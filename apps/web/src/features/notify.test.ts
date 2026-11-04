import { expect, test } from "bun:test"
import { noteworthy } from "../labels.ts"

test("noteworthy: waiting and failed always; done only after running", () => {
  expect(noteworthy("running", "waiting")).toBe("waiting")
  expect(noteworthy("running", "failed")).toBe("failed")
  expect(noteworthy("running", "idle")).toBe("done")
  expect(noteworthy(undefined, "idle")).toBeUndefined() // first sight of a chat
  expect(noteworthy("waiting", "waiting")).toBeUndefined()
})
