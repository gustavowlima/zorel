import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkFolder, clipOutput, Computers, containerName, detectEngine, folderName, formatRun, mountOf, problemOf, type Runner, runArgs } from "./computer.ts"

test("the engine: Podman when it works, Docker when only it does, else what the person has to do", async () => {
  const runner =
    (answers: Record<string, { code: number; stderr?: string }>): Runner =>
    async (bin) => ({ code: answers[bin]!.code, stdout: "", stderr: answers[bin]!.stderr ?? "" })
  expect(await detectEngine(runner({ podman: { code: 0 }, docker: { code: 0 } }))).toEqual({ engine: "podman", problem: null })
  expect(await detectEngine(runner({ podman: { code: -1, stderr: "Executable not found (ENOENT)" }, docker: { code: 0 } }))).toEqual({ engine: "docker", problem: null })
  expect((await detectEngine(runner({ podman: { code: 125, stderr: "Cannot connect to Podman. Please verify your connection… podman machine start" }, docker: { code: -1, stderr: "ENOENT" } }))).problem).toContain("podman machine start")
  expect((await detectEngine(runner({ podman: { code: -1, stderr: "ENOENT" }, docker: { code: 1, stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" } }))).problem).toContain("not running")
  expect((await detectEngine(runner({ podman: { code: -1, stderr: "ENOENT" }, docker: { code: -1, stderr: "ENOENT" } }))).problem).toContain("podman.io")
  expect(problemOf("docker", "permission denied while trying to connect to the docker.sock")).toContain("docker group")
})

test("only a folder inside home can be lent: not home itself, hidden ones, system settings or Zorel's data", () => {
  const home = mkdtempSync(join(tmpdir(), "zorel-home-"))
  for (const d of ["code/app", ".ssh", "Library/Keys", "zorel-data"]) mkdirSync(join(home, d), { recursive: true })
  const check = (p: string) => checkFolder(join(home, p), { home, dataDir: join(home, "zorel-data") })
  expect(check("code/app")).toBeNull()
  expect(checkFolder(home, { home, dataDir: "/x" })).toContain("inside the home folder")
  expect(check(".ssh")).toContain("settings and credentials")
  expect(check("Library/Keys")).toContain("settings and credentials")
  expect(check("zorel-data")).toContain("Zorel's own data")
  expect(check("missing")).toContain("doesn't exist")
  expect(folderName("/Users/me/My App!")).toBe("my-app")
})

test("container arguments: local-only ports, the lent folder read-only when asked, keep-id for rootless Podman on Linux", () => {
  const base = { name: "zorel-abc-agent-proj", install: "abc", agentId: "agent", work: "/data/work", lent: { path: "/home/me/app", readOnly: true } }
  const mac = runArgs({ ...base, engine: "podman", platform: "darwin" })
  expect(mac).toContain("type=bind,src=/home/me/app,dst=/projects/app,readonly")
  expect(mac).toContain("no-new-privileges")
  expect(mac).toContain("127.0.0.1::5173")
  expect(mac).not.toContain("--userns=keep-id:uid=0,gid=0")
  expect(runArgs({ ...base, engine: "podman", platform: "linux" })).toContain("--userns=keep-id:uid=0,gid=0")
  expect(runArgs({ ...base, engine: "docker", platform: "linux" })).not.toContain("--userns=keep-id:uid=0,gid=0")
  expect(runArgs({ ...base, engine: "docker", lent: null }).some((a) => a.includes("/projects"))).toBe(false)
  expect(containerName("/data/a", "agent-123456789", null)).not.toBe(containerName("/data/b", "agent-123456789", null)) // two installs never share
  // A writable repo keeps its .git read-only (host git runs its hooks and config); the mount is labeled so a change of
  // folder or level makes the container again.
  const repo = mkdtempSync(join(tmpdir(), "zorel-repo-"))
  mkdirSync(join(repo, ".git"))
  const rw = runArgs({ ...base, engine: "docker", lent: { path: repo, readOnly: false } })
  expect(rw).toContain(`type=bind,src=${join(repo, ".git")},dst=/projects/${folderName(repo)}/.git,readonly`)
  // A folder with ":" in its name stays one mount.
  expect(runArgs({ ...base, engine: "docker", lent: { path: "/home/me/a:b", readOnly: false } })).toContain("type=bind,src=/home/me/a:b,dst=/projects/a-b")
  expect(rw).toContain(`zorel.mount=${mountOf({ path: repo, readOnly: false })}`)
  expect(mountOf({ path: repo, readOnly: true })).not.toBe(mountOf({ path: repo, readOnly: false }))
})

test("command output keeps its start and, mostly, its end; a timeout says how to run long things", () => {
  const long = `${"a".repeat(50)}${"m".repeat(1000)}${"z".repeat(50)}`
  const clipped = clipOutput(long, 200)
  expect(clipped.startsWith("a".repeat(40))).toBe(true)
  expect(clipped.endsWith("z".repeat(50))).toBe(true)
  expect(formatRun({ code: 124, stdout: "", stderr: "" }, 30)).toContain("went past 30 s")
  expect(formatRun({ code: 137, stdout: "", stderr: "", late: true }, 30)).toContain("went past 30 s") // killed from outside
  expect(formatRun({ code: 0, stdout: "\u001b[32mok\u001b[0m\n", stderr: "" }, 30)).toBe("exit code 0\n--- stdout ---\nok")
})

test("erase takes an agent id, never a path", async () => {
  await expect(new Computers(mkdtempSync(join(tmpdir(), "zorel-data-"))).erase("..")).rejects.toThrow("Not an agent id")
})
