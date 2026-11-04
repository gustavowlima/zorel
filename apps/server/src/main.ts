import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Api, CronInvalid, GitFailed, MAX_ATTACHMENT_BYTES, type ToolInfo, UndoConflict, USAGE_DAYS } from "@zero/contracts"
import { ZeroRpc } from "@zero/contracts/events"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join, normalize, resolve } from "node:path"
import { ask, consolidate, DataDir, prepare } from "./chat.ts"
import * as Git from "./git.ts"
import { MAX_AFTER, snippet } from "./context.ts"

const CHARS_PER_TOKEN = 4 // rough, provider-neutral: the meter says it is an estimate
import { Store, type Repository } from "./db.ts"
import { Engines, listModels, splitModel } from "./engines.ts"
import { claudeCommands } from "./engines/claude-sdk.ts"
import { API_KEYS, mcpEnvName, Secrets } from "./secrets.ts"
import { Accounts } from "./accounts.ts"
import { Actor } from "./access.ts"
import { Actions, Audit, changed } from "./audit.ts"
import { LoggerLive } from "./observability.ts"
import { Runtime } from "./runtime.ts"
import { RoutineScheduler, runRoutine } from "./routines.ts"
import { createRoutineFor, newToken, nextRun } from "./schedule.ts"
import { BUILDER } from "./team.ts"
import { Tools } from "./tools.ts"
import { billingOf, Pricing } from "./pricing.ts"
import { clean, measure } from "./storage.ts"
import { Workspace } from "./workspace.ts"
import { projectFor } from "./chat.ts"
import { closeTerminal, scriptsOf, serversIn, TerminalSocket, terminalsOf } from "./terminals.ts"
import { BrowserService, BrowserSocket } from "./browser.ts"

const notFound = () => Effect.fail(new HttpApiError.NotFound())
const found = <A, E, R>(e: Effect.Effect<A | undefined, E, R>) => Effect.flatMap(e, (a) => (a === undefined ? notFound() : Effect.succeed(a)))
const exists = <A>(e: Effect.Effect<A | undefined>) => Effect.map(e, (a) => a !== undefined)

// A chat's agents: they exist and are global or from the same project.
const validAgents = (store: Repository, agentIds: ReadonlyArray<string>, projectId: string | null) =>
  Effect.forEach(agentIds, store.agent).pipe(Effect.map((as) => as.every((a) => !!a && (a.projectId === null || a.projectId === projectId))))
// Optional project that, if given, must exist.
const projectOk = (store: Repository, projectId: string | null) => (projectId ? exists(store.project(projectId)) : Effect.succeed(true))

const Projects = HttpApiBuilder.group(Api, "projects", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    const { hub } = yield* Tools
    const workspace = yield* Workspace
    const audit = yield* Audit
    // A folder is stored only after the Workspace accepts it (absolute, real, a directory, not root/home/data).
    const withPath = <T extends { path?: string | null | undefined }>(input: T) =>
      input.path ? Effect.map(workspace.validate(input.path), (path) => ({ ...input, path })) : Effect.succeed(input)
    return h
      .handle("list", () => store.projects())
      .handle("create", ({ payload }) =>
        Effect.flatMap(withPath(payload), store.createProject).pipe(
          Effect.tap((p) => audit.record(Actions.projectCreated, { target: p, after: { name: p.name, path: p.path } }))
        )
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const before = yield* store.project(params.id)
          // The default agent must be one the project's chats can have: global, or of this project.
          if (payload.defaultAgentId) {
            const a = yield* store.agent(payload.defaultAgentId)
            if (!a || (a.projectId !== null && a.projectId !== params.id)) return yield* notFound()
          }
          const after = yield* Effect.flatMap(withPath(payload), (p) => found(store.updateProject(params.id, p)))
          if (before) yield* audit.record(Actions.projectUpdated, { target: after, ...changed(before, after, ["name", "brief", "path", "defaultAgentId"]) })
          return after
        })
      )
      .handle("files", ({ params, query }) =>
        Effect.gen(function* () {
          const project = yield* store.project(params.id)
          if (!project) return yield* notFound()
          // Marks are relative to the chat's first checkpoint: what this conversation changed.
          const since = query.chatId ? yield* store.firstTree(query.chatId) : null
          const chat = query.chatId ? yield* store.chat(query.chatId) : undefined
          return yield* workspace.files((chat ? projectFor(chat, project) : project)!, since ?? null)
        })
      )
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          const servers = (yield* store.mcpServers()).filter((s) => s.projectId === params.id)
          yield* Effect.promise(() => Promise.all(servers.map((s) => hub.close(s.id))))
          const project = yield* store.project(params.id)
          yield* store.removeProject(params.id)
          if (project) yield* audit.record(Actions.projectDeleted, { target: project })
        })
      )
      .handle("reorder", ({ payload }) => store.reorderProjects(payload.ids))
  })
)

const AGENT_FIELDS = ["name", "title", "description", "instructions", "model", "accountId", "effort", "failover", "access", "permissions"] as const

const Agents = HttpApiBuilder.group(Api, "agents", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    const audit = yield* Audit
    return h
      .handle("list", () => store.agents())
      .handle("create", ({ payload }) =>
        Effect.flatMap(projectOk(store, payload.projectId), (ok) => (ok ? store.createAgent(payload) : notFound())).pipe(
          Effect.tap((a) => audit.record(Actions.agentCreated, { target: a, after: { name: a.name, model: a.model, access: a.access } }))
        )
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const before = yield* store.agent(params.id)
          const after = yield* found(store.updateAgent(params.id, payload))
          if (before) yield* audit.record(Actions.agentUpdated, { target: after, ...changed(before, after, AGENT_FIELDS) })
          return after
        })
      )
      .handle("builder", ({ payload }) =>
        Effect.gen(function* () {
          if (!(yield* projectOk(store, payload.projectId))) return yield* notFound()
          // The Builder is Zero's own agent (builtin): out of the team lists, talked to only on the Build screen.
          const existing = (yield* store.agents()).find((a) => a.builtin === "builder")
          const builder = existing ?? (yield* store.createAgent({ projectId: null, name: BUILDER.name, title: BUILDER.title, description: BUILDER.description, instructions: BUILDER.instructions, model: payload.model, access: BUILDER.access, builtin: "builder" }))
          if (!existing) yield* audit.record(Actions.agentCreated, { target: builder, after: { name: builder.name, model: builder.model, access: builder.access } })
          // Each visit starts fresh (as in Tucano): the screen's previous conversation here goes away.
          for (const old of yield* store.hiddenChats(payload.projectId)) yield* store.removeChat(old.id)
          const chat = yield* store.createChat({ projectId: payload.projectId, agentIds: [builder.id], model: payload.model, hidden: true })
          return (yield* store.updateChat(chat.id, { title: "Build agents" }))!
        })
      )
      .handle("versions", ({ params }) =>
        Effect.flatMap(store.agent(params.id), (a) => (a ? Effect.map(store.agentVersions(a.id), (vs) => vs.map(({ agentId: _, ...v }) => v)) : notFound()))
      )
      // A past profile becomes the current one (recorded as a new version; nothing is lost).
      .handle("restore", ({ params }) =>
        Effect.gen(function* () {
          const before = yield* store.agent(params.id)
          const v = before && (yield* store.agentVersions(before.id)).find((x) => x.n === params.n)
          if (!before || !v) return yield* notFound()
          const after = yield* found(store.updateAgent(before.id, v.profile))
          yield* audit.record(Actions.agentUpdated, { target: after, ...changed(before, after, AGENT_FIELDS), reason: `restored version ${v.n}` })
          return after
        })
      )
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          const agent = yield* store.agent(params.id)
          yield* store.removeAgent(params.id)
          if (agent) yield* audit.record(Actions.agentDeleted, { target: agent })
        })
      )
  })
)

const Chats = HttpApiBuilder.group(Api, "chats", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    const dataDir = yield* DataDir
    const workspace = yield* Workspace
    const audit = yield* Audit
    const pricing = yield* Pricing
    const services = yield* Effect.context<Store | Engines | DataDir>()
    const runtime = yield* Runtime
    // git/gh refusals go back to the person as GitFailed with git's own message.
    const gitTry = <A>(f: () => Promise<A>) =>
      Effect.tryPromise({ try: f, catch: (e) => new GitFailed({ message: e instanceof Error ? e.message : String(e) }) })
    // A git step in the audit log, on the chat's project.
    const gitAudit = (chatId: string, a: (typeof Actions)[keyof typeof Actions], after: Record<string, unknown>) =>
      Effect.gen(function* () {
        const chat = yield* store.chat(chatId)
        const project = chat?.projectId ? yield* store.project(chat.projectId) : undefined
        yield* audit.record(a, { target: { id: project?.id ?? chatId, name: project?.name ?? chat?.title ?? chatId }, after })
      })
    // The folder the chat's agents and shells work in.
    const chatRoot = (id: string) =>
      Effect.gen(function* () {
        const chat = yield* store.chat(id)
        if (!chat) return yield* notFound()
        return workspace.cwdOf(chat.id, projectFor(chat, chat.projectId ? yield* store.project(chat.projectId) : undefined))
      })
    // A turn with workspace checkpoints, its project and whether its changes were undone.
    const turnWithTrees = (id: string) =>
      Effect.gen(function* () {
        const row = yield* store.turnRow(id)
        if (!row?.treeBefore || !row.treeAfter) return undefined
        const chat = yield* store.chat(row.chatId)
        if (!chat?.projectId) return undefined
        const message = row.messageId ? (yield* store.messages(row.chatId)).find((m) => m.id === row.messageId) : undefined
        return { row, projectId: chat.projectId, before: row.treeBefore, after: row.treeAfter, revertedAt: message?.revertedAt ?? null }
      })
    return h
      .handle("list", () => store.chats())
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          if (!(yield* projectOk(store, payload.projectId)) || !(yield* validAgents(store, payload.agentIds, payload.projectId))) return yield* notFound()
          return yield* store.createChat(payload)
        })
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const chat = yield* store.chat(params.id)
          if (!chat || (payload.agentIds && !(yield* validAgents(store, payload.agentIds, chat.projectId)))) return yield* notFound()
          return yield* found(store.updateChat(params.id, payload))
        })
      )
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          // Its worktree goes with it when nothing in it is uncommitted (else it stays on disk, with its branch).
          const chat = yield* store.chat(params.id)
          const project = chat?.worktree && chat.projectId ? yield* store.project(chat.projectId) : undefined
          if (chat?.worktree && project?.path) {
            const removed = yield* Effect.promise(() => Git.removeWorktree(project.path!, chat.worktree!).catch(() => false))
            if (!removed) yield* Effect.logInfo("worktree kept: it has uncommitted changes", { chatId: chat.id, worktree: chat.worktree })
          }
        }).pipe(
          Effect.andThen(store.removeChat(params.id)),
          Effect.tap(() =>
            Effect.sync(() => {
              rmSync(join(dataDir, "attachments", params.id), { recursive: true, force: true })
              for (const s of terminalsOf(params.id)) closeTerminal(s.id) // its shells end with it
            })
          )
        )
      )
      .handle("terminals", ({ params }) => Effect.flatMap(store.chat(params.id), (chat) => (chat ? Effect.sync(() => terminalsOf(chat.id)) : notFound())))
      .handle("closeTerminal", ({ params }) =>
        Effect.sync(() => {
          if (terminalsOf(params.id).some((s) => s.id === params.terminal)) closeTerminal(params.terminal)
        })
      )
      .handle("git", ({ params }) => Effect.flatMap(chatRoot(params.id), (root) => Effect.promise(() => Git.status(root))))
      // The chat's model drafts the message from the diff (commit) or the commits ahead of the default branch (PR).
      .handle("gitDraft", ({ params, payload }) =>
        Effect.gen(function* () {
          const root = yield* chatRoot(params.id)
          const chat = (yield* store.chat(params.id))!
          const prompt = yield* gitTry(() => (payload.kind === "commit" ? Git.commitDraftPrompt(root) : Git.prDraftPrompt(root)))
          const answer = yield* ask(chat.model, prompt).pipe(Effect.provide(services))
          if (answer.error || !answer.text.trim()) return yield* new GitFailed({ message: answer.error ?? "The model gave no answer." })
          if (payload.kind === "pr") return Git.parsePrDraft(answer.text)
          const [title = "", ...rest] = Git.cleanMessage(answer.text).split("\n")
          return { title, body: rest.join("\n").trim() }
        })
      )
      .handle("gitCommit", ({ params, payload }) =>
        Effect.gen(function* () {
          const root = yield* chatRoot(params.id)
          const sha = yield* gitTry(() => Git.commit(root, payload.message))
          yield* gitAudit(params.id, Actions.gitCommitted, { commit: sha, message: payload.message.split("\n")[0] })
          return { sha }
        })
      )
      .handle("gitPush", ({ params }) =>
        Effect.gen(function* () {
          const root = yield* chatRoot(params.id)
          yield* gitTry(() => Git.push(root))
          yield* gitAudit(params.id, Actions.gitPushed, {})
        })
      )
      .handle("gitPr", ({ params, payload }) =>
        Effect.gen(function* () {
          const root = yield* chatRoot(params.id)
          const url = yield* gitTry(() => Git.createPr(root, payload.title, payload.body))
          yield* gitAudit(params.id, Actions.gitPrCreated, { url, title: payload.title })
          return { url }
        })
      )
      .handle("gitBranch", ({ params, payload }) =>
        Effect.gen(function* () {
          const root = yield* chatRoot(params.id)
          yield* gitTry(() => Git.switchToNewBranch(root, payload.name))
          yield* gitAudit(params.id, Actions.gitBranched, { branch: payload.name })
        })
      )
      // The chat moves to a new worktree of its project, on a new branch from where the project is now. The next turn
      // opens its engine session there (the session key carries the folder).
      .handle("enterWorktree", ({ params, payload }) =>
        Effect.gen(function* () {
          const chat = yield* store.chat(params.id)
          if (!chat) return yield* notFound()
          const project = chat.projectId ? yield* store.project(chat.projectId) : undefined
          if (!project?.path) return yield* new GitFailed({ message: "Only a chat in a project with a folder can have a worktree." })
          if (chat.worktree) return yield* new GitFailed({ message: "This chat already works in a worktree." })
          if (runtime.busy(chat.id)) return yield* new GitFailed({ message: "Wait for the turn to finish." })
          const dir = join(dataDir, "worktrees", project.id, chat.id)
          const branch = payload.branch ?? Git.branchFor(chat.title, chat.id)
          yield* gitTry(() => Git.addWorktree(project.path!, dir, branch))
          yield* store.setWorktree(chat.id, dir)
          yield* gitAudit(chat.id, Actions.gitBranched, { branch, worktree: dir })
        })
      )
      // Back to the project folder. The worktree goes only when nothing in it is uncommitted; its branch stays.
      .handle("leaveWorktree", ({ params }) =>
        Effect.gen(function* () {
          const chat = yield* store.chat(params.id)
          if (!chat) return yield* notFound()
          if (!chat.worktree) return
          if (runtime.busy(chat.id)) return yield* new GitFailed({ message: "Wait for the turn to finish." })
          const project = chat.projectId ? yield* store.project(chat.projectId) : undefined
          const removed = project?.path ? yield* gitTry(() => Git.removeWorktree(project.path!, chat.worktree!)) : true
          if (!removed) return yield* new GitFailed({ message: "The worktree has uncommitted changes: commit them (or discard them) first." })
          yield* store.setWorktree(chat.id, null)
        })
      )
      .handle("rewind", ({ params, payload }) =>
        Effect.gen(function* () {
          const chat = yield* store.chat(params.id)
          if (!chat) return yield* notFound()
          if (runtime.busy(chat.id)) return yield* new HttpApiError.Conflict()
          const all = yield* store.messages(chat.id)
          const cut = all.find((m) => m.id === payload.messageId && m.role === "user")
          if (!cut) return yield* notFound()
          const later = all.filter((m) => m.at >= cut.at)
          // Files first (newest turn first), so a conflict leaves the conversation untouched.
          if (payload.files) {
            const project = chat.projectId ? yield* store.project(chat.projectId) : undefined
            for (const m of later.filter((x) => x.turnId && x.changes.length && !x.revertedAt).reverse()) {
              const t = yield* turnWithTrees(m.turnId!)
              if (!t || !project) continue
              const { conflicts } = yield* workspace.restore(projectFor(chat, project)!, t.before, t.after)
              if (conflicts.length) return yield* new UndoConflict({ files: conflicts })
              yield* store.markReverted(t.row.id)
            }
          }
          yield* store.deleteMessagesFrom(chat.id, cut.at)
          if (chat.summaryUntil >= cut.at) yield* store.setSummary(chat.id, "", 0) // the summary covered what went
          yield* runtime.forget(chat.id)
          return { text: cut.text }
        })
      )
      .handle("search", ({ query }) =>
        Effect.map(store.searchMessages(query.q.trim()), (rows) => rows.map((m) => ({ chatId: m.chatId, messageId: m.id, at: m.at, snippet: snippet(m.text, query.q.trim()) })))
      )
      .handle("scripts", ({ params }) => Effect.map(chatRoot(params.id), scriptsOf))
      .handle("servers", ({ params }) => Effect.map(chatRoot(params.id), serversIn))
      // Stops a server of that list (SIGTERM); a pid outside it is not found.
      .handle("stopServer", ({ params }) =>
        Effect.flatMap(chatRoot(params.id), (root) =>
          serversIn(root).some((s) => s.pid === params.pid) ? Effect.sync(() => void process.kill(params.pid, "SIGTERM")) : notFound()
        )
      )
      // A path printed in the terminal, opened in the computer's default app; only files inside the chat's folder.
      .handle("openFile", ({ params, payload }) =>
        Effect.gen(function* () {
          const chat = yield* store.chat(params.id)
          if (!chat) return yield* notFound()
          const root = yield* chatRoot(chat.id)
          const file = resolve(root, payload.path)
          if (!(file === root || file.startsWith(`${root}/`)) || !existsSync(file)) return yield* new HttpApiError.BadRequest()
          yield* Effect.sync(() => Bun.spawn(["open", file], { stdout: "ignore", stderr: "ignore" }))
        })
      )
      .handle("reorder", ({ payload }) => store.reorderChats(payload.projectId, payload.ids))
      .handle("messages", ({ params }) => store.messages(params.id))
      // The slash commands of the chat's engine, read in the folder the agents work in (Claude Code only).
      .handle("commands", ({ params }) =>
        Effect.gen(function* () {
          const chat = yield* store.chat(params.id)
          if (!chat) return yield* notFound()
          if (splitModel(chat.model).provider !== "claude-cli") return []
          const project = chat.projectId ? yield* store.project(chat.projectId) : undefined
          const account = yield* store.account(chat.accountId ?? "claude-default")
          return yield* Effect.promise(() => claudeCommands(account?.home ?? undefined, workspace.cwdOf(chat.id, projectFor(chat, project))))
        })
      )
      // The next turn as the lead would get it, measured part by part.
      .handle("context", ({ params }) =>
        Effect.gen(function* () {
          const chat = yield* store.chat(params.id)
          if (!chat) return yield* notFound()
          const lead = chat.agentIds[0] ? yield* store.agent(chat.agentIds[0]) : undefined
          const turn = yield* prepare(store, chat, lead, chat.model, dataDir, undefined)
          const since = yield* store.messagesAfter(chat.id, chat.summaryUntil)
          const tokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN)
          const sizes = turn.parts ?? { instructions: turn.system.length, memories: 0, skills: 0, summary: 0 }
          const parts = [
            { id: "instructions" as const, tokens: tokens(sizes.instructions) },
            { id: "memories" as const, tokens: tokens(sizes.memories) },
            { id: "skills" as const, tokens: tokens(sizes.skills) },
            { id: "summary" as const, tokens: tokens(sizes.summary) },
            { id: "messages" as const, tokens: tokens(turn.messages.reduce((n, m) => n + m.text.length, 0)) }
          ]
          return {
            model: chat.model,
            windowTokens: pricing.contextWindow(chat.model),
            usedTokens: parts.reduce((n, x) => n + x.tokens, 0),
            parts,
            messagesSinceSummary: since.length,
            compactAfter: MAX_AFTER,
            lastInputTokens: since.findLast((m) => m.role === "assistant" && m.inputTokens > 0)?.inputTokens ?? null
          }
        })
      )
      .handle("consolidate", ({ params }) =>
        consolidate(params.id, true).pipe(
          Effect.provide(services),
          Effect.catchTags({ NotFound: () => notFound(), Busy: () => Effect.fail(new HttpApiError.Conflict()) })
        )
      )
      .handle("diff", ({ params }) =>
        Effect.gen(function* () {
          const t = yield* turnWithTrees(params.id)
          if (!t) return yield* notFound()
          return { turnId: t.row.id, files: yield* workspace.diff(t.projectId, t.before, t.after), revertedAt: t.revertedAt }
        })
      )
      .handle("undo", ({ params }) =>
        Effect.gen(function* () {
          const t = yield* turnWithTrees(params.id)
          const project = t && (yield* store.project(t.projectId))
          if (!t || !project) return yield* notFound()
          // In the folder the chat works in now (its worktree, if it has one).
          const chat = yield* store.chat(t.row.chatId)
          const { conflicts } = yield* workspace.restore((chat ? projectFor(chat, project) : project)!, t.before, t.after)
          if (conflicts.length) return yield* new UndoConflict({ files: conflicts })
          yield* store.markReverted(t.row.id)
          const files = yield* workspace.diff(t.projectId, t.before, t.after)
          yield* audit.record(Actions.turnUndone, { target: { id: t.row.id, name: (yield* store.chat(t.row.chatId))?.title ?? project.name }, before: { files: files.map((f) => f.path) } })
          return { turnId: t.row.id, files: yield* workspace.diff(t.projectId, t.before, t.after), revertedAt: Date.now() }
        })
      )
  })
)

const Memories = HttpApiBuilder.group(Api, "memories", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    const actor = yield* Actor
    return h
      .handle("list", () => store.memories())
      // Written by the user: starts active. Duplicate: returns the existing one.
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          const added = yield* store.addMemory({ ...payload, state: "active", origin: "manual", chatId: null, owner: actor.id })
          return added ?? (yield* store.memories()).find((m) => m.scope === payload.scope && m.text === payload.text)!
        })
      )
      .handle("update", ({ params, payload }) => found(store.updateMemory(params.id, payload)))
  })
)

const ToolsGroup = HttpApiBuilder.group(Api, "tools", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    const secrets = yield* Secrets
    const { hub } = yield* Tools
    const runtime = yield* Runtime
    const audit = yield* Audit
    return h
      .handle("list", () => store.mcpServers())
      .handle("create", ({ payload: { env, ...input } }) =>
        Effect.gen(function* () {
          if (!(yield* projectOk(store, input.projectId))) return yield* notFound()
          const server = yield* store.createMcpServer({ ...input, envKeys: Object.keys(env) })
          if (Object.keys(env).length) yield* Effect.promise(() => secrets.set(mcpEnvName(server.id), JSON.stringify(env))) // values only in the keychain
          yield* audit.record(Actions.mcpAdded, { target: server, after: { mode: server.mode, envKeys: Object.keys(env) } })
          return server
        })
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const before = yield* store.mcpServer(params.id)
          yield* Effect.promise(() => hub.close(params.id))
          const after = yield* found(store.updateMcpServer(params.id, payload))
          if (before) yield* audit.record(Actions.mcpUpdated, { target: after, ...changed(before, after, Object.keys(payload)) })
          return after
        })
      )
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          const server = yield* store.mcpServer(params.id)
          yield* Effect.promise(async () => {
            await hub.close(params.id)
            await secrets.set(mcpEnvName(params.id), "")
          })
          yield* store.removeMcpServer(params.id)
          if (server) yield* audit.record(Actions.mcpRemoved, { target: server })
        })
      )
      .handle("inspect", ({ params }) =>
        Effect.flatMap(found(store.mcpServer(params.id)), (server) =>
          Effect.promise(() =>
            hub.tools(server).then(
              (tools) => ({ tools: tools.map(({ name, description, cls }): ToolInfo => ({ name, description, cls })), error: null }),
              (e: unknown) => ({ tools: [], error: e instanceof Error ? e.message : String(e) })
            )
          )
        )
      )
      .handle("decide", ({ params, payload }) =>
        runtime.decide(params.id, payload.approve ? "approved" : "denied").pipe(Effect.catchTag("ApprovalNotFound", () => notFound()))
      )
  })
)

const AccountsGroup = HttpApiBuilder.group(Api, "accounts", (h) =>
  Effect.gen(function* () {
    const accounts = yield* Accounts
    const audit = yield* Audit
    const named = (id: string) => Effect.map(accounts.list, (all) => all.find((a) => a.id === id))
    return h
      .handle("list", () => accounts.list)
      .handle("create", ({ payload }) =>
        accounts.create(payload.provider, payload.label).pipe(Effect.tap((a) => audit.record(Actions.accountAdded, { target: { id: a.id, name: a.label }, after: { provider: a.provider } })))
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const before = yield* named(params.id)
          const after = yield* found(accounts.rename(params.id, payload.label))
          yield* audit.record(Actions.accountRenamed, { target: { id: after.id, name: after.label }, before: { label: before?.label }, after: { label: after.label } })
          return after
        })
      )
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          const account = yield* named(params.id)
          const r = yield* accounts.remove(params.id)
          if (r === "not-found") return yield* notFound()
          if (r !== "ok") return yield* Effect.fail(new HttpApiError.Conflict())
          if (account) yield* audit.record(Actions.accountRemoved, { target: { id: account.id, name: account.label } })
        })
      )
      .handle("login", ({ params }) =>
        Effect.gen(function* () {
          const r = yield* accounts.login(params.id)
          if (r === "not-found") return yield* notFound()
          if (r === "busy") return yield* Effect.fail(new HttpApiError.Conflict())
          const account = yield* named(params.id)
          if (account) yield* audit.record(Actions.accountSignInStarted, { target: { id: account.id, name: account.label } })
          return r
        })
      )
      .handle("limits", ({ params }) => found(accounts.refreshLimits(params.id)))
  })
)

// The failover terms warning (§6.1) is accepted once and remembered here.
const FAILOVER_TERMS = "failover_terms_accepted_at"
const preferencesOf = (store: Repository) =>
  Effect.map(Effect.all([store.preference(FAILOVER_TERMS), store.preference("paused")]), ([v, p]) => ({ failoverTermsAcceptedAt: v ? Number(v) : null, paused: p === "1" }))

const Settings = HttpApiBuilder.group(Api, "settings", (h) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const accounts = yield* Accounts
    const store = yield* Store
    const audit = yield* Audit
    const dataDir = yield* DataDir
    const runtime = yield* Runtime
    const storageReport = Effect.gen(function* () {
      const [projects, chats, messages] = yield* Effect.all([store.projects(), store.chats(), store.messageCounts()])
      return yield* Effect.promise(() => measure(dataDir, { projects, chats, messages }))
    })
    return h
      .handle("audit", ({ query }) => audit.list(query))
      .handle("storage", () => storageReport)
      .handle("cleanStorage", ({ params }) =>
        Effect.gen(function* () {
          const before = yield* storageReport
          const [chats, projects] = yield* Effect.all([store.chats(), store.projects()])
          const removed = clean(dataDir, params.id, new Set(chats.map((c) => c.id)), new Set(projects.map((p) => p.id)))
          const freed = before.cleanup.find((c) => c.id === params.id)?.bytes ?? 0
          yield* audit.record(Actions.storageCleaned, { target: { id: params.id, name: params.id }, after: { items: removed, bytes: freed } })
          return yield* storageReport
        })
      )
      .handle("models", () => Effect.flatMap(accounts.cliModels, (cli) => Effect.promise(() => listModels(secrets, cli))))
      .handle("usage", () => Effect.map(store.usage(Date.now() - USAGE_DAYS * 86_400_000), (rows) => rows.map((r) => ({ ...r, billing: billingOf(r.model) }))))
      .handle("topTurns", ({ query }) =>
        Effect.map(store.topTurns(query.since), (rows) => rows.map((r) => ({ ...r, cost: r.cost ?? 0, billing: billingOf(r.model) })))
      )
      .handle("preferences", () => preferencesOf(store))
      .handle("pause", ({ payload }) => runtime.setPaused(payload.paused))
      .handle("acceptFailoverTerms", () =>
        Effect.andThen(
          store.setPreference(FAILOVER_TERMS, String(Date.now())).pipe(Effect.tap(() => audit.record(Actions.failoverTermsAccepted, { target: { id: FAILOVER_TERMS, name: "Failover" } }))),
          preferencesOf(store)
        )
      )
      .handle("keys", () => Effect.sync(() => API_KEYS.map((name) => ({ name, set: !!secrets.get(name), fromEnv: secrets.fromEnv(name) }))))
      // The value never reaches the audit log: only which key was set or cleared.
      .handle("setKey", ({ params, payload }) =>
        (API_KEYS as ReadonlyArray<string>).includes(params.name)
          ? Effect.promise(() => secrets.set(params.name, payload.value.trim())).pipe(
              Effect.tap(() => audit.record(payload.value.trim() ? Actions.apiKeySet : Actions.apiKeyCleared, { target: { id: params.name, name: params.name } }))
            )
          : notFound()
      )
  })
)

// Turns: effect/rpc over WebSocket at /rpc (ARCHITECTURE §4). The global LocalOnly also covers the upgrade.
const RpcHandlers = ZeroRpc.toLayer(
  Effect.gen(function* () {
    const runtime = yield* Runtime
    const store = yield* Store
    return {
      send: (p) => runtime.send(p),
      steer: (p) => runtime.steer(p.chatId, p.text, p.attachmentIds),
      interrupt: (p) => runtime.interrupt(p.chatId),
      decide: (p) => runtime.decide(p.approvalId, p.outcome, p.reason),
      subscribeChat: (p) => runtime.subscribeChat(p.chatId),
      subscribeStatus: () => runtime.subscribeStatus,
      approvals: () => store.openApprovals(),
      runs: (p) => store.runsOf(p.chatId)
    }
  })
)
const RpcRoute = RpcServer.layerHttp({ group: ZeroRpc, path: "/rpc", protocol: "websocket" }).pipe(Layer.provide([RpcHandlers, RpcSerialization.layerJson]))

// Web build (apps/web/dist), when present: a single process serves the API and the UI.
// Attachments (ARCHITECTURE §12): raw body upload, outside HttpApi like the RPC route. The file goes to
// <dataDir>/attachments/<chat>/<id>; the name travels in x-file-name (URI-encoded).
const AttachmentUpload = HttpRouter.add(
  "POST",
  "/api/chats/:id/attachments",
  Effect.gen(function* () {
    const { id: chatId } = yield* HttpRouter.schemaPathParams(Schema.Struct({ id: Schema.String }))
    const req = yield* HttpServerRequest.HttpServerRequest
    const store = yield* Store
    const dataDir = yield* DataDir
    if (!(yield* store.chat(chatId))) return HttpServerResponse.jsonUnsafe({ error: "chat_not_found" }, { status: 404 })
    const declared = Number(req.headers["content-length"] ?? 0)
    if (declared > MAX_ATTACHMENT_BYTES) return HttpServerResponse.jsonUnsafe({ error: "too_large" }, { status: 413 })
    const body = new Uint8Array(yield* req.arrayBuffer)
    if (!body.length || body.length > MAX_ATTACHMENT_BYTES) return HttpServerResponse.jsonUnsafe({ error: body.length ? "too_large" : "empty" }, { status: body.length ? 413 : 400 })
    const name = decodeURIComponent(req.headers["x-file-name"] ?? "arquivo").replace(/[/\\]/g, "_").slice(0, 200) || "arquivo"
    const mime = (req.headers["content-type"] ?? "application/octet-stream").split(";")[0]!.trim().slice(0, 100)
    const id = crypto.randomUUID()
    const dir = join(dataDir, "attachments", chatId)
    mkdirSync(dir, { recursive: true })
    yield* Effect.promise(() => Bun.write(join(dir, id), body))
    return HttpServerResponse.jsonUnsafe(yield* store.addAttachment({ id, chatId, name, mime, size: body.length, path: join(dir, id) }))
  }).pipe(Effect.catchTag("SchemaError", () => Effect.succeed(HttpServerResponse.jsonUnsafe({ error: "bad_request" }, { status: 400 }))), Effect.orDie)
)
const AttachmentFile = HttpRouter.add(
  "GET",
  "/api/attachments/:id",
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.schemaPathParams(Schema.Struct({ id: Schema.String }))
    const a = yield* (yield* Store).attachment(id)
    if (!a || !existsSync(a.path)) return HttpServerResponse.empty({ status: 404 })
    return yield* HttpServerResponse.file(a.path).pipe(
      Effect.map(HttpServerResponse.setHeaders({ "content-type": a.mime, "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(a.name)}`, "x-content-type-options": "nosniff" }))
    )
  }).pipe(Effect.orDie)
)

const WebRoute = (dir: string) =>
  HttpRouter.add("GET", "/*", (req) => {
    const path = normalize(join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname)))
    const file = path.startsWith(dir) && existsSync(path) && !path.endsWith("/") && Bun.file(path).size > 0 ? path : join(dir, "index.html")
    // index.html always revalidates (it points at the current build); hashed assets never change.
    const cache = file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable"
    return HttpServerResponse.file(file).pipe(Effect.map(HttpServerResponse.setHeader("cache-control", cache)), Effect.orDie)
  })

// The server is local, with no login: it only accepts clients that talk to it as local. Unlisted Host blocks DNS rebinding;
// Origin from another site blocks CSRF (a "simple" POST from any page would trigger a turn with tools).
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])
const hostname = (value: string | undefined) => {
  if (!value) return undefined
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname
  } catch {
    return "invalid"
  }
}
export function isLocalRequest(headers: Readonly<Record<string, string | undefined>>): boolean {
  const host = hostname(headers.host)
  if (!host || !LOCAL.has(host)) return false
  if (!headers.origin) return true // same origin on GET, curl, CLIs
  return LOCAL.has(hostname(headers.origin) ?? "") // "null" (sandbox, file://) is also rejected
}

const LocalOnly = HttpRouter.middleware(
  (app) =>
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest
      return isLocalRequest(req.headers) ? yield* app : HttpServerResponse.text("forbidden", { status: 403 })
    }),
  { global: true }
)

// Knowledge pages (phase 3b): CRUD, pin, versions and restore. Every edit is a version.
const PagesGroup = HttpApiBuilder.group(Api, "pages", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    return h
      .handle("list", () => store.pages())
      .handle("create", ({ payload }) => store.savePage(payload))
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const p = yield* store.page(params.id)
          if (!p) return yield* notFound()
          if (payload.pinned !== undefined) yield* store.pinPage(p.id, payload.pinned)
          if (payload.title !== undefined || payload.body !== undefined) return yield* store.savePage({ id: p.id, scope: p.scope, title: payload.title ?? p.title, body: payload.body ?? p.body })
          return (yield* store.page(p.id))!
        })
      )
      .handle("remove", ({ params }) => store.removePage(params.id))
      .handle("versions", ({ params }) =>
        Effect.flatMap(store.page(params.id), (p) => (p ? Effect.map(store.pageVersions(p.id), (vs) => vs.map(({ pageId: _, ...v }) => v)) : notFound()))
      )
      .handle("restore", ({ params }) =>
        Effect.gen(function* () {
          const p = yield* store.page(params.id)
          const v = p && (yield* store.pageVersions(p.id)).find((x) => x.n === params.n)
          if (!p || !v) return yield* notFound()
          return yield* store.savePage({ id: p.id, scope: p.scope, title: v.title, body: v.body })
        })
      )
  })
)

// Routines (phase 7): CRUD, run now, and the local webhook. Creating one opens its chat with its agent.
const RoutinesGroup = HttpApiBuilder.group(Api, "routines", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    const services = yield* Effect.context<Store | Runtime>()
    const schedule = (cron: string | null) =>
      Effect.suspend(() => {
        if (cron === null) return Effect.succeed(null)
        const next = nextRun(cron)
        return "error" in next ? Effect.fail(new CronInvalid({ message: next.error })) : Effect.succeed(next.at)
      })
    const run = (id: string, key: string, payload?: unknown) => runRoutine(id, key, payload).pipe(Effect.provide(services))
    return h
      .handle("list", () => store.routines())
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          const agent = yield* store.agent(payload.agentId)
          if (!agent) return yield* notFound()
          return yield* createRoutineFor(store, agent, payload).pipe(Effect.mapError((message) => new CronInvalid({ message })))
        })
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const r = yield* store.routine(params.id)
          if (!r) return yield* notFound()
          const cron = payload.cron === undefined ? r.cron : payload.cron
          const enabled = payload.enabled ?? r.enabled
          const nextRunAt = enabled ? yield* schedule(cron) : null
          const token = payload.webhook === undefined ? r.token : payload.webhook ? (r.token ?? newToken()) : null
          return (yield* store.updateRoutine(r.id, { name: payload.name, prompt: payload.prompt, cron, enabled, nextRunAt, token }))!
        })
      )
      .handle("remove", ({ params }) => store.removeRoutine(params.id))
      .handle("run", ({ params }) => Effect.flatMap(run(params.id, `now-${Date.now()}`), (r) => (r === "missing" ? notFound() : Effect.void)))
      .handle("hook", ({ params, payload }) =>
        Effect.gen(function* () {
          const r = yield* store.routineByToken(params.token)
          if (!r || !r.enabled) return yield* notFound()
          yield* run(r.id, `hook-${Date.now()}`, payload)
        })
      )
  })
)

export const AppLive = (webDir?: string) =>
  Layer.mergeAll(
    LocalOnly,
    HttpApiBuilder.layer(Api).pipe(Layer.provide([Projects, Agents, Chats, Memories, ToolsGroup, AccountsGroup, Settings, RoutinesGroup, PagesGroup])),
    RoutineScheduler,
    RpcRoute,
    AttachmentUpload,
    AttachmentFile,
    TerminalSocket,
    BrowserSocket,
    ...(webDir && existsSync(join(webDir, "index.html")) ? [WebRoute(webDir)] : [])
  )

// Services with real dependencies (system keychain). Tests build their own with Secrets.memory.
export const services = (dbPath: string, dataDir: string, secrets?: Layer.Layer<Secrets, never, Store>) => {
  const store = Store.layer(dbPath)
  const withSecrets = Layer.provideMerge(secrets ?? Secrets.layer, store)
  const base = Layer.mergeAll(Layer.provideMerge(Layer.mergeAll(Engines.layer, Tools.layer), withSecrets), DataDir.layer(dataDir))
  const withAccounts = Layer.provideMerge(Layer.mergeAll(Accounts.layer, Workspace.layer, Pricing.layer, Audit.layer, BrowserService.layer), base)
  return Layer.mergeAll(Layer.provideMerge(Runtime.layer, withAccounts), Actor.local)
}

export interface StartOptions {
  readonly port?: number
  readonly dataDir?: string
  readonly webDir?: string
}

// Entry point also used by the desktop app.
export async function start(o: StartOptions = {}) {
  const dataDir = o.dataDir ?? process.env.ZERO_HOME ?? join(homedir(), ".zero")
  mkdirSync(dataDir, { recursive: true }) // don't spawn a shell just to create the folder
  const port = o.port ?? Number(process.env.PORT ?? 4317)
  const webDir = o.webDir ?? process.env.ZERO_WEB_DIR ?? resolve(import.meta.dir, "../../web/dist")
  AppLive(resolve(webDir)).pipe(
    HttpRouter.serve,
    Layer.provide(services(process.env.ZERO_DB ?? join(dataDir, "zero.db"), dataDir)),
    Layer.provide(BunHttpServer.layer({ port, hostname: "127.0.0.1" })),
    Layer.provide(LoggerLive),
    Layer.launch,
    BunRuntime.runMain
  )
  watchParent()
  return `http://127.0.0.1:${port}`
}

// Started by the desktop app: exit when it's gone (it crashed or was killed without stopping the server).
function watchParent() {
  const parent = Number(process.env.ZERO_PARENT_PID)
  if (!parent) return
  setInterval(() => {
    try {
      process.kill(parent, 0)
    } catch {
      process.exit(0)
    }
  }, 5000).unref()
}

if (import.meta.main) await start()
