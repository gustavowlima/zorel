// The computer's processes, on Windows, macOS and Linux: the table (pid, parent, name, CPU time, memory), the ports
// being listened on, and a process's working folder where the system tells it. Settings › Processes builds Zorel's
// own tree from it (the app, the server and everything they started) and the CPU and memory each part uses now.
//
// Linux reads /proc (no process spawned); macOS runs `ps` and `lsof`; Windows keeps one PowerShell open and asks it
// for Win32_Process on each read (starting PowerShell costs ~0.3 s of CPU, too much to pay every few seconds).
import { readdirSync, readFileSync } from "node:fs"
import { cpus } from "node:os"

export interface Proc {
  readonly pid: number
  readonly ppid: number
  readonly name: string
  readonly cpuMs: number // CPU time used since it started
  readonly rss: number // resident memory, bytes
}

// "[[DD-]HH:]MM:SS[.cc]" (ps's cputime) to milliseconds.
export function parseCpuTime(s: string): number {
  const [days, rest] = s.includes("-") ? [Number(s.split("-")[0]), s.split("-")[1]!] : [0, s]
  const parts = rest.split(":").map(Number)
  const secs = parts.reduce((acc, p) => acc * 60 + p, 0)
  return Math.round((days * 86400 + secs) * 1000)
}

// `ps -A -o pid=,ppid=,rss=,time=,comm=` (macOS; Linux's ps prints the same columns).
export function parsePs(out: string): Proc[] {
  return out.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line)
    if (!m) return []
    const name = m[5]!.trim().split("/").pop()!
    return [{ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]) * 1024, cpuMs: parseCpuTime(m[4]!), name }]
  })
}

// One /proc/<pid>/stat line: "pid (comm) state ppid … utime stime … rss …" (fields 14, 15 and 24).
export function parseProcStat(stat: string, tickMs = 10, page = 4096): Proc | undefined {
  const open = stat.indexOf("(")
  const close = stat.lastIndexOf(")")
  if (open < 0 || close < 0) return undefined
  const f = stat.slice(close + 2).split(" ")
  return { pid: Number(stat.slice(0, open)), name: stat.slice(open + 1, close), ppid: Number(f[1]), cpuMs: (Number(f[11]) + Number(f[12])) * tickMs, rss: Number(f[21]) * page }
}

// Our PowerShell lines: "pid<TAB>ppid<TAB>workingSet<TAB>cpuMs<TAB>name".
export function parseWin(out: string): Proc[] {
  return out.split(/\r?\n/).flatMap((line) => {
    const [pid, ppid, rss, cpu, ...name] = line.split("\t")
    if (!pid || !/^\d+$/.test(pid)) return []
    return [{ pid: Number(pid), ppid: Number(ppid), rss: Number(rss), cpuMs: Number(cpu), name: name.join("\t").trim() }]
  })
}

const run = (cmd: string[]) => {
  try {
    const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "ignore", windowsHide: true } as Parameters<typeof Bun.spawnSync>[1])
    return r.stdout?.toString() ?? ""
  } catch {
    return "" // the tool isn't there
  }
}

function linuxProcs(): Proc[] {
  // ponytail: 100 Hz clock and 4 KiB pages, the usual Linux values; read sysconf if a box reports odd numbers.
  return readdirSync("/proc").flatMap((d) => {
    if (!/^\d+$/.test(d)) return []
    try {
      const p = parseProcStat(readFileSync(`/proc/${d}/stat`, "utf8"))
      return p ? [p] : []
    } catch {
      return [] // ended while reading
    }
  })
}

// One PowerShell for the server's life; each read writes a line and waits for the "<<end>>" marker.
const WIN_SCRIPT = `$ErrorActionPreference='SilentlyContinue'
while ($null -ne [Console]::In.ReadLine()) {
  Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)\`t$($_.ParentProcessId)\`t$($_.WorkingSetSize)\`t$([math]::Floor(($_.KernelModeTime + $_.UserModeTime) / 10000))\`t$($_.Name)" }
  '<<end>>'
}`
let shell: { proc: Bun.Subprocess<"pipe", "pipe", "ignore">; reader: ReadableStreamDefaultReader<Uint8Array>; buf: string } | undefined
let queue: Promise<unknown> = Promise.resolve()
function windowsProcs(): Promise<Proc[]> {
  const ask = async () => {
    if (!shell || shell.proc.exitCode !== null) {
      const encoded = Buffer.from(WIN_SCRIPT, "utf16le").toString("base64")
      const proc = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { stdin: "pipe", stdout: "pipe", stderr: "ignore", windowsHide: true } as never) as Bun.Subprocess<"pipe", "pipe", "ignore">
      shell = { proc, reader: proc.stdout.getReader(), buf: "" }
    }
    const s = shell
    s.proc.stdin.write("\n")
    s.proc.stdin.flush()
    const dec = new TextDecoder()
    while (!s.buf.includes("<<end>>")) {
      const { value, done } = await s.reader.read()
      if (done) break
      s.buf += dec.decode(value)
    }
    const end = s.buf.indexOf("<<end>>")
    const out = end < 0 ? s.buf : s.buf.slice(0, end)
    s.buf = end < 0 ? "" : s.buf.slice(end + 7)
    return parseWin(out)
  }
  const next = queue.then(ask, ask) // one read at a time on the shared shell
  queue = next.catch(() => undefined)
  return next.catch(() => [])
}

export async function listProcs(): Promise<Proc[]> {
  if (process.platform === "linux") return linuxProcs()
  if (process.platform === "win32") return windowsProcs()
  return parsePs(run(["ps", "-A", "-o", "pid=,ppid=,rss=,time=,comm="]))
}

// ---------- listening ports ----------

// lsof -F output (one field per line: p<pid>, c<command>, n<name>) to pid → fields.
export function parseLsof(out: string): Map<number, { command: string; names: string[] }> {
  const procs = new Map<number, { command: string; names: string[] }>()
  let cur: { command: string; names: string[] } | undefined
  for (const line of out.split("\n")) {
    const v = line.slice(1)
    if (line[0] === "p") {
      cur = { command: "", names: [] }
      procs.set(Number(v), cur)
    } else if (line[0] === "c" && cur) cur.command = v
    else if (line[0] === "n" && cur) cur.names.push(v)
  }
  return procs
}
const portOf = (addr: string) => Number(addr.slice(addr.lastIndexOf(":") + 1))

// `ss -ltnpH` (Linux): "LISTEN 0 511 127.0.0.1:4599 0.0.0.0:* users:(("bun",pid=123,fd=21))".
export function parseSs(out: string): Array<{ pid: number; port: number }> {
  return out.split("\n").flatMap((line) => {
    const cols = line.trim().split(/\s+/)
    const port = cols[3] ? portOf(cols[3]) : NaN
    return Number.isFinite(port) && port > 0 ? [...line.matchAll(/pid=(\d+)/g)].map((m) => ({ pid: Number(m[1]), port })) : []
  })
}

// `netstat -ano -p TCP` (Windows): "  TCP    127.0.0.1:4599    0.0.0.0:0    LISTENING    1234".
export function parseNetstat(out: string): Array<{ pid: number; port: number }> {
  return out.split(/\r?\n/).flatMap((line) => {
    const cols = line.trim().split(/\s+/)
    return cols[0]?.startsWith("TCP") && cols[3] === "LISTENING" && cols[4] ? [{ pid: Number(cols[4]), port: portOf(cols[1]!) }] : []
  })
}

// pid → the ports it listens on (TCP).
export function listeners(): Map<number, number[]> {
  const pairs =
    process.platform === "win32"
      ? [...parseNetstat(run(["netstat", "-ano", "-p", "TCP"])), ...parseNetstat(run(["netstat", "-ano", "-p", "TCPv6"]))]
      : process.platform === "linux"
        ? parseSs(run(["ss", "-ltnpH"]))
        : [...parseLsof(run(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]))].flatMap(([pid, p]) => p.names.map((n) => ({ pid, port: portOf(n) })))
  const out = new Map<number, number[]>()
  for (const { pid, port } of pairs) if (pid && port > 0 && pid !== process.pid) out.set(pid, [...new Set([...(out.get(pid) ?? []), port])].sort((a, b) => a - b))
  return out
}

// ---------- trees and CPU now ----------

// pid → its descendants (itself included).
export function subtree(procs: ReadonlyArray<Proc>, root: number): number[] {
  const kids = new Map<number, number[]>()
  for (const p of procs) if (p.pid !== p.ppid) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p.pid])
  const out: number[] = []
  const stack = [root]
  while (stack.length) {
    const pid = stack.pop()!
    if (out.includes(pid)) continue
    out.push(pid)
    stack.push(...(kids.get(pid) ?? []))
  }
  return procs.some((p) => p.pid === root) ? out : []
}

// CPU % (100 = one core, as Activity Monitor and Task Manager's per-process view) from two reads of the table.
let last: { at: number; cpu: Map<number, number> } | undefined
export async function sample(): Promise<{ procs: Proc[]; cpu: Map<number, number>; cores: number }> {
  let procs = await listProcs()
  if (!last || Date.now() - last.at > 30_000) {
    // No recent read to compare with: take one now, a moment apart.
    last = { at: Date.now(), cpu: new Map(procs.map((p) => [p.pid, p.cpuMs])) }
    await Bun.sleep(400)
    procs = await listProcs()
  }
  const now = Date.now()
  const elapsed = Math.max(1, now - last.at)
  const cpu = new Map(procs.map((p) => [p.pid, Math.max(0, ((p.cpuMs - (last!.cpu.get(p.pid) ?? p.cpuMs)) / elapsed) * 100)]))
  last = { at: now, cpu: new Map(procs.map((p) => [p.pid, p.cpuMs])) }
  return { procs, cpu, cores: cpus().length }
}
