import { discovered, pickedPaths } from "./file-skills.ts"
import { finishSignIn, isSignedIn, startSignIn } from "./oauth.ts"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Api, CronInvalid, GitFailed, MAX_ATTACHMENT_BYTES, type ToolInfo, UndoConflict, USAGE_DAYS } from "@zorel/contracts"
import { ZorelRpc } from "@zorel/contracts/events"
import { LOGIN_PATH, SESSION_BYTES, SESSION_COOKIE, SESSION_ENV, SESSION_HEADER } from "@zorel/contracts/session"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join, normalize, resolve, sep } from "node:path"
import { ask, consolidate, DataDir, DbPath, prepare } from "./chat.ts"
import * as Git from "./git.ts"
import { MAX_AFTER, snippet } from "./context.ts"

const CHARS_PER_TOKEN = 4 // rough, provider-neutral: the meter says it is an estimate
import { Store, type Repository } from "./db.ts"
import { Engines, listModels, splitModel } from "./engines.ts"
import { claudeCommands } from "./engines/claude-sdk.ts"
import { API_KEYS, mcpEnvName, oauthKey, Secrets } from "./secrets.ts"
import { Accounts } from "./accounts.ts"
import { Actor } from "./access.ts"
import { Actions, Audit, changed } from "./audit.ts"
import { LoggerLive } from "./observability.ts"
import { Runtime, type RuntimeService } from "./runtime.ts"
import { RoutineScheduler, runRoutine } from "./routines.ts"
import { createRoutineFor, newToken, nextRun } from "./schedule.ts"
import { BUILDER } from "./team.ts"
import { Tools } from "./tools.ts"
import { billingOf, Pricing } from "./pricing.ts"
import { clean, measure } from "./storage.ts"
import { Workspace } from "./workspace.ts"
import { projectFor } from "./chat.ts"
import { createFile, FsError, inside, moveInto, osCommand, readText, renamePath, restore, trash } from "./fs-ops.ts"
import { applyPendingImport, cancelImport, exportWorkspace, MAX_IMPORT_BYTES, pendingImport, stageImport } from "./transfer.ts"
import { cpus, totalmem } from "node:os"
import { listProcs, type Proc, sample, subtree } from "./procs.ts"
import { closeTerminal, liveTerminals, scriptsOf, serversUnder, TerminalSocket, terminalsOf } from "./terminals.ts"
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
          // The Builder is Zorel's own agent (builtin): out of the team lists, talked to only on the Build screen.
          const found = (yield* store.agents()).find((a) => a.builtin === "builder")
          // Zorel's own prompt evolves with Zorel: an existing Builder gets the current one (not a user edit to keep).
          const existing = found && found.instructions !== BUILDER.instructions ? yield* store.updateAgent(found.id, { instructions: BUILDER.instructions, description: BUILDER.description }, "Zorel") : found
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
    // The servers of a chat's folder (terminals.ts), placed also by the chat's own shells and agent sessions.
    const chatServers = (chatId: string, root: string) =>
      Effect.promise(() => serversUnder([root], ownedBy(runtime, new Map([[chatId, root]])))).pipe(Effect.map((list) => list.map(({ root: _root, ...s }) => s)))
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
      .handle("terminals", ({ params }) => Effect.flatMap(store.chat(params.id), (chat) => (chat ? Effect.promise(() => listProcs().then((procs) => terminalsOf(chat.id, procs))) : notFound())))
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
      .handle("servers", ({ params }) => Effect.flatMap(chatRoot(params.id), (root) => chatServers(params.id, root)))
      // Stops a server of that list (SIGTERM); a pid outside it is not found.
      .handle("stopServer", ({ params }) =>
        Effect.flatMap(chatRoot(params.id), (root) =>
          Effect.flatMap(chatServers(params.id, root), (list) => (list.some((s) => s.pid === params.pid) ? Effect.sync(() => void process.kill(params.pid, "SIGTERM")) : notFound()))
        )
      )
      // A path printed in the terminal, opened in the computer's default app; only files inside the chat's folder.
      .handle("openFile", ({ params, payload }) =>
        Effect.gen(function* () {
          const chat = yield* store.chat(params.id)
          if (!chat) return yield* notFound()
          const root = yield* chatRoot(chat.id)
          const file = yield* Effect.try(() => inside(root, payload.path)).pipe(Effect.mapError(() => new HttpApiError.BadRequest()))
          if (!existsSync(file)) return yield* new HttpApiError.BadRequest()
          yield* Effect.sync(() => Bun.spawn(osCommand("open", file), { stdout: "ignore", stderr: "ignore", windowsHide: true } as never))
        })
      )
      .handle("readFile", ({ params, query }) =>
        Effect.gen(function* () {
          const root = yield* chatRoot(params.id)
          return yield* Effect.try(() => readText(root, query.path)).pipe(Effect.mapError(() => new HttpApiError.BadRequest()))
        })
      )
      // The Files panel (fs-ops.ts): each op checks its paths stay inside the chat's folder.
      .handle("fs", ({ params, payload: p }) =>
        Effect.gen(function* () {
          const chat = yield* store.chat(params.id)
          if (!chat) return yield* notFound()
          const root = yield* chatRoot(chat.id)
          const trashDir = join(dataDir, "trash")
          return yield* Effect.try(() => {
            const need = <T>(v: T | undefined): T => {
              if (v === undefined || v === "") throw new FsError("missing")
              return v
            }
            if (p.op === "create") createFile(root, need(p.path))
            else if (p.op === "rename") renamePath(root, need(p.path), need(p.to))
            else if (p.op === "move") moveInto(root, need(p.paths), p.to ?? "")
            else if (p.op === "delete") return { trashId: trash(root, need(p.paths), trashDir) }
            else if (p.op === "restore") restore(root, need(p.id), trashDir)
            else Bun.spawn(osCommand(p.op, inside(root, need(p.path))), { stdout: "ignore", stderr: "ignore", windowsHide: true } as never)
            return { trashId: null }
          }).pipe(Effect.tapError((e) => Effect.logWarning("files op failed", p.op, String(e))), Effect.mapError(() => new HttpApiError.BadRequest()))
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
      // Approving a proposed improvement applies it to the skill it replaces (the old text becomes a version).
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const before = yield* store.memory(params.id)
          if (before?.state === "pending" && before.replaces && payload.state === "active") {
            const applied = yield* store.applyImprovement(before.id, "you")
            if (applied) return applied
          }
          return yield* found(store.updateMemory(params.id, payload))
        })
      )
      .handle("versions", ({ params }) => Effect.flatMap(store.memory(params.id), (m) => (m ? store.memoryVersions(m.id) : notFound())))
      // An earlier text comes back (the current one is kept as a version too).
      .handle("restore", ({ params, payload }) =>
        Effect.gen(function* () {
          const v = yield* store.memoryVersion(payload.versionId)
          if (!v || v.memoryId !== params.id) return yield* notFound()
          return yield* found(store.updateMemory(params.id, { title: v.title, text: v.text }))
        })
      )
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
          if (input.auth === "oauth" && !input.url) return yield* new HttpApiError.BadRequest()
          const server = yield* store.createMcpServer({ ...input, auth: input.auth ?? "none", envKeys: Object.keys(env) })
          if (Object.keys(env).length) yield* Effect.promise(() => secrets.set(mcpEnvName(server.id), JSON.stringify(env))) // values only in the keychain
          yield* audit.record(Actions.mcpAdded, { target: server, after: { mode: server.mode, envKeys: Object.keys(env) } })
          return server
        })
      )
      .handle("update", ({ params, payload: { env, ...payload } }) =>
        Effect.gen(function* () {
          const before = yield* store.mcpServer(params.id)
          if (!before) return yield* notFound()
          yield* Effect.promise(async () => {
            if (env) await secrets.set(mcpEnvName(params.id), Object.keys(env).length ? JSON.stringify(env) : "")
            await hub.close(params.id)
          })
          const after = yield* found(store.updateMcpServer(params.id, { ...payload, ...(env && { envKeys: Object.keys(env) }) }))
          yield* audit.record(Actions.mcpUpdated, { target: after, ...changed(before, after, [...Object.keys(payload), ...(env ? ["envKeys"] : [])]) })
          return after
        })
      )
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          const server = yield* store.mcpServer(params.id)
          yield* Effect.promise(async () => {
            await hub.close(params.id)
            await secrets.set(mcpEnvName(params.id), "")
            await secrets.set(oauthKey(params.id), "")
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
      .handle("signIn", ({ params }) =>
        Effect.gen(function* () {
          const server = yield* found(store.mcpServer(params.id))
          if (server.auth !== "oauth" || !server.url) return yield* new HttpApiError.BadRequest()
          const url = server.url
          const authorizeUrl = yield* Effect.tryPromise(() => startSignIn(secrets, server.id, url)).pipe(
            Effect.tapError((e) => Effect.logWarning("oauth sign-in failed", server.name, e)),
            Effect.mapError(() => new HttpApiError.BadRequest())
          )
          yield* Effect.promise(() => hub.close(server.id))
          return { authorizeUrl }
        })
      )
      .handle("signedIn", () =>
        store.mcpServers().pipe(Effect.map((all) => ({ signedIn: all.filter((s) => s.auth === "oauth" && isSignedIn(secrets, s.id)).map((s) => s.id), refused: all.filter((s) => hub.refused.has(s.id)).map((s) => s.id) })))
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
  Effect.map(Effect.all([store.preference(FAILOVER_TERMS), store.preference("paused"), store.preference("nativeSkills")]), ([v, p, n]) => ({
    failoverTermsAcceptedAt: v ? Number(v) : null,
    paused: p === "1",
    nativeSkills: n === "1"
  }))

// The processes a chat started (its shells, its agent sessions) → the chat's folder, to place the servers they run.
function ownedBy(runtime: RuntimeService, folders: ReadonlyMap<string, string>): Map<number, string> {
  const owned = new Map<number, string>()
  for (const t of liveTerminals()) if (folders.has(t.chatId)) owned.set(t.pid, folders.get(t.chatId)!)
  for (const s of runtime.liveSessions()) if (s.pid && folders.has(s.chatId)) owned.set(s.pid, folders.get(s.chatId)!)
  return owned
}
// CPU and memory of a set of processes (each counted once).
const useOf = (pids: Iterable<number>, procs: ReadonlyArray<Proc>, cpu: ReadonlyMap<number, number>) => {
  const seen = new Set(pids)
  let c = 0
  let m = 0
  for (const p of procs) {
    if (!seen.has(p.pid)) continue
    c += cpu.get(p.pid) ?? 0
    m += p.rss
  }
  return { cpu: Math.round(c * 10) / 10, memory: m }
}

const Settings = HttpApiBuilder.group(Api, "settings", (h) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const accounts = yield* Accounts
    const store = yield* Store
    const audit = yield* Audit
    const runtime = yield* Runtime
    const { hub } = yield* Tools
    const workspace = yield* Workspace
    // The folder of every chat (a worktree, the project's, or its own), servers found under them in one pass; then
    // CPU and memory of Zorel's whole tree (procs.ts), split by part. Root: the desktop app when it started the
    // server (ZOREL_PARENT_PID), else the server.
    const processes = Effect.gen(function* () {
      const projects = yield* store.projects()
      const folders = new Map<string, { chatIds: string[]; projectId: string | null }>() // folder → the chats working in it
      const chatFolder = new Map<string, string>()
      for (const chat of yield* store.chats()) {
        const folder = workspace.cwdOf(chat.id, projectFor(chat, projects.find((p) => p.id === chat.projectId)))
        const f = folders.get(folder) ?? { chatIds: [], projectId: chat.projectId }
        f.chatIds.push(chat.id)
        folders.set(folder, f)
        chatFolder.set(chat.id, folder)
      }
      const { procs, cpu } = yield* Effect.promise(sample)
      const tree = (pid: number | undefined) => (pid ? subtree(procs, pid) : [])
      const owned = ownedBy(runtime, chatFolder)
      const inside = new Set([...owned.keys()].flatMap((pid) => tree(pid)))
      const found = yield* Effect.promise(() => serversUnder([...folders.keys()], owned, procs))
      const servers = found.map(({ root, ...s }) => ({ ...s, ...folders.get(root)!, folder: root, nested: inside.has(s.pid), ...useOf(tree(s.pid), procs, cpu) }))
      const terminals = liveTerminals(procs).map(({ pid, ...t }) => ({ ...t, ...useOf(tree(pid), procs, cpu) }))
      const sessions = runtime.liveSessions().map(({ pid, ...s }) => ({ ...s, ...useOf(tree(pid), procs, cpu) }))
      const mcp = yield* store.mcpServers()
      const connections = hub.connected().flatMap((id) => mcp.filter((s) => s.id === id).map((s) => ({ id: s.id, name: s.name, local: !s.url, ...useOf(tree(hub.pidOf(id)), procs, cpu) })))
      // The whole of Zorel, and its parts: each process counted in the first part that claims it.
      const parent = Number(process.env.ZOREL_PARENT_PID)
      const all = tree(parent && procs.some((p) => p.pid === parent) ? parent : process.pid)
      const serverTree = new Set(tree(process.pid))
      const claimed = new Set<number>()
      const part = (pids: Iterable<number>) => {
        const own = [...pids].filter((p) => !claimed.has(p))
        for (const p of own) claimed.add(p)
        return useOf(own, procs, cpu)
      }
      const agents = part(runtime.liveSessions().flatMap((s) => tree(s.pid)))
      const shells = part(liveTerminals().flatMap((t) => tree(t.pid)))
      const conns = part(hub.connected().flatMap((id) => tree(hub.pidOf(id))))
      const server = part([process.pid])
      const other = part([...serverTree])
      const app = part(all) // the desktop app's own processes (window, GPU, the agents' browser views)
      return {
        servers, terminals, sessions, connections,
        usage: {
          ...useOf(all, procs, cpu), cores: cpus().length, totalMemory: totalmem(),
          parts: [
            { id: "app" as const, ...app }, { id: "server" as const, ...server }, { id: "agents" as const, ...agents },
            { id: "terminals" as const, ...shells }, { id: "connections" as const, ...conns }, { id: "other" as const, ...other }
          ]
        }
      }
    })
    const dataDir = yield* DataDir
    const storageReport = Effect.gen(function* () {
      const [projects, chats, messages] = yield* Effect.all([store.projects(), store.chats(), store.messageCounts()])
      return yield* Effect.promise(() => measure(dataDir, { projects, chats, messages }))
    })
    return h
      .handle("audit", ({ query }) => audit.list(query))
      .handle("storage", () => storageReport)
      .handle("processes", () => processes)
      // Only a pid found listening inside a chat's folder can be stopped (never an arbitrary process).
      .handle("stopProcess", ({ params }) =>
        Effect.flatMap(processes, (p) => (p.servers.some((s) => s.pid === params.pid) ? Effect.sync(() => void process.kill(params.pid, "SIGTERM")) : notFound()))
      )
      .handle("closeSession", ({ params }) => runtime.closeSession(params.key))
      .handle("closeConnection", ({ params }) => Effect.promise(() => hub.close(params.id)))
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
      // Skills on this computer, with which ones the agents use; a pick must be one the scan found.
      .handle("fileSkills", () => Effect.map(store.preference("fileSkills"), (pref) => fileSkillsWith(pref)))
      .handle("pickFileSkill", ({ payload }) =>
        Effect.gen(function* () {
          if (!discovered().some((s) => s.path === payload.path)) return yield* notFound()
          const now = new Set(pickedPaths(yield* store.preference("fileSkills")))
          if (payload.enabled) now.add(payload.path)
          else now.delete(payload.path)
          const pref = JSON.stringify([...now])
          yield* store.setPreference("fileSkills", pref)
          return fileSkillsWith(pref)
        })
      )
      .handle("pause", ({ payload }) => runtime.setPaused(payload.paused))
      // The harnesses' own skills on or off (the next session of each chat picks it up).
      .handle("nativeSkills", ({ payload }) => Effect.andThen(store.setPreference("nativeSkills", payload.enabled ? "1" : "0"), preferencesOf(store)))
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
const RpcHandlers = ZorelRpc.toLayer(
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
const RpcRoute = RpcServer.layerHttp({ group: ZorelRpc, path: "/rpc", protocol: "websocket" }).pipe(Layer.provide([RpcHandlers, RpcSerialization.layerJson]))

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
    const name = decodeURIComponent(req.headers["x-file-name"] ?? "file").replace(/[/\\]/g, "_").slice(0, 200) || "file"
    const mime = (req.headers["content-type"] ?? "application/octet-stream").split(";")[0]!.trim().slice(0, 100)
    const id = crypto.randomUUID()
    const dir = join(dataDir, "attachments", chatId)
    mkdirSync(dir, { recursive: true })
    yield* Effect.promise(() => Bun.write(join(dir, id), body))
    return HttpServerResponse.jsonUnsafe(yield* store.addAttachment({ id, chatId, name, mime, size: body.length, path: join(dir, id) }))
  }).pipe(Effect.catchTag("SchemaError", () => Effect.succeed(HttpServerResponse.jsonUnsafe({ error: "bad_request" }, { status: 400 }))), Effect.orDie)
)
// No scripts, no requests out: a file is shown, never run.
const ATTACHMENT_CSP = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "application/pdf", "text/plain", "audio/mpeg", "audio/wav", "video/mp4", "video/webm"])
const AttachmentFile = HttpRouter.add(
  "GET",
  "/api/attachments/:id",
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.schemaPathParams(Schema.Struct({ id: Schema.String }))
    const a = yield* (yield* Store).attachment(id)
    const root = resolve(yield* DataDir, "attachments") + sep
    if (!a || !resolve(a.path).startsWith(root) || !existsSync(a.path)) return HttpServerResponse.empty({ status: 404 })
    // The type is what the uploader declared. Only passive types open as a page; anything else (HTML, SVG…) downloads
    // when opened, so a file can't run as a page on the API's own address (an <img> still shows an SVG, scripts off).
    // The CSP sandbox stops scripts even if a browser shows it anyway.
    const shown = INLINE_TYPES.has(a.mime)
    return yield* HttpServerResponse.file(a.path).pipe(
      Effect.map(
        HttpServerResponse.setHeaders({
          "content-type": a.mime,
          "content-disposition": `${shown ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
          "x-content-type-options": "nosniff",
          "content-security-policy": ATTACHMENT_CSP
        })
      )
    )
  }).pipe(Effect.orDie)
)

// Moving the workspace (transfer.ts): export downloads one .tar.gz; import checks an upload and leaves it pending for
// the next start (GET says whether one is pending; DELETE drops it).
const WorkspaceExport = HttpRouter.add(
  "GET",
  "/api/workspace/export",
  Effect.gen(function* () {
    const [dbPath, dataDir] = [yield* DbPath, yield* DataDir]
    const bytes = yield* Effect.promise(() => exportWorkspace(dbPath, dataDir))
    const name = `zorel-workspace-${new Date().toISOString().slice(0, 10)}.tar.gz`
    return HttpServerResponse.uint8Array(bytes, { contentType: "application/gzip", headers: { "content-disposition": `attachment; filename="${name}"` } })
  })
)
const WorkspaceImport = HttpRouter.add(
  "*",
  "/api/workspace/import",
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const dataDir = yield* DataDir
    if (req.method === "GET") return HttpServerResponse.jsonUnsafe({ pending: pendingImport(dataDir) })
    if (req.method === "DELETE") return yield* Effect.sync(() => cancelImport(dataDir)).pipe(Effect.as(HttpServerResponse.empty({ status: 204 })))
    if (req.method !== "POST") return HttpServerResponse.empty({ status: 405 })
    if (Number(req.headers["content-length"] ?? 0) > MAX_IMPORT_BYTES) return HttpServerResponse.jsonUnsafe({ error: "too_large" }, { status: 413 })
    const body = new Uint8Array(yield* req.arrayBuffer)
    return yield* Effect.tryPromise(() => stageImport(body, dataDir)).pipe(
      Effect.map((counts) => HttpServerResponse.jsonUnsafe({ pending: true, ...counts })),
      Effect.catch(() => Effect.succeed(HttpServerResponse.jsonUnsafe({ error: "not_an_export" }, { status: 400 })))
    )
  }).pipe(Effect.orDie)
)

// Connectors (oauth.ts): the service sends the person back here after they allow Zorel.
const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) // error text comes from the service
const page = (title: string, text: string, status = 200, close = true) =>
  HttpServerResponse.text(
    `<!doctype html><meta charset="utf-8"><title>Zorel</title><body style="font:15px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:90vh;margin:0"><div style="text-align:center"><h1 style="font-size:20px;font-weight:600">${escapeHtml(title)}</h1><p style="opacity:.7">${escapeHtml(text.slice(0, 300))}</p></div>${close ? "<script>setTimeout(()=>window.close(),1500)</script>" : ""}`,
    { status, contentType: "text/html; charset=utf-8" }
  )
const OAuthCallback = HttpRouter.add(
  "GET",
  "/api/oauth/callback",
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const q = new URL(req.url, "http://x").searchParams
    const code = q.get("code")
    const state = q.get("state")
    if (!code || !state) return page("Not connected", q.get("error_description") ?? q.get("error") ?? "The service didn't send a sign-in code.", 400)
    const store = yield* Store
    const secrets = yield* Secrets
    const { hub } = yield* Tools
    return yield* Effect.tryPromise(() => finishSignIn(secrets, state, code, (id) => Effect.runPromise(store.mcpServer(id)).then((s) => s?.url ?? undefined))).pipe(
      Effect.tap((id) => Effect.promise(() => hub.close(id))),
      Effect.map(() => page("Connected", "You can close this tab and go back to Zorel.")),
      Effect.catch((e) => Effect.logWarning("oauth callback failed", e).pipe(Effect.as(page("Not connected", e.cause instanceof Error ? e.cause.message : "Sign-in failed.", 400))))
    )
  })
)

const WebRoute = (dir: string) =>
  HttpRouter.add("GET", "/*", (req) => {
    const path = normalize(join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname)))
    const file = path.startsWith(dir + sep) && existsSync(path) && !path.endsWith("/") && Bun.file(path).size > 0 ? path : join(dir, "index.html")
    // The app itself only with a session: without one it couldn't load anything, so say how to get one.
    if (file.endsWith("index.html") && !signedIn(req.headers)) return Effect.succeed(page("Open Zorel from its link", "Use the link Zorel printed when it started (it ends in /api/login?t=…).", 401, false))
    // index.html always revalidates (it points at the current build); hashed assets never change.
    const cache = file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable"
    return HttpServerResponse.file(file).pipe(Effect.map(HttpServerResponse.setHeader("cache-control", cache)), Effect.orDie)
  })

// The server is local and only its owner's UI may call it. Host must be local (blocks DNS rebinding) and an Origin,
// when sent, must be this very origin (blocks CSRF from other sites and other localhost ports). Past that, every
// /api and /rpc request carries the per-launch session secret: other processes on this computer (agents included)
// reach 127.0.0.1 too, so a local address alone proves nothing. The desktop app adds it as a header from its main
// process; a browser gets it as a cookie from /api/login?t=<secret>, the link printed at start. The secret never sits
// in process.env, so nothing the server spawns inherits it.
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])
const hostname = (value: string | undefined) => {
  if (!value) return undefined
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname
  } catch {
    return "invalid"
  }
}
export const SESSION = process.env[SESSION_ENV] || randomBytes(SESSION_BYTES).toString("hex")
delete process.env[SESSION_ENV]
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const cookieOf = (cookie: string | undefined) => (cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) ?? ""
// Open without the secret: the web app's files, the login link, the OAuth return (state-bound) and routine webhooks (token-bound).
const open = (path: string) => (!path.startsWith("/api/") && path !== "/rpc") || path === LOGIN_PATH || path === "/api/oauth/callback" || path.startsWith("/api/hooks/")
const signedIn = (headers: Readonly<Record<string, string | undefined>>, session = SESSION) => same(headers[SESSION_HEADER] ?? "", session) || same(cookieOf(headers.cookie), session)
export function isLocalRequest(headers: Readonly<Record<string, string | undefined>>, path = "/", session = SESSION): boolean {
  const host = hostname(headers.host)
  if (!host || !LOCAL.has(host)) return false
  if (headers.origin) {
    try {
      if (new URL(headers.origin).host !== headers.host) return false // "null" (sandbox, file://) throws: rejected
    } catch {
      return false
    }
  }
  return open(path) || signedIn(headers, session)
}


// The login link: sets the session cookie (HttpOnly, this site only) and opens the app.
const Login = HttpRouter.add("GET", LOGIN_PATH, (req) => {
  const t = new URL(req.url, "http://x").searchParams.get("t") ?? ""
  if (!same(t, SESSION)) return Effect.succeed(HttpServerResponse.text("This link is out of date: open the one Zorel printed when it started.", { status: 403 }))
  return Effect.succeed(HttpServerResponse.empty({ status: 302, headers: { location: "/", "set-cookie": `${SESSION_COOKIE}=${SESSION}; Path=/; HttpOnly; SameSite=Strict` } }))
})

const LocalOnly = HttpRouter.middleware(
  (app) =>
    Effect.gen(function* () {
      const req = yield* HttpServerRequest.HttpServerRequest
      return isLocalRequest(req.headers, new URL(req.url, "http://x").pathname) ? yield* app : HttpServerResponse.text("forbidden", { status: 403 })
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
    Login,
    HttpApiBuilder.layer(Api).pipe(Layer.provide([Projects, Agents, Chats, Memories, ToolsGroup, AccountsGroup, Settings, RoutinesGroup, PagesGroup])),
    RoutineScheduler,
    RpcRoute,
    AttachmentUpload,
    AttachmentFile,
    WorkspaceExport,
    WorkspaceImport,
    OAuthCallback,
    TerminalSocket,
    BrowserSocket,
    ...(webDir && existsSync(join(webDir, "index.html")) ? [WebRoute(webDir)] : [])
  )

// Services with real dependencies (system keychain). Tests build their own with Secrets.memory.
export const services = (dbPath: string, dataDir: string, secrets?: Layer.Layer<Secrets, never, Store>) => {
  const store = Store.layer(dbPath)
  const withSecrets = Layer.provideMerge(secrets ?? Secrets.layer, store)
  const base = Layer.mergeAll(Layer.provideMerge(Layer.mergeAll(Engines.layer, Tools.layer), withSecrets), DataDir.layer(dataDir), DbPath.layer(dbPath))
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
  const dataDir = o.dataDir ?? process.env.ZOREL_HOME ?? defaultDataDir()
  mkdirSync(dataDir, { recursive: true }) // don't spawn a shell just to create the folder
  const port = o.port ?? Number(process.env.PORT ?? 4317)
  process.env.ZOREL_ORIGIN ??= `http://127.0.0.1:${port}` // where OAuth services send the person back (oauth.ts)
  const dbPath = process.env.ZOREL_DB ?? dbPathIn(dataDir)
  const imported = await applyPendingImport(dataDir, dbPath).catch((e: unknown) => {
    console.error("import not applied:", e)
    return false
  })
  if (imported) console.info("imported workspace applied")
  const webDir = o.webDir ?? process.env.ZOREL_WEB_DIR ?? resolve(import.meta.dir, "../../web/dist")
  AppLive(resolve(webDir)).pipe(
    HttpRouter.serve,
    Layer.provide(services(dbPath, dataDir)),
    Layer.provide(BunHttpServer.layer({ port, hostname: "127.0.0.1" })),
    Layer.provide(LoggerLive),
    Layer.launch,
    BunRuntime.runMain
  )
  watchParent()
  // The desktop app brings its own secret; elsewhere this link is how the owner's browser gets in.
  if (!process.env.ZOREL_PARENT_PID) console.info(`Open Zorel: ${process.env.ZOREL_WEB_ORIGIN ?? `http://127.0.0.1:${port}`}${LOGIN_PATH}?t=${SESSION}`)
  return `http://127.0.0.1:${port}`
}

// Before the rename to Zorel the data lived in ~/.zero/zero.db. Keep using it where it exists (not moved: the
// database holds absolute paths of attachments and accounts).
function defaultDataDir() {
  const legacy = join(homedir(), ".zero")
  const current = join(homedir(), ".zorel")
  return existsSync(legacy) && !existsSync(current) ? legacy : current
}
const dbPathIn = (dataDir: string) => (existsSync(join(dataDir, "zero.db")) && !existsSync(join(dataDir, "zorel.db")) ? join(dataDir, "zero.db") : join(dataDir, "zorel.db"))

// Started by the desktop app: exit when it's gone (it crashed or was killed without stopping the server).
function watchParent() {
  const parent = Number(process.env.ZOREL_PARENT_PID)
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

// Every skill found on this computer, with whether the agents use it.
const fileSkillsWith = (pref: string | undefined) => {
  const on = new Set(pickedPaths(pref))
  return discovered().map((s) => ({ path: s.path, name: s.name, description: s.description, source: s.source, ...(s.plugin && { plugin: s.plugin }), enabled: on.has(s.path) }))
}
