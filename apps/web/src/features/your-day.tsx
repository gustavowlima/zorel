// Settings › General › Your day (spec 012): the person's time zone, when their day starts (learned from the first
// activity of each day, or set by hand) and quiet hours, when routines hold their pings for the morning brief.
// Also the activity signal: the app tells the server the person is here when the window gains focus.
import type { QuietHours, TimeProfile } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { useEffect, useState } from "react"
import { mutations, preferencesAtom, useMutation } from "../client.ts"
import { Input, Rows, Section, Select, SettingRow, Switch } from "@/ui"
import { hm, toMinutes } from "../labels.ts"

const ZONES: ReadonlyArray<string> = (() => {
  try {
    return (Intl as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? []
  } catch {
    return []
  }
})()
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export function YourDaySetting() {
  const profile = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)?.timeProfile
  if (!profile) return null
  return <YourDay key={JSON.stringify(profile)} profile={profile} />
}

function YourDay({ profile }: { profile: TimeProfile }) {
  const save = useMutation(mutations.setTimeProfile)
  const [error, setError] = useState<string>()
  const put = (next: { timeZone?: string; quietHours?: QuietHours | null; dayStartSet?: number | null }) => {
    setError(undefined)
    void save({
      payload: { timeZone: next.timeZone ?? profile.timeZone, quietHours: next.quietHours === undefined ? profile.quietHours : next.quietHours, dayStartSet: next.dayStartSet === undefined ? profile.dayStartSet : next.dayStartSet },
      reactivityKeys: ["preferences", "routines"]
    }).catch(() => setError(t("day.saveFailed")))
  }
  const [start, setStart] = useState(hm(profile.dayStartMinutes))
  const [from, setFrom] = useState(profile.quietHours?.from ?? "21:00")
  const [to, setTo] = useState(profile.quietHours?.to ?? "07:00")
  const zones = ZONES.includes(profile.timeZone) ? ZONES : [profile.timeZone, ...ZONES]
  return (
    <Section title={t("day.title")} description={t("day.hint")}>
      <Rows>
        <SettingRow title={t("day.zone")}>
          <Select aria-label={t("day.zone")} value={profile.timeZone} onChange={(timeZone) => put({ timeZone })} searchLabel={t("day.zone")} options={zones.map((z) => ({ value: z, label: z.replaceAll("_", " ") }))} />
        </SettingRow>
        <SettingRow
          title={t("day.start")}
          hint={profile.dayStartSet !== null ? undefined : profile.learned ? t("day.learned", { count: profile.learned, time: hm(profile.dayStartMinutes) }) : t("day.notLearned", { time: hm(profile.dayStartMinutes) })}
        >
          <Switch aria-label={t("day.auto")} isSelected={profile.dayStartSet === null} onChange={(auto) => put({ dayStartSet: auto ? null : profile.dayStartMinutes })}>
            {t("day.auto")}
          </Switch>
          {profile.dayStartSet !== null && (
            <Input size="sm" aria-label={t("day.start")} value={start} onChange={(e) => setStart(e.target.value)} onBlur={() => HHMM.test(start) && put({ dayStartSet: toMinutes(start) })} className="w-20 tabular-nums" />
          )}
        </SettingRow>
        <SettingRow title={t("day.quiet")} hint={t("day.quietHint")}>
          {profile.quietHours && (
            <>
              <Input size="sm" aria-label={t("day.from")} value={from} onChange={(e) => setFrom(e.target.value)} onBlur={() => HHMM.test(from) && put({ quietHours: { from, to: profile.quietHours?.to ?? to } })} className="w-20 tabular-nums" />
              <Input size="sm" aria-label={t("day.to")} value={to} onChange={(e) => setTo(e.target.value)} onBlur={() => HHMM.test(to) && put({ quietHours: { from: profile.quietHours?.from ?? from, to } })} className="w-20 tabular-nums" />
            </>
          )}
          <Switch aria-label={t("day.quiet")} isSelected={!!profile.quietHours} onChange={(on) => put({ quietHours: on ? { from, to } : null })} />
        </SettingRow>
      </Rows>
      {error && <p className="text-sm text-danger">{error}</p>}
    </Section>
  )
}

// The person is here: the first time each day it teaches the server when their day starts (and starts the day's
// routines). At most every 10 minutes, on focus.
const ACTIVITY_EVERY = 10 * 60_000
export function useActivity() {
  const activity = useMutation(mutations.activity)
  useEffect(() => {
    let last = 0
    const ping = () => {
      if (document.hidden || Date.now() - last < ACTIVITY_EVERY) return
      last = Date.now()
      void activity({}).catch(() => undefined)
    }
    ping()
    window.addEventListener("focus", ping)
    document.addEventListener("visibilitychange", ping)
    return () => {
      window.removeEventListener("focus", ping)
      document.removeEventListener("visibilitychange", ping)
    }
  }, [activity])
}
