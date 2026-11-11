import { discovered, pickedEntries, serializePicks } from "./file-skills.ts"
import { listFolders } from "./folders.ts"
import { finishSignIn, isSignedIn, startSignIn } from "./oauth.ts"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Api, ChatNeedsAgentError, CliInstallFailed, LastAgent, CronInvalid, FlowConflict, FlowInvalid, type FlowGraph, type RoutineDelivery, type RoutineSchedule, synthesizeFlow, validateFlow, RoutineInvalid, RoutineQueueFull, TeamHandleTaken, TeamInvalid, DesktopInstallFailed, GitFailed, isTeammate, MAX_ATTACHMENT_BYTES, PreviewFailed, type ToolInfo, UndoConflict, USAGE_DAYS, WorkspaceInvalid } from "@zorel/contracts"
import { ApprovalNotFound, ChatNotFound, ZorelRpc } from "@zorel/contracts/events"
import { LOGIN_PATH, SESSION_BYTES, SESSION_COOKIE, SESSION_ENV, SESSION_HEADER, SESSION_STDIN_ENV } from "@zorel/contracts/session"
import { Effect, Layer, Schema, Semaphore, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { randomBytes, timingSafeEqual } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join, normalize, resolve, sep } from "node:path"
import { ask, consolidate, DataDir, DbPath, prepare } from "./chat.ts"
import * as Git from "./git.ts"
import { MAX_AFTER, snippet } from "./context.ts"

const CHARS_PER_TOKEN = 4 // rough, provider-neutral: the meter says it is an estimate
import { Store, type Repository, type RunRow, type StepRow } from "./db.ts"
import { PAGES_DIR } from "./page-files.ts"
import { PageSync } from "./page-sync.ts"
import { Engines, listModels, splitModel } from "./engines.ts"
import { claudeCommands } from "./engines/claude-sdk.ts"
import { API_KEYS, fileVault, mcpEnvName, oauthKey, Secrets } from "./secrets.ts"
import { hasOwner, makeAuth, migrateAuth, setupToken } from "./auth.ts"
import { type ServerMode, serverModeFrom } from "./server-mode.ts"
import { serverRoutes } from "./server-routes.ts"
import { serverIdentity } from "./devices.ts"
import { viewerScope } from "./visibility.ts"
import { addCliDirsToPath, cliName, cliStates, installCli } from "./cli/index.ts"
import { desktopCli, desktopStatus, installDesktop } from "./desktop.ts"
import { installedApps } from "./installed-apps.ts"
import { checkFolder, computersFor } from "./computer.ts"
import { isZorel } from "./desktop-apps.ts"
import { channelAgent, newPairingCode, pairingCode, TELEGRAM_AGENT, TELEGRAM_KEY, TelegramChannel, telegramUsers, unpairTelegram } from "./telegram.ts"
import { Accounts } from "./accounts.ts"
import { Actor, LOCAL_ACTOR } from "./access.ts"
import { Actions, Audit, changed } from "./audit.ts"
import { LoggerLive, redact } from "./observability.ts"
import { MAX_PER_CHAT_KEY, MAX_RUNNING_KEY, parseMaxPerChat, parseMaxRunning, Runtime, type RuntimeService } from "./runtime.ts"
import { notices, resolveStep, RoutineScheduler, runRoutine } from "./routines.ts"
import { optionsOf, savedArgsProblem, testToolStep, testTrigger, toolState } from "./flows.ts"
import { permissionsOf } from "./permissions.ts"
import { nextScheduled, plannedRuns, todayOf } from "./routine-runs.ts"
import { briefFrom, noteActivity, profileOf, saveProfile, toContract } from "./time-profile.ts"
import { createRoutineFor, newToken, nextRun } from "./schedule.ts"
import { BUILDER, INSTALLER } from "./team.ts"
import { handleClash, holds, invalidMembers, teamHandle } from "./agent-teams.ts"
import { resultText, Tools } from "./tools.ts"
import { billingOf, Pricing } from "./pricing.ts"
import { clean, measure } from "./storage.ts"
import { Workspace } from "./workspace.ts"
import { projectFor } from "./chat.ts"
import { createFile, FsError, inside, moveInto, osCommand, readText, renamePath, restore, trash } from "./fs-ops.ts"
import { applyPendingImport, cancelImport, exportWorkspace, MAX_IMPORT_BYTES, pendingImport, stageImport } from "./transfer.ts"
import { cpus, totalmem } from "node:os"
import { listProcs, type Proc, sample, subtree } from "./procs.ts"
import { closeTerminal, liveTerminals, scriptsOf, serversUnder, TerminalSocket, terminalsOf } from "./terminals.ts"
import { BrowserPicture, BrowserService, BrowserSocket } from "./browser.ts"

const BUILDER_KEEP_MS = 60 * 60 * 1000 // a Builder conversation younger than this is someone's, not litter

const notFound = () => Effect.fail(new HttpApiError.NotFound())
const badRequest = () => Effect.fail(new HttpApiError.BadRequest())
// The agents a skill is limited to: each must exist and be a teammate (not archived, not the Builder). Deduplicated.
const skillAgents = (store: Repository, ids: ReadonlyArray<string> | undefined) =>
  Effect.gen(function* () {
    const wanted = [...new Set(ids ?? [])]
    const all = yield* store.agents()
    return wanted.every((id) => all.some((a) => a.id === id && isTeammate(a))) ? wanted : undefined
  })
const found = <A, E, R>(e: Effect.Effect<A | undefined, E, R>) => Effect.flatMap(e, (a) => (a === undefined ? notFound() : Effect.succeed(a)))
const exists = <A>(e: Effect.Effect<A | undefined>) => Effect.map(e, (a) => a !== undefined)

// The person's last agent can't go (archived or deleted): every chat needs one to answer. One check at a time, so two
// windows removing the last two can't both pass.
const agentGuard = Semaphore.makeUnsafe(1)
export const keepsAnAgent = (store: Repository, goingId: string) =>
  Effect.flatMap(store.agents(), (all) => (all.some((a) => isTeammate(a) && a.id !== goingId) ? Effect.void : Effect.fail(new LastAgent())))
// Folders lent to an agent's computer: each one a folder that may be lent (inside home, not hidden or Zorel's own).
const lentOk = (paths: ReadonlyArray<string> | undefined) =>
  Effect.gen(function* () {
    const dataDir = yield* DataDir
    for (const path of paths ?? []) {
      const why = checkFolder(path, { dataDir })
      if (why) return yield* new TeamInvalid({ message: `${path}: ${why}` })
    }
  })
// What the request's person may see (visibility.ts); locally the one owner sees everything.
const seen = Effect.gen(function* () {
  return yield* viewerScope(yield* Actor)
})
// The routines whose chats the person sees (their runs, the week, the day's brief).
const visibleRoutines = Effect.gen(function* () {
  const store = yield* Store
  const v = yield* seen
  const shown = new Set((yield* store.chatAccessAll()).filter((c) => v.chat(c)).map((c) => c.id))
  return new Set((yield* store.routines()).filter((r) => shown.has(r.chatId)).map((r) => r.id))
})

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
      .handle("list", () => Effect.flatMap(seen, (v) => Effect.map(store.projects(), (all) => all.filter((p) => v.project(p.id)))))
      // The subfolders of one folder, to pick a project's folder (names and paths only).
      .handle("folders", ({ query }) =>
        Effect.try({ try: () => listFolders(query.dir), catch: (e) => (e instanceof WorkspaceInvalid ? e : new WorkspaceInvalid({ reason: "forbidden" })) })
      )
      .handle("create", ({ payload }) =>
        Effect.flatMap(withPath(payload), store.createProject).pipe(
          Effect.tap((p) => audit.record(Actions.projectCreated, { target: p, after: { name: p.name, path: p.path } }))
        )
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const before = yield* store.project(params.id)
          // Who joins its chats must be in reach of them: global, or of this project (agents and teams alike).
          const near = (x: { projectId: string | null } | undefined) => !!x && (x.projectId === null || x.projectId === params.id)
          const inReach = (ids: ReadonlyArray<string> | undefined, all: ReadonlyArray<{ id: string; projectId: string | null }>) => (ids ?? []).every((id) => near(all.find((x) => x.id === id)))
          if (payload.agentIds?.length && !inReach(payload.agentIds, yield* store.agents())) return yield* notFound()
          if (payload.teamIds?.length && !inReach(payload.teamIds, yield* store.teams())) return yield* notFound()
          const after = yield* Effect.flatMap(withPath(payload), (p) => found(store.updateProject(params.id, p)))
          if (before) yield* audit.record(Actions.projectUpdated, { target: after, ...changed(before, after, ["name", "brief", "path", "agentIds", "teamIds", "sharedBrowser"]) })
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
      .handle("reorder", ({ payload }) => Effect.flatMap(seen, (v) => store.reorderProjects(payload.ids.filter(v.project))))
  })
)

const AGENT_FIELDS = ["name", "title", "description", "instructions", "model", "accountId", "effort", "failover", "access", "permissions", "archivedAt", "monthlyTokens", "replyTokens", "memory", "knowledge"] as const

const Agents = HttpApiBuilder.group(Api, "agents", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    const runtime = yield* Runtime
    const audit = yield* Audit
    const dataDir = yield* DataDir
    // Teams (spec 010). An agent's name must not take a team's handle, and the teams it joins must be able to hold it.
    const agentTeamsOk = (agent: { projectId: string | null; id?: string }, name: string | undefined, teamIds: ReadonlyArray<string> | undefined) =>
      Effect.gen(function* () {
        const teams = yield* store.teams()
        const clash = name === undefined ? undefined : handleClash(teamHandle(name), agent, { agents: [], teams })
        if (clash) return yield* new TeamHandleTaken({ message: clash })
        for (const id of teamIds ?? []) {
          const team = teams.find((t) => t.id === id)
          if (!team) return yield* notFound()
          if (!holds(team, agent)) return yield* new TeamInvalid({ message: `The team ${team.name} belongs to another project.` })
        }
      })
    // A team's name and members, checked before it is saved. self: the team being changed.
    const teamOk = (team: { projectId: string | null; id?: string }, name: string | undefined, agentIds: ReadonlyArray<string> | undefined) =>
      Effect.gen(function* () {
        const [agents, teams] = [yield* store.agents(), yield* store.teams()]
        const clash = name === undefined ? undefined : handleClash(teamHandle(name), team, { agents, teams })
        if (clash) return yield* new TeamHandleTaken({ message: clash })
        const invalid = agentIds && invalidMembers(team, agentIds, agents)
        if (invalid) return yield* new TeamInvalid({ message: invalid })
      })
    const teamById = (id: string) => Effect.map(store.teams(), (ts) => ts.find((t) => t.id === id))
    return h
      .handle("list", () => Effect.flatMap(seen, (v) => Effect.map(store.agents(), (all) => all.filter((a) => a.projectId === null || v.project(a.projectId)))))
      .handle("teams", () => store.teams())
      .handle("createTeam", ({ payload }) =>
        Effect.gen(function* () {
          if (!(yield* projectOk(store, payload.projectId))) return yield* notFound()
          yield* teamOk({ projectId: payload.projectId }, payload.name, payload.agentIds)
          const team = (yield* teamById(yield* store.createTeam(payload)))!
          yield* audit.record(Actions.teamCreated, { target: team, after: { name: team.name, members: team.agentIds.length } })
          return team
        })
      )
      .handle("updateTeam", ({ params, payload }) =>
        Effect.gen(function* () {
          const before = yield* teamById(params.id)
          if (!before) return yield* notFound()
          yield* teamOk({ projectId: before.projectId, id: before.id }, payload.name, payload.agentIds)
          yield* store.updateTeam(before.id, payload)
          const after = (yield* teamById(before.id))!
          yield* audit.record(Actions.teamUpdated, { target: after, ...changed(before, after, ["name", "agentIds"] as const) })
          return after
        })
      )
      .handle("removeTeam", ({ params }) =>
        Effect.gen(function* () {
          const team = yield* teamById(params.id)
          yield* store.removeTeam(params.id)
          if (team) yield* audit.record(Actions.teamDeleted, { target: team })
        })
      )
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          if (!(yield* projectOk(store, payload.projectId))) return yield* notFound()
          const { teamIds, ...input } = payload
          yield* agentTeamsOk({ projectId: payload.projectId }, payload.name, teamIds)
          yield* lentOk(payload.permissions?.lent)
          const a = yield* store.createAgent(input)
          if (teamIds) yield* store.setAgentTeams(a.id, teamIds)
          yield* audit.record(Actions.agentCreated, { target: a, after: { name: a.name, model: a.model, access: a.access } })
          return a
        })
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const before = yield* store.agent(params.id)
          // "archived" is a switch; the row keeps when (null: not archived). Archiving again keeps the first time.
          const { archived, teamIds, ...rest } = payload
          yield* lentOk(payload.permissions?.lent)
          if (before) yield* agentTeamsOk({ projectId: before.projectId, id: before.id }, rest.name, teamIds)
          const archivedAt = archived === undefined ? undefined : archived ? (before?.archivedAt ?? Date.now()) : null
          const save = found(store.updateAgent(params.id, { ...rest, ...(archivedAt !== undefined && { archivedAt }) }))
          const after = yield* (archived && !before?.archivedAt ? agentGuard.withPermits(1)(Effect.andThen(keepsAnAgent(store, params.id), save)) : save)
          if (teamIds) yield* store.setAgentTeams(after.id, teamIds)
          if (before) yield* audit.record(Actions.agentUpdated, { target: after, ...changed(before, after, AGENT_FIELDS) })
          // Archived: its computers stop (their files stay for a restore).
          if (archived) yield* Effect.tryPromise(() => computersFor(dataDir).stopAgent(params.id)).pipe(Effect.ignore)
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
          // Each visit starts fresh. Old Builder conversations are tidied away, but never one opened in the last
          // hour: another tab, window or the desktop app may be in the middle of it (deleting it broke their send).
          for (const old of yield* store.hiddenChats(payload.projectId, Date.now() - BUILDER_KEEP_MS)) yield* store.removeChat(old.id).pipe(Effect.andThen(runtime.release(old.id)))
          const chat = yield* store.createChat({ projectId: payload.projectId, agentIds: [builder.id], model: payload.model, hidden: true, ownerId: (yield* Actor).id })
          return (yield* store.updateChat(chat.id, { title: "Build agents" }))!
        })
      )
      // Zorel's Installer (spec 017; admins only on a team server, server-routes.ts): a chat of its own with it. Like the
      // Builder, an existing one gets Zorel's current instructions.
      .handle("installer", ({ payload }) =>
        Effect.gen(function* () {
          const found = (yield* store.agents()).find((a) => a.builtin === "installer")
          const existing = found && found.instructions !== INSTALLER.instructions ? yield* store.updateAgent(found.id, { instructions: INSTALLER.instructions, description: INSTALLER.description }, "Zorel") : found
          const installer = existing ?? (yield* store.createAgent({ projectId: null, name: INSTALLER.name, title: INSTALLER.title, description: INSTALLER.description, instructions: INSTALLER.instructions, model: payload.model, access: INSTALLER.access, builtin: "installer" }))
          if (!existing) yield* audit.record(Actions.agentCreated, { target: installer, after: { name: installer.name, model: installer.model, access: installer.access } })
          const chat = yield* store.createChat({ projectId: null, agentIds: [installer.id], model: payload.model, ownerId: (yield* Actor).id })
          return (yield* store.updateChat(chat.id, { title: "Install Zorel on another computer" }))!
        })
      )
      .handle("runs", ({ params }) => Effect.flatMap(store.agent(params.id), (a) => (a ? store.agentRuns(a.id) : notFound())))
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
          yield* agentGuard.withPermits(1)(Effect.andThen(keepsAnAgent(store, params.id), store.removeAgent(params.id)))
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
    // An agent's own worktree in a chat, with the chat and its project; refused while that agent is at work there.
    const agentWorktree = (chatId: string, agentId: string) =>
      Effect.gen(function* () {
        const chat = yield* store.chat(chatId)
        const wt = chat?.agentWorktrees[agentId]
        const project = chat?.projectId ? yield* store.project(chat.projectId) : undefined
        if (!chat || !wt || !project?.path) return yield* notFound()
        if (runtime.agentBusy(chat.id, agentId)) return yield* new GitFailed({ message: "Wait for this agent to finish." })
        const agent = yield* store.agent(agentId)
        return { chat, project, wt, agent }
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
      Effect.promise(() => serversUnder(ownedBy(runtime, new Map([[chatId, root]])))).pipe(Effect.map((list) => list.map(({ root: _root, ...s }) => s)))
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
      .handle("list", () =>
        Effect.gen(function* () {
          const v = yield* seen
          const access = new Map((yield* store.chatAccessAll()).map((c) => [c.id, c]))
          return (yield* store.chats()).filter((c) => v.chat(access.get(c.id) ?? { projectId: c.projectId, ownerId: null }))
        })
      )
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          if (!(yield* projectOk(store, payload.projectId)) || !(yield* validAgents(store, payload.agentIds, payload.projectId))) return yield* notFound()
          if (!payload.agentIds.length) return yield* new ChatNeedsAgentError()
          return yield* store.createChat({ ...payload, ownerId: (yield* Actor).id }) // outside a project only its owner sees it
        })
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const chat = yield* store.chat(params.id)
          if (!chat || (payload.agentIds && !(yield* validAgents(store, payload.agentIds, chat.projectId)))) return yield* notFound()
          if (payload.agentIds?.length === 0) return yield* new ChatNeedsAgentError()
          const updated = yield* found(store.updateChat(params.id, payload))
          // The level agents work at is a security choice: it leaves a record, like the same choice on an agent.
          if (payload.access !== undefined && payload.access !== chat.access) yield* audit.record(Actions.chatAccessChanged, { target: { id: chat.id, name: chat.title }, ...changed(chat, updated, ["access"] as const) })
          return updated
        })
      )
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          // Its worktrees (its own and its agents', spec 016) go with it when nothing in them is uncommitted (else they
          // stay on disk, with their branches).
          const chat = yield* store.chat(params.id)
          const project = chat?.projectId ? yield* store.project(chat.projectId) : undefined
          const trees = chat && project?.path ? [...Object.values(chat.agentWorktrees).map((w) => w.path), ...(chat.worktree ? [chat.worktree] : [])] : []
          for (const dir of trees) {
            const removed = yield* Effect.promise(() => Git.removeWorktree(project!.path!, dir).catch(() => false))
            if (!removed) yield* Effect.logInfo("worktree kept: it has uncommitted changes", { chatId: params.id, worktree: dir })
          }
        }).pipe(
          Effect.andThen(store.removeChat(params.id)),
          Effect.andThen(runtime.release(params.id)), // its sessions and open streams end, nothing kept live for it (spec 011)
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
      // An agent's own worktree (spec 016) into the chat's folder: its uncommitted work committed on its branch, then
      // merged; a conflict leaves the folder as it was and says so. Not while that agent is at work in the chat.
      .handle("mergeAgentWorktree", ({ params }) =>
        Effect.gen(function* () {
          const { chat, project, wt, agent } = yield* agentWorktree(params.id, params.agentId)
          const into = projectFor(chat, project)!.path!
          yield* gitTry(() => Git.mergeWorktree(into, wt.path, wt.branch, `Work by ${agent?.name ?? "an agent"} in "${chat.title}"`))
          yield* store.setAgentWorktree(chat.id, params.agentId, null)
          yield* gitAudit(chat.id, Actions.gitMerged, { branch: wt.branch, agent: agent?.name ?? params.agentId })
        })
      )
      .handle("discardAgentWorktree", ({ params }) =>
        Effect.gen(function* () {
          const { chat, project, wt, agent } = yield* agentWorktree(params.id, params.agentId)
          yield* gitTry(() => Git.discardWorktree(projectFor(chat, project)!.path!, wt.path, wt.branch))
          yield* store.setAgentWorktree(chat.id, params.agentId, null)
          yield* gitAudit(chat.id, Actions.gitDiscarded, { branch: wt.branch, agent: agent?.name ?? params.agentId })
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
        Effect.gen(function* () {
          const v = yield* seen
          const access = new Map((yield* store.chatAccessAll()).map((c) => [c.id, c]))
          const rows = (yield* store.searchMessages(query.q.trim())).filter((m) => { const c = access.get(m.chatId); return !!c && v.chat(c) })
          return rows.map((m) => ({ chatId: m.chatId, messageId: m.id, at: m.at, snippet: snippet(m.text, query.q.trim()) }))
        })
      )
      .handle("scripts", ({ params }) => Effect.map(chatRoot(params.id), scriptsOf))
      .handle("preview", ({ params, payload }) =>
        runtime.preview(params.id, payload).pipe(
          Effect.mapError(() => new HttpApiError.NotFound()),
          Effect.flatMap((r) => ("error" in r ? Effect.fail(new PreviewFailed({ message: r.error })) : Effect.succeed(r)))
        )
      )
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
      .handle("reorder", ({ payload }) =>
        Effect.gen(function* () {
          const v = yield* seen
          const shown = new Set((yield* store.chatAccessAll()).filter((c) => v.chat(c)).map((c) => c.id))
          return yield* store.reorderChats(payload.projectId, payload.ids.filter((id) => shown.has(id))) // only what the person sees
        })
      )
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
        consolidate(params.id, "all", (saved) => runtime.remembered(params.id, saved)).pipe(
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

// The point a scope's facts hang off on the map: its project or its agent (none for what's about you).
const ownerPoint = (store: Repository, scope: string) =>
  Effect.gen(function* () {
    const [kind, id = ""] = scope.split(":")
    const project = kind === "project" ? yield* store.project(id) : undefined
    const agent = kind === "agent" ? yield* store.agent(id) : undefined
    return project ? [{ id: project.id, name: project.name, type: "project" as const }] : agent ? [{ id: agent.id, name: agent.name, type: "agent" as const }] : []
  })

// A scope a memory can move to: you, a project that exists, or an agent that is a teammate.
const scopeExists = (store: Repository, scope: string) =>
  Effect.gen(function* () {
    if (scope === "user") return true
    const [kind, id = ""] = scope.split(":")
    if (kind === "project") return !!(yield* store.project(id))
    const a = kind === "agent" ? yield* store.agent(id) : undefined
    return !!a && isTeammate(a)
  })

const Memories = HttpApiBuilder.group(Api, "memories", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    return h
      .handle("list", () =>
        Effect.gen(function* () {
          const actor = yield* Actor
          const v = yield* seen
          return (yield* store.memories(actor.id)).filter((m) => !m.scope.startsWith("project:") || v.project(m.scope.slice(8)))
        })
      )
      // The map of one scope (and what's about you), or of every scope.
      .handle("map", ({ query }) =>
        Effect.gen(function* () {
          // ponytail: the map's points have no owner, so on a team server the personal ("user") scope stays off it;
          // a per-person map would need entities keyed by owner.
          const v = yield* seen
          const personal = (yield* Actor).id === LOCAL_ACTOR.id
          const visible = (s: string) => (s === "user" ? personal : !s.startsWith("project:") || v.project(s.slice(8)))
          const scopes = (query.scope ? [...new Set(["user", query.scope])] : [...new Set((yield* store.memories()).map((m) => m.scope))]).filter(visible)
          const shape = ({ memory_ids, ...p }: { id: string; scope: string; name: string; type: string; weight: number; facts: number; pending: number; memory_ids: string }) => ({ ...p, type: p.type as "project" | "agent" | "concept" | "subject", facts: Number(p.facts), pending: Number(p.pending ?? 0), memoryIds: memory_ids ? memory_ids.split(",") : [] })
          const own = (yield* store.entitiesIn(scopes)).map(shape)
          // A bridge brings its other end onto this map (drawn as another project's point).
          const bridges = yield* store.bridgesOf(own.map((p) => p.id))
          const across = bridges.others.length ? (yield* store.entitiesIn([...new Set(bridges.others.map((o) => o.scope))])).filter((p) => bridges.others.some((o) => o.id === p.id)).map(shape) : []
          const points = [...own, ...across.filter((p) => !own.some((o) => o.id === p.id))]
          return { points, links: [...(yield* store.linksAmong(own.map((p) => p.id))), ...bridges.links.map((l) => ({ ...l, rel: "", bridge: true }))] }
        })
      )
      // Written by the user: starts active. Duplicate: returns the existing one.
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          if (payload.agents?.length && payload.kind !== "skill") return yield* badRequest() // only a skill is limited to agents
          const only = yield* skillAgents(store, payload.agents)
          if (!only) return yield* badRequest()
          const added = yield* store.addMemory({ ...payload, agents: only, state: "active", origin: "manual", chatId: null, owner: (yield* Actor).id })
          // A fact written by hand hangs off its project's or agent's point on the map (what it's about: the next sleep).
          if (added && added.kind === "fact") yield* store.linkMemory(added.id, added.scope, { entities: [], relations: [] }, yield* ownerPoint(store, added.scope))
          return added ?? (yield* store.memories()).find((m) => m.scope === payload.scope && m.text === payload.text)!
        })
      )
      // Approving a proposed improvement applies it to the skill it replaces (the old text becomes a version).
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const before = yield* store.memory(params.id)
          if (payload.agents !== undefined && before && before.kind !== "skill") return yield* badRequest()
          const only = payload.agents === undefined ? undefined : yield* skillAgents(store, payload.agents)
          if (payload.agents !== undefined && !only) return yield* badRequest()
          if (before?.state === "pending" && before.replaces && payload.state === "active") {
            const applied = yield* store.applyImprovement(before.id, "you")
            if (applied) return applied
          }
          // Moved to another owner: one that exists (you, a project, a teammate); its old one keeps nothing of it.
          if (payload.scope !== undefined && before && payload.scope !== before.scope && !(yield* scopeExists(store, payload.scope))) return yield* badRequest()
          // Edited or moved into the words of another memory of the scope: refused, not a crash on the unique key.
          if (before && (payload.text !== undefined || payload.scope !== undefined) && (yield* store.textTaken(before.id, payload.scope ?? before.scope, payload.text ?? before.text))) return yield* new HttpApiError.Conflict()
          const { agents: _, ...rest } = payload
          return yield* found(store.updateMemory(params.id, { ...rest, agents: only }))
        })
      )
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          const m = yield* store.memory(params.id)
          if (!m) return yield* notFound()
          if (m.state !== "forgotten") return yield* new HttpApiError.Conflict() // forget it first
          yield* store.removeMemory(m.id)
        })
      )
      .handle("connect", ({ payload }) =>
        Effect.gen(function* () {
          const [a, b] = [yield* store.entity(payload.a), yield* store.entity(payload.b)]
          if (!a || !b) return yield* notFound()
          if (a.scope === b.scope || a.scope === "user" || b.scope === "user") return yield* badRequest() // a bridge is between projects (yours is on every map)
          yield* store.connectEntities(a.id, b.id)
        })
      )
      .handle("disconnect", ({ payload }) => store.disconnectEntities(payload.a, payload.b))
      .handle("versions", ({ params }) => Effect.flatMap(store.memory(params.id), (m) => (m ? store.memoryVersions(m.id) : notFound())))
      // An earlier text comes back (the current one is kept as a version too).
      .handle("restore", ({ params, payload }) =>
        Effect.gen(function* () {
          const v = yield* store.memoryVersion(payload.versionId)
          if (!v || v.memoryId !== params.id) return yield* notFound()
          const m = yield* store.memory(params.id)
          if (m && (yield* store.textTaken(m.id, m.scope, v.text))) return yield* new HttpApiError.Conflict()
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
      // Spec 013: the step picker's list, each tool with whether this agent can use it now.
      .handle("catalog", ({ params, query }) =>
        Effect.gen(function* () {
          const server = yield* found(store.mcpServer(params.id))
          const agent = yield* found(store.agent(query.agentId))
          const perms = permissionsOf(agent)
          return yield* Effect.promise(() =>
            hub.tools(server).then(
              (tools) => ({ tools: tools.map((t) => ({ name: t.name, description: t.description, cls: t.cls, inputSchema: t.inputSchema, ...(t.outputSchema && { outputSchema: t.outputSchema }), state: toolState(server, hub.refused.has(server.id), t, perms) })), error: null }),
              (e: unknown) => ({ tools: [], error: e instanceof Error ? e.message : String(e) })
            )
          )
        })
      )
      // Ids picked by name: what a read tool lists. A tool that may change something is refused.
      .handle("options", ({ params, payload }) =>
        Effect.gen(function* () {
          const server = yield* found(store.mcpServer(params.id))
          if (!server.enabled) return yield* new HttpApiError.BadRequest()
          const tool = (yield* Effect.tryPromise(() => hub.tools(server)).pipe(Effect.mapError(() => new HttpApiError.BadRequest()))).find((t) => t.name === payload.tool)
          if (tool?.cls !== "read") return yield* new HttpApiError.BadRequest()
          const res = yield* Effect.tryPromise(() => hub.call(server, tool.name, { ...payload.args })).pipe(Effect.mapError(() => new HttpApiError.BadRequest()))
          return res.isError ? [] : optionsOf(resultText(res)).slice(0, 500)
        })
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
      .handle("loginCode", ({ params, payload }) => Effect.flatMap(accounts.answer(params.id, payload.code), (ok) => (ok ? Effect.void : notFound())))
      .handle("limits", ({ params, query }) => found(accounts.refreshLimits(params.id, query.fresh === "1")))
  })
)

// The failover terms warning (§6.1) is accepted once and remembered here.
const FAILOVER_TERMS = "failover_terms_accepted_at"
const MEMORY_APPROVAL = "memoryApproval" // "review" (default) or "undo": see Preferences
const MEMORY_MODEL = "memoryModel" // "" (automatic) or a model id: see Preferences
const preferencesOf = (store: Repository) =>
  Effect.map(Effect.all([store.preference(FAILOVER_TERMS), store.preference("paused"), store.preference("nativeSkills"), store.preference(MAX_RUNNING_KEY), store.preference(MEMORY_APPROVAL), store.preference(MEMORY_MODEL), profileOf(store), store.preference(MAX_PER_CHAT_KEY)]), ([v, p, n, m, a, mm, time, perChat]) => ({
    timeProfile: toContract(time),
    memoryApproval: a === "undo" ? ("undo" as const) : ("review" as const),
    memoryModel: mm ?? "",
    failoverTermsAcceptedAt: v ? Number(v) : null,
    paused: p === "1",
    nativeSkills: n === "1",
    maxRunning: parseMaxRunning(m),
    maxPerChat: parseMaxPerChat(perChat)
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
    const telegramStatus = Effect.gen(function* () {
      const users = yield* telegramUsers.pipe(Effect.provideService(Store, store))
      const chosen = yield* store.preference(TELEGRAM_AGENT)
      const agent = yield* channelAgent(store, chosen)
      return { tokenSet: !!secrets.get(TELEGRAM_KEY), fromEnv: secrets.fromEnv(TELEGRAM_KEY), users: users.length, agentId: agent?.id ?? null, chosen: !!agent && agent.id === chosen, pairing: pairingCode() ?? null }
    })
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
      const found = yield* Effect.promise(() => serversUnder(owned, procs))
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
          const now = new Map(pickedEntries(yield* store.preference("fileSkills")).map((e) => [e.path, e.agents]))
          const only = payload.agents === undefined ? undefined : yield* skillAgents(store, payload.agents)
          if (payload.agents !== undefined && !only) return yield* badRequest()
          // Picking again keeps the agents it already had unless new ones come with it.
          if (payload.enabled) now.set(payload.path, only ?? now.get(payload.path) ?? [])
          else now.delete(payload.path)
          const pref = serializePicks([...now].map(([path, agents]) => ({ path, agents })))
          yield* store.setPreference("fileSkills", pref)
          return fileSkillsWith(pref)
        })
      )
      .handle("pause", ({ payload }) => runtime.setPaused(payload.paused))
      // The harnesses' own skills on or off (the next session of each chat picks it up).
      .handle("nativeSkills", ({ payload }) => Effect.andThen(store.setPreference("nativeSkills", payload.enabled ? "1" : "0"), preferencesOf(store)))
      .handle("memoryApproval", ({ payload }) => Effect.andThen(store.setPreference(MEMORY_APPROVAL, payload.approval), preferencesOf(store)))
      .handle("timeProfile", ({ payload }) =>
        Effect.gen(function* () {
          if (!(yield* saveProfile(store, payload))) return yield* Effect.fail(new HttpApiError.BadRequest())
          return yield* preferencesOf(store)
        })
      )
      .handle("memoryModel", ({ payload }) => Effect.andThen(store.setPreference(MEMORY_MODEL, payload.model), preferencesOf(store)))
      .handle("maxRunning", ({ payload }) => Effect.andThen(runtime.setMaxRunning(payload.value), preferencesOf(store)))
      .handle("maxPerChat", ({ payload }) => Effect.andThen(runtime.setMaxPerChat(payload.value), preferencesOf(store)))
      .handle("acceptFailoverTerms", () =>
        Effect.andThen(
          store.setPreference(FAILOVER_TERMS, String(Date.now())).pipe(Effect.tap(() => audit.record(Actions.failoverTermsAccepted, { target: { id: FAILOVER_TERMS, name: "Failover" } }))),
          preferencesOf(store)
        )
      )
      .handle("computer", () => Effect.promise(() => computersFor(dataDir).status(true)))
      .handle("computerState", ({ params }) => Effect.flatMap(store.agent(params.id), (a) => (a ? Effect.promise(() => computersFor(dataDir).state(a.id)) : notFound())))
      .handle("computerStart", ({ params }) =>
        Effect.gen(function* () {
          const a = yield* store.agent(params.id)
          if (!a) return yield* notFound()
          // Outside any chat: only the folders lent to it (each checked), read-only when it works at "ask".
          const p = permissionsOf(a)
          const lents = (p.lent ?? []).filter((path) => !checkFolder(path, { dataDir })).map((path) => ({ path, readOnly: a.access === "ask" }))
          computersFor(dataDir).start({ agentId: a.id, lents })
          return yield* Effect.promise(() => computersFor(dataDir).state(a.id))
        })
      )
      .handle("computerRestart", ({ params }) =>
        Effect.gen(function* () {
          const a = yield* store.agent(params.id)
          if (!a) return yield* notFound()
          yield* Effect.promise(() => computersFor(dataDir).restart(a.id).catch(() => undefined))
          return yield* Effect.promise(() => computersFor(dataDir).state(a.id))
        })
      )
      .handle("computerOpen", ({ params }) =>
        Effect.gen(function* () {
          const a = yield* store.agent(params.id)
          if (!a) return yield* notFound()
          const folder = computersFor(dataDir).workFolder(a.id)
          yield* Effect.sync(() => Bun.spawn(osCommand("open", folder), { stdout: "ignore", stderr: "ignore", windowsHide: true } as never))
        })
      )
      .handle("eraseComputer", ({ params }) =>
        Effect.promise(() => computersFor(dataDir).erase(params.id)).pipe(Effect.tap(() => audit.record(Actions.computerErased, { target: { id: params.id, name: params.id } })))
      )
      .handle("desktop", () => Effect.promise(() => desktopStatus(dataDir)))
      .handle("installDesktop", () =>
        Effect.promise(() => installDesktop(dataDir)).pipe(
          Effect.flatMap((r) => (r.ok ? Effect.promise(() => desktopStatus(dataDir)) : Effect.fail(new DesktopInstallFailed({ message: r.error })))),
          Effect.tap(() => audit.record(Actions.desktopInstalled, { target: { id: "agent-desktop", name: "agent-desktop" } }))
        )
      )
      .handle("cliStatus", ({ query }) => Effect.promise(() => cliStates(query.fresh === "1")))
      .handle("installCli", ({ params }) =>
        Effect.promise(() => installCli(params.id)).pipe(
          Effect.flatMap((r) => (r.ok ? accounts.forgetCliModels : Effect.fail(new CliInstallFailed({ message: r.error })))),
          Effect.tap(() => audit.record(Actions.cliInstalled, { target: { id: params.id, name: cliName(params.id) } }))
        )
      )
      // macOS: opens System Settings with agent-desktop's guide to the Accessibility permission.
      .handle("desktopGuide", () => Effect.promise(() => desktopCli(dataDir)(["permissions", "--guide"], 15_000)).pipe(Effect.asVoid))
      // The apps open now (to pick from), never Zorel itself.
      .handle("installedApps", () => Effect.sync(() => installedApps()))
      .handle("desktopRunning", () =>
        Effect.promise(() => desktopCli(dataDir)(["list-apps"], 20_000)).pipe(
          Effect.map((r) => [...new Set(((r.data?.apps ?? []) as Array<{ name?: string; presentation?: string }>).filter((a) => a.presentation === "foreground" && a.name && !isZorel(a.name)).map((a) => a.name!))].sort())
        )
      )
      .handle("telegram", () => telegramStatus)
      .handle("telegramPair", () => Effect.sync(newPairingCode).pipe(Effect.andThen(telegramStatus)))
      .handle("telegramUnpair", () => unpairTelegram.pipe(Effect.provideService(Store, store), Effect.andThen(telegramStatus)))
      .handle("telegramAgent", ({ payload }) =>
        Effect.gen(function* () {
          const a = yield* store.agent(payload.agentId)
          if (!a || !isTeammate(a) || a.projectId !== null) return yield* notFound() // a global teammate answers a channel
          yield* store.setPreference(TELEGRAM_AGENT, a.id)
          return yield* telegramStatus
        })
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
    // Each call names a chat: one the person can't see answers as missing (spec 014; locally the owner sees all).
    const reach = (chatId: string) =>
      Effect.gen(function* () {
        const v = yield* seen
        const c = yield* store.chatAccess(chatId)
        if (!c || !v.chat(c)) return yield* new ChatNotFound({ chatId })
        return (yield* Actor).id
      })
    const visibleIds = Effect.gen(function* () {
      const v = yield* seen
      return new Set((yield* store.chatAccessAll()).filter((c) => v.chat(c)).map((c) => c.id))
    })
    return {
      send: (p) => reach(p.chatId).pipe(Effect.tap(() => noteActivity(store)), Effect.flatMap((personId) => runtime.send(p, { personId }))), // the person is here (spec 012)
      steer: (p) => reach(p.chatId).pipe(Effect.andThen(runtime.steer(p.chatId, p.text, p.attachmentIds))),
      interrupt: (p) => reach(p.chatId).pipe(Effect.andThen(runtime.interrupt(p.chatId, p.turnId)), Effect.ignore),
      retry: (p) => reach(p.chatId).pipe(Effect.andThen(runtime.retry(p.chatId, p.messageId))),
      decide: (p) =>
        Effect.gen(function* () {
          const a = (yield* store.openApprovals()).find((x) => x.id === p.approvalId)
          if (a && !(yield* visibleIds).has(a.chatId)) return yield* new ApprovalNotFound({ approvalId: p.approvalId })
          if ((yield* Actor).device) return yield* new ApprovalNotFound({ approvalId: p.approvalId }) // a device approves only signed (spec 014 FR-014)
          return yield* runtime.decide(p.approvalId, p.outcome, p.reason, p.overrides)
        }),
      subscribeChat: (p) => Stream.unwrap(reach(p.chatId).pipe(Effect.as(runtime.subscribeChat(p.chatId)))),
      subscribeStatus: () => Stream.unwrap(Effect.map(visibleIds, (ids) => runtime.subscribeStatus.pipe(Stream.filter((s) => ids.has(s.chatId))))),
      notices: () => Stream.fromPubSub(notices),
      approvals: () => Effect.flatMap(visibleIds, (ids) => Effect.map(store.openApprovals(), (all) => all.filter((a) => ids.has(a.chatId)))),
      runs: (p) => reach(p.chatId).pipe(Effect.andThen(store.runsOf(p.chatId)), Effect.orElseSucceed(() => []))
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

const WebRoute = (dir: string, server = false) =>
  HttpRouter.add("GET", "/*", (req) => {
    // An API path no route answered is missing, not the app's page (the web app reads /api/server to tell modes apart).
    if (new URL(req.url, "http://x").pathname.startsWith("/api/")) return Effect.succeed(HttpServerResponse.jsonUnsafe({ error: "not_found" }, { status: 404 }))
    const path = normalize(join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname)))
    const file = path.startsWith(dir + sep) && existsSync(path) && !path.endsWith("/") && Bun.file(path).size > 0 ? path : join(dir, "index.html")
    // The app itself only with a session: without one it couldn't load anything, so say how to get one.
    // A server's app loads signed out (it shows the sign-in or the setup); locally it needs the per-launch secret.
    if (file.endsWith("index.html") && !server && !signedIn(req.headers)) return Effect.succeed(page("Open Zorel from its link", "Use the link Zorel printed when it started (it ends in /api/login?t=…).", 401, false))
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
// From the desktop app: one line on stdin, which it then closes. Else the environment (development), else a new one.
const fromStdin = process.env[SESSION_STDIN_ENV] === "1" ? readFileSync(0, "utf8").trim() : ""
export const SESSION = fromStdin || process.env[SESSION_ENV] || randomBytes(SESSION_BYTES).toString("hex")
delete process.env[SESSION_ENV]
delete process.env[SESSION_STDIN_ENV]
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
      .handle("list", () => Effect.flatMap(seen, (v) => Effect.map(store.pages(), (all) => all.filter((p) => !p.scope.startsWith("project:") || v.project(p.scope.slice(8))))))
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
    const audit = yield* Audit
    const { hub } = yield* Tools
    const dataDir = yield* DataDir
    const services = yield* Effect.context<Store | Runtime | DataDir | Engines | Secrets | Tools>()
    const zone = Effect.map(profileOf(store), (p) => p.zone)
    const schedule = (cron: string | null) =>
      Effect.gen(function* () {
        if (cron === null) return null
        const next = nextRun(cron, new Date(), yield* zone)
        return "error" in next ? yield* Effect.fail(new CronInvalid({ message: next.error })) : next.at
      })
    const run = (id: string, key: string, payload?: unknown) => runRoutine(id, key, payload).pipe(Effect.provide(services))
    // Spec 012: "look first" needs an outside trigger (a watched connector or the webhook); a page to update must be one the routine's agent can reach.
    const settingsOk = (agentProjectId: string | null, s: { lookFirst?: boolean | undefined; watch?: unknown; webhook?: unknown; delivery?: RoutineDelivery | undefined }) =>
      Effect.gen(function* () {
        if (s.lookFirst && !s.watch && !s.webhook) return yield* Effect.fail(new RoutineInvalid({ message: "Look first works with a watched connector or the webhook." }))
        const pageId = s.delivery?.pageId
        if (s.delivery?.channels.includes("page") && !pageId) return yield* Effect.fail(new RoutineInvalid({ message: "Pick the page to update." }))
        if (pageId) {
          const page = yield* store.page(pageId)
          const reach = ["user", agentProjectId && `project:${agentProjectId}`].filter(Boolean)
          if (!page || !(reach.includes(page.scope) || page.scope.startsWith("agent:"))) return yield* Effect.fail(new RoutineInvalid({ message: "That page isn't one this routine can update." }))
        }
        // Spec 013: each connector destination is a tool that writes, its text field is one of its inputs, and the rest
        // fits the tool's description. A connector that doesn't answer now isn't held against the save.
        for (const d of s.delivery?.connectors ?? []) {
          const server = yield* store.mcpServer(d.serverId)
          if (!server) return yield* Effect.fail(new RoutineInvalid({ message: "That connector isn't here anymore." }))
          const tools = yield* Effect.promise(() => hub.tools(server).catch(() => undefined))
          if (!tools) continue
          const tool = tools.find((x) => x.name === d.tool)
          if (!tool || tool.cls === "read") return yield* Effect.fail(new RoutineInvalid({ message: `${server.name} has no tool ${d.tool} that posts.` }))
          if (!(d.textField in ((tool.inputSchema as { properties?: object }).properties ?? {}))) return yield* Effect.fail(new RoutineInvalid({ message: `${d.tool} has no input ${d.textField}.` }))
          const bad = savedArgsProblem(tool.inputSchema, { ...d.args, [d.textField]: "text" })
          if (bad) return yield* Effect.fail(new RoutineInvalid({ message: `${d.tool}: ${bad.field ? `${bad.field}: ` : ""}${bad.problem}` }))
        }
      })
    // Spec 013: the flow's own rules (shared with the editor), then each tool step against its connector: the tool is
    // there and its fixed inputs fit. A connector that doesn't answer now isn't held against the save.
    const flowOk = (graph: FlowGraph) =>
      Effect.gen(function* () {
        const checked = validateFlow(graph)
        if (!checked.ok) return yield* Effect.fail(new FlowInvalid({ message: checked.problem, ...(checked.nodeId && { nodeId: checked.nodeId }), ...(checked.field && { field: checked.field }) }))
        for (const n of graph.nodes) {
          const c = n.kind === "tool" ? n.config : n.kind === "trigger" && (n.config.on === "watch" || n.config.on === "message") ? { serverId: n.config.serverId!, tool: n.config.tool!, args: n.config.args ?? {} } : undefined
          if (!c) continue
          const server = yield* store.mcpServer(c.serverId)
          if (!server) return yield* Effect.fail(new FlowInvalid({ message: "That connector isn't here anymore.", nodeId: n.id, field: "serverId" }))
          const tools = yield* Effect.promise(() => hub.tools(server).catch(() => undefined))
          if (!tools) continue
          const tool = tools.find((t) => t.name === c.tool)
          if (!tool) return yield* Effect.fail(new FlowInvalid({ message: `${server.name} has no tool ${c.tool}.`, nodeId: n.id, field: "tool" }))
          if (n.kind === "trigger" && tool.cls !== "read") return yield* Effect.fail(new FlowInvalid({ message: "A watch can only use a tool that reads.", nodeId: n.id, field: "tool" }))
          const bad = savedArgsProblem(tool.inputSchema, c.args)
          if (bad) return yield* Effect.fail(new FlowInvalid({ message: bad.problem, nodeId: n.id, field: bad.field ? `args.${bad.field}` : "args" }))
        }
      })
    return h
      .handle("list", () =>
        Effect.gen(function* () {
          const v = yield* seen
          const access = new Map((yield* store.chatAccessAll()).map((c) => [c.id, c]))
          return (yield* store.routines()).filter((r) => { const c = access.get(r.chatId); return !c || v.chat(c) })
        })
      )
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          const agent = yield* store.agent(payload.agentId)
          if (!agent) return yield* notFound()
          if (payload.watch && !(yield* store.mcpServer(payload.watch.serverId))) return yield* notFound()
          yield* settingsOk(agent.projectId, payload)
          return yield* createRoutineFor(store, agent, payload, yield* zone).pipe(Effect.mapError((message) => new CronInvalid({ message })))
        })
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const r = yield* store.routine(params.id)
          if (!r) return yield* notFound()
          const cron = payload.cron === undefined ? r.cron : payload.cron
          const enabled = payload.enabled ?? r.enabled
          // Spec 013: turning on a routine whose steps or destinations use a connector that's gone is refused.
          if (enabled && !r.enabled) {
            const graph = r.version !== null ? yield* store.versionOf(r.id, r.version) : undefined
            const used = [...(graph?.nodes ?? []).flatMap((n) => (n.kind === "tool" ? [n.config.serverId] : n.kind === "trigger" && n.config.serverId ? [n.config.serverId] : [])), ...(r.delivery.connectors ?? []).map((d) => d.serverId)]
            for (const id of new Set(used)) if (!(yield* store.mcpServer(id))) return yield* Effect.fail(new RoutineInvalid({ message: "A step or destination uses a connector that isn't here anymore. Fix it in the steps first." }))
          }
          const nextRunAt = !enabled ? null : r.schedule ? nextScheduled(r.schedule, yield* zone, Date.now()) : yield* schedule(cron)
          const token = payload.webhook === undefined ? r.token : payload.webhook ? (r.token ?? newToken()) : null
          const agent = yield* store.agent(r.agentId)
          yield* settingsOk(agent?.projectId ?? null, { lookFirst: payload.lookFirst ?? r.lookFirst, watch: r.watch, webhook: token, delivery: payload.delivery ?? r.delivery })
          const { onDayStart, lookFirst, delivery, tell, urgent } = payload
          return (yield* store.updateRoutine(r.id, { name: payload.name, prompt: payload.prompt, cron, enabled, nextRunAt, token, onDayStart, lookFirst, delivery, tell, urgent }))!
        })
      )
      .handle("remove", ({ params }) => store.removeRoutine(params.id))
      .handle("run", ({ params }) => Effect.flatMap(run(params.id, `now-${Date.now()}`), (r) => (r === "missing" ? notFound() : Effect.void)))
      .handle("hook", ({ params, payload }) =>
        Effect.gen(function* () {
          const r = yield* store.routineByToken(params.token)
          if (!r || !r.enabled) return yield* notFound()
          if ((yield* run(r.id, `hook-${Date.now()}`, payload ?? {})) === "full") return yield* Effect.fail(new RoutineQueueFull({ message: "20 events are already waiting for this routine. Try again later." }))
        })
      )
      .handle("history", ({ params, query }) =>
        Effect.gen(function* () {
          if (!(yield* store.routine(params.id))) return yield* notFound()
          return (yield* store.routineRunsOf(params.id, query.before)).map(({ payload: _p, ...run }) => run)
        })
      )
      .handle("clearHistory", ({ params }) =>
        Effect.gen(function* () {
          const r = yield* store.routine(params.id)
          if (!r) return yield* notFound()
          yield* store.clearRoutineRuns(r.id)
          yield* audit.record(Actions.routineHistoryCleared, { target: { id: r.id, name: r.name } })
        })
      )
      .handle("week", ({ query }) =>
        Effect.gen(function* () {
          if (!(query.to > query.from) || query.to - query.from > 31 * 24 * 60 * 60_000) return yield* Effect.fail(new HttpApiError.BadRequest())
          const p = yield* profileOf(store)
          const mine = yield* visibleRoutines
          const runs = (yield* store.routineRunsBetween(query.from, query.to)).filter((r) => mine.has(r.routineId)).map(({ payload: _p, report: _r, ...run }) => run)
          return { runs, planned: plannedRuns((yield* store.routines()).filter((r) => mine.has(r.id)), p.zone, p.start, Math.max(query.from, Date.now()), query.to) }
        })
      )
      .handle("today", () =>
        Effect.gen(function* () {
          const from = yield* briefFrom(store)
          const mine = yield* visibleRoutines
          const t = todayOf((yield* store.routineRunsBetween(from, Date.now() + 1)).filter((r) => mine.has(r.routineId)).map(({ payload: _p, report: _r, ...run }) => run), from)
          return { from, ...t }
        })
      )
      .handle("todayRead", ({ payload }) => store.readRoutineRuns(payload.runIds))
      .handle("activity", () => noteActivity(store).pipe(Effect.asVoid))
      // ---------- flows (spec 013) ----------
      .handle("flow", ({ params }) =>
        Effect.gen(function* () {
          const r = yield* found(store.routine(params.id))
          const graph = r.version !== null ? yield* store.versionOf(r.id, r.version) : undefined
          return { version: graph ? r.version : null, graph: graph ?? synthesizeFlow(r) }
        })
      )
      .handle("flowVersion", ({ params }) =>
        Effect.gen(function* () {
          const graph = yield* store.versionOf(params.id, params.n)
          return graph ? { version: params.n, graph } : yield* notFound()
        })
      )
      .handle("saveFlow", ({ params, payload }) =>
        Effect.gen(function* () {
          const r = yield* found(store.routine(params.id))
          if (payload.baseVersion !== r.version) return yield* Effect.fail(new FlowConflict({ message: "The routine was saved elsewhere meanwhile. Reload it to see the newer version.", version: r.version }))
          yield* flowOk(payload.graph)
          // The trigger sets when the routine runs (the clock, the watch and the webhook read these columns).
          const t = payload.graph.nodes.find((n) => n.kind === "trigger")!.config as Extract<FlowGraph["nodes"][number], { kind: "trigger" }>["config"]
          const cron = t.on === "schedule" ? (t.cron ?? null) : null
          const timed = SCHEDULES[t.on]?.(t) ?? null
          const triggerId = payload.graph.nodes.find((n) => n.kind === "trigger")!.id
          const nextRunAt = !r.enabled ? null : timed ? nextScheduled(timed, yield* zone, Date.now()) : yield* schedule(cron).pipe(Effect.mapError((e) => new FlowInvalid({ message: e.message, nodeId: triggerId, field: "cron" })))
          if (timed?.kind === "once" && nextRunAt === null) return yield* Effect.fail(new FlowInvalid({ message: "That time has already passed.", nodeId: triggerId, field: "date" }))
          const watching = t.on === "watch" || t.on === "message"
          const watch = watching && t.serverId && t.tool ? { serverId: t.serverId, tool: t.tool, args: t.args ?? {}, ...(t.more?.length && { more: t.more }), ...(t.filter?.trim() && { filter: t.filter.trim() }), ...(t.on === "message" && { each: true }) } : null
          const prompt = payload.graph.nodes.find((n) => n.kind === "agent")?.config as { prompt?: string } | undefined
          const version = yield* store.addVersion(r.id, payload.graph)
          yield* store.updateRoutine(r.id, {
            cron, nextRunAt, watch, schedule: timed, watchEvery: t.every ?? 5, ...(channelsOf(watch) !== channelsOf(r.watch) && { watchSeen: null, watchAt: null }),
            onDayStart: t.on === "dayStart", lookFirst: watching && !!t.lookFirst, token: t.on === "webhook" ? (r.token ?? newToken()) : null,
            ...(prompt?.prompt && { prompt: prompt.prompt.slice(0, 8000) })
          })
          return { version }
        })
      )
      .handle("testStep", ({ params, payload }) =>
        Effect.gen(function* () {
          const r = yield* found(store.routine(params.id))
          const node = payload.graph.nodes.find((n) => n.id === payload.nodeId)
          if (node?.kind !== "tool") return yield* Effect.fail(new FlowInvalid({ message: "Only a connector tool step can be tested alone.", nodeId: payload.nodeId }))
          return yield* testToolStep(r, node).pipe(Effect.provide(services))
        })
      )
      // A destination tested without sending (FR-016): checked like a save, then the arguments it would post, with the
      // routine's last result in its text field.
      .handle("testDelivery", ({ params, payload }) =>
        Effect.gen(function* () {
          const r = yield* found(store.routine(params.id))
          const agent = yield* store.agent(r.agentId)
          yield* settingsOk(agent?.projectId ?? null, { delivery: { channels: [], connectors: [payload] } })
          const text = (yield* store.lastReport(r.id))?.report || "(the routine's result)"
          const shown = yield* Effect.promise(() => redact(JSON.stringify({ ...payload.args, [payload.textField]: text }, null, 2)))
          return { output: shown, dry: true, error: null }
        })
      )
      .handle("testNewTrigger", ({ payload }) =>
        Effect.gen(function* () {
          yield* found(store.agent(payload.agentId))
          return yield* testTrigger({ watch: null, watchSeen: null, agentId: payload.agentId, prompt: payload.prompt }, payload.trigger, yield* zone).pipe(Effect.provide(services))
        })
      )
      .handle("testTrigger", ({ params, payload }) =>
        Effect.gen(function* () {
          const r = yield* found(store.routine(params.id))
          const trigger = payload.graph.nodes.find((n) => n.kind === "trigger")
          if (trigger?.kind !== "trigger") return yield* Effect.fail(new FlowInvalid({ message: "A routine has exactly one trigger." }))
          return yield* testTrigger(r, trigger.config, yield* zone).pipe(Effect.provide(services))
        })
      )
      .handle("runDetail", ({ params }) =>
        Effect.gen(function* () {
          const run = yield* found(store.routineRun(params.runId))
          if (run.routineId !== params.id) return yield* notFound()
          return { run: runOut(run), steps: (yield* store.stepsOfRun(run.id)).map(stepOut) }
        })
      )
      .handle("stepOutput", ({ params }) =>
        Effect.gen(function* () {
          const run = yield* found(store.routineRun(params.runId))
          const step = yield* found(store.runStep(params.stepId))
          if (run.routineId !== params.id || step.runId !== run.id) return yield* notFound()
          // The path comes from the database (written by flows.ts under dataDir/runs), never from the request.
          const text = step.outputFile ? yield* Effect.promise(() => Bun.file(join(dataDir, step.outputFile!)).text().catch(() => step.output)) : step.output
          return { text }
        })
      )
      .handle("uncertain", () =>
        Effect.gen(function* () {
          const out = []
          const mine = yield* visibleRoutines
          for (const step of yield* store.uncertainSteps()) {
            const run = yield* store.routineRun(step.runId)
            if (run && mine.has(run.routineId)) out.push({ routineId: run.routineId, runId: run.id, stepId: step.id, nodeId: step.nodeId, at: step.startedAt })
          }
          return out
        })
      )
      .handle("resolveStep", ({ params, payload }) =>
        Effect.gen(function* () {
          const run = yield* found(store.routineRun(params.runId))
          if (run.routineId !== params.id) return yield* notFound()
          if (!(yield* resolveStep(run.id, payload.stepId, payload.choice).pipe(Effect.provide(services)))) return yield* new HttpApiError.BadRequest()
        })
      )
  })
)

const runOut = ({ payload: _p, ...run }: RunRow) => run
// What a watch reads (a change starts it over, its first poll only learning); its filter and runs-per-item don't.
const channelsOf = (w: { serverId: string; tool: string; args: unknown; more?: unknown } | null) => (w ? JSON.stringify([w.serverId, w.tool, w.args, w.more ?? []]) : "")
// The flow trigger kinds that run at set times other than cron (spec 013), as the routine's schedule column.
const SCHEDULES: Partial<Record<string, (t: { date?: string | undefined; time?: string | undefined; day?: number | undefined }) => RoutineSchedule | null>> = {
  once: (t) => (t.date && t.time ? { kind: "once", date: t.date, time: t.time } : null),
  monthly: (t) => (t.day && t.time ? { kind: "monthly", day: t.day, time: t.time } : null)
}
const stepOut = ({ outputFile, mayHaveWritten: _m, ...s }: StepRow) => ({ ...s, full: outputFile !== null })

// `server`: server mode's guard and routes (server-routes.ts) in place of LocalOnly and the local login link.
export const AppLive = (webDir?: string, server?: ReturnType<typeof serverRoutes>) =>
  Layer.mergeAll(
    server ?? Layer.mergeAll(LocalOnly, Login),
    HttpApiBuilder.layer(Api).pipe(Layer.provide([Projects, Agents, Chats, Memories, ToolsGroup, AccountsGroup, Settings, RoutinesGroup, PagesGroup])),
    RoutineScheduler,
    TelegramChannel,
    RpcRoute,
    AttachmentUpload,
    AttachmentFile,
    WorkspaceExport,
    WorkspaceImport,
    OAuthCallback,
    TerminalSocket,
    BrowserSocket,
    BrowserPicture,
    ...(webDir && existsSync(join(webDir, "index.html")) ? [WebRoute(webDir, !!server)] : [])
  )

// Services with real dependencies (system keychain). Tests build their own with Secrets.memory.
export const services = (dbPath: string, dataDir: string, secrets?: Layer.Layer<Secrets, never, Store>) => {
  const pagesDir = join(dataDir, PAGES_DIR) // knowledge pages as Markdown files (page-files.ts)
  const store = Layer.provideMerge(PageSync(pagesDir), Store.layer(dbPath, pagesDir))
  const withSecrets = Layer.provideMerge(secrets ?? Secrets.layer, store)
  const base = Layer.mergeAll(Layer.provideMerge(Layer.mergeAll(Engines.layer, Tools.layer), withSecrets), DataDir.layer(dataDir), DbPath.layer(dbPath))
  const withAccounts = Layer.provideMerge(Layer.mergeAll(Accounts.layer, Workspace.layer, Pricing.layer, Audit.layer, BrowserService.layer), base)
  return Layer.mergeAll(Layer.provideMerge(Runtime.layer, withAccounts), Actor.local)
}

interface StartOptions {
  readonly port?: number
  readonly dataDir?: string
  readonly webDir?: string
}

// Entry point also used by the desktop app.
export async function start(o: StartOptions = {}) {
  const dataDir = o.dataDir ?? process.env.ZOREL_HOME ?? defaultDataDir()
  mkdirSync(dataDir, { recursive: true }) // don't spawn a shell just to create the folder
  // Server mode (spec 014): by environment only; misconfigured, it refuses to start rather than run open.
  let mode: ServerMode | undefined
  try {
    mode = serverModeFrom(process.env)
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }
  const port = mode?.port ?? o.port ?? Number(process.env.PORT ?? 4317)
  if (mode) process.env.ZOREL_ORIGIN = mode.publicUrl.origin // OAuth services send people back to the public URL
  process.env.ZOREL_ORIGIN ??= `http://127.0.0.1:${port}` // where OAuth services send the person back (oauth.ts)
  const dbPath = process.env.ZOREL_DB ?? dbPathIn(dataDir)
  const imported = await applyPendingImport(dataDir, dbPath).catch((e: unknown) => {
    console.error("import not applied:", e)
    return false
  })
  if (imported) console.info("imported workspace applied")
  const webDir = o.webDir ?? process.env.ZOREL_WEB_DIR ?? resolve(import.meta.dir, "../../web/dist")
  // A server keeps its secrets in the file vault (no keychain to rely on), the auth secret among them, made once.
  const server = mode && (await serverSetup(mode, dataDir, dbPath))
  AppLive(resolve(webDir), server?.routes).pipe(
    HttpRouter.serve,
    Layer.provide(services(dbPath, dataDir, mode ? Secrets.file(dataDir) : undefined)),
    Layer.provide(BunHttpServer.layer({ port, hostname: mode?.host ?? "127.0.0.1" })),
    Layer.provide(LoggerLive),
    Layer.launch,
    BunRuntime.runMain
  )
  watchParent()
  addCliDirsToPath() // agent CLIs installed in their usual folders are found even when this process's PATH lacks them
  process.on("exit", () => computersFor(dataDir).stopAll()) // the containers this run used don't outlive it
  // The desktop app brings its own secret; elsewhere this link is how the owner's browser gets in.
  if (mode) console.info(server?.setupLink ? `Zorel needs its first owner. Open (valid 1 hour): ${server.setupLink}` : `Zorel is up at ${mode.publicUrl.origin}`)
  else if (!process.env.ZOREL_PARENT_PID) console.info(`Open Zorel: ${process.env.ZOREL_WEB_ORIGIN ?? `http://127.0.0.1:${port}`}${LOGIN_PATH}?t=${SESSION}`)
  return `http://127.0.0.1:${port}`
}

// Server mode's identity (auth.ts): its secret from the vault (made once), its tables, the routes and guard, and the
// one-time setup link while there's no owner.
async function serverSetup(mode: ServerMode, dataDir: string, dbPath: string) {
  const vault = fileVault(dataDir)
  let secret = vault.get(AUTH_SECRET)
  if (!secret) {
    secret = randomBytes(32).toString("base64url")
    await vault.set(AUTH_SECRET, secret)
  }
  const a = makeAuth({ dbPath, secret, mode })
  await migrateAuth(a)
  const setup = setupToken()
  // The server's identity key (devices check it at pairing), made once into the vault.
  const identity = await serverIdentity(vault.get(SERVER_KEY), (jwk) => vault.set(SERVER_KEY, jwk))
  // Someone removed (FR-008, FR-019): their routines pause and they leave every project; their sessions and devices
  // are already gone (team-routes.ts).
  const onRemoved = async (personId: string) => {
    a.db.query("UPDATE routines SET enabled = 0 WHERE chat_id IN (SELECT id FROM chats WHERE owner_id = ?)").run(personId)
    a.db.query("DELETE FROM project_members WHERE person_id = ?").run(personId)
    a.db.query("UPDATE devices SET state = 'revoked' WHERE person_id = ?").run(personId)
  }
  return { routes: serverRoutes(mode, a, setup, identity, onRemoved), setupLink: hasOwner(a) ? undefined : `${mode.publicUrl.origin}/setup?t=${setup.value}` }
}
const AUTH_SECRET = "auth-secret"
const SERVER_KEY = "server-identity-key"

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
  const on = new Map(pickedEntries(pref).map((e) => [e.path, e.agents]))
  return discovered().map((s) => ({ path: s.path, name: s.name, description: s.description, source: s.source, ...(s.plugin && { plugin: s.plugin }), enabled: on.has(s.path), agents: on.get(s.path) ?? [] }))
}
