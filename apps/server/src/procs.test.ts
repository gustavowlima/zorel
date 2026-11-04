// The process table and ports on the three systems, from sample output of each (CI runs on macOS only).
import { expect, test } from "bun:test"
import { listeners, listProcs, parseCpuTime, parseNetstat, parseProcStat, parsePs, parseSs, parseWin, subtree } from "./procs.ts"

test("cpu time from ps: minutes, hours and days", () => {
  expect(parseCpuTime("0:01.50")).toBe(1500) // macOS
  expect(parseCpuTime("01:02:03")).toBe(3723000) // Linux
  expect(parseCpuTime("2-00:00:01")).toBe(172801000)
})

test("ps (macOS): pid, parent, memory, CPU time and the name without its path", () => {
  const out = "  101     1  20480   0:01.50 /usr/bin/bun\n  202   101   1024   0:00.10 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n"
  expect(parsePs(out)).toEqual([
    { pid: 101, ppid: 1, rss: 20480 * 1024, cpuMs: 1500, name: "bun" },
    { pid: 202, ppid: 101, rss: 1024 * 1024, cpuMs: 100, name: "Google Chrome" }
  ])
})

test("/proc/<pid>/stat (Linux): a name with spaces and parentheses", () => {
  const stat = "4242 (node (dev) server) S 4000 4242 4242 0 -1 4194304 1000 0 0 0 150 50 0 0 20 0 11 0 12345 1000000 2560 18446744073709551615"
  expect(parseProcStat(stat)).toEqual({ pid: 4242, name: "node (dev) server", ppid: 4000, cpuMs: 2000, rss: 2560 * 4096 })
})

test("PowerShell Win32_Process lines (Windows)", () => {
  expect(parseWin("10\t4\t5242880\t1234\tbun.exe\r\n11\t10\t1048576\t0\tclaude.exe\r\n\r\n")).toEqual([
    { pid: 10, ppid: 4, rss: 5242880, cpuMs: 1234, name: "bun.exe" },
    { pid: 11, ppid: 10, rss: 1048576, cpuMs: 0, name: "claude.exe" }
  ])
})

test("listening ports: ss (Linux) and netstat (Windows)", () => {
  expect(parseSs('LISTEN 0 511 127.0.0.1:4599 0.0.0.0:* users:(("bun",pid=123,fd=21))\nLISTEN 0 128 [::]:22 [::]:* users:(("sshd",pid=7,fd=3))')).toEqual([
    { pid: 123, port: 4599 },
    { pid: 7, port: 22 }
  ])
  const netstat = "\r\nActive Connections\r\n\r\n  Proto  Local Address          Foreign Address        State           PID\r\n  TCP    127.0.0.1:4599         0.0.0.0:0              LISTENING       1234\r\n  TCP    127.0.0.1:50000        127.0.0.1:4599         ESTABLISHED     99\r\n  TCP    [::1]:5173             [::]:0                 LISTENING       55\r\n"
  expect(parseNetstat(netstat)).toEqual([
    { pid: 1234, port: 4599 },
    { pid: 55, port: 5173 }
  ])
})

test("a process's tree, and this machine's table includes this process", async () => {
  const procs = [
    { pid: 1, ppid: 0, name: "init", cpuMs: 0, rss: 0 },
    { pid: 10, ppid: 1, name: "zorel", cpuMs: 0, rss: 0 },
    { pid: 11, ppid: 10, name: "claude", cpuMs: 0, rss: 0 },
    { pid: 12, ppid: 11, name: "bun test", cpuMs: 0, rss: 0 },
    { pid: 20, ppid: 1, name: "other", cpuMs: 0, rss: 0 }
  ]
  expect(subtree(procs, 10).sort()).toEqual([10, 11, 12])
  expect(subtree(procs, 99)).toEqual([])
  expect((await listProcs()).some((p) => p.pid === process.pid)).toBe(true)
  expect(listeners()).toBeInstanceOf(Map) // this system's port tool runs and parses (CI: Linux, macOS, Windows)
})
