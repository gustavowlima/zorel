import { describe, expect, test } from "bun:test"
import { agentOptions, callable, projectCrew, teamsIn, toJoin, withTeam } from "./agent-options.ts"

const agent = (id: string, name: string, o: { projectId?: string | null; builtin?: boolean } = {}) => ({ id, name, projectId: o.projectId ?? null, builtin: o.builtin ?? false })
const lead = agent("a1", "Tech Leader")
const dev = agent("a2", "Frontend")
const qa = agent("a3", "Tester")
const hints = { member: (a: { name: string }) => `role of ${a.name}`, outside: "Add to chat" }

describe("callable", () => {
  test("not the Builder; the project's own and the global ones, not another project's", () => {
    const list = [lead, agent("b", "Builder", { builtin: true }), agent("p1", "Mine", { projectId: "P" }), agent("p2", "Theirs", { projectId: "Q" })]
    expect(callable(list, "P").map((a) => a.id)).toEqual(["a1", "p1"])
    expect(callable(list, null).map((a) => a.id)).toEqual(["a1"])
  })
})

describe("agentOptions", () => {
  test("members first in the chat's order, with their role; the others after, saying they join the chat", () => {
    const options = agentOptions([lead, dev, qa], ["a3", "a1"], hints)
    expect(options.map((o) => [o.id, o.member, o.hint])).toEqual([
      ["tester", true, "role of Tester"],
      ["tech-leader", true, "role of Tech Leader"],
      ["frontend", false, "Add to chat"]
    ])
    expect(options[0]).toMatchObject({ label: "Tester", agent: qa })
  })
  test("a chat with no members offers everyone as outside; a member that can't be called is skipped", () => {
    expect(agentOptions([lead, dev], [], hints).every((o) => !o.member)).toBe(true)
    expect(agentOptions([lead], ["gone", "a1"], hints).map((o) => o.id)).toEqual(["tech-leader"])
  })
})

describe("toJoin", () => {
  const team = [lead, dev, qa, agent("a4", "Ana Júlia")]
  const ids = (text: string, members: string[]) => toJoin(text, members, team).map((a) => a.id)

  test("an agent from outside the chat joins; one already in it does not", () => {
    expect(ids("@tester please", ["a1"])).toEqual(["a3"])
    expect(ids("@tester please", ["a1", "a3"])).toEqual([])
  })
  test("several, once each, in the order they appear", () => {
    expect(ids("@frontend then @tester, @frontend again", [])).toEqual(["a2", "a3"])
  })
  test("an unknown handle, a handle that continues and an e-mail call no one", () => {
    expect(ids("@nobody @testers mail me at x@tester.com", [])).toEqual([])
  })
  test("the same reading as the server: accents and case do not matter, punctuation around is fine", () => {
    expect(ids("(@ANA-JÚLIA!) and —@Frontend", [])).toEqual(["a4", "a2"])
  })
  test("a mention inside backticks or a code block is not a call", () => {
    expect(ids("run `@tester` and\n```\n@frontend\n```", [])).toEqual([])
    expect(ids("`code` then @tester", [])).toEqual(["a3"])
  })
  test("an agent that can't be called here is not offered to join", () => {
    expect(toJoin("@tester", [], [lead, dev])).toEqual([])
  })
})

describe("teams (spec 010)", () => {
  const ana = agent("a4", "Ana Júlia")
  const callable = [lead, dev, qa, ana]
  const crew = { name: "Front Crew", agentIds: ["a3", "gone", "a2"], projectId: null }

  test("@team brings in its callable members in team order; ones in the chat or outside reach don't", () => {
    expect(toJoin("@front-crew look", [], callable, [crew]).map((a) => a.id)).toEqual(["a3", "a2"])
    expect(toJoin("@front-crew look", ["a2"], callable, [crew]).map((a) => a.id)).toEqual(["a3"])
    expect(toJoin("`@front-crew`", [], callable, [crew])).toEqual([])
    expect(toJoin("@tester and @front-crew", [], callable, [crew]).map((a) => a.id)).toEqual(["a3", "a2"]) // once each
  })
  test("adding a team: after the chat's members, without duplicates, up to the cap", () => {
    expect(withTeam(crew, callable, ["a1", "a2"])).toMatchObject({ ids: ["a1", "a2", "a3"], overflow: 0 })
    expect(withTeam(crew, callable, ["a1", "a2", "x", "y", "z", "w", "v"])).toMatchObject({ ids: ["a1", "a2", "x", "y", "z", "w", "v", "a3"], overflow: 0 })
    expect(withTeam(crew, callable, ["a1", "x", "y", "z", "w", "v", "u"])).toMatchObject({ overflow: 1 })
    expect(withTeam({ agentIds: [] }, callable, [])).toMatchObject({ ids: [], added: [], overflow: 0 })
  })
  test("teamsIn: the project's own and the global ones", () => {
    expect(teamsIn([{ projectId: null }, { projectId: "p1" }, { projectId: "p2" }], "p1")).toHaveLength(2)
  })
})

describe("projectCrew", () => {
  test("its agents, then its teams' members, once each, only those in reach, up to 8", () => {
    const teams = [{ id: "t1", agentIds: ["a2", "a3", "gone"] }]
    expect(projectCrew({ agentIds: ["a2", "a1"], teamIds: ["t1", "deleted"] }, [lead, dev, qa], teams).map((a) => a.id)).toEqual(["a2", "a1", "a3"])
    expect(projectCrew(undefined, [lead], teams)).toEqual([])
    const many = Array.from({ length: 10 }, (_, i) => agent(`m${i}`, `M${i}`))
    expect(projectCrew({ agentIds: many.map((a) => a.id), teamIds: [] }, many, [])).toHaveLength(8)
  })
})
