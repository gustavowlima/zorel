import { expect, test } from "bun:test"
import { agyPlatform, cliDirs, opencodeAsset } from "./cli-install.ts"

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
