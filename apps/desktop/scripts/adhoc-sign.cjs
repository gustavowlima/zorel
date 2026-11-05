// electron-builder afterSign hook. Without a Developer ID (no CSC_LINK) the macOS app is signed ad hoc, as a whole and
// without the hardened runtime: Apple silicon runs only signed code, and an ad hoc signature with the hardened
// runtime is refused (its library validation wants one team for the app and Electron's frameworks; tested
// 2026-11-04). Such a build opens once the download's quarantine mark is gone (install.sh clears it) and updates by
// running install.sh again: the built-in updater needs a Developer ID on macOS.
// --deep signs the app's bundles and frameworks, not the programs kept in Resources (the bundled Chromium): those are
// signed one by one first. Nothing may keep another signature: a stray one from the keychain (electron-builder used to
// pick any "Apple Development" identity it found; package.json now turns that off) can be revoked, and macOS then
// calls the whole app malware and moves it to the Trash.
const { execFileSync } = require("node:child_process")
const { readdirSync, statSync } = require("node:fs")
const { join } = require("node:path")

const programs = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return programs(p)
    return e.isFile() && (e.name.endsWith(".dylib") || (statSync(p).mode & 0o111) !== 0) ? [p] : []
  })

exports.default = async (context) => {
  // A Developer ID build (CSC_LINK in CI, or release-mac.sh's keychain identity) keeps electron-builder's signature.
  if (context.electronPlatformName !== "darwin" || process.env.CSC_LINK || process.env.ZOREL_SIGN_IDENTITY) return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  for (const file of programs(join(app, "Contents", "Resources", "browsers"))) execFileSync("codesign", ["--force", "--sign", "-", file])
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" })
}
