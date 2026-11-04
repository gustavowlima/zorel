// Native tool policy (ARCHITECTURE §9.2): what an agent may do without asking, by access level.
//   workspace: read anywhere in the folder, edit inside it, run commands that aren't destructive or online
//   ask:       read only; every edit and command waits for the person
//   full:      everything
import type { Access } from "@zorel/contracts"
import { isAbsolute, relative, resolve } from "node:path"
import type { NativeApproval } from "#server/engines/session.ts"

export type Decision = "allow" | "ask"

// Commands that destroy, publish or reach the network always ask in workspace mode.
const RISKY = /(^|[\s;&|(])(sudo|rm\s+-[a-z]*[rf]|git\s+(push|reset\s+--hard|clean|checkout\s+--|rebase)|npm\s+publish|bun\s+publish|curl|wget|ssh|scp|rsync|nc|chmod\s+-R|chown|mkfs|dd\s|kill|pkill|shutdown|reboot)\b/

export const inside = (cwd: string, path: string) => {
  const rel = relative(cwd, isAbsolute(path) ? path : resolve(cwd, path))
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

export function decideCommand(access: Access, command: string): Decision {
  if (access === "full") return "allow"
  if (access === "ask") return "ask"
  return RISKY.test(command) ? "ask" : "allow"
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

// The approval card for a native call (summary in English: the interface shows it as written).
export const approvalFor = (kind: NativeApproval["kind"], tool: string, summary: string, args: unknown, cwd: string): NativeApproval => ({
  kind,
  tool,
  summary,
  args: typeof args === "string" ? args : JSON.stringify(args, null, 2).slice(0, 4000),
  cwd
})
