// Home = a new chat: pick the project and who answers above the box (always an agent, spec 015), the model in it, and type. The chat
// is created on the first send (or the first attachment, which needs a chat to belong to), then the screen
// moves to it.
import { t } from "@zorel/i18n"
import { useEffect, useRef, useState } from "react"
import { agentsAtom, chatsAtom, mutations, projectsAtom, teamsAtom, uploadAttachment, useList, useMutation } from "../client.ts"
import { go } from "../state.ts"
import { agentOptions, callable, lastUsedAgent, projectCrew, teamsIn, toJoin } from "./agent-options.ts"
import { Composer, type ComposerOption, type ComposerSources, SendError } from "./composer.tsx"
import { type ModelChoice, ModelPicker } from "./model-picker.tsx"
import { agentTint, agentTone, modelLabel } from "../labels.ts"
import { AgentAvatar, cn, Folder, OrbitBackdrop, Select, Users } from "@/ui"

const DEFAULT_MODEL: ModelChoice = { model: "claude-cli/sonnet", accountId: null, effort: null }

export function HomeView({ projectId: initialProject }: { projectId?: string | undefined }) {
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const createChat = useMutation(mutations.createChat)
  const send = useMutation(mutations.send)
  const updateChat = useMutation(mutations.updateChat)
  const [projectId, setProjectId] = useState<string | null>(initialProject ?? null)
  // Only what the person chose is state: who answers outside a crew, and a model of their own. Who starts the chat
  // and its model follow from the project; picking another project forgets both choices.
  const [chosen, setChosen] = useState<string>()
  const [picked, setPicked] = useState<ModelChoice>()
  const chats = useList(chatsAtom)
  const chat = useRef<Promise<string> | null>(null)

  const available = callable(agents, projectId)
  const teams = teamsIn(useList(teamsAtom), projectId)
  const pickProject = (id: string | null) => {
    setProjectId(id)
    setChosen(undefined)
    setPicked(undefined)
  }
  // "#" in the box calls an agent (a chip, "@handle" in the text, as in a chat; typing filters, so a long team stays
  // usable). Who is named joins the new chat when the message is sent (see `callWith`).
  const sources: ComposerSources = {
    leads: agentOptions(available, available.map((a) => a.id), { member: (a) => a.title || modelLabel(a.model), outside: "" }).map((o): ComposerOption => ({
      id: o.id,
      label: o.label,
      hint: o.hint,
      icon: <AgentAvatar id={o.agent.id} name={o.agent.name} tone={agentTone(o.agent, agents)} size={16} />,
      tint: agentTint(o.agent, agents)
    })).concat(teams.map((x) => ({ id: x.handle, label: x.name, hint: t("teams.option", { count: x.agentIds.length }), icon: <Users className="size-4" /> })))
  }
  // A project's chat starts with who takes part in it (Agents tab of the project): its agents and its teams' members.
  // With no crew, one agent answers: the one picked here, else the one used last. The lead's model is the chat's unless
  // the person picked one.
  const crew = projectCrew(projects.find((p) => p.id === projectId), available, teams)
  const single = available.find((a) => a.id === chosen) ?? lastUsedAgent(chats, available)
  const members = crew.length ? crew : single ? [single] : []
  const lead = members[0]
  const choice = picked ?? (lead ? { model: lead.model, accountId: lead.accountId, effort: lead.effort } : DEFAULT_MODEL)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new route project resets the draft
  useEffect(() => {
    pickProject(initialProject ?? null)
    chat.current = null
  }, [initialProject])

  // Who is in the chat a message starts: the crew, then everyone the text names. With no one yet, the first one
  // named leads (and the chat takes its model).
  const callWith = (text: string) => {
    const named = toJoin(text, members.map((a) => a.id), available, teams).slice(0, 8 - members.length) // a chat holds 8
    return { agentIds: [...members.map((a) => a.id), ...named.map((a) => a.id)], ...(!members.length && named[0] && { model: named[0].model }) }
  }
  // One chat per draft, however many files are attached before sending.
  const ensureChat = (call: { agentIds: string[]; model?: string } = { agentIds: members.map((a) => a.id) }) =>
    (chat.current ??= createChat({ payload: { projectId, ...choice, ...call }, reactivityKeys: ["chats"] }).then(
      (c) => c.id,
      (e: unknown) => {
        chat.current = null // a failed create can be retried
        throw e
      }
    ))

  const submit = async (text: string, attachmentIds: ReadonlyArray<string>) => {
    const call = callWith(text)
    const created = chat.current !== null // a file was attached first: the chat exists with only its crew
    const chatId = await ensureChat(call)
    if (created && call.agentIds.length > members.length) {
      try {
        await updateChat({ params: { id: chatId }, payload: call, reactivityKeys: ["chats", "context"] })
      } catch {
        throw new SendError(t("chat.addFailed"))
      }
    }
    await send({ payload: { chatId, clientId: crypto.randomUUID(), text, ...(attachmentIds.length && { attachmentIds }) } })
    go({ view: "chat", id: chatId })
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col items-center justify-center overflow-auto px-7 py-10">
      {/* Orbits behind it, after the mark (decoration only). */}
      <OrbitBackdrop className="absolute inset-0" />
      <div className="relative flex w-full max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-1.5 text-center">
          <h1 className="text-lg font-semibold">{t("home.title")}</h1>
          <p className="text-muted">{t("home.subtitle")}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          {/* Where the chat lives and who answers, above the box (the box is the chat's own: attach, text,
              model). The project sets the context, the agents and the folder. */}
          <div className="flex items-center gap-1">
            <Select
              variant="ghost"
              icon={<Folder />}
              className="w-auto max-w-64"
              aria-label={t("home.project")}
              value={projectId ?? ""}
              onChange={(v) => {
                pickProject(v || null)
              }}
              options={[{ value: "", label: t("home.noProject") }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
              searchLabel={t("home.searchProjects")}
            />
            {crew.length > 0 ? (
              // Who the chat starts with (the project's crew): their faces and who. More join with "#" in the box.
              <span className={cn("flex h-control-sm items-center gap-1.5 rounded-full border px-1.5 text-sm", crew.length === 1 ? `tinted ${agentTint(crew[0]!, agents)}` : "border-transparent bg-control text-fg")}>
                <span className="flex -space-x-1.5">
                  {crew.slice(0, 3).map((a) => (
                    <AgentAvatar key={a.id} id={a.id} name={a.name} tone={agentTone(a, agents)} size={20} />
                  ))}
                </span>
                <span className="max-w-48 truncate">{crew.length === 1 ? t("home.answers", { name: crew[0]!.name }) : t("home.crew", { count: crew.length })}</span>
              </span>
            ) : (
              single && (
                // Who answers: the agent used last, or another one picked here.
                <Select
                  variant="ghost"
                  className="w-auto max-w-64"
                  aria-label={t("home.whoAnswers")}
                  value={single.id}
                  onChange={setChosen}
                  options={available.map((a) => ({ value: a.id, label: a.name, icon: <AgentAvatar id={a.id} name={a.name} tone={agentTone(a, agents)} size={16} /> }))}
                  searchLabel={t("home.searchAgents")}
                />
              )
            )}
          </div>
          <Composer
            autoFocus
            sources={sources}
            onSubmit={submit}
            upload={(f) => ensureChat().then((id) => uploadAttachment(id, f))}
            placeholder={t("home.placeholder")}
            tools={<ModelPicker value={choice} onChange={setPicked} />}
          />
        </div>
      </div>
    </div>
  )
}
