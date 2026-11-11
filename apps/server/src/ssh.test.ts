import { expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { isKnown, runRemote, sshArgs, targetFrom, targetText, trust } from "./ssh.ts"

test("a target is user@host[:port]; anything that could read as an option or carry spaces is refused", () => {
  expect(targetFrom("deploy@example.com")).toEqual({ user: "deploy", host: "example.com", port: 22 })
  expect(targetFrom(" root@10.0.0.5:2222 ")).toEqual({ user: "root", host: "10.0.0.5", port: 2222 })
  for (const bad of ["example.com", "-oProxyCommand=x@h", "u@-h", "u@h:0", "u@h:70000", "u v@h", "u@h;rm"]) expect(targetFrom(bad)).toBeUndefined()
  expect(targetText({ user: "a", host: "h", port: 22 })).toBe("a@h")
  expect(targetText({ user: "a", host: "h", port: 2222 })).toBe("a@h:2222")
})

test("ssh runs with Zorel's key, no prompts and the pinned host key only; the command goes after --", () => {
  const args = sshArgs("/d/ssh", { user: "a", host: "h", port: 2222 }, "uname -a")
  expect(args).toContain("BatchMode=yes")
  expect(args).toContain("StrictHostKeyChecking=yes")
  expect(args).toContain("UserKnownHostsFile=/d/ssh/known_hosts")
  expect(args.slice(-3)).toEqual(["a@h", "--", "uname -a"])
})

test("a pinned host is known by its known_hosts name ([host]:port off 22)", () => {
  const dir = mkdtempSync(join(tmpdir(), "zorel-ssh-"))
  const t = { user: "a", host: "h.example", port: 2222 }
  expect(isKnown(dir, t)).toBe(false)
  trust(dir, "[h.example]:2222 ssh-ed25519 AAAAC3Nza")
  expect(isKnown(dir, t)).toBe(true)
  expect(isKnown(dir, { ...t, port: 22 })).toBe(false)
})

test("a command runs through the system's ssh, its secret on stdin, exit code and output back", async () => {
  if (process.platform === "win32") return // a shell script stands in for ssh
  const bin = mkdtempSync(join(tmpdir(), "zorel-fake-ssh-"))
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, "ssh"), '#!/bin/sh\nread secret\necho "args: $*"\necho "stdin: $secret"\nexit 3\n')
  chmodSync(join(bin, "ssh"), 0o755)
  const path = process.env.PATH
  process.env.PATH = `${bin}${delimiter}${path}`
  try {
    const r = await runRemote("/d/ssh", { user: "a", host: "h", port: 22 }, "echo hi", { stdin: "s3cret\n" })
    expect(r.code).toBe(3)
    expect(r.output).toContain("stdin: s3cret")
    expect(r.output).toContain("a@h -- echo hi")
    expect(r.output).not.toContain("s3cret -") // the secret never reaches the arguments
  } finally {
    process.env.PATH = path
  }
})
