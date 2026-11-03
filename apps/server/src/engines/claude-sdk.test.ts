import { expect, test } from "bun:test"
import { commandOf } from "./claude-sdk.ts"

const commands = [{ name: "review", description: "", argumentHint: null }, { name: "plugin:fix", description: "", argumentHint: null }]

test("commandOf finds a known command at the start of the message", () => {
  expect(commandOf("/review the auth module", commands)).toBe("review")
  expect(commandOf("  /plugin:fix", commands)).toBe("plugin:fix")
  expect(commandOf("/unknown thing", commands)).toBeUndefined()
  expect(commandOf("please /review", commands)).toBeUndefined()
  expect(commandOf("/reviewer", commands)).toBeUndefined()
})
