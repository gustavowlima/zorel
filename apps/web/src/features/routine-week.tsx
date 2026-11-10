// The Routines page's week (spec 012): seven days from 07:00 to 22:00, each run at its time, colored by how it
// ended (needs you, something new, nothing new), the planned ones dashed, quiet hours shaded and the line where the
// person's day usually starts. A run opens its routine's chat. On the side: what needs the person and the week's
// counts. On a phone the grid scrolls sideways inside its box. An empty slot, clicked, starts a new routine at that
// day and time (on the hour or the half hour, by where it was clicked), like a calendar. Runs close in time cascade
// (each later one a little to the right, on top, readable; hover shows the whole line). A coming run of a simple
// schedule (a time on some days) can be dragged to another time or day: the routine's schedule moves with it.
import type { Routine, RoutineRun } from "@zorel/contracts"
import { locale, t } from "@zorel/i18n"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { type PointerEvent, useRef, useState } from "react"
import { mutations, preferencesAtom, routineWeekAtom, useMutation, useReading, routinesAtom } from "../client.ts"
import { go, type Route } from "../state.ts"
import { lanesOf, moveCron } from "./week-lanes.ts"
import { Button, ChevronLeft, ChevronRight, cx, Dot, IconButton, ListRow, Rows, Section, Tooltip } from "@/ui"

const DAY = 24 * 60 * 60_000
const FIRST_HOUR = 7
const LAST_HOUR = 22
const HOUR_PX = 44
const BLOCK_PX = 38
const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i)
const DAYS = [0, 1, 2, 3, 4, 5, 6] // Monday first

// Monday 00:00 (local) of the week `offset` weeks from this one.
const weekStart = (offset: number) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7)
  return d.getTime()
}
const minutesOf = (at: number) => {
  const d = new Date(at)
  return d.getHours() * 60 + d.getMinutes()
}
// Where a time sits in the grid, clamped into the visible hours.
const topOf = (minutes: number) => Math.min(Math.max(((minutes - FIRST_HOUR * 60) / 60) * HOUR_PX, 0), (LAST_HOUR - FIRST_HOUR) * HOUR_PX - BLOCK_PX)
const hm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
const toMinutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))

// How each outcome looks on the grid. Opaque, so a block cascading over another stays readable.
const LOOK: Record<"needs" | "something" | "nothing" | "planned", string> = {
  needs: "border border-warning bg-raised text-fg",
  something: "border border-strong bg-raised text-fg",
  nothing: "border border-subtle bg-surface text-dim",
  planned: "border border-dashed border-strong bg-surface text-muted"
}
const CASCADE_PX = 14 // how far each overlapping block steps right
const SNAP = 15 // minutes a drag moves by

// A planned run opens what it will run: a routine's steps (spec 013), else its chat.
const plannedOpen = (r: Routine | undefined): Route | undefined => (!r ? undefined : r.version != null ? { view: "routine-flow", id: r.id } : { view: "chat", id: r.chatId })
type Block = { key: string; day: number; minutes: number; title: string; meta: string; look: keyof typeof LOOK; open: Route | undefined; routine?: Routine | undefined }
type Drag = { key: string; x: number; y: number; dx: number; dy: number; width: number }


export type Slot = { weekday: number; minutes: number } // 0 = Sunday, as cron counts
export function RoutineWeek({ onCreate }: { onCreate?: (slot: Slot) => void }) {
  const [offset, setOffset] = useState(0)
  const from = weekStart(offset)
  const week = AsyncResult.getOrElse(useAtomValue(routineWeekAtom(from, from + 7 * DAY)), () => undefined)
  const prefs = AsyncResult.getOrElse(useAtomValue(preferencesAtom), () => undefined)
  const routines = useReading(routinesAtom).items
  const update = useMutation(mutations.updateRoutine)
  const [drag, setDrag] = useState<Drag>()
  // The half hour under the pointer on an empty slot (where a click would start a new routine), drawn dotted with
  // its time inside.
  const [hover, setHover] = useState<{ day: number; minutes: number }>()
  const hoverAt = (day: number) => (e: PointerEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).closest("[data-week-slot]")) return setHover(undefined)
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    const minutes = FIRST_HOUR * 60 + Math.floor(y / (HOUR_PX / 2)) * 30
    if (hover?.day !== day || hover.minutes !== minutes) setHover({ day, minutes })
  }
  const dragged = useRef(false) // the press that ends a drag isn't a click
  const byId = new Map<string, Routine>(routines.map((r) => [r.id, r]))
  const profile = prefs?.timeProfile
  const runs = week?.runs ?? []
  const blockOf = (run: RoutineRun): Block | undefined => {
    const r = byId.get(run.routineId)
    if (!r || !run.outcome) return undefined
    return { key: run.id, day: Math.floor((run.createdAt - from) / DAY), minutes: minutesOf(run.createdAt), title: r.name, meta: run.summary || t(`routines.runs.outcome.${run.outcome}`), look: run.outcome, open: run.version != null ? { view: "routine-run", id: r.id, runId: run.id } : { view: "chat", id: r.chatId } }
  }
  const blocks: Block[] = [
    ...runs.map(blockOf).filter((b): b is Block => !!b),
    ...(week?.planned ?? []).map((p, i) => ({ key: `p${i}`, day: Math.floor((p.at - from) / DAY), minutes: minutesOf(p.at), title: byId.get(p.routineId)?.name ?? "", meta: t("routines.legend.planned"), look: "planned" as const, open: plannedOpen(byId.get(p.routineId)), routine: byId.get(p.routineId) }))
  ]
  const today = Math.floor((Date.now() - from) / DAY)
  const quiet = profile?.quietHours
  // Where a drag lands: whole days sideways, SNAP minutes up or down, kept inside the week and the shown hours.
  const landing = (b: Block, d: Drag) => {
    const day = Math.min(6, Math.max(0, b.day + Math.round(d.dx / d.width)))
    const minutes = Math.min((LAST_HOUR - 1) * 60, Math.max(FIRST_HOUR * 60, b.minutes + Math.round(((d.dy / HOUR_PX) * 60) / SNAP) * SNAP))
    return { day, minutes }
  }
  const startDrag = (b: Block) => (e: PointerEvent<HTMLDivElement>) => {
    if (!b.routine?.cron || !moveCron(b.routine.cron, 0, 0) || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ key: b.key, x: e.clientX, y: e.clientY, dx: 0, dy: 0, width: e.currentTarget.parentElement?.clientWidth ?? 100 })
  }
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => drag && setDrag({ ...drag, dx: e.clientX - drag.x, dy: e.clientY - drag.y })
  const endDrag = (b: Block) => () => {
    const d = drag
    setDrag(undefined)
    if (!d || d.key !== b.key || !b.routine?.cron) return
    dragged.current = Math.abs(d.dx) >= 4 || Math.abs(d.dy) >= 4
    if (!dragged.current) return
    const to = landing(b, d)
    const cron = moveCron(b.routine.cron, new Date(from + to.day * DAY).getDay(), to.minutes)
    if (cron && cron !== b.routine.cron) void update({ params: { id: b.routine.id }, payload: { cron }, reactivityKeys: ["routines"] })
  }
  const done = runs.filter((r) => r.state === "done")
  const needs = done.filter((r) => r.outcome === "needs" && !r.readAt)
  const range = `${new Date(from).toLocaleDateString(locale(), { month: "short", day: "numeric" })} – ${new Date(from + 6 * DAY).toLocaleDateString(locale(), { month: "short", day: "numeric", year: "numeric" })}`
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-1">
          <IconButton label={t("routines.prevWeek")} onPress={() => setOffset((o) => o - 1)}>
            <ChevronLeft />
          </IconButton>
          <IconButton label={t("routines.nextWeek")} onPress={() => setOffset((o) => o + 1)}>
            <ChevronRight />
          </IconButton>
          <span className="ml-1 font-medium">{range}</span>
          {offset !== 0 && (
            <Button size="sm" variant="secondary" className="ml-2" onPress={() => setOffset(0)}>
              {t("routines.thisWeek")}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          <span className="flex items-center gap-1.5"><Dot tone="warning" />{t("routines.legend.needs")}</span>
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-fg" />{t("routines.legend.something")}</span>
          <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full border border-dim" />{t("routines.legend.nothing")}</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 rounded-sm border border-dashed border-dim" />{t("routines.legend.planned")}</span>
          {profile && <span className="flex items-center gap-1.5"><span className="w-3 border-t border-dotted border-strong" />{t("routines.legend.dayStart")}</span>}
        </div>
        {profile && (
          <span className="ml-auto text-sm text-dim">
            {[t("routines.dayStartsAround", { time: hm(profile.dayStartMinutes) }), quiet && t("routines.quietFromTo", { from: quiet.from, to: quiet.to })].filter(Boolean).join(" · ")}{" "}
            <Button size="sm" variant="ghost" onPress={() => go({ view: "settings", tab: "general" })}>
              {t("routines.change")}
            </Button>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 overflow-x-auto rounded-card border border-subtle bg-surface" style={{ flex: "999 1 40rem" }}>
          <div className="grid min-w-180" style={{ gridTemplateColumns: "3.25rem repeat(7, minmax(0, 1fr))" }}>
            <div className="h-11 border-b border-subtle" />
            {DAYS.map((d) => {
              const date = new Date(from + d * DAY)
              return (
                <div key={`head-${d}`} className={cx("flex h-11 items-center justify-center gap-1.5 border-b border-l border-subtle text-sm", d === today ? "text-fg" : "text-muted")}>
                  <span>{date.toLocaleDateString(locale(), { weekday: "short" })}</span>
                  <span className={cx("flex size-5.5 items-center justify-center rounded-full font-semibold", d === today ? "bg-accent text-on-accent" : d > 4 ? "text-dim" : "text-fg")}>{date.getDate()}</span>
                </div>
              )
            })}
            <div className="relative" style={{ height: (LAST_HOUR - FIRST_HOUR) * HOUR_PX }}>
              {hours.map((h) => (
                <span key={h} className="absolute right-2 text-xs text-dim tabular-nums" style={{ top: h === FIRST_HOUR ? 2 : (h - FIRST_HOUR) * HOUR_PX - 7 }}>
                  {hm(h * 60)}
                </span>
              ))}
            </div>
            {DAYS.map((d) => (
              <div key={`col-${d}`} onPointerMove={onCreate && hoverAt(d)} onPointerLeave={() => setHover(undefined)} className={cx("relative border-l border-subtle", d > 4 && "bg-canvas")} style={{ height: (LAST_HOUR - FIRST_HOUR) * HOUR_PX }}>
                {hours.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-subtle/50" style={{ top: (h - FIRST_HOUR) * HOUR_PX }} />
                ))}
                {onCreate &&
                  hours.map((h) => {
                    const weekday = new Date(from + d * DAY).getDay()
                    const day = new Date(from + d * DAY).toLocaleDateString(locale(), { weekday: "long" })
                    return (
                      <Button
                        key={`slot-${h}`}
                        variant="ghost"
                        data-week-slot=""
                        aria-label={t("routines.newAt", { day, time: hm(h * 60) })}
                        onPress={(e) => onCreate({ weekday, minutes: h * 60 + (e.y >= HOUR_PX / 2 ? 30 : 0) })}
                        className="absolute inset-x-0 h-auto rounded-none p-0 hover:bg-transparent data-hovered:bg-transparent data-pressed:bg-transparent"
                        style={{ top: (h - FIRST_HOUR) * HOUR_PX, height: HOUR_PX }}
                      />
                    )
                  })}
                {hover?.day === d && !drag && (
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-1 flex items-start rounded-md border border-dashed border-strong px-1.5 pt-0.5 text-xs text-muted tabular-nums" style={{ top: topOf(hover.minutes), height: HOUR_PX / 2 }}>
                    {hm(hover.minutes)}
                  </div>
                )}
                {quiet && <QuietBands from={toMinutes(quiet.from)} to={toMinutes(quiet.to)} />}
                {profile && d < 5 && <div className="absolute inset-x-0 border-t border-dotted border-strong" style={{ top: topOf(profile.dayStartMinutes) }} />}
                {lanesOf(blocks.filter((b) => b.day === d), (BLOCK_PX / HOUR_PX) * 60).map((b) => {
                  const style = { top: topOf(b.minutes), height: BLOCK_PX, left: 4 + b.lane * CASCADE_PX, right: 4, zIndex: b.lane + 1 }
                  const body = (
                    <>
                      <span className="w-full truncate font-medium">{b.title}</span>
                      <span className="w-full truncate opacity-80">{b.meta}</span>
                    </>
                  )
                  const box = "absolute flex h-auto min-w-0 flex-col items-start justify-start gap-0 overflow-hidden rounded-md px-1.5 py-1 text-left text-xs shadow-sm"
                  const movable = !!b.routine?.cron && !!moveCron(b.routine.cron, 0, 0)
                  if (movable) {
                    const dragging = drag?.key === b.key ? drag : undefined
                    const to = dragging && landing(b, dragging)
                    return (
                      <Tooltip key={b.key} content={`${b.title} · ${t("routines.dragHint")}`}>
                        <div
                          onPointerDownCapture={startDrag(b)}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag(b)}
                          onPointerCancel={() => setDrag(undefined)}
                          className={cx("absolute cursor-grab touch-none select-none", dragging && "cursor-grabbing opacity-90")}
                          style={{ ...style, ...(dragging && to && { transform: `translate(${(to.day - b.day) * dragging.width}px, ${topOf(to.minutes) - topOf(b.minutes)}px)`, zIndex: 50 }) }}
                        >
                          <Button
                            variant="ghost"
                            aria-label={`${b.title}: ${b.meta}. ${t("routines.dragHint")}`}
                            onPress={() => {
                              const wasDrag = dragged.current
                              dragged.current = false
                              if (!wasDrag && b.open) go(b.open)
                            }}
                            className={cx(box, "inset-0 cursor-grab", LOOK[b.look], dragging && "ring-2 ring-accent")}
                          >
                            {dragging && to ? (
                              <>
                                <span className="w-full truncate font-medium">{b.title}</span>
                                <span className="w-full truncate tabular-nums">{`${new Date(from + to.day * DAY).toLocaleDateString(locale(), { weekday: "short" })} ${hm(to.minutes)}`}</span>
                              </>
                            ) : (
                              body
                            )}
                          </Button>
                        </div>
                      </Tooltip>
                    )
                  }
                  return (
                    <Tooltip key={b.key} content={`${b.title}: ${b.meta}`}>
                      <Button variant="ghost" aria-label={`${b.title}: ${b.meta}`} onPress={() => b.open && go(b.open)} className={cx(box, LOOK[b.look], "hover:z-40")} style={style}>
                        {body}
                      </Button>
                    </Tooltip>
                  )
                })}
                {d === today && <div className="absolute inset-x-0 border-t border-accent-text" style={{ top: topOf(minutesOf(Date.now())) }} />}
              </div>
            ))}
          </div>
        </div>

        <aside className="flex min-w-60 flex-1 basis-64 flex-col gap-5 xl:max-w-80">
          {needs.length > 0 && (
            <Section title={t("routines.sideNeeds", { count: needs.length })}>
              <Rows>
                {needs.map((run) => {
                  const r = byId.get(run.routineId)
                  return <ListRow key={run.id} label={run.summary} title={run.summary} hint={r?.name} onPress={() => r && go(run.version != null ? { view: "routine-run", id: r.id, runId: run.id } : { view: "chat", id: r.chatId })} />
                })}
              </Rows>
            </Section>
          )}
          <Section title={t("routines.thisWeekTitle")}>
            <Rows>
              <Stat label={t("routines.stats.runs")} value={String(done.length)} />
              <Stat label={t("routines.stats.told")} value={String(done.filter((r) => r.deliveredAt).length)} />
              <Stat label={t("routines.stats.checked")} value={String(done.filter((r) => r.outcome === "nothing" && !r.turnId).length)} />
              <Stat label={t("routines.stats.cost")} value={`$${done.reduce((n, r) => n + (r.cost ?? 0), 0).toFixed(2)}`} />
            </Rows>
          </Section>
        </aside>
      </div>
    </div>
  )
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between py-2.5">
    <span className="text-muted">{label}</span>
    <span className="tabular-nums">{value}</span>
  </div>
)

// Quiet hours on one day's column; a window across midnight is two bands (evening and morning).
function QuietBands({ from, to }: { from: number; to: number }) {
  const top = FIRST_HOUR * 60
  const end = LAST_HOUR * 60
  const spans = from < to ? [[from, to]] : [[from, end], [top, to]]
  return (
    <>
      {spans.map(([a, b]) => {
        const s = Math.max(a!, top)
        const e = Math.min(b!, end)
        if (e <= s) return null
        return <div key={a} aria-hidden="true" className="absolute inset-x-0 bg-canvas/60" style={{ top: ((s - top) / 60) * HOUR_PX, height: ((e - s) / 60) * HOUR_PX }} />
      })}
    </>
  )
}
