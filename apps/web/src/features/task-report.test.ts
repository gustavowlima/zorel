import { expect, test } from "bun:test"
import { parseTaskReport, taskIdOf } from "./task-report.ts"

test("parseTaskReport: the asked shape on one line or several, the link last; anything else stays text", () => {
  expect(parseTaskReport("Status: done Result: ok Evidence: rodei `sleep 10` e ele terminou sem erro.\n\n[Open the task](#/chat/c-1)")).toEqual({ status: "done", result: "ok", evidence: "rodei `sleep 10` e ele terminou sem erro.", taskId: "c-1" })
  expect(parseTaskReport("**Status:** partial\n**Result:** half of it\n**Evidence:** read 2 files\n\n[Open the task](#/chat/x)")).toMatchObject({ status: "partial", result: "half of it", evidence: "read 2 files" })
  expect(parseTaskReport("Status: blocked. Result: no access\n\n[Open the task](#/chat/x)")).toMatchObject({ status: "blocked", result: "no access", evidence: "" })
  expect(parseTaskReport("Here is what I found: all good.\n\n[Open the task](#/chat/x)")).toBeUndefined() // not the shape
  expect(parseTaskReport("Status: done Result: ok")).toBeUndefined() // no task link
  expect(taskIdOf("#/chat/abc")).toBe("abc")
  expect(taskIdOf("https://example.com")).toBeUndefined()
})
