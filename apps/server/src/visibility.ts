// Who sees what on a team server (spec 014, FR-006/FR-015): a chat outside a project only its owner (an owner or admin
// doesn't read other people's private chats); a project, its chats, files and agents, its members, and owners and
// admins every project. Locally the one owner ("local") sees everything: chats are theirs, projects open.
import { Effect } from "effect"
import { type Ref, type RefKind, Store } from "./db.ts"

export interface Viewer {
  readonly id: string
  readonly role: "owner" | "admin" | "member"
}
type ChatRef = { readonly projectId: string | null; readonly ownerId: string | null }

export const seesProject = (v: Viewer, projectId: string, mine: ReadonlySet<string>) => v.role !== "member" || mine.has(projectId)
// A chat made before people existed (no owner) belongs to the owners.
export const seesChat = (v: Viewer, c: ChatRef, mine: ReadonlySet<string>) => (c.projectId ? seesProject(v, c.projectId, mine) : c.ownerId === v.id || (c.ownerId === null && v.role === "owner"))

// The projects a person belongs to, and a checker bound to them.
export const viewerScope = (v: Viewer) =>
  Effect.gen(function* () {
    const store = yield* Store
    const mine = new Set(v.role === "member" ? yield* store.projectsOf(v.id) : [])
    return { chat: (c: ChatRef) => seesChat(v, c, mine), project: (id: string) => seesProject(v, id, mine) }
  })

// What a request names (a chat or a project, in its path or its query), so the guard checks it before any handler runs.
// Routes named by another kind of id: the guard looks up what it belongs to (Store.refOf).
export const REF_KINDS: ReadonlyArray<RefKind> = ["turns", "approvals", "routines", "memories", "pages", "agents"]
export function namedIn(path: string, query: URLSearchParams): { chat?: string; project?: string; attachment?: string; ref?: { kind: RefKind; id: string } } {
  const ref = /^\/api\/([a-z]+)\/([^/]+)/.exec(path)
  if (ref && REF_KINDS.includes(ref[1] as RefKind) && !RESERVED.has(ref[2]!)) return { ref: { kind: ref[1] as RefKind, id: ref[2]! } }
  const chat = /^\/api\/chats\/([^/]+)/.exec(path)?.[1]
  if (chat && chat !== "order") return { chat }
  const project = /^\/api\/projects\/([^/]+)/.exec(path)?.[1]
  if (project && project !== "order") return { project, ...(query.get("chatId") && { chat: query.get("chatId")! }) }
  const attachment = /^\/api\/attachments\/([^/]+)/.exec(path)?.[1]
  if (attachment) return { attachment }
  if (path === "/api/browser" || path === "/api/browser/picture" || path === "/api/terminals") return query.get("chat") ? { chat: query.get("chat")! } : {}
  return {}
}

const RESERVED = new Set(["order", "builder", "map", "test-trigger"]) // words in those paths that aren't ids

// Whether the viewer may reach what the request names: unknown ids pass (the handler answers "not found" itself).
export const mayReach = (v: Viewer, path: string, query: URLSearchParams) =>
  Effect.gen(function* () {
    const named = namedIn(path, query)
    if (!named.chat && !named.project && !named.attachment && !named.ref) return true
    const store = yield* Store
    const scope = yield* viewerScope(v)
    if (named.ref) {
      const r = yield* store.refOf(named.ref.kind, named.ref.id)
      if (!r) return true
      if (!(yield* reachesRef(v, r, scope.project))) return false
      if (!r.chatId) return true
      const c = yield* store.chatAccess(r.chatId)
      return !c || scope.chat(c)
    }
    if (named.project && !scope.project(named.project)) return false
    const chatId = named.chat ?? (named.attachment ? (yield* store.attachment(named.attachment))?.chatId : undefined)
    if (!chatId) return true
    const c = yield* store.chatAccess(chatId)
    return !c || scope.chat(c)
  })

// A memory, page or agent: by its scope. A person's own facts ("user") are theirs alone; a project's or a project
// agent's, the project's people; a global agent's, everyone's.
const reachesRef = (v: Viewer, r: Ref, project: (id: string) => boolean) =>
  Effect.gen(function* () {
    if (r.projectId) return project(r.projectId)
    if (r.scope === "user") return r.owner === undefined || r.owner === v.id
    if (r.scope?.startsWith("project:")) return project(r.scope.slice(8))
    if (r.scope?.startsWith("agent:")) {
      const agent = yield* (yield* Store).refOf("agents", r.scope.slice(6))
      return !agent?.projectId || project(agent.projectId)
    }
    return true
  })

// The store as one person's turn sees it (spec 014): every read of memories hears only that person's personal facts
// (the user scope), and what it keeps is theirs. Everything else is the store itself. Locally the person is "local".
export const ownedStore = <S extends OwnedMemories>(store: S, owner: string): S => ({
  ...store,
  memories: () => store.memories(owner),
  activeMemories: (scopes, kind, _o, forAgent) => store.activeMemories(scopes, kind, owner, forAgent),
  pendingMemories: (scopes) => store.pendingMemories(scopes, owner),
  pendingCount: (scopes) => store.pendingCount(scopes, owner),
  forgottenMemories: (scopes, limit) => store.forgottenMemories(scopes, limit, owner),
  factsAbout: (ids, scopes) => store.factsAbout(ids, scopes, owner),
  searchMemories: (scopes, query, exclude, limit, kind, _o, forAgent) => store.searchMemories(scopes, query, exclude, limit, kind, owner, forAgent),
  addMemory: (input) => store.addMemory({ ...input, owner })
})
import type { Repository } from "./db.ts"
type OwnedMemories = Pick<Repository, "memories" | "activeMemories" | "pendingMemories" | "pendingCount" | "forgottenMemories" | "factsAbout" | "searchMemories" | "addMemory">
