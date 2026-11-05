import { describe, expect, test } from "bun:test"
import { MENTION_RE } from "./index.ts"

const tokens = (text: string) => [...text.matchAll(MENTION_RE)].map((m) => m[1])

describe("MENTION_RE", () => {
  test("calls: after a space, punctuation, a dash or at the start", () => {
    expect(tokens("@tester")).toEqual(["tester"])
    expect(tokens("(@tester) and —@leo, \"@nico\"")).toEqual(["tester", "leo", "nico"])
    expect(tokens("@ANA-JÚLIA!")).toEqual(["ANA-JÚLIA"])
    expect(tokens("first\n@tester")).toEqual(["tester"])
  })
  test("does not call: glued to a letter, digit, _, . or -", () => {
    for (const text of ["foo@tester.com", "a.b@tester", "a_@tester", "a-@tester", "1@tester", "é@tester"]) expect(tokens(text)).toEqual([])
  })
  test("does not call: no token", () => {
    for (const text of ["@", "@-x", "@ tester", "mail @ home"]) expect(tokens(text)).toEqual([])
  })
  test("the token is the whole word: a trailing dash is part of it", () => {
    expect(tokens("@ana- and @ana.")).toEqual(["ana-", "ana"])
  })
  test("no state between uses of the shared regex", () => {
    expect(tokens("hi @tester")).toEqual(["tester"])
    expect(tokens("hi @tester")).toEqual(["tester"])
  })
  test("several in a row and repeated ones are all read, in order", () => {
    expect(tokens("@a @b\n@c @a")).toEqual(["a", "b", "c", "a"])
    expect(tokens("@tester,@leo")).toEqual(["tester", "leo"])
  })
  test("a token starts with a letter or digit, never _ or -", () => {
    expect(tokens("@_x @-x @9x")).toEqual(["9x"])
  })
})
