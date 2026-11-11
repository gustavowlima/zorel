// electron-builder afterSign hook. Without a Developer ID (no CSC_LINK) the macOS app is signed ad hoc, as a whole and
// without the hardened runtime: Apple silicon runs only signed code, and an ad hoc signature with the hardened
// runtime is refused (its library validation wants one team for the app and Electron's frameworks; tested
// 2026-11-04). Such a build opens once the download's quarantine mark is gone (install.sh clears it) and updates by
// running install.sh again: the built-in updater needs a Developer ID on macOS.
// --deep signs the app's bundles and frameworks. Nothing may keep another signature: a stray one from the keychain (electron-builder used to
// pick any "Apple Development" identity it found; package.json now turns that off) can be revoked, and macOS then
// calls the whole app malware and moves it to the Trash.
const { execFileSync } = require("node:child_process")
const { join } = require("node:path")

exports.default = async (context) => {
  if (context.electronPlatformName !== "darwin" || process.env.CSC_LINK) return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" })
}
