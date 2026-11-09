import { expect, test } from "bun:test"
import { DEFAULT_PERMISSIONS } from "@zorel/contracts"
import { accessChange, browserRoute, mcpRoute, withAlways } from "./permissions.ts"

const server = { id: "s1", mode: "approve" as const }
const p = (over = {}) => ({ ...DEFAULT_PERMISSIONS, ...over })

test("grants decide which tools an agent sees", () => {
  expect(mcpRoute(p({ grants: { s1: "none" } }), server, { name: "get", cls: "read" }, false).expose).toBe(false)
  expect(mcpRoute(p({ grants: { s1: "read" } }), server, { name: "get", cls: "read" }, false).expose).toBe(true)
  expect(mcpRoute(p({ grants: { s1: "read" } }), server, { name: "create", cls: "write" }, false).expose).toBe(false)
  // No grant: the server's mode (a read-only server shows reading tools only).
  expect(mcpRoute(p(), { id: "s2", mode: "read" }, { name: "create", cls: "write" }, false).expose).toBe(false)
})

test("destructive tools ask unless allowed for good or the server is trusted", () => {
  const del = { name: "delete_page", cls: "sensitive" as const }
  expect(mcpRoute(p(), { id: "s1", mode: "auto" }, { name: "create", cls: "write" }, false).approve).toBe(false)
  expect(mcpRoute(p(), { id: "s1", mode: "auto" }, del, false).approve).toBe(false)
  expect(mcpRoute(p(), server, del, false).approve).toBe(true)
  expect(mcpRoute(p({ always: ["s1:delete_page"] }), server, del, false).approve).toBe(false)
  // "Ask first" asks for a destructive tool even on a trusted server.
  expect(mcpRoute(p(), { id: "s1", mode: "auto" }, del, true).approve).toBe(true)
  expect(mcpRoute(p(), { id: "s1", mode: "read" }, { name: "create", cls: "write" }, true).approve).toBe(false) // not exposed at all
})

test("risky clicks always ask; the rest asks only when the agent asks first", () => {
  expect(browserRoute(p({ always: ["browser"] }), { element: "Place order" }, true, false)).toEqual({ approve: true, alwaysKey: null })
  expect(browserRoute(p(), { element: "Next page" }, true, false).approve).toBe(false)
  expect(browserRoute(p(), { element: "Next page" }, true, true).approve).toBe(true)
  // The agent's own label can't hide what the page calls the button.
  expect(browserRoute(p({ always: ["browser"] }), { element: "button" }, true, false, "Place order")).toEqual({ approve: true, alwaysKey: null })
  expect(browserRoute(p(), {}, true, false, "")).toEqual({ approve: false, alwaysKey: null })
  expect(browserRoute(p({ always: ["browser"] }), {}, true, true).approve).toBe(false)
  expect(withAlways(withAlways(p(), "browser"), "browser").always).toEqual(["browser"])
})

test("an access request names what changes, or why it can't", () => {
  const servers = [{ id: "s1", name: "GitHub", mode: "approve" as const }]
  expect(accessChange(p({ web: false }), "web", undefined, servers)).toEqual({ label: "use the web", next: p({ web: true }) })
  expect(accessChange(p(), "web", undefined, servers)).toBe("You already have web access.")
  expect(accessChange(p({ grants: { s1: "none" } }), "github", "read", servers)).toEqual({ label: "read GitHub", next: p({ grants: { s1: "read" } }) })
  expect(typeof accessChange(p(), "linear", "read", servers)).toBe("string")
})
