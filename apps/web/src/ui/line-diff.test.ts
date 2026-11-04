import { expect, test } from "bun:test"
import { diffLines } from "./line-diff.tsx"

test("removed lines come before what replaces them; unchanged lines stay", () => {
  const d = diffLines("1. test\n2. bump\n3. tag", "1. test\n2. lint\n3. bump\n4. tag")
  expect(d.map((l) => `${l.kind}:${l.text}`)).toEqual(["same:1. test", "del:2. bump", "del:3. tag", "add:2. lint", "add:3. bump", "add:4. tag"])
  expect(diffLines("a\nb", "a\nb").every((l) => l.kind === "same")).toBe(true)
})
