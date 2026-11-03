import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Api, MAX_ATTACHMENT_BYTES, type ToolInfo, UndoConflict, USAGE_DAYS } from "@zero/contracts"
import { ZeroRpc } from "@zero/contracts/events"
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join, normalize, resolve } from "node:path"
import { consolidate, DataDir } from "./chat.ts"
import { Store, type Repository } from "./db.ts"
import { Engines, listModels } from "./engines.ts"
import { API_KEYS, mcpEnvName, Secrets } from "./secrets.ts"
import { Accounts } from "./accounts.ts"
import { Actor } from "./access.ts"
import { Actions, Audit, changed } from "./audit.ts"
import { LoggerLive } from "./observability.ts"
import { Runtime } from "./runtime.ts"
import { Tools } from "./tools.ts"
import { billingOf, Pricing } from "./pricing.ts"
import { clean, measure } from "./storage.ts"
import { Workspace } from "./workspace.ts"

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
          const after = yield* Effect.flatMap(withPath(payload), (p) => found(store.updateProject(params.id, p)))
          if (before) yield* audit.record(Actions.projectUpdated, { target: after, ...changed(before, after, ["name", "brief", "path"]) })
          return after
        })
      )
      .handle("files", ({ params, query }) =>
        Effect.gen(function* () {
          const project = yield* store.project(params.id)
          if (!project) return yield* notFound()
          // Marks are relative to the chat's first checkpoint: what this conversation changed.
          const since = query.chatId ? yield* store.firstTree(query.chatId) : null
          return yield* workspace.files(project, since ?? null)
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

const AGENT_FIELDS = ["name", "instructions", "model", "accountId", "effort", "failover", "access"] as const

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
    const services = yield* Effect.context<Store | Engines | DataDir>()
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
        store.removeChat(params.id).pipe(Effect.tap(() => Effect.sync(() => rmSync(join(dataDir, "attachments", params.id), { recursive: true, force: true }))))
      )
      .handle("reorder", ({ payload }) => store.reorderChats(payload.projectId, payload.ids))
      .handle("messages", ({ params }) => store.messages(params.id))
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
          const { conflicts } = yield* workspace.restore(project, t.before, t.after)
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
  Effect.map(store.preference(FAILOVER_TERMS), (v) => ({ failoverTermsAcceptedAt: v ? Number(v) : null }))

const Settings = HttpApiBuilder.group(Api, "settings", (h) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const accounts = yield* Accounts
    const store = yield* Store
    const audit = yield* Audit
    const dataDir = yield* DataDir
    const storageReport = Effect.gen(function* () {
      const [projects, chats, messages] = yield* Effect.all([store.projects(), store.chats(), store.messageCounts()])
      return yield* Effect.promise(() => measure(dataDir, { projects, chats, messages }))
    })
    return h
      .handle("audit", () => audit.list)
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

export const AppLive = (webDir?: string) =>
  Layer.mergeAll(
    LocalOnly,
    HttpApiBuilder.layer(Api).pipe(Layer.provide([Projects, Agents, Chats, Memories, ToolsGroup, AccountsGroup, Settings])),
    RpcRoute,
    AttachmentUpload,
    AttachmentFile,
    ...(webDir && existsSync(join(webDir, "index.html")) ? [WebRoute(webDir)] : [])
  )

// Services with real dependencies (system keychain). Tests build their own with Secrets.memory.
export const services = (dbPath: string, dataDir: string, secrets?: Layer.Layer<Secrets, never, Store>) => {
  const store = Store.layer(dbPath)
  const withSecrets = Layer.provideMerge(secrets ?? Secrets.layer, store)
  const base = Layer.mergeAll(Layer.provideMerge(Layer.mergeAll(Engines.layer, Tools.layer), withSecrets), DataDir.layer(dataDir))
  const withAccounts = Layer.provideMerge(Layer.mergeAll(Accounts.layer, Workspace.layer, Pricing.layer, Audit.layer), base)
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
  return `http://127.0.0.1:${port}`
}

if (import.meta.main) await start()
