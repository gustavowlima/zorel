import { expect, test } from "bun:test"
import { lanesOf, moveCron } from "./week-lanes.ts"

test("lanesOf: overlapping runs share the column side by side; apart ones take it whole", () => {
  const got = lanesOf([{ id: "a", minutes: 727 }, { id: "b", minutes: 730 }, { id: "c", minutes: 600 }, { id: "d", minutes: 731 }])
  const by = Object.fromEntries(got.map((g) => [g.id, [g.lane, g.lanes]]))
  expect(by.c).toEqual([0, 1])
  expect([by.a, by.b, by.d]).toEqual([[0, 3], [1, 3], [2, 3]])
  expect(lanesOf([{ minutes: 600 }, { minutes: 700 }]).map((g) => g.lanes)).toEqual([1, 1])
})

test("moveCron: a time on one weekday follows the drop; a set of days keeps its days; other patterns don't move", () => {
  expect(moveCron("15 17 * * 5", 4, 10 * 60 + 30)).toBe("30 10 * * 4")
  expect(moveCron("0 9 * * 1-5", 3, 8 * 60)).toBe("0 8 * * 1-5")
  expect(moveCron("0 9 * * *", 0, 9 * 60 + 45)).toBe("45 9 * * *")
  expect(moveCron("0 9 * * 1,3", 2, 7 * 60)).toBe("0 7 * * 1,3")
  expect(moveCron("0 * * * *", 1, 600)).toBeUndefined()
  expect(moveCron("*/15 9-18 * * 1-5", 1, 600)).toBeUndefined()
  expect(moveCron("0 9 1 * *", 1, 600)).toBeUndefined()
})
