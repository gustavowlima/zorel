// The first run (spec 015): in Zorel you always talk to agents, so the person makes their first one before anything
// else, on a set drawn from Zorel's mark (ui/onboarding.tsx). The opening (once per browser, skippable) draws the mark
// and opens the orbits; then connecting an AI (first-run-connect.tsx: found, installed or signed in from here); then
// the first agent, made in the app's own agent builder (with AI, or by hand from there). "Set up later"
// makes a general agent instead. The first run doesn't hold a builder of its own: there is one, the app's.
import { t } from "@zorel/i18n"
import { LayoutGroup } from "motion/react"
import { useCallback, useEffect, useState } from "react"
import { mutations, useMutation } from "../client.ts"
import { go } from "../state.ts"
import { Connect, useAi } from "./first-run-connect.tsx"
import { ArrowRight, Button, MarkOpening, OnboardingSet, StepColumn, StepHeader, StepTransition } from "@/ui"

type Step = "opening" | "connect" | "agent"
const ORDER: Readonly<Record<Step, number>> = { opening: 0, connect: 1, agent: 2 }
const OPENED_KEY = "zorel.seen.opening"
// Drafts of the earlier first run (a form, then a text box): dropped.
const OLD_KEYS = ["zorel.draft.firstAgent", "zorel.draft.firstAsk"]
type Action = { label: string; onPress: () => void; busy?: boolean }

// Browser storage, best effort (a private window has none).
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      // no storage: nothing kept
    }
  }
}

export function FirstRun({ hold }: { hold: (on: boolean) => void }) {
  // Seen the opening already: back at connecting an AI (it says at once what's ready, one press to go on).
  const [step, setStep] = useState<Step>(() => {
    for (const k of OLD_KEYS) store.set(k, null)
    return store.get(OPENED_KEY) ? "connect" : "opening"
  })
  const [dir, setDir] = useState(1) // the way steps slide: 1 forward, -1 back
  const goTo = useCallback((next: Step) => {
    setStep((now) => {
      setDir(ORDER[next] >= ORDER[now] ? 1 : -1)
      return next
    })
  }, [])
  useEffect(() => hold(true), [hold])
  const opened = useCallback(() => {
    store.set(OPENED_KEY, "1")
    goTo("connect")
  }, [goTo])
  // Leaving the first run for the app's agent builder.
  const leaveTo = (route: Parameters<typeof go>[0]) => {
    go(route)
    hold(false)
  }
  const later = useLater(() => hold(false))
  const back = (to: Step, label = t("firstRun.back")) => ({ label, onPress: () => goTo(to) })

  return (
    <LayoutGroup>
      <div className="relative flex min-h-0 flex-1 overflow-hidden bg-canvas">
        <OnboardingSet opening={step === "opening"} dim={step !== "opening"} />
        {step === "opening" ? (
          <MarkOpening title={t("firstRun.brand")} line={t("firstRun.opening")} skip={t("firstRun.skip")} onDone={opened} />
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <StepHeader wide={false} pulse={0} at={ORDER[step] - 1} steps={[t("firstRun.steps.connect"), t("firstRun.steps.agent")]} />
            <StepTransition id={step} dir={dir}>
              {step === "connect" && <Connect back={back("opening", t("firstRun.replay"))} later={later} onNext={() => goTo("agent")} />}
              {step === "agent" && <FirstAgent back={back("connect")} later={later} onBuilder={() => leaveTo({ view: "builder", projectId: null })} />}
            </StepTransition>
          </div>
        )}
      </div>
    </LayoutGroup>
  )
}

// "Your first agent": one way in, the app's agent builder (it proposes the agent or a team with their powers, and
// has "build it myself" for the form).
function FirstAgent({ back, later, onBuilder }: { back: Action; later: Action; onBuilder: () => void }) {
  const ai = useAi()
  return (
    <StepColumn back={back} later={later}>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{t("firstRun.agentTitle")}</h1>
        <p className="max-w-prose text-muted">{t("firstRun.agentLede")}</p>
      </div>
      <Button variant="default" size="lg" className="self-start" isDisabled={!ai.model} onPress={onBuilder}>
        {t("firstRun.createAgent")}
        <ArrowRight />
      </Button>
    </StepColumn>
  )
}


// "Set up later": Zorel always works with an agent (spec 015), so this makes a general one (named, plain instructions,
// on the AI found here, else Claude's) and opens the app; everything changes later on its page.
const GENERAL_INSTRUCTIONS = "You help me with whatever I ask. Understand the request first, ask when something important is unclear, keep answers short, and tell me what you did."
function useLater(done: () => void): Action {
  const ai = useAi()
  const createAgent = useMutation(mutations.createAgent)
  const [busy, setBusy] = useState(false)
  const onPress = () => {
    if (busy) return
    setBusy(true)
    const model = ai.models.find((m) => m.id === "claude-cli/sonnet")?.id ?? ai.models[0]?.id ?? "claude-cli/sonnet"
    void createAgent({ payload: { projectId: null, name: t("firstRun.defaultName"), title: "", instructions: GENERAL_INSTRUCTIONS, model, accountId: null, effort: null }, reactivityKeys: ["agents"] })
      .then(() => {
        go({ view: "home" })
        done()
      })
      .catch(() => setBusy(false))
  }
  return { label: t("firstRun.later"), onPress, busy }
}
