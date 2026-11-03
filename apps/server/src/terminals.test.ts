import { expect, test } from "bun:test"
import { parseFrame } from "./terminals.ts"

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
