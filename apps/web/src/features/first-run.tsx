// The first run (spec 015): in Zorel you always talk to agents, so before anything else the person makes their first
// one. A name, what it is for (a ready choice sets its instructions, editable later), and which AI it uses; with none
// connected, the providers open here, in a dialog. Create makes the agent and a chat with it, then goes there. What
// was typed survives closing the app midway (localStorage, best effort).
import { t } from "@zorel/i18n"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { useEffect, useState } from "react"
import { modelsAtom, mutations, useList, useMutation } from "../client.ts"
import { go, useRoute } from "../state.ts"
import { type ModelChoice, ModelPicker } from "./model-picker.tsx"
import { ProvidersSection } from "./providers.tsx"
import { Button, ChoiceCards, Dialog, Field, Input, Logo, Spinner, Textarea } from "@/ui"

type Purpose = "research" | "writing" | "code" | "operations" | "own"
// What each ready choice tells the agent (model-facing, so English, and never which language to reply in).
const INSTRUCTIONS: Readonly<Record<Exclude<Purpose, "own">, string>> = {
  research: "You research for me: find sources, read them, compare what they say and give me a short answer with links. Say what you couldn't verify.",
  writing: "You write with me: drafts, edits and summaries in my voice. Ask what it's for and who reads it when that isn't clear; keep it short.",
  code: "You build software with me: read the code before changing it, make small changes that work, run the tests, and tell me what you changed.",
  operations: "You handle my routine work: check what needs attention, keep things in order with my tools, and tell me only what needs me."
}
const PURPOSES = ["research", "writing", "code", "operations", "own"] as const
const DRAFT_KEY = "zorel.draft.firstAgent"
type Draft = { name: string; purpose: Purpose; own: string }

const readDraft = (): Draft => {
  try {
    return { name: "", purpose: "research", own: "", ...JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") }
  } catch {
    return { name: "", purpose: "research", own: "" }
  }
}
const saveDraft = (d: Draft | null) => {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    // no storage (private window): the draft just isn't kept
  }
}

export function FirstRun() {
  // Finding the AIs takes a few seconds (the CLIs are asked): until then it says so, not "none connected".
  const modelsResult = useAtomValue(modelsAtom)
  const looking = AsyncResult.isInitial(modelsResult) || (AsyncResult.isSuccess(modelsResult) && modelsResult.waiting)
  const models = useList(modelsAtom).filter((m) => m.available)
  const route = useRoute()
  const createAgent = useMutation(mutations.createAgent)
  const createChat = useMutation(mutations.createChat)
  const [draft, setDraft] = useState(readDraft)
  const [picked, setPicked] = useState<ModelChoice>()
  const [connecting, setConnecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => saveDraft(draft), [draft])
  // The model: the person's pick, else Claude's when it's ready, else the first one ready.
  const first = models.find((m) => m.id === "claude-cli/sonnet") ?? models[0]
  const choice: ModelChoice | undefined = picked ?? (first && { model: first.id, accountId: null, effort: null })
  const name = draft.name.trim() || t("firstRun.defaultName")
  const instructions = draft.purpose === "own" ? draft.own.trim() : INSTRUCTIONS[draft.purpose]
  const ready = !!choice && !!instructions && !saving

  const create = async () => {
    if (!choice) return
    setSaving(true)
    setError(undefined)
    try {
      const title = draft.purpose === "own" ? "" : t(`firstRun.purpose.${draft.purpose}`)
      const agent = await createAgent({ payload: { projectId: null, name, title, instructions, ...choice }, reactivityKeys: ["agents"] })
      const chat = await createChat({ payload: { projectId: null, agentIds: [agent.id], ...choice }, reactivityKeys: ["chats"] })
      saveDraft(null)
      go({ view: "chat", id: chat.id })
    } catch {
      setError(t("firstRun.failed"))
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto bg-canvas px-6 py-12">
      <div className="flex w-full max-w-xl flex-col gap-7 animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
        <div className="flex flex-col gap-2">
          <Logo className="size-8" />
          <h1 className="text-xl font-semibold">{t("firstRun.title")}</h1>
          <p className="text-muted">{t("firstRun.subtitle")}</p>
        </div>
        <Field label={t("firstRun.name")}>
          <Input autoFocus value={draft.name} placeholder={t("firstRun.defaultName")} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label={t("firstRun.for")}>
          <ChoiceCards
            list
            label={t("firstRun.for")}
            value={draft.purpose}
            onChange={(purpose) => setDraft({ ...draft, purpose })}
            options={PURPOSES.map((p) => ({ value: p, title: t(`firstRun.purpose.${p}`), description: t(`firstRun.purposeHint.${p}`) }))}
          />
        </Field>
        {draft.purpose === "own" && <Textarea aria-label={t("firstRun.own")} placeholder={t("firstRun.ownHint")} value={draft.own} onChange={(e) => setDraft({ ...draft, own: e.target.value })} rows={4} />}
        <Field label={t("firstRun.ai")} hint={choice ? t("firstRun.aiHint") : undefined}>
          {choice ? (
            <ModelPicker variant="field" value={choice} onChange={setPicked} />
          ) : looking ? (
            <p className="flex h-control items-center gap-2 text-sm text-muted">
              <Spinner className="size-4" />
              {t("firstRun.looking")}
            </p>
          ) : (
            <div className="flex items-center gap-3 rounded-card border border-subtle bg-surface px-3.5 py-3">
              <span className="flex-1 text-sm text-muted">{t("firstRun.noAi")}</span>
              <Button variant="secondary" onPress={() => setConnecting(true)}>
                {t("firstRun.connect")}
              </Button>
            </div>
          )}
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end">
          <Button isDisabled={!ready} onPress={() => void create()}>
            {saving ? t("firstRun.creating") : t("firstRun.create", { name })}
          </Button>
        </div>
      </div>
      {/* Connecting an AI without leaving the step: the providers' own screens, in a dialog. */}
      <Dialog title={t("firstRun.connect")} size="xl" isOpen={connecting} onOpenChange={setConnecting}>
        {() => <ProvidersSection provider={route.view === "settings" ? route.provider : undefined} />}
      </Dialog>
    </div>
  )
}
