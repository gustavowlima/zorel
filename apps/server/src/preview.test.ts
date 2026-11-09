import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { freePort, outputTail, previewFolder, previewKey, previewLine, previewUrl, waitForPort } from "./preview.ts"

const scripts = [
  { name: "dev", command: "vite" },
  { name: "start", command: "next start" },
  { name: "docs", command: "astro dev" }
]

test("a script runs with the project's manager; Vite and Astro also get the port as a flag", () => {
  expect(previewLine({ script: "dev" }, scripts, "bun", 4123)).toEqual({ line: "bun run dev --port 4123 --strictPort", label: "dev" })
  expect(previewLine({ script: "dev" }, scripts, "npm", 4123)).toEqual({ line: "npm run dev -- --port 4123 --strictPort", label: "dev" }) // npm: after --
  expect(previewLine({ script: "docs" }, scripts, "pnpm", 4123)).toEqual({ line: "pnpm run docs --port 4123 --strictPort", label: "docs" })
  expect(previewLine({ script: "start" }, scripts, "yarn", 4123)).toEqual({ line: "yarn run start", label: "start" }) // Next reads PORT
})

test("a command for any stack gets the port where it says {port}", () => {
  expect(previewLine({ command: "python manage.py runserver {port}" }, [], "npm", 5000)).toEqual({ line: "python manage.py runserver 5000", label: "python manage.py runserver" })
  expect(previewLine({ command: "rails server -p {port} -b 127.0.0.1" }, [], "npm", 5000)).toMatchObject({ line: "rails server -p 5000 -b 127.0.0.1" })
})

test("what can't run is said in words", () => {
  expect(previewLine({ script: "dev", command: "x" }, scripts, "bun", 1)).toBe("Give script or command, not both.")
  expect(previewLine({ script: "build" }, scripts, "bun", 1)).toBe("No script \"build\". This folder has: dev, start, docs.")
  expect(previewLine({}, [], "bun", 1)).toMatch(/give command/)
  expect(previewLine({ command: "a\nrm -rf ~" }, [], "bun", 1)).toBe("command: one line, up to 1000 characters.") // one line: nothing smuggled after it
})

test("the folder stays inside the project", () => {
  const root = mkdtempSync(join(tmpdir(), "zorel-preview-"))
  mkdirSync(join(root, "apps", "web"), { recursive: true })
  expect(previewFolder(root, undefined)).toEqual({ dir: root })
  expect(previewFolder(root, "apps/web")).toEqual({ dir: join(root, "apps", "web") })
  expect(previewFolder(root, "../elsewhere")).toBe("folder: a path inside the project.")
  expect(previewFolder(root, "/etc")).toBe("folder: a path inside the project.")
  expect(previewFolder(root, "apps/missing")).toBe("No folder apps/missing in the project.")
})

test("the page's URL, the reuse key and the output the agent reads", () => {
  expect(previewUrl(4000, undefined)).toBe("http://localhost:4000/")
  expect(previewUrl(4000, "login")).toBe("http://localhost:4000/login")
  expect(previewKey("p1", "/r", "/r/apps/web", "dev")).toBe("preview:p1:apps/web:dev")
  expect(previewKey("p1", "/r", "/r", "dev")).toBe("preview:p1:.:dev")
  expect(outputTail(new TextEncoder().encode("\x1b[32mready\x1b[0m in 300ms\r\nerror: port in use\r\n"))).toBe("ready in 300ms\nerror: port in use")
})

// A real server under a shell: the wait finds the port it was given (procs.ts reads the system's tables).
test.skipIf(process.platform === "win32")("waits for the port a server started from the shell listens on", async () => {
  const port = await freePort()
  const server = `Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PORT), fetch: () => new Response("ok") })`
  // On SIGTERM the shell stops the server it started: killing only `sh` left the server running, one per test run.
  const shell = Bun.spawn(["sh", "-c", `bun -e '${server}' & p=$!; trap 'kill $p' TERM; wait`], { env: { ...process.env, PORT: String(port) }, stdout: "ignore", stderr: "ignore" })
  try {
    expect(await waitForPort(shell.pid, port, () => shell.exitCode !== null, 15_000)).toBe(port)
  } finally {
    shell.kill()
    await shell.exited
  }
  expect(await fetch(`http://127.0.0.1:${port}/`).then(() => "still up", () => "gone")).toBe("gone") // no orphan left behind
}, 20_000)
