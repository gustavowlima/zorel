// The first run (spec 015): in Zorel you always talk to agents, so the person makes their first one before anything
// else, on a set drawn from Zorel's mark (ui/onboarding.tsx). The opening (once per browser, skippable) draws the mark
// and opens the orbits; then connecting an AI (first-run-connect.tsx: found, installed or signed in from here); then
// the first agent, made in the app's own agent builder (with AI, or by hand from there). "Set up later"
// makes a general agent instead. The first run doesn't hold a builder of its own: there is one, the app's.
import { t } from "@zorel/i18n"
import { LayoutGroup } from "motion/react"
import { useCallback, useState } from "react"
import { agentsAtom, mutations, useList, useMutation } from "../client.ts"
import { go, READY_KEY, store, stored } from "../state.ts"
import { FALLBACK_MODEL } from "./builder.tsx"
import { Connect, useAi } from "./first-run-connect.tsx"
import type { Agent } from "@zorel/contracts"
import { agentTone, handleOf } from "../labels.ts"
import { AgentAvatar, ArrowRight, Button, Inbox, MarkOpening, OnboardingSet, StepColumn, StepHeader, type StepAction, StepTransition } from "@/ui"

type Step = "opening" | "connect" | "agent"
const ORDER: Readonly<Record<Step, number>> = { opening: 0, connect: 1, agent: 2 }
const OPENED_KEY = "zorel.seen.opening"


// Shown while the person has no agent of their own (App decides); it leaves by making one or opening the builder.
export function FirstRun() {
  // Seen the opening already: back at connecting an AI (it says at once what's ready, one press to go on).
  const [step, setStep] = useState<Step>(() => (stored(OPENED_KEY) ? "connect" : "opening"))
  const [dir, setDir] = useState(1) // the way steps slide: 1 forward, -1 back
  const goTo = useCallback((next: Step) => {
    setStep((now) => {
      setDir(ORDER[next] >= ORDER[now] ? 1 : -1)
      return next
    })
  }, [])
  const opened = useCallback(() => {
    store(OPENED_KEY, "1")
    goTo("connect")
  }, [goTo])
  const later = useLater()
  const back = (to: Step, label = t("firstRun.back")) => ({ label, onPress: () => goTo(to) })

  return (
    <LayoutGroup>
      <div className="relative flex min-h-0 flex-1 overflow-hidden bg-canvas">
        <OnboardingSet opening={step === "opening"} />
        {step === "opening" ? (
          <MarkOpening title={t("firstRun.brand")} line={t("firstRun.opening")} skip={t("firstRun.skip")} onDone={opened} />
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <StepHeader at={ORDER[step] - 1} steps={[t("firstRun.steps.connect"), t("firstRun.steps.agent")]} />
            <StepTransition id={step} dir={dir}>
              {step === "connect" && <Connect back={back("opening", t("firstRun.replay"))} later={later} onNext={() => goTo("agent")} />}
              {step === "agent" && (
                <FirstAgent
                  back={back("connect")}
                  later={later}
                  onBuilder={() => {
                    store(READY_KEY, "pending")
                    go({ view: "builder", projectId: null })
                  }}
                />
              )}
            </StepTransition>
          </div>
        )}
      </div>
    </LayoutGroup>
  )
}

// "Your first agent": one way in, the app's agent builder (it proposes the agent or a team with their powers, and
// has "build it myself" for the form).
function FirstAgent({ back, later, onBuilder }: { back: StepAction; later: StepAction; onBuilder: () => void }) {
  const ai = useAi()
  return (
    <StepColumn back={back} later={later}>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{t("firstRun.agentTitle")}</h1>
        <p className="max-w-prose text-muted">{t("firstRun.agentLede")}</p>
      </div>
      {/* What happens next, in three steps. */}
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        {[t("firstRun.howSay"), t("firstRun.howPropose"), t("firstRun.howReview")].map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span className="flex size-4.5 items-center justify-center rounded-full bg-control text-xs font-semibold text-secondary">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <Button variant="default" size="lg" className="self-start" isDisabled={!ai.model} onPress={onBuilder}>
        {t("firstRun.createAgent")}
        <ArrowRight />
      </Button>
    </StepColumn>
  )
}


// "Set up later": Zorel always works with an agent (spec 015), so this makes a general one (named, plain instructions,
// on the AI the Builder would use, else the fallback) and opens the app; everything changes later on its page. Home first:
// once the agent exists, App shows the app at the current route.
const GENERAL_INSTRUCTIONS = "You help me with whatever I ask. Understand the request first, ask when something important is unclear, keep answers short, and tell me what you did."
function useLater(): StepAction {
  const ai = useAi()
  const createAgent = useMutation(mutations.createAgent)
  const [busy, setBusy] = useState(false)
  const onPress = () => {
    if (busy) return
    setBusy(true)
    go({ view: "home" })
    void createAgent({ payload: { projectId: null, name: t("firstRun.defaultName"), title: "", instructions: GENERAL_INSTRUCTIONS, model: ai.model ?? FALLBACK_MODEL, accountId: null, effort: null }, reactivityKeys: ["agents"] }).catch(
      () => setBusy(false)
    )
  }
  return { label: t("firstRun.later"), onPress, busy }
}

// The first agent is ready (spec 018): it lands on its orbit, then the two ways on and three things worth knowing.
export function FirstRunReady({ agentId }: { agentId: string }) {
  const agents = useList(agentsAtom)
  const agent: Agent | undefined = agents.find((a) => a.id === agentId)
  const done = (to: Parameters<typeof go>[0]) => {
    store(READY_KEY, null)
    go(to)
  }
  if (!agent) return null
  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-canvas">
      <OnboardingSet opening={false} />
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
        <span className="motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:duration-700">
          <AgentAvatar id={agent.id} name={agent.name} tone={agentTone(agent, agents)} size={64} live />
        </span>
        <div className="flex max-w-lg flex-col gap-2">
          <h1 className="text-display font-semibold text-balance">{t("firstRun.readyTitle", { name: agent.name })}</h1>
          <p className="text-lg text-secondary">{t("firstRun.readyLede")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="default" size="lg" onPress={() => done({ view: "home" })}>
            {t("firstRun.readyStart")}
          </Button>
          <Button variant="ghost" size="lg" onPress={() => done({ view: "builder", projectId: null })}>
            {t("firstRun.readyMore")}
          </Button>
        </div>
        <ul className="flex flex-wrap justify-center gap-x-8 gap-y-2 border-t border-subtle pt-6 text-sm text-secondary">
          <li>{t("firstRun.readyTipMention", { handle: handleOf(agent) })}</li>
          <li className="flex items-center gap-2">
            <Inbox className="size-4 text-muted" />
            {t("firstRun.readyTipApprovals")}
          </li>
          <li className="flex items-center gap-2">
            <kbd className="rounded-control-sm px-1.5 text-xs text-muted ring-1 ring-strong">⌘K</kbd>
            {t("firstRun.readyTipSearch")}
          </li>
        </ul>
      </div>
    </div>
  )
}
