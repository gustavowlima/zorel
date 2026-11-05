import { describe, expect, test } from "bun:test"
import { agentUrl, linkMentions, splitMentions } from "./mentions.ts"

const team = [
  { id: "a1", name: "Tester" },
  { id: "a2", name: "Ana Júlia" },
  { id: "a3", name: "Ana" }
]
const agent = (id: string) => team.find((a) => a.id === id)

describe("splitMentions", () => {
  test("text without a mention stays as it is", () => {
    expect(splitMentions("no one here", team)).toEqual(["no one here"])
    expect(splitMentions("write to a@b.com", team)).toEqual(["write to a@b.com"])
    expect(splitMentions("mail foo@tester.com or a.b@tester", team)).toEqual(["mail foo@tester.com or a.b@tester"]) // an e-mail calls no one
  })
  test("a handle becomes the agent, case-insensitive", () => {
    expect(splitMentions("@tester go\nthen @Tester", team)).toEqual([{ agent: agent("a1"), text: "@tester" }, " go\nthen ", { agent: agent("a1"), text: "@Tester" }])
  })
  test("the same rule as the server (MENTION_RE): punctuation before the @ is fine, accents and case do not matter", () => {
    expect(splitMentions("(@tester) and —@tester, @ANA-JÚLIA!", team)).toEqual([
      "(",
      { agent: agent("a1"), text: "@tester" },
      ") and —",
      { agent: agent("a1"), text: "@tester" },
      ", ",
      { agent: agent("a2"), text: "@ANA-JÚLIA" },
      "!"
    ])
  })
  test("the whole token is the handle: ana-julia is not ana, and a longer word is not a mention", () => {
    expect(splitMentions("hi @ana-julia and @ana.", team)).toEqual(["hi ", { agent: agent("a2"), text: "@ana-julia" }, " and ", { agent: agent("a3"), text: "@ana" }, "."])
    expect(splitMentions("@testers and @nobody", team)).toEqual(["@testers and @nobody"])
  })
  test("no agents: nothing to link", () => {
    expect(splitMentions("@tester", [])).toEqual(["@tester"])
  })
})

describe("linkMentions", () => {
  type N = { type: string; value?: string; url?: string; children?: N[] }
  const run = (tree: N) => {
    linkMentions(team)()(tree)
    return tree
  }
  test("turns a mention in a paragraph into a link to the agent", () => {
    const tree = run({ type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: "ok @tester" }] }] })
    expect(tree.children![0]!.children).toEqual([
      { type: "text", value: "ok " },
      { type: "link", url: agentUrl("a1"), children: [{ type: "text", value: "@tester" }] }
    ])
  })
  test("leaves code and links alone", () => {
    const code = { type: "inlineCode", value: "@tester" }
    const link = { type: "link", url: "https://x.dev", children: [{ type: "text", value: "@tester" }] }
    const tree = run({ type: "root", children: [{ type: "paragraph", children: [code, link] }] })
    expect(tree.children![0]!.children).toEqual([code, link])
  })
})
