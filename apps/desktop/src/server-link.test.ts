import { expect, test } from "bun:test"
import { serverFrom } from "./server-link.ts"

test("a server's address or invite link: HTTPS, or HTTP on this machine only; an invite opens its page", () => {
  expect(serverFrom("https://zorel.example.com/chats/1")).toEqual({ origin: "https://zorel.example.com", open: "https://zorel.example.com/" })
  expect(serverFrom(" https://zorel.example.com/invite/abc?x=1 ")).toEqual({ origin: "https://zorel.example.com", open: "https://zorel.example.com/invite/abc" })
  expect(serverFrom("http://127.0.0.1:4400/setup?t=abc")).toEqual({ origin: "http://127.0.0.1:4400", open: "http://127.0.0.1:4400/setup?t=abc" })
  expect(serverFrom("http://localhost:4317")?.origin).toBe("http://localhost:4317")
  for (const bad of ["http://zorel.example.com", "zorel.example.com", "file:///etc/hosts", "javascript:alert(1)", "https://user:pw@zorel.example.com", ""]) expect(serverFrom(bad)).toBeUndefined()
})
