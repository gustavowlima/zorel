// Home = a new chat: pick the project and the agent (or none) above the box, the model in it, and type. The chat
// is created on the first send (or the first attachment, which needs a chat to belong to), then the screen
// moves to it.
import { t } from "@zorel/i18n"
import { useEffect, useRef, useState } from "react"
import { agentsAtom, mutations, projectsAtom, teamsAtom, uploadAttachment, useList, useMutation } from "../client.ts"
import { go } from "../state.ts"
import { agentOptions, callable, teamsIn, toJoin } from "./agent-options.ts"
import { Composer, type ComposerSources, SendError } from "./composer.tsx"
import { type ModelChoice, ModelPicker } from "./model-picker.tsx"
import { agentTone, modelLabel } from "../labels.ts"
import { AgentAvatar, Folder, IconButton, Select, Users, X } from "@/ui"

const DEFAULT_MODEL: ModelChoice = { model: "claude-cli/sonnet", accountId: null, effort: null }

export function HomeView({ projectId: initialProject }: { projectId?: string | undefined }) {
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const createChat = useMutation(mutations.createChat)
  const send = useMutation(mutations.send)
  const updateChat = useMutation(mutations.updateChat)
  const [projectId, setProjectId] = useState<string | null>(initialProject ?? null)
  const [agentId, setAgentId] = useState<string | null>(null)
  const [choice, setChoice] = useState<ModelChoice>(DEFAULT_MODEL)
  const chat = useRef<Promise<string> | null>(null)

  const available = callable(agents, projectId)
  const teams = teamsIn(useList(teamsAtom), projectId)
  const pickAgent = (id: string | null) => {
    setAgentId(id)
    const a = agents.find((x) => x.id === id)
    if (a) setChoice({ model: a.model, accountId: a.accountId, effort: a.effort })
  }
  const lead = available.find((a) => a.id === agentId)
  // "#" in the box calls an agent (a chip, "@handle" in the text, as in a chat; typing filters, so a long team stays
  // usable). Who is named joins the new chat when the message is sent (see `callWith`).
  const sources: ComposerSources = {
    leads: agentOptions(available, available.map((a) => a.id), { member: (a) => a.title || modelLabel(a.model), outside: "" }).map((o) => ({
      id: o.id,
      label: o.label,
      hint: o.hint,
      icon: <AgentAvatar id={o.agent.id} name={o.agent.name} tone={agentTone(o.agent, agents)} size={16} />
    })).concat(teams.map((x) => ({ id: x.handle, label: x.name, hint: t("teams.option", { count: x.agentIds.length }), icon: <Users className="size-4" /> })))
  }
  // A project's chat starts with its default agent (Agents tab of the project), if it has one.
  const defaultAgent = projects.find((p) => p.id === projectId)?.defaultAgentId ?? null
  useEffect(() => {
    setProjectId(initialProject ?? null)
    chat.current = null
  }, [initialProject])
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new project or default resets the pick
  useEffect(() => {
    pickAgent(agents.some((a) => a.id === defaultAgent) ? defaultAgent : null)
  }, [projectId, defaultAgent, agents.length])

  // Who is in the chat a message starts: the chosen lead (or the project's default), then everyone the text names.
  // With no lead chosen, the first one named leads (and the chat takes its model).
  const callWith = (text: string) => {
    const named = toJoin(text, agentId ? [agentId] : [], available, teams).slice(0, agentId ? 7 : 8) // a chat holds 8
    return { agentIds: [...(agentId ? [agentId] : []), ...named.map((a) => a.id)], ...(!agentId && named[0] && { model: named[0].model }) }
  }
  // One chat per draft, however many files are attached before sending.
  const ensureChat = (call: { agentIds: string[]; model?: string } = { agentIds: agentId ? [agentId] : [] }) =>
    (chat.current ??= createChat({ payload: { projectId, ...choice, ...call }, reactivityKeys: ["chats"] }).then(
      (c) => c.id,
      (e: unknown) => {
        chat.current = null // a failed create can be retried
        throw e
      }
    ))

  const submit = async (text: string, attachmentIds: ReadonlyArray<string>) => {
    const call = callWith(text)
    const created = chat.current !== null // a file was attached first: the chat exists with only its lead
    const chatId = await ensureChat(call)
    if (created && call.agentIds.length > (agentId ? 1 : 0)) {
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
    <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-auto px-7 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
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
                setProjectId(v || null)
                pickAgent(null)
              }}
              options={[{ value: "", label: t("home.noProject") }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
              searchLabel={t("home.searchProjects")}
            />
            {lead && (
              // Who answers, once picked ("#" in the box, or the project's default): its face and name, × goes back
              // to a plain chat. Picking happens in the box itself, so there is no list of names here.
              <span className="flex h-control-sm items-center gap-1.5 rounded-full bg-control pr-0.5 pl-1 text-sm text-fg">
                <AgentAvatar id={lead.id} name={lead.name} tone={agentTone(lead, agents)} size={20} />
                <span className="max-w-40 truncate">{t("home.answers", { name: lead.name })}</span>
                <IconButton label={t("home.clearAgent", { name: lead.name })} size="xs" shape="pill" onPress={() => pickAgent(null)}>
                  <X className="size-3.5" />
                </IconButton>
              </span>
            )}
          </div>
          <Composer
            autoFocus
            sources={sources}
            onSubmit={submit}
            upload={(f) => ensureChat().then((id) => uploadAttachment(id, f))}
            placeholder={t(available.length ? "home.placeholder" : "home.placeholderPlain")}
            tools={<ModelPicker value={choice} onChange={setChoice} />}
          />
        </div>
      </div>
    </div>
  )
}
