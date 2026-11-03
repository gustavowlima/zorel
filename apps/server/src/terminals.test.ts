import { expect, test } from "bun:test"
import { parseFrame, Ring } from "./terminals.ts"

test("parseFrame takes input and sane sizes, nothing else", () => {
  expect(parseFrame(`{"t":"i","d":"ls\\r"}`)).toEqual({ t: "i", d: "ls\r" })
  expect(parseFrame(`{"t":"r","c":120,"r":40}`)).toEqual({ t: "r", c: 120, r: 40 })
  expect(parseFrame(`{"t":"r","c":0,"r":40}`)).toBeUndefined() // too small
  expect(parseFrame(`{"t":"r","c":120.5,"r":40}`)).toBeUndefined() // not an integer
  expect(parseFrame(`{"t":"r","c":99999,"r":40}`)).toBeUndefined() // too large
  expect(parseFrame(`{"t":"i","d":"${"x".repeat(70_000)}"}`)).toBeUndefined() // over the input cap
  expect(parseFrame("not json")).toBeUndefined()
  expect(parseFrame(`{"t":"x"}`)).toBeUndefined()
})

test("parseFrame: kill", () => {
  expect(parseFrame(`{"t":"k"}`)).toEqual({ t: "k" })
})

test("Ring keeps the last bytes in order", () => {
  const r = new Ring(8)
  const enc = (s: string) => new TextEncoder().encode(s)
  r.push(enc("abc"))
  r.push(enc("defg"))
  expect(new TextDecoder().decode(r.read())).toBe("abcdefg")
  r.push(enc("hijk"))
  expect(new TextDecoder().decode(r.read())).toBe("defghijk") // "abc" dropped, 8 bytes kept
  r.push(enc("0123456789"))
  expect(new TextDecoder().decode(r.read())).toBe("23456789") // one chunk larger than the ring: its tail
})
