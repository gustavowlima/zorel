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
const found = <A>(a: A | undefined) => (a === undefined ? notFound() : Effect.succeed(a))

// Agentes de um chat: existem e são globais ou do mesmo projeto.
const validAgents = (store: Repository, agentIds: ReadonlyArray<string>, projectId: string | null) =>
  agentIds.every((id) => {
    const a = store.agent(id)
    return !!a && (a.projectId === null || a.projectId === projectId)
  })

const Projects = HttpApiBuilder.group(Api, "projects", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    const { hub } = yield* Tools
    return h
      .handle("list", () => Effect.sync(store.projects))
      .handle("create", ({ payload }) => Effect.sync(() => store.createProject(payload)))
      .handle("update", ({ params, payload }) => found(store.updateProject(params.id, payload)))
      .handle("remove", ({ params }) =>
        Effect.promise(async () => {
          await Promise.all(store.mcpServers().filter((s) => s.projectId === params.id).map((s) => hub.close(s.id)))
          store.removeProject(params.id)
        })
      )
  })
)

const Agents = HttpApiBuilder.group(Api, "agents", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    return h
      .handle("list", () => Effect.sync(store.agents))
      .handle("create", ({ payload }) => (payload.projectId && !store.project(payload.projectId) ? notFound() : Effect.sync(() => store.createAgent(payload))))
      .handle("update", ({ params, payload }) => found(store.updateAgent(params.id, payload)))
      .handle("remove", ({ params }) => Effect.sync(() => store.removeAgent(params.id)))
  })
)

const Chats = HttpApiBuilder.group(Api, "chats", (h) =>
  Effect.gen(function* () {
    const store = yield* Store
    const services = yield* Effect.context<Store | Engines | DataDir>()
    return h
      .handle("list", () => Effect.sync(store.chats))
      .handle("create", ({ payload }) =>
        (payload.projectId && !store.project(payload.projectId)) || !validAgents(store, payload.agentIds, payload.projectId)
          ? notFound()
          : Effect.sync(() => store.createChat(payload))
      )
      .handle("update", ({ params, payload }) => {
        const chat = store.chat(params.id)
        if (!chat || (payload.agentIds && !validAgents(store, payload.agentIds, chat.projectId))) return notFound()
        return found(store.updateChat(params.id, payload))
      })
      .handle("remove", ({ params }) => Effect.sync(() => store.removeChat(params.id)))
      .handle("messages", ({ params }) => Effect.sync(() => store.messages(params.id)))
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
      .handle("list", () => Effect.sync(store.memories))
      // Escrita pelo usuário: já nasce ativa. Repetida: devolve a existente.
      .handle("create", ({ payload }) =>
        Effect.sync(
          () =>
            store.addMemory({ ...payload, state: "active", origin: "manual", chatId: null }) ??
            store.memories().find((m) => m.scope === payload.scope && m.text === payload.text)!
        )
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
      .handle("list", () => Effect.sync(store.mcpServers))
      .handle("create", ({ payload: { env, ...input } }) =>
        input.projectId && !store.project(input.projectId)
          ? notFound()
          : Effect.promise(async () => {
              const server = store.createMcpServer({ ...input, envKeys: Object.keys(env) })
              if (Object.keys(env).length) await secrets.set(mcpEnvName(server.id), JSON.stringify(env)) // valores só no chaveiro
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
          store.removeMcpServer(params.id)
        })
      )
      .handle("inspect", ({ params }) => {
        const server = store.mcpServer(params.id)
        if (!server) return notFound()
        return Effect.promise(() =>
          hub.tools(server).then(
            (tools) => ({ tools: tools.map(({ name, description, cls }): ToolInfo => ({ name, description, cls })), error: null }),
            (e: unknown) => ({ tools: [], error: e instanceof Error ? e.message : String(e) })
          )
        )
      })
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

export const AppLive = (webDir?: string) =>
  Layer.mergeAll(
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
