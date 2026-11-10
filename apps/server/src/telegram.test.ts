import { expect, test } from "bun:test"
import { parseCard } from "./telegram.ts"

test("parseCard (spec 013): a card's button, nothing else", () => {
  const id = "0b6a1f3e-58c4-4c39-9f5e-6f7f2d1c9a10"
  expect(parseCard(`ap:${id}:y`)).toEqual({ id, approve: true })
  expect(parseCard(`ap:${id}:n`)).toEqual({ id, approve: false })
  expect(parseCard(`ap:${id}:x`)).toBeUndefined()
  expect(parseCard("ap:../../etc:y")).toBeUndefined()
  expect(parseCard(undefined)).toBeUndefined()
})
