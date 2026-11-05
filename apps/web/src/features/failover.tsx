// Failover list editor (ARCHITECTURE §6.1): ordered fallbacks { model, account } tried when a turn fails
// before acting. Used by the agent (its own list) and the chat (an override for the lead).
// A second subscription account of the same provider shows the terms warning once; API fallbacks say they
// cost per token.
import { type FailoverTarget, MAX_FAILOVER } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { AsyncResult } from "effect/reactivity"
import { useAtomValue } from "@effect/atom-react"
import { accountsAtom, modelsAtom, mutations, preferencesAtom, useList, useMutation } from "../client.ts"
import { ACCOUNT_OF_MODEL, splitModel } from "../labels.ts"
import { ModelPicker } from "./model-picker.tsx"
import { Button, CircleAlert, IconButton, Notice, Plus, SortableList, X } from "@/ui"


// True while the list mixes two subscription accounts of one provider and the warning isn't accepted yet.
export function useTermsPending(primary: FailoverTarget, list: ReadonlyArray<FailoverTarget>): boolean {
  const accounts = useList(accountsAtom)
  const prefs = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)
  if (!prefs || prefs.failoverTermsAcceptedAt) return false
  const seen = new Map<string, Set<string>>()
  for (const r of [primary, ...list]) {
    const provider = ACCOUNT_OF_MODEL[splitModel(r.model).provider]
    if (!provider) continue
    const id = r.accountId ?? accounts.find((a) => a.provider === provider && a.isDefault)?.id ?? `${provider}-default`
    seen.set(provider, (seen.get(provider) ?? new Set()).add(id))
  }
  return [...seen.values()].some((ids) => ids.size > 1)
}

export function FailoverEditor({ primary, value, onChange }: { primary: FailoverTarget; value: ReadonlyArray<FailoverTarget>; onChange: (v: ReadonlyArray<FailoverTarget>) => void }) {
  const models = useList(modelsAtom)
  const accept = useMutation(mutations.acceptFailoverTerms)
  const pending = useTermsPending(primary, value)
  const isApi = (model: string) => models.find((m) => m.provider === splitModel(model).provider)?.kind === "api"
  // A new fallback starts on the first available model not in use yet (a copy of the primary is useless).
  const fresh = (): FailoverTarget => {
    const used = new Set([primary, ...value].map((r) => r.model))
    const ids = models.filter((m) => !m.id.endsWith("…")).sort((a, b) => Number(b.available) - Number(a.available))
    return { model: ids.find((m) => !used.has(m.id))?.id ?? primary.model, accountId: null }
  }
  const set = (i: number, r: FailoverTarget) => onChange(value.map((x, j) => (j === i ? r : x)))

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && <p className="text-muted">{t("failover.empty")}</p>}
      {/* Order is the order they're tried: drag a row by its handle (or keyboard) to change it. */}
      {value.length > 0 && (
        <SortableList
          items={value}
          label={t("failover.title")}
          handleLabel={(_r, i) => t("failover.reorder", { n: i + 1 })}
          textOf={(r) => r.model}
          onReorder={onChange}
        >
          {(r, i) => (
            <>
              <span className="w-4 shrink-0 text-right text-sm text-muted tabular-nums">{i + 1}</span>
              <ModelPicker variant="field" className="min-w-0 flex-1" value={{ ...r, effort: null }} onChange={(v) => set(i, { model: v.model, accountId: v.accountId })} />
              {isApi(r.model) && <span className="shrink-0 text-sm text-dim">{t("failover.perToken")}</span>}
              <IconButton label={t("failover.remove")} size="xs" onPress={() => onChange(value.filter((_, j) => j !== i))}>
                <X className="size-3.5" />
              </IconButton>
            </>
          )}
        </SortableList>
      )}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="secondary" isDisabled={value.length >= MAX_FAILOVER} onPress={() => onChange([...value, fresh()])}>
          <Plus />
          {t("failover.add")}
        </Button>
        {value.length >= MAX_FAILOVER && <span className="text-sm text-dim">{t("failover.max", { max: MAX_FAILOVER })}</span>}
      </div>
      {pending && (
        <Notice
          icon={<CircleAlert />}
          title={t("failover.termsTitle")}
          action={
            <Button size="sm" variant="secondary" onPress={() => void accept({ reactivityKeys: ["preferences"] })}>
              {t("failover.termsAccept")}
            </Button>
          }
        >
          {t("failover.termsBody")}
        </Notice>
      )}
    </div>
  )
}
