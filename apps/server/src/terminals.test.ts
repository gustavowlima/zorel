import { describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseLsof } from "./procs.ts"
import { parseFrame, Ring, runLine, scriptsOf, serversUnder, shellCommand } from "./terminals.ts"

test("parseFrame takes input and sane sizes, nothing else", () => {
  expect(parseFrame(`{"t":"i","d":"ls\\r"}`)).toEqual({ t: "i", d: "ls\r" })
  expect(parseFrame(`{"t":"r","c":120,"r":40}`)).toEqual({ t: "r", c: 120, r: 40 })
  expect(parseFrame(`{"t":"r","c":0,"r":40}`)).toBeUndefined() // too small
  expect(parseFrame(`{"t":"r","c":120.5,"r":40}`)).toBeUndefined() // not an integer
  expect(parseFrame(`{"t":"r","c":99999,"r":40}`)).toBeUndefined() // too large
  expect(parseFrame(`{"t":"i","d":"${"x".repeat(70_000)}"}`)).toBeUndefined() // over the input cap
  expect(parseFrame("not json")).toBeUndefined()
  expect(parseFrame(`{"t":"x"}`)).toBeUndefined()
})

test("parseFrame: kill", () => {
  expect(parseFrame(`{"t":"k"}`)).toEqual({ t: "k" })
})

test("Ring keeps the last bytes in order", () => {
  const r = new Ring(8)
  const enc = (s: string) => new TextEncoder().encode(s)
  r.push(enc("abc"))
  r.push(enc("defg"))
  expect(new TextDecoder().decode(r.read())).toBe("abcdefg")
  r.push(enc("hijk"))
  expect(new TextDecoder().decode(r.read())).toBe("defghijk") // "abc" dropped, 8 bytes kept
  r.push(enc("0123456789"))
  expect(new TextDecoder().decode(r.read())).toBe("23456789") // one chunk larger than the ring: its tail
})

describe("project scripts", () => {
  test("lists package.json scripts and runs them with the lockfile's manager", () => {
    const dir = mkdtempSync(join(tmpdir(), "zorel-scripts-"))
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { dev: "vite", "test:unit": "bun test", "bad name": "x", n: 1 } }))
    writeFileSync(join(dir, "bun.lock"), "")
    expect(scriptsOf(dir)).toEqual([{ name: "dev", command: "vite" }, { name: "test:unit", command: "bun test" }])
    expect(runLine(dir, "dev")).toBe("bun run dev\r")
    expect(runLine(dir, "bad name")).toBeUndefined()
    expect(runLine(dir, "rm -rf /")).toBeUndefined()
    expect(scriptsOf(join(dir, "nope"))).toEqual([])
  })
})

describe("parseLsof", () => {
  test("groups fields by process", () => {
    const m = parseLsof("p10\ncnode\nf3\nn*:5173\nf4\nn[::1]:5173\np11\ncbun\nn127.0.0.1:4000\n")
    expect(m.get(10)).toEqual({ command: "node", names: ["*:5173", "[::1]:5173"] })
    expect(m.get(11)?.names).toEqual(["127.0.0.1:4000"])
  })
})

describe("shellCommand", () => {
  test("PowerShell on Windows; the person's $SHELL elsewhere, as a login shell", () => {
    expect(shellCommand("win32", {})[0]).toMatch(/^(pwsh|powershell)\.exe$/)
    expect(shellCommand("linux", { SHELL: "/usr/bin/fish" })).toEqual(["/usr/bin/fish", "-l"])
    expect(shellCommand("darwin", {})[1]).toBe("-l")
  })
})

// A server counts when one of a chat's own processes (a shell, an agent session) started it; one that only runs in the
// same folder doesn't, and neither does the session listening itself.
test.skipIf(process.platform === "win32")("servers: what a chat's process started counts, a stranger in the folder doesn't", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "zorel-srv-")))
  const serve = "Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('ok') }); setInterval(() => {}, 1000)"
  const shell = Bun.spawn(["sh", "-c", `bun -e "${serve}" & p=$!; trap 'kill $p' TERM; wait`], { cwd: root, stdout: "ignore", stderr: "ignore" })
  const stranger = Bun.spawn(["bun", "-e", serve], { cwd: root, stdout: "ignore", stderr: "ignore" })
  try {
    const owned = new Map([[shell.pid, root]])
    let found: Awaited<ReturnType<typeof serversUnder>> = []
    for (let i = 0; i < 50 && !found.length; i++) {
      await Bun.sleep(100)
      found = await serversUnder(owned)
    }
    expect(found.map((s) => s.root)).toEqual([root]) // the shell's server
    expect(found.some((s) => s.pid === stranger.pid)).toBe(false) // same folder, not started by the chat
    expect(found.some((s) => s.pid === shell.pid)).toBe(false) // the session itself isn't a server
  } finally {
    shell.kill()
    stranger.kill()
    await Promise.all([shell.exited, stranger.exited])
  }
}, 20_000)
