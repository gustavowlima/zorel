// A file's icon by its name, as an editor's explorer: the language's own mark in its color (simple-icons, CC0) for
// code, a generic lucide shape for images, archives, text and the rest. Marks too dark for a dark theme (black,
// navy) take the muted ink instead, so they read in both themes.
import {
  type SimpleIcon, siC, siCplusplus, siCss, siDart, siDocker, siDotnet, siElixir, siGit, siGnubash, siGo, siGraphql, siHtml5, siJavascript, siJson,
  siKotlin, siLua, siMarkdown, siOpenjdk, siPhp, siPrisma, siPython, siReact, siRuby, siRust, siSass, siSqlite, siSvelte, siSwift, siToml,
  siTypescript, siVuedotjs, siYaml
} from "simple-icons"
import { cn } from "@/lib/utils"
import { File, FileArchive, FileImage, FileLock, FileText, Settings } from "./icons"

const BY_EXT: Record<string, SimpleIcon> = {
  ts: siTypescript, mts: siTypescript, cts: siTypescript, tsx: siReact, jsx: siReact, js: siJavascript, mjs: siJavascript, cjs: siJavascript,
  py: siPython, rs: siRust, go: siGo, md: siMarkdown, mdx: siMarkdown, json: siJson, jsonc: siJson, css: siCss, scss: siSass, sass: siSass,
  html: siHtml5, htm: siHtml5, yml: siYaml, yaml: siYaml, toml: siToml, svelte: siSvelte, vue: siVuedotjs, swift: siSwift, kt: siKotlin, kts: siKotlin,
  java: siOpenjdk, c: siC, h: siC, cpp: siCplusplus, cc: siCplusplus, hpp: siCplusplus, php: siPhp, rb: siRuby, sh: siGnubash, bash: siGnubash,
  zsh: siGnubash, fish: siGnubash, sql: siSqlite, db: siSqlite, sqlite: siSqlite, cs: siDotnet, dart: siDart, lua: siLua, ex: siElixir, exs: siElixir,
  graphql: siGraphql, gql: siGraphql, prisma: siPrisma
}
const BY_NAME: Record<string, SimpleIcon> = { dockerfile: siDocker, ".gitignore": siGit, ".gitattributes": siGit, ".gitmodules": siGit }
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif", "icns"])
const ARCHIVE = new Set(["zip", "gz", "tgz", "tar", "rar", "7z", "bz2", "xz"])
const TEXT = new Set(["txt", "log", "csv", "tsv", "rtf", "pdf"])
const LOCK = /(^|\.)lock$|\.lockb$|-lock\.(json|yaml)$/
const CONFIG = /^\.(env|editorconfig|prettierrc|npmrc|nvmrc)|\.(ini|conf|cfg|config\.[cm]?[jt]s)$/

// Dark marks (black, navy, near-black): the muted ink reads in both themes.
const dark = (hex: string) => {
  const n = Number.parseInt(hex, 16)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 70
}

export function FileIcon({ name, className }: { name: string; className?: string }) {
  const lower = name.toLowerCase()
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : ""
  const box = cn("size-4 shrink-0", className)
  if (LOCK.test(lower)) return <FileLock className={cn(box, "text-dim")} />
  const mark = BY_NAME[lower] ?? (lower.startsWith("dockerfile") ? BY_NAME.dockerfile : undefined) ?? (CONFIG.test(lower) ? undefined : BY_EXT[ext])
  if (mark)
    return (
      <span className={cn(box, "flex items-center justify-center p-px", dark(mark.hex) && "text-muted")}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-full" fill={dark(mark.hex) ? "currentColor" : `#${mark.hex}`}>
          <path d={mark.path} />
        </svg>
      </span>
    )
  const Icon = IMAGE.has(ext) ? FileImage : ARCHIVE.has(ext) ? FileArchive : TEXT.has(ext) ? FileText : CONFIG.test(lower) ? Settings : File
  return <Icon className={cn(box, "text-dim")} />
}
