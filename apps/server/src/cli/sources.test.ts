import { expect, test } from "bun:test"
import { cliDirs } from "./path.ts"
import { agyPlatform, claudePlatform, codexAsset, opencodeAsset } from "./sources.ts"

test("the Antigravity manifest for each system", () => {
  expect(agyPlatform("darwin", "arm64", false)).toBe("darwin_arm64")
  expect(agyPlatform("linux", "x64", false)).toBe("linux_amd64")
  expect(agyPlatform("linux", "arm64", true)).toBe("linux_arm64_musl")
  expect(agyPlatform("win32", "x64", false)).toBe("windows_amd64")
  expect(agyPlatform("darwin", "x64", true)).toBe("darwin_amd64") // musl only matters on Linux
  expect(agyPlatform("freebsd", "x64", false)).toBeUndefined()
  expect(agyPlatform("linux", "ia32", false)).toBeUndefined()
})

test("the OpenCode build for each system", () => {
  expect(opencodeAsset("darwin", "arm64", false)).toBe("opencode-darwin-arm64.zip")
  expect(opencodeAsset("linux", "x64", true)).toBe("opencode-linux-x64-musl.tar.gz")
  expect(opencodeAsset("win32", "x64", false)).toBe("opencode-windows-x64.zip")
  expect(opencodeAsset("aix", "x64", false)).toBeUndefined()
})

test("the CLIs' usual folders per system", () => {
  expect(cliDirs("/home/a", "linux")).toEqual(["/home/a/.local/bin", "/home/a/.opencode/bin"])
  expect(cliDirs("/Users/a", "darwin")).toEqual(["/Users/a/.local/bin", "/Users/a/.opencode/bin"])
})

test("the Claude Code build for each system (its release manifest's names)", () => {
  expect(claudePlatform("darwin", "arm64", false)).toBe("darwin-arm64")
  expect(claudePlatform("linux", "x64", true)).toBe("linux-x64-musl")
  expect(claudePlatform("linux", "arm64", false)).toBe("linux-arm64")
  expect(claudePlatform("win32", "x64", false)).toBe("win32-x64")
  expect(claudePlatform("darwin", "x64", true)).toBe("darwin-x64") // musl only matters on Linux
  expect(claudePlatform("freebsd", "x64", false)).toBeUndefined()
})

test("the Codex build for each system (static on Linux, a zip on Windows)", () => {
  expect(codexAsset("darwin", "arm64")).toBe("codex-aarch64-apple-darwin.tar.gz")
  expect(codexAsset("linux", "x64")).toBe("codex-x86_64-unknown-linux-musl.tar.gz")
  expect(codexAsset("win32", "x64")).toBe("codex-x86_64-pc-windows-msvc.exe.zip")
  expect(codexAsset("linux", "ia32")).toBeUndefined()
})
