// Memory › Map: the memory's map drawn as points and links (what the facts are about and how those relate), from
// GET /api/memories/map. A small force simulation on a canvas, seeded on a spiral so the same map lands the same way;
// drag the background to pan, a point to pull its neighbours, wheel or the buttons to zoom; hovering lights a
// point's links and names them. A point opens a panel with the facts that prove it and what it's linked to. A point
// whose facts all wait for review pulses. A bridge the person made to another project's point is dashed, and that
// point is hollow, named with its project.
import { useAtomValue } from "@effect/atom-react"
import type { MapPoint, Memory, MemoryMap as MapData } from "@zorel/contracts"
import { AsyncResult } from "effect/reactivity"
import { formatAge, t } from "@zorel/i18n"
import { useEffect, useMemo, useRef, useState } from "react"
import { agentsAtom, chatsAtom, memoriesAtom, memoryMapAtom, mutations, projectsAtom, useList, useMutation } from "../client.ts"
import { chatTitle, scopeLabel } from "../labels.ts"
import { go } from "../state.ts"
import { Brain, Button, cx, EmptyState, Link2, Maximize2, Menu, MenuItem, Minus, Plus, Rows, Unlink, X } from "@/ui"

type Kind = MapPoint["type"]
const NO_MAP: MapData = { points: [], links: [] }
const KINDS: ReadonlyArray<Kind> = ["project", "agent", "concept", "subject"]
// Identity colours (the agents' palette, never a state colour); the project is the accent text.
const COLOR: Record<Kind, string> = { project: "--z-accent-text", agent: "--z-agent-1", concept: "--z-agent-2", subject: "--z-agent-4" }

// A bridge's far end: a point of a project this map doesn't show (all maps: none is far).
const far = (p: { scope: string }, scope: string) => !!scope && p.scope !== scope && p.scope !== "user"

interface Node extends MapPoint {
  x: number
  y: number
  vx: number
  vy: number
}

export function MemoryMap({ scope }: { scope: string }) {
  const map = AsyncResult.getOrElse(useAtomValue(memoryMapAtom(scope)), () => NO_MAP)
  const [hidden, setHidden] = useState<ReadonlySet<Kind>>(new Set())
  const [selected, setSelected] = useState<string>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const nodes = useRef<Node[]>([])
  const view = useRef({ x: 0, y: 0, k: 1 })
  const hover = useRef<Node | undefined>(undefined)
  const { points, links } = map
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const labels = useMemo(() => Object.fromEntries([...new Set(points.map((p) => p.scope))].map((s) => [s, scopeLabel(s, projects, agents)])), [points, projects, agents])

  // Keep each point's place across refreshes; a new one starts on the spiral (deterministic).
  useMemo(() => {
    const was = new Map(nodes.current.map((n) => [n.id, n]))
    nodes.current = points.map((p, i) => {
      const old = was.get(p.id)
      const a = i * 2.39996
      const r = 40 + 26 * Math.sqrt(i)
      return old ? { ...old, ...p } : { ...p, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 }
    })
  }, [points])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext("2d")!
    const css = getComputedStyle(document.documentElement)
    const text = css.getPropertyValue("--z-text-secondary").trim()
    const dim = css.getPropertyValue("--z-text-dim").trim()
    const colour = (k: Kind) => css.getPropertyValue(COLOR[k]).trim() || dim
    let frame = 0
    let dragging: Node | undefined
    let panning: { x: number; y: number; vx: number; vy: number } | undefined
    let moved = false
    const size = () => {
      const r = c.getBoundingClientRect()
      c.width = r.width * devicePixelRatio
      c.height = r.height * devicePixelRatio
    }
    const toScreen = (n: Node) => {
      const v = view.current
      return [(n.x - v.x) * v.k + c.width / devicePixelRatio / 2, (n.y - v.y) * v.k + c.height / devicePixelRatio / 2] as const
    }
    const shown = () => nodes.current.filter((n) => !hidden.has(n.type))
    const byId = (id: string) => nodes.current.find((n) => n.id === id)
    const degree = (id: string) => links.filter((l) => l.a === id || l.b === id).length
    const step = (vis: Node[]) => {
      for (const a of vis)
        for (const b of vis) {
          if (a === b) continue
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d2 = dx * dx + dy * dy + 0.01
          const f = 1800 / d2 / Math.sqrt(d2)
          a.vx += dx * f
          a.vy += dy * f
        }
      const ids = new Set(vis.map((n) => n.id))
      for (const l of links) {
        if (!ids.has(l.a) || !ids.has(l.b)) continue
        const a = byId(l.a)!
        const b = byId(l.b)!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy) || 1
        const f = (d - 95) * 0.02
        a.vx += (dx / d) * f
        a.vy += (dy / d) * f
        b.vx -= (dx / d) * f
        b.vy -= (dy / d) * f
      }
      for (const n of vis) {
        n.vx -= n.x * 0.004
        n.vy -= n.y * 0.004
        if (n !== dragging) {
          n.x += n.vx
          n.y += n.vy
        }
        n.vx *= 0.82
        n.vy *= 0.82
      }
    }
    const draw = () => {
      const vis = shown()
      const ids = new Set(vis.map((n) => n.id))
      step(vis)
      step(vis)
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      ctx.clearRect(0, 0, c.width, c.height)
      // The dotted ground, moving with the view.
      const w = c.width / devicePixelRatio
      const h = c.height / devicePixelRatio
      const gap = 28 * view.current.k
      const ox = ((-view.current.x * view.current.k + w / 2) % gap + gap) % gap
      const oy = ((-view.current.y * view.current.k + h / 2) % gap + gap) % gap
      ctx.fillStyle = dim
      ctx.globalAlpha = 0.25
      for (let x = ox; x < w; x += gap) for (let y = oy; y < h; y += gap) ctx.fillRect(x, y, 1, 1)
      ctx.globalAlpha = 1
      const focus = hover.current ?? (selected ? byId(selected) : undefined)
      const near = focus ? new Set([focus.id, ...links.filter((l) => l.a === focus.id || l.b === focus.id).map((l) => (l.a === focus.id ? l.b : l.a))]) : undefined
      for (const l of links) {
        if (!ids.has(l.a) || !ids.has(l.b)) continue
        const [x1, y1] = toScreen(byId(l.a)!)
        const [x2, y2] = toScreen(byId(l.b)!)
        const lit = near?.has(l.a) && near.has(l.b)
        ctx.strokeStyle = l.bridge ? colour("project") : text
        ctx.globalAlpha = lit ? 0.6 : near ? 0.06 : l.bridge ? 0.45 : 0.18
        ctx.lineWidth = l.bridge ? 1.5 : 1
        ctx.setLineDash(l.bridge ? [5, 4] : [])
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        ctx.setLineDash([])
        if (lit && l.rel && view.current.k > 0.8) {
          ctx.globalAlpha = 0.6
          ctx.fillStyle = text
          ctx.font = "11px Inter Variable, sans-serif"
          ctx.textAlign = "center"
          ctx.fillText(l.rel, (x1 + x2) / 2, (y1 + y2) / 2 - 4)
        }
      }
      for (const n of vis) {
        const [x, y] = toScreen(n)
        const r = (5 + Math.sqrt(degree(n.id)) * 2.4) * Math.min(1.4, Math.max(0.7, view.current.k))
        ctx.globalAlpha = near && !near.has(n.id) ? 0.25 : 1
        if (n.pending === n.facts) {
          const p = (Date.now() / 900) % 1
          ctx.strokeStyle = colour("project")
          ctx.globalAlpha = (near && !near.has(n.id) ? 0.25 : 1) * (1 - p)
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(x, y, r + 3 + p * 9, 0, 7)
          ctx.stroke()
          ctx.globalAlpha = near && !near.has(n.id) ? 0.25 : 1
        }
        ctx.beginPath()
        ctx.arc(x, y, r, 0, 7)
        if (far(n, scope)) {
          ctx.strokeStyle = colour(n.type)
          ctx.lineWidth = 2
          ctx.stroke()
        } else {
          ctx.fillStyle = colour(n.type)
          ctx.fill()
        }
        if (selected === n.id) {
          ctx.strokeStyle = text
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(x, y, r + 3, 0, 7)
          ctx.stroke()
        }
        ctx.fillStyle = near && !near.has(n.id) ? dim : text
        ctx.font = `${n.type === "project" ? 600 : 400} 12px Inter Variable, sans-serif`
        ctx.textAlign = "center"
        ctx.fillText(n.name, x, y + r + 15)
        if (far(n, scope) && labels[n.scope]) {
          ctx.fillStyle = dim
          ctx.font = "11px Inter Variable, sans-serif"
          ctx.fillText(labels[n.scope]!, x, y + r + 29)
        }
      }
      ctx.globalAlpha = 1
      frame = requestAnimationFrame(draw)
    }
    const at = (e: MouseEvent) => {
      const r = c.getBoundingClientRect()
      return shown().find((n) => {
        const [x, y] = toScreen(n)
        return Math.hypot(x - (e.clientX - r.left), y - (e.clientY - r.top)) < 14
      })
    }
    const down = (e: MouseEvent) => {
      moved = false
      dragging = at(e)
      if (!dragging) panning = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y }
    }
    const move = (e: MouseEvent) => {
      const v = view.current
      if (dragging) {
        const r = c.getBoundingClientRect()
        dragging.x = (e.clientX - r.left - r.width / 2) / v.k + v.x
        dragging.y = (e.clientY - r.top - r.height / 2) / v.k + v.y
        moved = true
      } else if (panning) {
        v.x = panning.vx - (e.clientX - panning.x) / v.k
        v.y = panning.vy - (e.clientY - panning.y) / v.k
        moved = true
      } else if (e.target === c) {
        hover.current = at(e)
        c.style.cursor = hover.current ? "pointer" : "grab"
      }
    }
    const up = (e: MouseEvent) => {
      if (dragging && !moved) setSelected(dragging.id)
      if (panning && !moved && e.target === c) setSelected(undefined)
      dragging = undefined
      panning = undefined
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      view.current.k = Math.min(3, Math.max(0.3, view.current.k * (e.deltaY < 0 ? 1.1 : 0.9)))
    }
    size()
    window.addEventListener("resize", size)
    c.addEventListener("mousedown", down)
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
    c.addEventListener("wheel", wheel, { passive: false })
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", size)
      c.removeEventListener("mousedown", down)
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
      c.removeEventListener("wheel", wheel)
    }
  }, [hidden, selected, links, labels, scope])

  const point = points.find((p) => p.id === selected)
  const zoom = (f: number) => {
    view.current.k = Math.min(3, Math.max(0.3, view.current.k * f))
  }
  if (!points.length)
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState icon={<Brain />} title={t("memory.mapEmpty")} hint={t("memory.mapEmptyHint")} />
      </div>
    )
  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative min-w-0 flex-1">
        <canvas ref={canvas} className="absolute inset-0 size-full cursor-grab" role="img" aria-label={t("memory.mapLabel", { points: points.length, links: links.length })} />
        <div className="absolute top-3 left-4 flex gap-1.5">
          {KINDS.map((k) => (
            <Button
              key={k}
              size="sm"
              variant="secondary"
              aria-pressed={!hidden.has(k)}
              className={cx("rounded-full", hidden.has(k) && "opacity-45")}
              onPress={() => setHidden((h) => (h.has(k) ? new Set([...h].filter((x) => x !== k)) : new Set([...h, k])))}
            >
              <span aria-hidden="true" className="size-2 rounded-full" style={{ background: `var(${COLOR[k]})` }} />
              {t(`memory.kind.${k}`)}
            </Button>
          ))}
        </div>
        <div className="absolute right-4 bottom-4 flex overflow-hidden rounded-control border border-strong bg-surface">
          <Button size="sm" variant="ghost" aria-label={t("memory.zoomOut")} onPress={() => zoom(1 / 1.2)}>
            <Minus />
          </Button>
          <Button size="sm" variant="ghost" aria-label={t("memory.zoomFit")} onPress={() => (view.current = { x: 0, y: 0, k: 1 })}>
            <Maximize2 />
          </Button>
          <Button size="sm" variant="ghost" aria-label={t("memory.zoomIn")} onPress={() => zoom(1.2)}>
            <Plus />
          </Button>
        </div>
        <p className="absolute bottom-4 left-4 text-xs text-dim">{t("memory.mapCount", { points: points.length, links: links.length })}</p>
      </div>
      {point && <PointPanel point={point} points={points} links={links} labels={labels} onOpen={setSelected} onClose={() => setSelected(undefined)} />}
    </div>
  )
}

// A point's panel: the facts that prove it (where each came from), what it's linked to, and the bridges to other
// projects' points (connect / disconnect).
function PointPanel({ point, points, links, labels, onOpen, onClose }: { point: MapPoint; points: ReadonlyArray<MapPoint>; links: ReadonlyArray<MapData["links"][number]>; labels: Record<string, string>; onOpen: (id: string) => void; onClose: () => void }) {
  const memories = useList(memoriesAtom)
  const chats = useList(chatsAtom)
  const disconnect = useMutation(mutations.disconnectPoints)
  const facts = point.memoryIds.flatMap((id) => memories.filter((m) => m.id === id)) as Memory[]
  const mine = links.filter((l) => l.a === point.id || l.b === point.id)
  return (
    <aside aria-label={point.name} className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l border-subtle px-5 py-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: `var(${COLOR[point.type]})` }}>
            {t(`memory.kind.${point.type}`)}
          </span>
          <h2 className="text-lg font-semibold">{point.name}</h2>
        </div>
        <Button size="sm" variant="ghost" aria-label={t("common.close")} onPress={onClose}>
          <X />
        </Button>
      </div>
      <section className="flex flex-col gap-1.5">
        <h3 className="text-sm font-medium text-muted">{t("memory.knows")}</h3>
        <Rows>
          {facts.map((m) => {
            const chat = chats.find((c) => c.id === m.chatId)
            return (
              <div key={m.id} className="flex flex-col gap-0.5 py-2.5">
                <span className={cx("text-fg", m.state === "pending" && "text-secondary")}>{m.text}</span>
                <span className="text-sm text-dim">
                  {[m.state === "pending" ? t("memory.waitsReview") : m.origin === "manual" ? t("memory.youWrote") : t("memory.learned"), chat && chatTitle(chat), formatAge(m.createdAt)].filter(Boolean).join(" · ")}
                </span>
              </div>
            )
          })}
        </Rows>
        <div>
          <Button size="sm" variant="ghost" onPress={() => go({ view: "memory", ...(point.memoryIds.some((id) => memories.find((m) => m.id === id)?.state === "pending") ? { review: true } : {}) })}>
            {t("memory.openList")}
          </Button>
        </div>
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className="text-sm font-medium text-muted">{t("memory.linkedTo", { count: mine.length })}</h3>
        <Rows>
          {mine.map((l) => {
            const other = points.find((p) => p.id === (l.a === point.id ? l.b : l.a))
            if (!other) return null
            return (
              <Button key={`${l.a}-${l.b}-${l.rel}`} variant="ghost" onPress={() => onOpen(other.id)} className="h-auto w-full justify-start gap-2 px-0 py-2.5 font-normal">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: `var(${COLOR[other.type]})` }} />
                <span className="min-w-0 flex-1 truncate text-left text-fg">{other.name}</span>
                {l.bridge ? (
                  <span className="shrink-0 text-sm text-dim">{labels[other.scope] ?? t("memory.bridge")}</span>
                ) : (
                  l.rel && <span className="shrink-0 text-sm text-dim">{l.a === point.id ? l.rel : `← ${l.rel}`}</span>
                )}
              </Button>
            )
          })}
        </Rows>
        {mine.some((l) => l.bridge) && (
          <div className="flex flex-wrap gap-1">
            {mine
              .filter((l) => l.bridge)
              .map((l) => {
                const other = points.find((p) => p.id === (l.a === point.id ? l.b : l.a))
                return (
                  other && (
                    <Button key={`x-${other.id}`} size="sm" variant="ghost" onPress={() => void disconnect({ payload: { a: l.a, b: l.b }, reactivityKeys: ["memories"] })}>
                      <Unlink />
                      {t("memory.disconnect", { name: other.name })}
                    </Button>
                  )
                )
              })}
          </div>
        )}
        {point.scope !== "user" && <ConnectMenu point={point} linked={mine.map((l) => (l.a === point.id ? l.b : l.a))} />}
      </section>
    </aside>
  )
}

// "Connect to another project": the points of other projects' maps, the ones sharing a word with this one first.
function ConnectMenu({ point, linked }: { point: MapPoint; linked: ReadonlyArray<string> }) {
  const all = AsyncResult.getOrElse(useAtomValue(memoryMapAtom("")), () => NO_MAP).points
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)
  const connect = useMutation(mutations.connectPoints)
  const words = new Set(point.name.toLowerCase().split(/\W+/).filter((w) => w.length >= 3))
  const shares = (p: MapPoint) => p.name.toLowerCase().split(/\W+/).some((w) => words.has(w))
  const others = all
    .filter((p) => p.scope !== point.scope && p.scope !== "user" && !linked.includes(p.id))
    .sort((a, b) => Number(shares(b)) - Number(shares(a)) || b.weight - a.weight)
    .slice(0, 30)
  if (!others.length) return null
  return (
    <div>
      <Menu
        label={t("memory.connect")}
        trigger={
          <Button size="sm" variant="ghost">
            <Link2 />
            {t("memory.connect")}
          </Button>
        }
      >
        {others.map((p) => (
          <MenuItem key={p.id} onAction={() => void connect({ payload: { a: point.id, b: p.id }, reactivityKeys: ["memories"] })}>
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: `var(${COLOR[p.type]})` }} />
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            <span className="shrink-0 text-sm text-dim">{scopeLabel(p.scope, projects, agents)}</span>
          </MenuItem>
        ))}
      </Menu>
    </div>
  )
}
