// Native tool policy (ARCHITECTURE §9.2): what an agent may do without asking, by access level.
//   workspace: read anywhere in the folder, edit inside it, run commands that aren't destructive or online
//   ask:       read only; every edit and command waits for the person
//   full:      everything
import type { Access } from "@zorel/contracts"
import { isAbsolute, relative, resolve } from "node:path"
import type { NativeApproval } from "#server/engines/session.ts"

type Decision = "allow" | "ask"

// Commands that destroy, publish or reach the network always ask in workspace mode (also called by path or quoted:
// /usr/bin/curl, "curl"). A heuristic: the OS sandbox is the boundary (claude-sdk.ts); without one, see SAFE below.
const RISKY = /(^|[\s;&|(/"'])(sudo|rm\s+-[a-z]*[rf]|git\s+(push|reset\s+--hard|clean|checkout\s+--|rebase)|npm\s+publish|bun\s+publish|curl|wget|ssh|scp|rsync|nc|chmod\s+-R|chown|mkfs|dd\s|kill|pkill|shutdown|reboot)\b/

export const inside = (cwd: string, path: string) => {
  const rel = relative(cwd, isAbsolute(path) ? path : resolve(cwd, path))
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

// With no OS sandbox under the shell (Windows; Linux without bubblewrap) a pattern can't keep a command inside the
// folder or offline, so only plain read-only commands on paths in the folder run without asking: no shell syntax
// (redirects, pipes, substitutions, quotes, globs), no interpreter, nothing that writes or connects.
const SAFE = /^(ls|pwd|cat|head|tail|wc|grep|rg|tree|stat|git\s+(status|diff|log|show|blame))(\s|$)/
const SHELL_SYNTAX = /[;&|<>`$()\n\r\\'"*?{}[\]~!]/
const readOnly = (cwd: string, command: string) => {
  const c = command.trim()
  if (!SAFE.test(c) || SHELL_SYNTAX.test(c)) return false
  return c.split(/\s+/).slice(c.startsWith("git") ? 2 : 1).filter((a) => !a.startsWith("-")).every((a) => inside(cwd, a))
}

// confined: the shell runs in the OS sandbox (writes only in the folder, no network).
export function decideCommand(access: Access, command: string, cwd: string, confined: boolean): Decision {
  if (access === "full") return "allow"
  if (access === "ask" || RISKY.test(command)) return "ask"
  return confined || readOnly(cwd, command) ? "allow" : "ask"
}

export function decideEdit(access: Access, cwd: string, path: string): Decision {
  if (access === "full") return "allow"
  if (access === "ask") return "ask"
  return inside(cwd, path) ? "allow" : "ask"
}

export function decideRead(access: Access, cwd: string, path: string | undefined): Decision {
  if (access === "full" || !path) return "allow"
  return inside(cwd, path) ? "allow" : "ask"
}

// What an approval card shows is what runs: the person approves the whole thing or nothing. Zorel's own tools refuse
// an action longer than this (cardText); a native call's card says plainly how much it leaves out.
export const MAX_CARD_TEXT = 12_000
export const cardText = (text: string): string | undefined => (text.length <= MAX_CARD_TEXT ? text : undefined)
export const TOO_LARGE = `Too large to show the user for approval (over ${MAX_CARD_TEXT} characters): split it into smaller steps.`
const clipped = (text: string) => cardText(text) ?? `${text.slice(0, MAX_CARD_TEXT)}\n\n[${text.length - MAX_CARD_TEXT} more characters not shown]`

// The approval card for a native call (summary in English: the interface shows it as written).
export const approvalFor = (kind: NativeApproval["kind"], tool: string, summary: string, args: unknown, cwd: string): NativeApproval => ({
  kind,
  tool,
  summary,
  args: typeof args === "string" ? args : clipped(JSON.stringify(args, null, 2)),
  cwd
})
