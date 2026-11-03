import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Api, SendInput, type SendEvent, type ToolInfo } from "@zero/contracts"
import { Effect, Layer, Schema, Stream } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join, normalize, resolve } from "node:path"
import { consolidate, DataDir, decide, send } from "./chat.ts"
import { Store, type Repository } from "./db.ts"
import { Engines, listModels } from "./engines.ts"
import { API_KEYS, mcpEnvName, Secrets } from "./secrets.ts"
import { Tools } from "./tools.ts"

const notFound = () => Effect.fail(new HttpApiError.NotFound())
const found = <A, E, R>(e: Effect.Effect<A | undefined, E, R>) => Effect.flatMap(e, (a) => (a === undefined ? notFound() : Effect.succeed(a)))
const exists = <A>(e: Effect.Effect<A | undefined>) => Effect.map(e, (a) => a !== undefined)

// Agentes de um chat: existem e são globais ou do mesmo projeto.
const validAgents = (store: Repository, agentIds: ReadonlyArray<string>, projectId: string | null) =>
  Effect.forEach(agentIds, store.agent).pipe(Effect.map((as) => as.every((a) => !!a && (a.projectId === null || a.projectId === projectId))))
// Projeto opcional que, se informado, precisa existir.
const projectOk = (store: Repository, projectId: string | null) => (projectId ? exists(store.project(projectId)) : Effect.succeed(true))

const Projects = HttpApiBuilder.group(Api, "projects", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    const { hub } = yield* Tools
    return h
      .handle("list", () => store.projects())
      .handle("create", ({ payload }) => store.createProject(payload))
      .handle("update", ({ params, payload }) => found(store.updateProject(params.id, payload)))
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          const servers = (yield* store.mcpServers()).filter((s) => s.projectId === params.id)
          yield* Effect.promise(() => Promise.all(servers.map((s) => hub.close(s.id))))
          yield* store.removeProject(params.id)
        })
      )
  })
)

const Agents = HttpApiBuilder.group(Api, "agents", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    return h
      .handle("list", () => store.agents())
      .handle("create", ({ payload }) => Effect.flatMap(projectOk(store, payload.projectId), (ok) => (ok ? store.createAgent(payload) : notFound())))
      .handle("update", ({ params, payload }) => found(store.updateAgent(params.id, payload)))
      .handle("remove", ({ params }) => store.removeAgent(params.id))
  })
)

const Chats = HttpApiBuilder.group(Api, "chats", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    const services = yield* Effect.context<Store | Engines | DataDir>()
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
      .handle("remove", ({ params }) => store.removeChat(params.id))
      .handle("messages", ({ params }) => store.messages(params.id))
      .handle("consolidate", ({ params }) =>
        consolidate(params.id, true).pipe(
          Effect.provide(services),
          Effect.catchTags({ NotFound: () => notFound(), Busy: () => Effect.fail(new HttpApiError.Conflict()) })
        )
      )
  })
)

const Memories = HttpApiBuilder.group(Api, "memories", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    return h
      .handle("list", () => store.memories())
      // Escrita pelo usuário: já nasce ativa. Repetida: devolve a existente.
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          const added = yield* store.addMemory({ ...payload, state: "active", origin: "manual", chatId: null })
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
    return h
      .handle("list", () => store.mcpServers())
      .handle("create", ({ payload: { env, ...input } }) =>
        Effect.gen(function* () {
          if (!(yield* projectOk(store, input.projectId))) return yield* notFound()
          const server = yield* store.createMcpServer({ ...input, envKeys: Object.keys(env) })
          if (Object.keys(env).length) yield* Effect.promise(() => secrets.set(mcpEnvName(server.id), JSON.stringify(env))) // valores só no chaveiro
          return server
        })
      )
      .handle("update", ({ params, payload }) =>
        Effect.promise(() => hub.close(params.id)).pipe(Effect.flatMap(() => found(store.updateMcpServer(params.id, payload))))
      )
      .handle("remove", ({ params }) =>
        Effect.promise(async () => {
          await hub.close(params.id)
          await secrets.set(mcpEnvName(params.id), "")
        }).pipe(Effect.andThen(store.removeMcpServer(params.id)))
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
      .handle("decide", ({ params, payload }) => (decide(params.id, payload.approve) ? Effect.void : notFound()))
  })
)

const Settings = HttpApiBuilder.group(Api, "settings", (h) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    return h
      .handle("models", () => Effect.promise(() => listModels(secrets)))
      .handle("keys", () => Effect.sync(() => API_KEYS.map((name) => ({ name, set: !!secrets.get(name), fromEnv: secrets.fromEnv(name) }))))
      .handle("setKey", ({ params, payload }) =>
        (API_KEYS as ReadonlyArray<string>).includes(params.name) ? Effect.promise(() => secrets.set(params.name, payload.value.trim())) : notFound()
      )
  })
)

// Streaming (SSE) fica fora do HttpApi: POST /api/chats/:id/send → data: SendEvent\n\n
const sse = (e: SendEvent) => `data: ${JSON.stringify(e)}\n\n`
const SendRoute = HttpRouter.add(
  "POST",
  "/api/chats/:id/send",
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.schemaPathParams(Schema.Struct({ id: Schema.String }))
    const input = yield* HttpServerRequest.schemaBodyJson(SendInput)
    const events = yield* send(id, input)
    return HttpServerResponse.stream(events.pipe(Stream.map(sse), Stream.encodeText), {
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" }
    })
  }).pipe(
    Effect.catchTags({
      SchemaError: (e) => HttpServerResponse.json({ error: e.message }, { status: 400 }),
      NotFound: () => HttpServerResponse.json({ error: "chat não encontrado" }, { status: 404 }),
      Busy: () => HttpServerResponse.json({ error: "este chat já está respondendo" }, { status: 409 })
    })
  )
)

// Build do web (apps/web/dist), quando existe: um processo só serve a API e a interface.
const WebRoute = (dir: string) =>
  HttpRouter.add("GET", "/*", (req) => {
    const path = normalize(join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname)))
    const file = path.startsWith(dir) && existsSync(path) && !path.endsWith("/") && Bun.file(path).size > 0 ? path : join(dir, "index.html")
    return HttpServerResponse.file(file).pipe(Effect.orDie)
  })

// O server é local, sem login: só aceita quem fala com ele como local. Host fora da lista barra DNS rebinding;
// Origin de outro site barra CSRF (um POST "simples" de qualquer página dispararia um turno com ferramentas).
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
  if (!headers.origin) return true // mesma origem em GET, curl, CLIs
  return LOCAL.has(hostname(headers.origin) ?? "") // "null" (sandbox, file://) também é recusada
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
    HttpApiBuilder.layer(Api).pipe(Layer.provide([Projects, Agents, Chats, Memories, ToolsGroup, Settings])),
    SendRoute,
    ...(webDir && existsSync(join(webDir, "index.html")) ? [WebRoute(webDir)] : [])
  )

// Serviços com dependências reais (chaveiro do sistema). Testes montam os seus com Secrets.memory.
export const services = (dbPath: string, dataDir: string, secrets?: Layer.Layer<Secrets, never, Store>) => {
  const store = Store.layer(dbPath)
  const withSecrets = Layer.provideMerge(secrets ?? Secrets.layer, store)
  return Layer.mergeAll(Layer.provideMerge(Layer.mergeAll(Engines.layer, Tools.layer), withSecrets), DataDir.layer(dataDir))
}

export interface StartOptions {
  readonly port?: number
  readonly dataDir?: string
  readonly webDir?: string
}

// Ponto de entrada também usado pelo app desktop.
export async function start(o: StartOptions = {}) {
  const dataDir = o.dataDir ?? process.env.ZERO_HOME ?? join(homedir(), ".zero")
  await Bun.$`mkdir -p ${dataDir}`.quiet()
  const port = o.port ?? Number(process.env.PORT ?? 4317)
  const webDir = o.webDir ?? process.env.ZERO_WEB_DIR ?? resolve(import.meta.dir, "../../web/dist")
  AppLive(resolve(webDir)).pipe(
    HttpRouter.serve,
    Layer.provide(services(process.env.ZERO_DB ?? join(dataDir, "zero.db"), dataDir)),
    Layer.provide(BunHttpServer.layer({ port, hostname: "127.0.0.1" })),
    Layer.launch,
    BunRuntime.runMain
  )
  return `http://127.0.0.1:${port}`
}

if (import.meta.main) await start()
