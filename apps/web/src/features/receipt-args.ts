// What an approval names, read from its JSON arguments; apart from the chat screen so it can be tested.
import type { Approval } from "@zorel/contracts/events"

type Named = Pick<Approval, "tool" | "args">

const parse = (args: string): Record<string, unknown> | undefined => {
  try {
    const v = JSON.parse(args) as unknown
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined // not JSON
  }
}

// What an approval would run, in one line: the shell command or file it names, else the tool.
export function commandOf(a: Named): string {
  const args = parse(a.args)
  const first = args && [args.command, args.cmd, args.file_path, args.path].find((v) => typeof v === "string")
  return typeof first === "string" ? first : a.tool
}

// Every argument, indented, when there is something the command line does not already show: more than one argument,
// or any argument at all when no command was found (the line then holds only the tool's name). Else nothing.
export function extraArgs(a: Named, command: string): string | undefined {
  const args = parse(a.args)
  if (!args) return undefined
  const keys = Object.keys(args).length
  return keys > (command === a.tool ? 0 : 1) ? JSON.stringify(args, null, 2) : undefined
}
