// SC-004 (spec 014): every route of the API is classified, so a new one can't slip in unchecked. Each is open (signed
// out: sign-in, setup, webhooks), for admins only (adminCheck), checked against what it names (visibility.ts: a chat,
// project, attachment, turn, approval, routine, memory, page or agent the person can't see answers 404), or shared by
// the team on purpose (lists filtered per person, the team's agents and connectors). A route in none of these fails.
import { expect, test } from "bun:test"
import { Api } from "@zorel/contracts"
import { HttpApi } from "effect/http-api"
import { adminCheck, openPath } from "./server-routes.ts"
import { namedIn } from "./visibility.ts"

// Team-wide by design: lists the handlers filter per person (main.ts `seen`), creating one's own things, and the
// team's shared crew and connectors (members use them, admins change them).
const SHARED = [
  "GET /api/projects", "POST /api/projects", "GET /api/chats", "POST /api/chats", "GET /api/agents", "POST /api/agents", "POST /api/agents/builder",
  "GET /api/teams", "POST /api/teams", "PATCH /api/teams/:id", "DELETE /api/teams/:id", "GET /api/models", "GET /api/search",
  "GET /api/memories", "POST /api/memories", "GET /api/memories/map", "POST /api/memories/map/links", "POST /api/memories/map/links/remove",
  "GET /api/pages", "POST /api/pages", "GET /api/routines", "POST /api/routines", "POST /api/routines/test-trigger", "GET /api/routine-runs",
  "GET /api/routine-steps/uncertain", "GET /api/today", "POST /api/today/read", "POST /api/activity", "GET /api/accounts", "GET /api/mcp",
  "GET /api/mcp/signed-in", "GET /api/mcp/:id/catalog", "GET /api/mcp/:id/tools", "POST /api/mcp/:id/options", "GET /api/preferences",
  "GET /api/skills/files", "GET /api/channels/telegram", "GET /api/computer", "GET /api/computer/:id/state", "POST /api/computer/:id/open",
  "POST /api/computer/:id/start", "POST /api/computer/:id/restart", "PUT /api/projects/order", "PUT /api/chats/order"
]

const member = { role: "member", sessionAt: Date.now() }
const sample = (path: string) => path.replace(/:[a-zA-Z]+/g, "x1")
const classify = (method: string, path: string) => {
  const p = sample(path)
  if (openPath(p)) return "open"
  if (adminCheck(method, p, member) === "admins_only") return "admin"
  if (Object.keys(namedIn(p, new URLSearchParams())).length) return "checked"
  if (SHARED.includes(`${method} ${path}`)) return "shared"
  return "unclassified"
}

test("SC-004: every API route is open, admin-only, checked against what it names, or shared on purpose", () => {
  const routes: string[] = []
  HttpApi.reflect(Api, { onGroup: () => {}, onEndpoint: ({ endpoint }) => routes.push(`${endpoint.method} ${endpoint.path}`) })
  expect(routes.length).toBeGreaterThan(100)
  const unclassified = routes.filter((r) => {
    const [method, path] = r.split(" ") as [string, string]
    return classify(method, path) === "unclassified"
  })
  expect(unclassified).toEqual([])
})

test("the server machine and its money are admins' (processes, folders, desktop, usage, erasing a computer)", () => {
  for (const [method, path] of [["GET", "/api/processes"], ["DELETE", "/api/processes/servers/1"], ["GET", "/api/folders"], ["GET", "/api/desktop/apps"], ["GET", "/api/usage"], ["POST", "/api/computer/erase/a1"]] as const)
    expect(adminCheck(method, path, member)).toBe("admins_only")
})

test("ids of other kinds name what they belong to; words in those paths don't", () => {
  expect(namedIn("/api/turns/t1/undo", new URLSearchParams())).toEqual({ ref: { kind: "turns", id: "t1" } })
  expect(namedIn("/api/approvals/a1", new URLSearchParams())).toEqual({ ref: { kind: "approvals", id: "a1" } })
  expect(namedIn("/api/memories/map", new URLSearchParams())).toEqual({})
  expect(namedIn("/api/agents/builder", new URLSearchParams())).toEqual({})
})
