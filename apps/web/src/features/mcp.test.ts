import { expect, test } from "bun:test"
import { splitCommand } from "../labels.ts"

test("splitCommand keeps quoted arguments whole", () => {
  expect(splitCommand(`npx -y @scope/server --root "/Users/me/My Files" --name 'two words'`)).toEqual(["npx", "-y", "@scope/server", "--root", "/Users/me/My Files", "--name", "two words"])
  expect(splitCommand("  uvx  server  ")).toEqual(["uvx", "server"])
})
