// The Routines page's week (spec 012): seven days from 07:00 to 22:00, each run at its time, colored by how it
// ended (needs you, something new, nothing new), the planned ones dashed, quiet hours shaded and the line where the
// person's day usually starts. A run opens its routine's chat. Spec 018: no side panel — the week's counts sit in one
// line above the grid; the face says who ran it, the fill says how it ended (never an agent-coloured block). On a phone the grid scrolls sideways inside its box. An empty slot, clicked, starts a new routine at that
// day and time (on the hour or the half hour, by where it was clicked), like a calendar. Runs close in time cascade
// (each later one a little to the right, on top, readable; hover shows the whole line). A coming run of a simple
// schedule (a time on some days) can be dragged to another time or day: the routine's schedule moves with it.
import type { Routine, RoutineRun } from "@zorel/contracts"
import { locale, t } from "@zorel/i18n"
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { type PointerEvent, useEffect, useRef, useState } from "react"
import { agentsAtom, mutations, preferencesAtom, routineWeekAtom, useList, useMutation, useReading, routinesAtom } from "../client.ts"
import { go, type Route } from "../state.ts"
import { lanesOf, moveCron } from "./week-lanes.ts"
import { AgentAvatar, Button, ChevronLeft, ChevronRight, cn, Dot, IconButton, Tooltip } from "@/ui"
import { agentTone, hm, toMinutes } from "../labels.ts"

const DAY = 24 * 60 * 60_000
// The whole day; the grid scrolls inside its card and opens an hour before your day starts.
const FIRST_HOUR = 0
const LAST_HOUR = 24
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

// How each outcome looks on the grid. Opaque, so a block cascading over another stays readable.
const LOOK: Record<"needs" | "something" | "nothing" | "planned", string> = {
  needs: "border border-warning/50 bg-raised text-warning",
  something: "border border-strong bg-raised text-fg",
  nothing: "border border-subtle bg-surface text-dim",
  planned: "border border-dashed border-strong bg-surface text-muted"
}
const CASCADE_PX = 14 // how far each overlapping block steps right
const SNAP = 15 // minutes a drag moves by

// A planned run opens what it will run: a routine's steps (spec 013), else its chat.
const plannedOpen = (r: Routine | undefined): Route | undefined => (!r ? undefined : r.version != null ? { view: "routine-flow", id: r.id } : { view: "chat", id: r.chatId })
type Block = { key: string; day: number; minutes: number; title: string; meta: string; look: keyof typeof LOOK; open: Route | undefined; routine?: Routine | undefined; agentId?: string | undefined; routineId: string; runId?: string | undefined }
type Drag = { key: string; x: number; y: number; dx: number; dy: number; width: number; moved: boolean }


export type Slot = { weekday: number; minutes: number } // 0 = Sunday, as cron counts
// onOpen: a block was pressed (the page shows that routine, and the run when it is one); without it, the block opens
// its run or its steps.
export function RoutineWeek({ onCreate, onOpen }: { onCreate?: (slot: Slot) => void; onOpen?: (routineId: string, runId: string | undefined) => void }) {
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
  // Open on the working hours: an hour before the day starts (08:00 when it isn't known yet), once per mount.
  const scroller = useRef<HTMLDivElement>(null)
  const startMinutes = prefs?.timeProfile?.dayStartMinutes
  const placed = useRef(false)
  useEffect(() => {
    if (placed.current || !scroller.current || prefs === undefined) return
    placed.current = true
    scroller.current.scrollTop = Math.max(0, ((startMinutes ?? 8 * 60) / 60 - 1) * HOUR_PX)
  }, [prefs, startMinutes])
  const press = (b: Block) => (onOpen ? onOpen(b.routineId, b.runId) : b.open && go(b.open))
  const byId = new Map<string, Routine>(routines.map((r) => [r.id, r]))
  const agents = useList(agentsAtom)
  // Whose routine a block is: its agent's color down its left edge (identity tint); the border keeps the outcome.
  const faceOf = (b: Block) => {
    const a = agents.find((x) => x.id === b.agentId)
    return a ? <AgentAvatar id={a.id} name={a.name} tone={agentTone(a, agents)} size={16} /> : null
  }
  const profile = prefs?.timeProfile
  const runs = week?.runs ?? []
  const blockOf = (run: RoutineRun): Block | undefined => {
    const r = byId.get(run.routineId)
    if (!r || !run.outcome) return undefined
    return { key: run.id, day: Math.floor((run.createdAt - from) / DAY), minutes: minutesOf(run.createdAt), title: r.name, agentId: r.agentId, routineId: r.id, runId: run.id, meta: run.summary || t(`routines.runs.outcome.${run.outcome}`), look: run.outcome, open: run.version != null ? { view: "routine-run", id: r.id, runId: run.id } : { view: "chat", id: r.chatId } }
  }
  const blocks: Block[] = [
    ...runs.map(blockOf).filter((b): b is Block => !!b),
    ...(week?.planned ?? []).map((p, i) => ({ key: `p${i}`, day: Math.floor((p.at - from) / DAY), minutes: minutesOf(p.at), title: byId.get(p.routineId)?.name ?? "", agentId: byId.get(p.routineId)?.agentId, routineId: p.routineId, meta: t("routines.legend.planned"), look: "planned" as const, open: plannedOpen(byId.get(p.routineId)), routine: byId.get(p.routineId) }))
  ]
  const today = Math.floor((Date.now() - from) / DAY)
  const quiet = profile?.quietHours
  // Where a drag lands: whole days sideways, SNAP minutes up or down, kept inside the week and the shown hours.
  const landing = (b: Block, d: Drag) => {
    const day = Math.min(6, Math.max(0, b.day + Math.round(d.dx / d.width)))
    const minutes = Math.min((LAST_HOUR - 1) * 60, Math.max(FIRST_HOUR * 60, b.minutes + Math.round(((d.dy / HOUR_PX) * 60) / SNAP) * SNAP))
    return { day, minutes }
  }
  // A press is a click until the pointer moves 4px; only then is the pointer captured and the block dragged, so a
  // click reaches the block's button like any other.
  const startDrag = (b: Block) => (e: PointerEvent<HTMLDivElement>) => {
    if (!b.routine?.cron || !moveCron(b.routine.cron, 0, 0) || e.button !== 0) return
    setDrag({ key: b.key, x: e.clientX, y: e.clientY, dx: 0, dy: 0, width: e.currentTarget.parentElement?.clientWidth ?? 100, moved: false })
  }
  const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    const moved = drag.moved || Math.abs(dx) >= 4 || Math.abs(dy) >= 4
    if (moved && !drag.moved) e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ ...drag, dx, dy, moved })
  }
  const endDrag = (b: Block) => () => {
    const d = drag
    setDrag(undefined)
    if (!d?.moved || d.key !== b.key || !b.routine?.cron) return
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
        <span className="text-sm text-muted num">
          {done.length > 0 && [`${t("routines.stats.runs")} ${done.length}`, `${t("routines.stats.told")} ${done.filter((r) => r.deliveredAt).length}`].join(" · ")}
          {needs.length > 0 && (
            <Button size="sm" variant="ghost" className="ml-1 text-warning" onPress={() => go({ view: "inbox" })}>
              {t("routines.sideNeeds", { count: needs.length })}
            </Button>
          )}
        </span>
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
        <div ref={scroller} className="min-w-0 overflow-auto rounded-card border border-subtle bg-surface" style={{ flex: "1 1 100%", maxHeight: "calc(100vh - 13rem)" }}>
          <div className="grid min-w-180" style={{ gridTemplateColumns: "3.25rem repeat(7, minmax(0, 1fr))" }}>
            {/* The days stay on top while the hours scroll under them. */}
            <div className="sticky top-0 z-30 h-11 border-b border-subtle bg-surface" />
            {DAYS.map((d) => {
              const date = new Date(from + d * DAY)
              return (
                <div key={`head-${d}`} className={cn("sticky top-0 z-30 flex h-11 items-center justify-center gap-1.5 border-b border-l border-subtle bg-surface text-sm", d === today ? "text-fg" : "text-muted")}>
                  <span>{date.toLocaleDateString(locale(), { weekday: "short" })}</span>
                  <span className={cn("flex size-5.5 items-center justify-center rounded-full font-semibold", d === today ? "bg-accent-soft text-accent-text" : d > 4 ? "text-dim" : "text-fg")}>{date.getDate()}</span>
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
              <div key={`col-${d}`} onPointerMove={onCreate && hoverAt(d)} onPointerLeave={() => setHover(undefined)} className={cn("relative border-l border-subtle", d > 4 && "bg-canvas")} style={{ height: (LAST_HOUR - FIRST_HOUR) * HOUR_PX }}>
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
                {hover?.day === d && !drag?.moved && (
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
                      <span className="flex w-full min-w-0 items-center gap-1.5 font-medium">
                        {faceOf(b)}
                        <span className="truncate">{b.title}</span>
                      </span>
                      <span className="w-full truncate opacity-80">{b.meta}</span>
                    </>
                  )
                  const box = "absolute flex h-auto min-w-0 flex-col items-start justify-start gap-0 overflow-hidden rounded-md px-1.5 py-1 text-left text-xs"
                  const movable = !!b.routine?.cron && !!moveCron(b.routine.cron, 0, 0)
                  if (movable) {
                    const dragging = drag?.key === b.key && drag.moved ? drag : undefined
                    const to = dragging && landing(b, dragging)
                    return (
                      <Tooltip key={b.key} content={`${b.title} · ${t("routines.dragHint")}`}>
                        <div
                          onPointerDownCapture={startDrag(b)}
                          onPointerMove={moveDrag}
                          onPointerUp={endDrag(b)}
                          onPointerCancel={() => setDrag(undefined)}
                          className={cn("absolute cursor-grab touch-none select-none", dragging && "cursor-grabbing opacity-90")}
                          style={{ ...style, ...(dragging && to && { transform: `translate(${(to.day - b.day) * dragging.width}px, ${topOf(to.minutes) - topOf(b.minutes)}px)`, zIndex: 50 }) }}
                        >
                          <Button
                            variant="ghost"
                            aria-label={`${b.title}: ${b.meta}. ${t("routines.dragHint")}`}
                            onPress={() => press(b)}
                            className={cn(box, "inset-0 cursor-grab", LOOK[b.look], dragging && "ring-2 ring-accent")}
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
                      <Button variant="ghost" aria-label={`${b.title}: ${b.meta}`} onPress={() => press(b)} className={cn(box, LOOK[b.look], "hover:z-40")} style={style}>
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

      </div>
    </div>
  )
}

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
