// Cmd+K: go anywhere and find anything. With nothing typed, the places and actions; typing
// narrows them and the chats by title, and from 2 characters also searches every message (the server).
import type { SearchHit } from "@zorel/contracts"
import { formatAge, t } from "@zorel/i18n"
import { useEffect, useState } from "react"
import { agentsAtom, chatsAtom, projectsAtom, useList } from "../client.ts"
import { chatTitle } from "../labels.ts"
import { go } from "../state.ts"
import { AlarmClock, BookOpen, Bot, ChartColumn, type CommandItem, CommandPalette, Folder, Inbox, MessageCircle, Plus, Search, Settings, SquarePen } from "@/ui"

const has = (text: string, q: string) => text.toLowerCase().includes(q.toLowerCase())

export function Palette({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<ReadonlyArray<SearchHit>>([])
  const chats = useList(chatsAtom)
  const projects = useList(projectsAtom)
  const agents = useList(agentsAtom)

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    addEventListener("keydown", on)
    return () => removeEventListener("keydown", on)
  }, [])
  useEffect(() => {
    if (!open) setQuery("")
  }, [open])
  // Messages: from 2 characters, a moment after typing stops.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return setHits([])
    const id = setTimeout(() => {
      fetch(`/api/search?${new URLSearchParams({ q })}`)
        .then((r) => (r.ok ? (r.json() as Promise<SearchHit[]>) : []))
        .then(setHits, () => setHits([]))
    }, 180)
    return () => clearTimeout(id)
  }, [query])

  const q = query.trim()
  const places: CommandItem[] = [
    { id: "new-chat", label: t("nav.newChat"), text: t("nav.newChat"), icon: <SquarePen />, onAction: () => go({ view: "home" }) },
    { id: "inbox", label: t("nav.needsYou"), text: t("nav.needsYou"), icon: <Inbox />, onAction: () => go({ view: "inbox" }) },
    { id: "agents", label: t("nav.agents"), text: t("nav.agents"), icon: <Bot />, onAction: () => go({ view: "agents" }) },
    { id: "new-agent", label: t("nav.newAgent"), text: t("nav.newAgent"), icon: <Plus />, onAction: () => go({ view: "new-agent", projectId: null }) },
    { id: "routines", label: t("nav.routines"), text: t("nav.routines"), icon: <AlarmClock />, onAction: () => go({ view: "routines" }) },
    { id: "knowledge", label: t("nav.knowledge"), text: t("nav.knowledge"), icon: <BookOpen />, onAction: () => go({ view: "knowledge" }) },
    { id: "usage", label: t("nav.usage"), text: t("nav.usage"), icon: <ChartColumn />, onAction: () => go({ view: "usage" }) },
    { id: "settings", label: t("nav.settings"), text: t("nav.settings"), icon: <Settings />, onAction: () => go({ view: "settings", tab: "general" }) },
    { id: "sidebar", label: t("palette.toggleSidebar"), text: t("palette.toggleSidebar"), icon: <MessageCircle />, onAction: onToggleSidebar }
  ].filter((i) => !q || has(i.text, q))
  const chatItems: CommandItem[] = chats
    .filter((c) => q && has(chatTitle(c), q))
    .slice(0, 8)
    .map((c) => ({ id: `chat:${c.id}`, label: chatTitle(c), text: chatTitle(c), hint: formatAge(c.lastAt ?? c.createdAt), icon: <MessageCircle />, onAction: () => go({ view: "chat", id: c.id }) }))
  const projectItems: CommandItem[] = projects
    .filter((p) => q && has(p.name, q))
    .slice(0, 5)
    .map((p) => ({ id: `project:${p.id}`, label: p.name, text: p.name, icon: <Folder />, onAction: () => go({ view: "project", id: p.id, tab: "overview" }) }))
  const agentItems: CommandItem[] = agents
    .filter((a) => q && (has(a.name, q) || has(a.title, q)))
    .slice(0, 5)
    .map((a) => ({ id: `agent:${a.id}`, label: a.name, text: a.name, hint: a.title || undefined, icon: <Bot />, onAction: () => go({ view: "agent", id: a.id }) }))
  const messageItems: CommandItem[] = hits.map((h) => {
    const chat = chats.find((c) => c.id === h.chatId)
    return { id: `msg:${h.messageId}`, label: h.snippet, text: h.snippet, hint: `${chat ? chatTitle(chat) : ""} · ${formatAge(h.at)}`, icon: <Search />, onAction: () => go({ view: "chat", id: h.chatId }) }
  })

  return (
    <CommandPalette
      isOpen={open}
      onOpenChange={setOpen}
      query={query}
      onQuery={setQuery}
      label={t("palette.label")}
      placeholder={t("palette.placeholder")}
      empty={t("palette.empty")}
      sections={[
        { id: "chats", title: t("nav.chats"), items: chatItems },
        { id: "messages", title: t("palette.messages"), items: messageItems },
        { id: "projects", title: t("nav.projects"), items: projectItems },
        { id: "agents", title: t("nav.agents"), items: agentItems },
        { id: "go", title: t("palette.go"), items: places }
      ]}
    />
  )
}
