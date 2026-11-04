// Home = a new chat: pick the project and the agent (or none) above the box, the model in it, and type. The chat
// is created on the first send (or the first attachment, which needs a chat to belong to), then the screen
// moves to it.
import { t } from "@zorel/i18n"
import { useEffect, useRef, useState } from "react"
import { agentsAtom, mutations, projectsAtom, uploadAttachment, useList, useMutation } from "../client.ts"
import { go } from "../state.ts"
import { Composer } from "./composer.tsx"
import { type ModelChoice, ModelPicker } from "./model-picker.tsx"
import { Bot, Folder, Select } from "@/ui"

const DEFAULT_MODEL: ModelChoice = { model: "claude-cli/sonnet", accountId: null, effort: null }

export function HomeView({ projectId: initialProject }: { projectId?: string | undefined }) {
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const createChat = useMutation(mutations.createChat)
  const send = useMutation(mutations.send)
  const [projectId, setProjectId] = useState<string | null>(initialProject ?? null)
  const [agentId, setAgentId] = useState<string | null>(null)
  const [choice, setChoice] = useState<ModelChoice>(DEFAULT_MODEL)
  const chat = useRef<Promise<string> | null>(null)

  const available = agents.filter((a) => !a.builtin && (a.projectId === null || a.projectId === projectId))
  const pickAgent = (id: string | null) => {
    setAgentId(id)
    const a = agents.find((x) => x.id === id)
    if (a) setChoice({ model: a.model, accountId: a.accountId, effort: a.effort })
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

  // One chat per draft, however many files are attached before sending.
  const ensureChat = () =>
    (chat.current ??= createChat({ payload: { projectId, agentIds: agentId ? [agentId] : [], ...choice }, reactivityKeys: ["chats"] }).then(
      (c) => c.id,
      (e: unknown) => {
        chat.current = null // a failed create can be retried
        throw e
      }
    ))

  const submit = async (text: string, attachmentIds: ReadonlyArray<string>) => {
    const chatId = await ensureChat()
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
            />
            {available.length > 0 && (
              <Select
                variant="ghost"
                icon={<Bot />}
                className="w-auto max-w-56"
                aria-label={t("home.agent")}
                value={agentId ?? ""}
                onChange={(v) => pickAgent(v || null)}
                options={[{ value: "", label: t("home.noAgent") }, ...available.map((a) => ({ value: a.id, label: a.name }))]}
              />
            )}
          </div>
          <Composer
            autoFocus
            onSubmit={submit}
            upload={(f) => ensureChat().then((id) => uploadAttachment(id, f))}
            placeholder={t("composer.placeholder")}
            tools={<ModelPicker value={choice} onChange={setChoice} />}
          />
        </div>
      </div>
    </div>
  )
}
