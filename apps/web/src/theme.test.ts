import { expect, test } from "bun:test"
import { accentTokens, checkAccent } from "./theme.ts"

test("a dark enough colour is accepted, normalised", () => {
  expect(checkAccent(" #2A6AF0 ")).toEqual({ ok: true, hex: "#2a6af0" })
})

test("a colour white can't be read on is refused for contrast", () => {
  expect(checkAccent("#ffd400")).toEqual({ ok: false, reason: "contrast" })
})

test("anything but #rrggbb is refused for format", () => {
  for (const v of ["blue", "#fff", "rgb(0,0,0)", "#12345g", ""]) expect(checkAccent(v)).toEqual({ ok: false, reason: "format" })
})

test("the override sets the colour, a deeper hover and a readable text tone", () => {
  const dark = accentTokens("#d9480f", "dark")
  expect(dark["--z-accent"]).toBe("#d9480f")
  expect(dark["--z-accent-hover"]).toContain("black")
  expect(dark["--z-accent-text"]).toContain("white")
  expect(accentTokens("#d9480f", "light")["--z-accent-text"]).toBe("#d9480f")
})
