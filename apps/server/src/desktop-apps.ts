// Computer apps (spec 008): an agent uses the apps the person gave it (Notes, Calendar, Spotify…), each "read" or
// "use", through agent-desktop (desktop.ts). It reads a window as a numbered list and clicks or writes by number or
// by the text it sees; nothing moves the mouse. A click or key that sends, pays, publishes, schedules or deletes
// waits for the person. The numbered list, picking a target, and the risky click and key rules derive from Tucano
// (Apache-2.0, see NOTICE: src/core/apps.ts).
import type { DesktopApp } from "@zorel/contracts"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { normalize } from "./db.ts"
import type { Cli, Envelope } from "./desktop.ts"
import { RISKY } from "./permissions.ts"
import { textResult, type ToolDef } from "./tools.ts"

const MAX_LINES = 160

// ---------- the numbered list the agent reads ----------

export interface Item {
  readonly n: number
  readonly ref: string
  readonly role: string
  readonly name: string
  readonly value?: string
}
interface Node {
  role?: string
  name?: string
  value?: unknown
  ref_id?: string
  children?: Node[]
}
const clean = (s: unknown) =>
  String(s ?? "")
    .replace(/[‎‏‪-‮]/g, "")
    .replace(/\s+/g, " ")
    .trim()
// A row with no name of its own (a list of notes) goes by what's in it.
const inner = (n: Node): string => {
  for (const c of n.children ?? []) {
    const t = clean(c.name) || inner(c)
    if (t) return t
  }
  return ""
}
const NAMED_BY_CONTENT = new Set(["row", "option", "listitem", "cell"])

// The tree as numbered lines: what the agent can act on, and the text around it.
export function itemize(tree: Node | undefined, max = MAX_LINES): { items: Item[]; lines: string[]; more: number } {
  const items: Item[] = []
  const lines: string[] = []
  let more = 0
  const visit = (n: Node, depth: number) => {
    const role = String(n.role ?? "")
    const name = clean(n.name) || (NAMED_BY_CONTENT.has(role) ? inner(n) : "")
    const value = typeof n.value === "string" || typeof n.value === "number" ? clean(n.value) : ""
    const pad = "  ".repeat(Math.min(depth, 4))
    if (n.ref_id) {
      const item: Item = { n: items.length + 1, ref: n.ref_id, role, name, ...(value && value !== name ? { value } : {}) }
      items.push(item)
      if (lines.length < max) lines.push(`${pad}#${item.n} ${role}${name ? ` "${name}"` : ""}${item.value ? ` = "${item.value.slice(0, 200)}"` : ""}`)
      else more++
    } else if (role === "statictext" && (name || value) && (name || value) !== items.at(-1)?.name && lines.length < max) lines.push(`${pad}text "${(name || value).slice(0, 200)}"`) // not the name just listed again
    for (const c of n.children ?? []) visit(c, depth + 1)
  }
  if (tree) visit(tree, 0)
  return { items, lines, more }
}

// "#12", "12", or the text of an element in the last list (exact first, then the only one that contains it).
export function pick(target: string, items: ReadonlyArray<Item>): Item | { error: string } {
  const t = target.trim()
  const num = /^#?\s*(\d+)$/.exec(t)
  if (num) return items.find((i) => i.n === Number(num[1])) ?? { error: `There's no #${num[1]} in the last list. Read the app again with desktop_read.` }
  const want = normalize(t)
  const exact = items.find((i) => normalize(i.name) === want)
  if (exact) return exact
  const part = items.filter((i) => i.name && normalize(i.name).includes(want))
  if (part.length === 1) return part[0]!
  if (part.length > 1) return { error: `"${t}" matches several: ${part.slice(0, 6).map((i) => `#${i.n} "${i.name}"`).join(", ")}. Use the number.` }
  return { error: `Couldn't find "${t}" in the last list. Read the app with desktop_read (or desktop_menu for the menus) and use the number.` }
}

// ---------- what asks first ----------

// Desktop apps name scheduling by what it makes ("New Event"), not by a verb; a click with no name can't be judged.
const CREATES = /\b(nov[oa]|criar|crie|new|create)\s+(evento|event|reuniao|meeting|compromisso|appointment)\b/
// What the general list misses in desktop apps: trashing, discarding, archiving, scheduling, answering an invite, and
// the paper-plane send icon (accents are already gone: normalize).
const DESKTOP_RISKY = /\b(trash|lixo|lixeira|discard|descartar|erase|archive|arquivar|schedule|agendar|accept|aceitar|decline|recusar|paperplane)\b/
export const riskyClick = (name: string) => !normalize(name) || RISKY.test(normalize(name)) || CREATES.test(normalize(name)) || DESKTOP_RISKY.test(normalize(name))
// Return (which often sends; Shift+Return is a new line), a send shortcut, Space (presses the focused button), or a delete
// (outside a text field it deletes the selected mail or note; text is written with desktop_type).
export function riskyKey(combo: string): boolean {
  const parts = combo.replace(/\s+/g, "").toLowerCase().split("+")
  const key = parts.pop() ?? ""
  const mods = new Set(parts.map((m) => ({ command: "cmd", meta: "cmd", control: "ctrl", option: "alt" })[m] ?? m))
  const cmd = mods.has("cmd") || mods.has("ctrl")
  const RULES: Record<string, () => boolean> = {
    return: () => !mods.has("shift") || cmd,
    enter: () => !mods.has("shift") || cmd,
    d: () => cmd && mods.has("shift"),
    space: () => mods.size === 0,
    backspace: () => true,
    delete: () => true
  }
  return RULES[key]?.() ?? false
}
// A shortcut as the system takes it: off a Mac, ⌘ is Ctrl and ⌥ is Alt.
export const keyFor = (combo: string, platform: string = process.platform) => {
  const c = combo.replace(/\s+/g, "").toLowerCase()
  return platform === "darwin" ? c : c.replace(/\b(cmd|command|meta)\+/g, "ctrl+").replace(/\boption\+/g, "alt+")
}

// Zorel itself (or Electron while developing) is never an app an agent drives: it could click its own approval.
export const isZorel = (name: string) => /^(zorel|electron)(\.exe)?$/i.test(name.trim())

// ---------- the tools ----------

export const DESKTOP_TOOL_NAMES = ["desktop_apps", "desktop_open", "desktop_read", "desktop_menu", "desktop_click", "desktop_type", "desktop_key"] as const
export type DesktopToolName = (typeof DESKTOP_TOOL_NAMES)[number]
export const CHANGING_DESKTOP_TOOLS: ReadonlySet<string> = new Set(["desktop_click", "desktop_type", "desktop_key"])
const CHANGES = CHANGING_DESKTOP_TOOLS

export function desktopTools(apps: ReadonlyArray<DesktopApp>): ToolDef[] {
  if (!apps.length) return []
  const app = { type: "string", description: `The app, by name: ${apps.map((a) => a.name).join(", ")}.` }
  const target = { type: "string", description: "The element's number in the last list (#12) or its text." }
  const reads: ToolDef[] = [
    { name: "desktop_apps", description: "Lists the computer apps you may use, whether they're open, and whether you may only read them or also use them.", inputSchema: { type: "object", properties: {} } },
    { name: "desktop_open", description: "Opens an app (or brings the open one forward), waits for its window and reads it.", inputSchema: { type: "object", properties: { app }, required: ["app"] } },
    {
      name: "desktop_read",
      description: "Reads the app's window: a numbered list of what can be clicked or filled in, and its texts. In a big window, pass area with a group's number to read only that.",
      inputSchema: { type: "object", properties: { app, area: { type: "string", description: "Optional: a group's number from the last list." } }, required: ["app"] }
    },
    { name: "desktop_menu", description: "Reads the app's menu bar (File, Edit…), numbered: many commands, like \"New Note\", live there.", inputSchema: { type: "object", properties: { app }, required: ["app"] } }
  ]
  const changes: ToolDef[] = [
    { name: "desktop_click", description: "Clicks an element of the app. A button that sends, pays, publishes, schedules or deletes waits for the user's approval.", inputSchema: { type: "object", properties: { app, target }, required: ["app", "target"] } },
    { name: "desktop_type", description: "Writes into a field of the app, replacing what was there.", inputSchema: { type: "object", properties: { app, target, text: { type: "string" } }, required: ["app", "target", "text"] } },
    { name: "desktop_key", description: "Presses a key or shortcut in the app (escape, tab, cmd+n…). Return and send shortcuts wait for approval.", inputSchema: { type: "object", properties: { app, key: { type: "string" } }, required: ["app", "key"] } }
  ]
  return [...reads, ...(apps.some((a) => a.level === "use") ? changes : [])]
}

// Retries a command when agent-desktop says that's safe (an app still opening), at most three times.
async function retried(cli: Cli, args: ReadonlyArray<string>): Promise<Envelope> {
  let out: Envelope = { ok: false }
  for (let i = 0; i < 3; i++) {
    out = await cli(args)
    if (out.ok || out.error?.disposition?.retry !== "safe") return out
    await new Promise((r) => setTimeout(r, Math.min(Math.max(out.error?.recovery?.retry_after_ms ?? 400, 250), 2_000)))
  }
  return out
}
const failure = (e: Envelope) => [e.error?.message, e.error?.suggestion].filter(Boolean).join(" ") || "failed"
const fail = (text: string) => textResult(text, true)

// On a Mac, apps made with Chromium (Spotify, Slack…) show their screen to accessibility only when started with it
// on; `open -a` also brings an open app forward. Elsewhere agent-desktop launches it.
const openMac = async (app: string) => (await Bun.spawn(["open", "-a", app, "--args", "--force-renderer-accessibility"], { stdout: "ignore", stderr: "ignore", timeout: 15_000 }).exited) === 0

export interface DesktopCall {
  readonly key: string // whose last list this is (chat + agent)
  readonly apps: ReadonlyArray<DesktopApp>
  readonly ask: (summary: string) => Promise<boolean> // the person's approval
  readonly askAll: boolean // the "ask" access level: every change asks
}

// One runtime's state: the last numbered list per chat and agent.
export class DesktopApps {
  private lists = new Map<string, { app: string; items: Item[] }>()
  constructor(
    private readonly cli: Cli,
    private readonly platform: string = process.platform,
    private readonly open: (app: string) => Promise<boolean> = openMac
  ) {}

  private async read(key: string, app: string, extra: ReadonlyArray<string> = []): Promise<CallToolResult> {
    const r = await retried(this.cli, ["snapshot", "--app", app, "-i", "--compact", ...extra])
    if (!r.ok) return fail(`Couldn't read ${app}: ${failure(r)}`)
    const { items, lines, more } = itemize(r.data?.tree as Node | undefined)
    this.lists.set(key, { app, items })
    const win = clean((r.data?.window as { title?: string } | undefined)?.title)
    const tail = more ? `\n+${more} elements not listed: read a group with desktop_read area=#n.` : ""
    return textResult(`${app}${win && win !== app ? ` · ${win}` : ""}\n${lines.join("\n") || "(nothing to click in this window)"}${tail}`)
  }

  private item(key: string, app: string, target: unknown): Item | { error: string } {
    const last = this.lists.get(key)
    if (!last || normalize(last.app) !== normalize(app)) return { error: `Read ${app} first with desktop_read or desktop_menu.` }
    return pick(String(target ?? ""), last.items)
  }

  // What each tool does, once the app is known to be given at the right level.
  private readonly handlers: Record<Exclude<DesktopToolName, "desktop_apps">, (c: DesktopCall, app: string, args: Record<string, unknown>) => Promise<CallToolResult>> = {
    desktop_open: async (c, app) => {
      const opened = this.platform === "darwin" && (await this.open(app))
      const r: Envelope = opened ? { ok: true } : await retried(this.cli, ["launch", app, "--activate", "--timeout", "25000"])
      if (!r.ok && r.error?.code !== "TIMEOUT") return fail(`${app} didn't open: ${failure(r)}`)
      for (let i = 0; i < 10; i++) {
        const w = await this.cli(["list-windows", "--app", app], 15_000)
        const list = Array.isArray(w.data) ? w.data : ((w.data?.windows as unknown[] | undefined) ?? [])
        if (w.ok && list.length) return this.read(c.key, app)
        await new Promise((res) => setTimeout(res, 1_500))
      }
      return fail(`${app} opened, but its window didn't show. Try desktop_read in a moment.`)
    },
    desktop_read: async (c, app, args) => {
      const area = String(args.area ?? "").trim()
      if (!area) return this.read(c.key, app)
      const it = this.item(c.key, app, area)
      return "error" in it ? fail(it.error) : this.read(c.key, app, ["--root", it.ref])
    },
    // Windows and Linux keep the menu bar inside the window: it's in the window's list.
    desktop_menu: (c, app) => this.read(c.key, app, this.platform === "darwin" ? ["--surface", "menubar"] : []),
    desktop_click: async (c, app, args) => {
      const it = this.item(c.key, app, args.target)
      if ("error" in it) return fail(it.error)
      const label = it.name || `#${it.n}`
      if ((c.askAll || riskyClick(it.name)) && !(await c.ask(`click "${label}" in ${app}`))) return fail("The user declined this click. Don't try it again without asking.")
      const r = await retried(this.cli, ["click", it.ref])
      return r.ok ? this.read(c.key, app) : fail(`The click on "${label}" didn't go through: ${failure(r)}`)
    },
    desktop_type: async (c, app, args) => {
      const it = this.item(c.key, app, args.target)
      if ("error" in it) return fail(it.error)
      const text = String(args.text ?? "")
      // A line break typed into a chat or mail field is Return: it may send, so it asks like the key would.
      if ((c.askAll || /[\r\n]/.test(text)) && !(await c.ask(`write "${text.slice(0, 200)}" into "${it.name || `#${it.n}`}" in ${app}`))) return fail("The user declined.")
      let r = await retried(this.cli, ["set-value", it.ref, text])
      if (!r.ok && this.platform !== "win32") r = await retried(this.cli, ["type", it.ref, text])
      return r.ok ? this.read(c.key, app) : fail(`Couldn't write into "${it.name || `#${it.n}`}": ${failure(r)}`)
    },
    desktop_key: async (c, app, args) => {
      const combo = keyFor(String(args.key ?? "").trim(), this.platform)
      if (!combo) return fail("Missing the key.")
      if ((c.askAll || riskyKey(combo)) && !(await c.ask(`press ${combo} in ${app}`))) return fail("The user declined this key. Don't try it again without asking.")
      const r = await retried(this.cli, ["press", combo, "--app", app])
      return r.ok ? this.read(c.key, app) : fail(`The key didn't go through: ${failure(r)}`)
    }
  }

  async call(c: DesktopCall, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (name === "desktop_apps") {
      const running = await this.cli(["list-apps"], 20_000)
      const open = new Set(((running.data?.apps ?? []) as Array<{ name?: string }>).map((a) => normalize(a.name ?? "")))
      return textResult(c.apps.map((a) => `- ${a.name}: ${a.level === "use" ? "read and use" : "read only"}${open.has(normalize(a.name)) ? " · open" : ""}`).join("\n") || "No apps given.")
    }
    const given = c.apps.find((a) => normalize(a.name) === normalize(String(args.app ?? "")))
    if (!given) return fail(`That app isn't given to you. Given: ${c.apps.map((a) => a.name).join(", ") || "none"}.`)
    if (isZorel(given.name)) return fail("Zorel itself can't be used as an app by an agent.")
    if (CHANGES.has(name) && given.level !== "use") return fail(`You may only read ${given.name}.`)
    const handler = this.handlers[name as keyof typeof this.handlers]
    return handler ? handler(c, given.name, args) : fail(`Unknown tool: ${name}`)
  }
}
