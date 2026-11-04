// Workspace checkpoints with a real git: what a turn changed, its diff, undo, and the folders Zorel refuses.
import { expect, test } from "bun:test"
import type { Project } from "@zorel/contracts"
import { Effect, Exit, Layer } from "effect"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { DataDir } from "./chat.ts"
import { Workspace } from "./workspace.ts"

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "zorel-ws-"))
  const data = join(root, "data")
  const folder = join(root, "app")
  mkdirSync(join(folder, "src"), { recursive: true })
  mkdirSync(join(folder, "node_modules", "x"), { recursive: true })
  writeFileSync(join(folder, "src", "a.ts"), "export const a = 1\n")
  writeFileSync(join(folder, "keep.md"), "keep\n")
  writeFileSync(join(folder, "node_modules", "x", "i.js"), "ignored\n")
  const project: Project = { id: "p1", name: "app", brief: "", path: folder, defaultAgentId: null, createdAt: 0 }
  const run = <A, E>(f: Effect.Effect<A, E, Workspace>) => Effect.runPromise(f.pipe(Effect.provide(Workspace.layer.pipe(Layer.provide(DataDir.layer(data))))) as Effect.Effect<A>)
  const runExit = <A, E>(f: Effect.Effect<A, E, Workspace>) => Effect.runPromise(Effect.exit(f).pipe(Effect.provide(Workspace.layer.pipe(Layer.provide(DataDir.layer(data))))))
  return { root, data, folder, project, run, runExit }
}

test("a turn's changes, diff and undo come from checkpoints; the project's own files stay its own", async () => {
  const { root, folder, project, run } = setup()
  const before = (await run(Effect.flatMap(Workspace, (w) => w.snapshot(project))))!
  writeFileSync(join(folder, "src", "a.ts"), "export const a = 2\nexport const b = 3\n")
  writeFileSync(join(folder, "src", "new.ts"), "new\n")
  rmSync(join(folder, "keep.md"))
  writeFileSync(join(folder, "node_modules", "x", "i.js"), "changed but ignored\n")
  const after = (await run(Effect.flatMap(Workspace, (w) => w.snapshot(project))))!

  const changes = await run(Effect.flatMap(Workspace, (w) => w.changes(project.id, before, after)))
  expect(changes.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
    { path: "keep.md", added: 0, removed: 1, status: "deleted" },
    { path: "src/a.ts", added: 2, removed: 1, status: "modified" },
    { path: "src/new.ts", added: 1, removed: 0, status: "added" }
  ])
  const diff = await run(Effect.flatMap(Workspace, (w) => w.diff(project.id, before, after)))
  expect(diff.find((d) => d.path === "src/a.ts")!.patch).toContain("+export const b = 3")
  expect(existsSync(join(folder, ".git"))).toBe(false) // the shadow repository lives in Zorel's data folder

  const files = await run(Effect.flatMap(Workspace, (w) => w.files(project, before)))
  expect(files.find((f) => f.path === "src/new.ts")!.status).toBe("added")
  expect(files.some((f) => f.path.startsWith("node_modules"))).toBe(false)

  const undone = await run(Effect.flatMap(Workspace, (w) => w.restore(project, before, after)))
  expect(undone.conflicts).toEqual([])
  expect(readFileSync(join(folder, "src", "a.ts"), "utf8")).toBe("export const a = 1\n")
  expect(existsSync(join(folder, "src", "new.ts"))).toBe(false)
  expect(readFileSync(join(folder, "keep.md"), "utf8")).toBe("keep\n")
  rmSync(root, { recursive: true, force: true })
})

test("undo refuses when a file the turn touched changed afterwards", async () => {
  const { root, folder, project, run } = setup()
  const before = (await run(Effect.flatMap(Workspace, (w) => w.snapshot(project))))!
  writeFileSync(join(folder, "src", "a.ts"), "turn\n")
  const after = (await run(Effect.flatMap(Workspace, (w) => w.snapshot(project))))!
  writeFileSync(join(folder, "src", "a.ts"), "you edited it later\n")
  const r = await run(Effect.flatMap(Workspace, (w) => w.restore(project, before, after)))
  expect(r.conflicts).toEqual(["src/a.ts"])
  expect(readFileSync(join(folder, "src", "a.ts"), "utf8")).toBe("you edited it later\n")
  rmSync(root, { recursive: true, force: true })
})

test("folders Zorel refuses: relative, missing, a file, the disk root, home and its own data folder", async () => {
  const { root, data, folder, runExit, run } = setup()
  mkdirSync(data, { recursive: true })
  const reason = async (p: string) => {
    const exit = await runExit(Effect.flatMap(Workspace, (w) => w.validate(p)))
    return Exit.isFailure(exit) ? JSON.stringify(exit.cause).match(/"reason":"(\w+)"/)?.[1] : "ok"
  }
  expect(await reason("app")).toBe("relative")
  expect(await reason(join(root, "nope"))).toBe("missing")
  expect(await reason(join(folder, "keep.md"))).toBe("not_directory")
  expect(await reason("/")).toBe("forbidden")
  expect(await reason(homedir())).toBe("forbidden")
  expect(await reason(join(data))).toBe("forbidden")
  expect(await run(Effect.flatMap(Workspace, (w) => w.validate(folder)))).toContain("app")
  rmSync(root, { recursive: true, force: true })
})
