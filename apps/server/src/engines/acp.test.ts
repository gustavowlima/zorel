import { describe, expect, test } from "bun:test"
import { kindOf, permission } from "./acp.ts"

describe("acp", () => {
  test("maps ACP tool kinds to step kinds", () => {
    expect([kindOf("read"), kindOf("edit"), kindOf("move"), kindOf("execute"), kindOf("fetch"), kindOf("think")]).toEqual(["read", "edit", "edit", "run", "search", "tool"])
  })
  test("allows once unless access is ask", () => {
    const options = [{ optionId: "a", kind: "allow_always" }, { optionId: "o", kind: "allow_once" }, { optionId: "r", kind: "reject_once" }]
    expect(permission(options, "workspace")).toEqual({ outcome: { outcome: "selected", optionId: "o" } })
    expect(permission(options, "ask")).toEqual({ outcome: { outcome: "cancelled" } })
    expect(permission([{ optionId: "r", kind: "reject_once" }], "full")).toEqual({ outcome: { outcome: "cancelled" } })
  })
})
