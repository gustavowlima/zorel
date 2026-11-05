import { describe, expect, test } from "bun:test"
import type { Chat } from "@zorel/contracts"
import type { ChatStatus } from "@zorel/contracts/events"
import { byTurn, lastActivity, ordered, rank, type Statuses, visibleChats } from "./sidebar-order.ts"

// Only the fields the ordering reads; the rest of Chat is irrelevant here.
const chat = (id: string, o: { createdAt?: number; lastAt?: number | null; position?: number | null } = {}) =>
  ({ id, createdAt: o.createdAt ?? 0, lastAt: o.lastAt ?? null, position: o.position ?? null }) as unknown as Chat
const status = (state: string, updatedAt = 0) => ({ state, updatedAt }) as unknown as ChatStatus
const ids = (l: ReadonlyArray<Chat>) => l.map((c) => c.id)
const many = (n: number) => Array.from({ length: n }, (_, i) => chat(`c${i}`))

describe("lastActivity", () => {
  test("takes the latest of createdAt, lastAt and status.updatedAt", () => {
    expect(lastActivity(chat("a", { createdAt: 5 }), {})).toBe(5)
    expect(lastActivity(chat("a", { createdAt: 5, lastAt: 9 }), {})).toBe(9)
    expect(lastActivity(chat("a", { createdAt: 5, lastAt: 9 }), { a: status("idle", 20) })).toBe(20)
    expect(lastActivity(chat("a", { createdAt: 50, lastAt: 9 }), { a: status("idle", 20) })).toBe(50)
  })
})

describe("ordered", () => {
  test("unplaced chats by newest activity, then placed ones by position", () => {
    const list = [chat("p2", { position: 2 }), chat("old", { createdAt: 1 }), chat("p1", { position: 1 }), chat("new", { createdAt: 9 })]
    expect(ids(ordered(list, {}))).toEqual(["new", "old", "p1", "p2"])
  })
  test("a status update lifts an unplaced chat", () => {
    const list = [chat("a", { createdAt: 5 }), chat("b", { createdAt: 1 })]
    expect(ids(ordered(list, { b: status("idle", 100) }))).toEqual(["b", "a"])
  })
  test("position 0 counts as placed", () => {
    expect(ids(ordered([chat("p", { position: 0 }), chat("u", { createdAt: 99 })], {}))).toEqual(["u", "p"])
  })
  test("does not mutate the input", () => {
    const list = [chat("a", { createdAt: 1 }), chat("b", { createdAt: 2 })]
    ordered(list, {})
    expect(ids(list)).toEqual(["a", "b"])
  })
  test("empty list", () => expect(ordered([], {})).toEqual([]))
})

describe("rank / byTurn", () => {
  test("waiting < running < everything else", () => {
    expect(rank(status("waiting"))).toBe(0)
    expect(rank(status("running"))).toBe(1)
    expect(rank(status("idle"))).toBe(2)
    expect(rank(status("failed"))).toBe(2)
    expect(rank(undefined)).toBe(2)
  })
  test("waiting first, then running, then the rest, each keeping the incoming order", () => {
    const list = [chat("idle1"), chat("run1"), chat("wait1"), chat("none"), chat("run2"), chat("wait2")]
    const st: Statuses = { idle1: status("idle"), run1: status("running"), wait1: status("waiting"), run2: status("running"), wait2: status("waiting") }
    expect(ids(byTurn(list, st))).toEqual(["wait1", "wait2", "run1", "run2", "idle1", "none"])
  })
  test("composes with ordered: recency inside each rank", () => {
    const list = [chat("a", { createdAt: 1 }), chat("b", { createdAt: 3 }), chat("c", { createdAt: 2 })]
    const st: Statuses = { a: status("waiting"), b: status("idle"), c: status("waiting") }
    expect(ids(byTurn(ordered(list, st), st))).toEqual(["c", "a", "b"])
  })
  test("a failed chat does not jump the queue", () => {
    expect(ids(byTurn([chat("f"), chat("r")], { f: status("failed"), r: status("running") }))).toEqual(["r", "f"])
  })
})

describe("visibleChats", () => {
  test("up to the limit: everything shows, nothing hidden", () => {
    for (const n of [0, 1, 5]) expect(visibleChats(many(n), undefined, 5, false)).toEqual({ visible: many(n), hidden: 0 })
  })
  test("over the limit: first 5 and the hidden count", () => {
    const r = visibleChats(many(8), undefined, 5, false)
    expect(ids(r.visible)).toEqual(["c0", "c1", "c2", "c3", "c4"])
    expect(r.hidden).toBe(3)
  })
  test("the open chat past the fold stays visible and lowers hidden", () => {
    const r = visibleChats(many(8), "c6", 5, false)
    expect(ids(r.visible)).toEqual(["c0", "c1", "c2", "c3", "c4", "c6"])
    expect(r.hidden).toBe(2)
  })
  test("the open chat inside the limit changes nothing", () => {
    const r = visibleChats(many(8), "c2", 5, false)
    expect(r.visible).toHaveLength(5)
    expect(r.hidden).toBe(3)
  })
  test("an unknown open id changes nothing", () => expect(visibleChats(many(8), "nope", 5, false).hidden).toBe(3))
  test("show all: everything visible, hidden 0", () => {
    const r = visibleChats(many(8), "c6", 5, true)
    expect(r.visible).toHaveLength(8)
    expect(r.hidden).toBe(0)
  })
  test("the open chat is the only one past the fold: hidden 0 but list longer than the limit", () => {
    const r = visibleChats(many(6), "c5", 5, false)
    expect(r.visible).toHaveLength(6)
    expect(r.hidden).toBe(0)
  })
})
