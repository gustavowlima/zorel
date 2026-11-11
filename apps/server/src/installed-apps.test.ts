import { expect, test } from "bun:test"
import { bundleApps, desktopEntry, iconFile, installedApps, shortcutApps } from "./installed-apps.ts"

test("macOS: bundles by name with their path; helpers inside another bundle and hidden ones aren't apps", () => {
  expect(bundleApps(["/Applications/Notes.app", "/Applications/Adobe/Photoshop.app", "/Applications/Xcode.app/Contents/Developer/Simulator.app", "/Applications/.Hidden.app", "/Applications/Utilities"])).toEqual([
    { name: "Notes", path: "/Applications/Notes.app" },
    { name: "Photoshop", path: "/Applications/Adobe/Photoshop.app" }
  ])
})

test("Windows: Start menu shortcuts with their path, without uninstallers and help links", () => {
  expect(shortcutApps("C:\\Menu", ["Spotify.lnk", "Uninstall Spotify.lnk", "Visual Studio Code.LNK", "Readme.lnk", "desktop.ini"]).map((a) => a.name)).toEqual(["Spotify", "Visual Studio Code"])
})

test("Linux: a visible application's own name and icon from its .desktop entry", () => {
  const entry = "[Desktop Entry]\nType=Application\nName=Firefox\nName[pt_BR]=Navegador Firefox\nIcon=firefox\nExec=firefox %u\n[Desktop Action new-window]\nName=New Window\n"
  expect(desktopEntry(entry)).toEqual({ name: "Firefox", icon: "firefox" })
  expect(desktopEntry("[Desktop Entry]\nType=Application\nName=Helper\nNoDisplay=true\n")).toBeUndefined()
  expect(desktopEntry("[Desktop Entry]\nType=Link\nName=Docs\n")).toBeUndefined()
})

test("Linux: a theme icon name resolves to a file, PNG first; an absolute path stays; none without a file", () => {
  const files = new Set(["/usr/share/icons/hicolor/48x48/apps/firefox.png", "/usr/share/icons/hicolor/scalable/apps/gimp.svg", "/opt/app/icon.png"])
  const exists = (p: string) => files.has(p)
  expect(iconFile("firefox", exists)).toBe("/usr/share/icons/hicolor/48x48/apps/firefox.png")
  expect(iconFile("gimp", exists)).toBe("/usr/share/icons/hicolor/scalable/apps/gimp.svg")
  expect(iconFile("/opt/app/icon.png", exists)).toBe("/opt/app/icon.png")
  expect(iconFile("nothing", exists)).toBeNull()
  expect(iconFile(undefined, exists)).toBeNull()
})

test("an unknown system lists nothing; this one lists sorted names without repeats", () => {
  expect(installedApps("plan9")).toEqual([])
  const names = installedApps().map((a) => a.name)
  expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names)
  expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length)
})
