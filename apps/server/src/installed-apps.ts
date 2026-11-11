// The apps installed on this computer, for the agent's "Computer apps" picker: name and where the app is (the desktop
// app draws its icon from that path). macOS: Spotlight's application bundles, joined with the Applications folders
// (Spotlight finds the ones in subfolders; the folders cover an index still being built). Windows: the Start menu's
// shortcuts. Linux: the visible .desktop entries, with their icon file when the theme has one.
import { execFileSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

export interface InstalledApp {
  readonly name: string
  readonly path: string | null // the bundle, the shortcut or an icon file: what the desktop app draws the icon from
}

const list = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch {
    return [] // a folder this system doesn't have
  }
}

// macOS: bundle paths → apps; a helper inside another bundle ("…/X.app/Contents/…/Y.app") isn't one.
export const bundleApps = (paths: ReadonlyArray<string>): InstalledApp[] =>
  paths.filter((p) => p.endsWith(".app") && !p.slice(0, -4).includes(".app/") && !basename(p).startsWith(".")).map((p) => ({ name: basename(p, ".app"), path: p }))

// Windows: "Spotify.lnk" → "Spotify"; uninstallers, read-mes and help links aren't apps.
const NOT_AN_APP = /\b(uninstall|desinstalar|readme|leia-me|help|ajuda|documentation|website|release notes)\b/i
export const shortcutApps = (dir: string, entries: ReadonlyArray<string>): InstalledApp[] =>
  entries.filter((e) => e.toLowerCase().endsWith(".lnk") && !NOT_AN_APP.test(e)).map((e) => ({ name: e.slice(0, -4), path: join(dir, e) }))

// Linux: a .desktop entry's own name and icon, when it's a visible application.
export function desktopEntry(text: string): { name: string; icon: string | undefined } | undefined {
  const main = text.split(/^\[/m).find((s) => s.startsWith("Desktop Entry]")) ?? ""
  const field = (k: string) => new RegExp(`^${k}=(.*)$`, "m").exec(main)?.[1]?.trim()
  if (field("Type") !== "Application" || field("NoDisplay") === "true" || field("Hidden") === "true") return undefined
  const name = field("Name")
  return name ? { name, icon: field("Icon") || undefined } : undefined
}

// A theme icon name ("firefox") → a file the desktop app can show: an absolute path as it is, else the first size
// found in the hicolor theme or pixmaps (PNG before SVG).
const ICON_DIRS = ["/usr/share/icons/hicolor/64x64/apps", "/usr/share/icons/hicolor/48x48/apps", "/usr/share/icons/hicolor/128x128/apps", "/usr/share/icons/hicolor/scalable/apps", "/usr/share/pixmaps"]
export function iconFile(icon: string | undefined, exists: (p: string) => boolean = existsSync): string | null {
  if (!icon) return null
  if (icon.startsWith("/")) return exists(icon) ? icon : null
  for (const dir of ICON_DIRS) for (const ext of [".png", ".svg"]) if (exists(join(dir, icon + ext))) return join(dir, icon + ext)
  return null
}

const MAC_FOLDERS = () => ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities", join(homedir(), "Applications")]
const spotlight = (dir: string): string[] => {
  try {
    return execFileSync("mdfind", ["-onlyin", dir, "kMDItemContentType == 'com.apple.application-bundle'"], { encoding: "utf8", timeout: 5000 }).split("\n").filter(Boolean)
  } catch {
    return [] // no Spotlight (turned off, or not this system): the folders still count
  }
}

const PER_OS: Readonly<Record<string, () => InstalledApp[]>> = {
  darwin: () => {
    const folders = MAC_FOLDERS()
    return bundleApps([...folders.flatMap((d) => list(d).map((e) => join(d, e))), ...["/Applications", "/System/Applications", join(homedir(), "Applications")].flatMap(spotlight)])
  },
  win32: () => {
    const roots = [process.env.ProgramData && join(process.env.ProgramData, "Microsoft/Windows/Start Menu/Programs"), process.env.APPDATA && join(process.env.APPDATA, "Microsoft/Windows/Start Menu/Programs")].filter((d): d is string => !!d)
    // The menu's folders go one level deep (a vendor's folder holds its apps).
    return roots.flatMap((r) => [...shortcutApps(r, list(r)), ...list(r).flatMap((sub) => shortcutApps(join(r, sub), list(join(r, sub))))])
  },
  linux: () => {
    const dirs = ["/usr/share/applications", "/usr/local/share/applications", "/var/lib/flatpak/exports/share/applications", join(homedir(), ".local/share/applications"), join(homedir(), ".local/share/flatpak/exports/share/applications")]
    return dirs.flatMap((d) =>
      list(d)
        .filter((f) => f.endsWith(".desktop"))
        .flatMap((f) => {
          try {
            const e = desktopEntry(readFileSync(join(d, f), "utf8"))
            return e ? [{ name: e.name, path: iconFile(e.icon) }] : []
          } catch {
            return []
          }
        })
    )
  }
}

// Sorted, without repeats (the same app found twice), case-insensitively.
export function installedApps(platform: string = process.platform): InstalledApp[] {
  const seen = new Map<string, InstalledApp>()
  for (const a of PER_OS[platform]?.() ?? []) if (!seen.has(a.name.toLowerCase())) seen.set(a.name.toLowerCase(), a)
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}
