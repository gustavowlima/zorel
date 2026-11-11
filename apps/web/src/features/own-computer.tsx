// An agent's own computer (spec 009): where it runs commands. None (this computer, inside its sandbox and access
// level), an isolated Linux container (Podman first, Docker as the fallback) where it installs and runs anything, or
// this computer without a sandbox (Full access). The Linux one shows what it's doing now (off, getting its system the
// first time, starting, running), the folders of this computer lent to it, and Start, Open folder, Restart and Erase.
import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { t } from "@zorel/i18n"
import { useEffect, useState } from "react"
import { computerAtom, computerStateAtom, mutations, useMutation } from "../client.ts"
import { Button, ConfirmButton, Folder, FolderOpen, IconButton, Input, Plus, RefreshCw, Segmented, Server, SettingRow, Tag, X } from "@/ui"

type Choice = "none" | "container" | "host"
const pickFolder = (window as { zorelDesktop?: { pickFolder?: (start?: string) => Promise<string | null> } }).zorelDesktop?.pickFolder

export function OwnComputer({
  value,
  onChange,
  lent,
  onLent,
  agentId
}: {
  value: Choice
  onChange: (v: Choice) => void
  lent: ReadonlyArray<string>
  onLent: (paths: ReadonlyArray<string>) => void
  agentId: string | undefined // a saved agent: its computer can be started, opened, restarted and erased
}) {
  const status = AsyncResult.getOrElse(useAtomValue(computerAtom), () => undefined)
  const engine = status?.engine === "podman" ? "Podman" : status?.engine === "docker" ? "Docker" : undefined
  const HINTS: Readonly<Record<Choice, string>> = {
    none: t("computer.ownNone"),
    container: engine ? t("computer.ownReady", { engine }) : (status?.problem ?? t("computer.ownChecking")),
    host: t("computer.ownHost")
  }
  const warn = value === "host" || (value === "container" && !!status && !status.engine)
  return (
    <div className="flex flex-col">
      <SettingRow icon={<Server />} title={t("computer.own")} hint={warn ? <span className="text-warning">{HINTS[value]}</span> : HINTS[value]}>
        <Segmented
          label={t("computer.own")}
          value={value}
          onChange={onChange}
          options={[
            { id: "none", label: t("agent.perm.level.none") },
            { id: "container", label: t("computer.ownContainer") },
            { id: "host", label: t("computer.ownHostLabel") }
          ]}
        />
      </SettingRow>
      {value === "container" && !!status?.engine && (
        <div className="mb-3 ml-12 flex flex-col gap-3 border-l border-subtle pl-4">
          {agentId && <ComputerNow agentId={agentId} />}
          <LentFolders value={lent} onChange={onLent} />
        </div>
      )}
    </div>
  )
}

// What the agent's computer is doing, followed every few seconds while it changes, and what can be done with it.
const TONE: Readonly<Record<string, string>> = { running: "text-success", pulling: "text-warning", starting: "text-warning", unavailable: "text-danger" }
function ComputerNow({ agentId }: { agentId: string }) {
  const atom = computerStateAtom(agentId)
  const now = AsyncResult.getOrElse(useAtomValue(atom), () => undefined)
  const refresh = useAtomRefresh(atom)
  const start = useMutation(mutations.computerStart)
  const restart = useMutation(mutations.computerRestart)
  const open = useMutation(mutations.computerOpen)
  const erase = useMutation(mutations.eraseComputer)
  const [busy, setBusy] = useState(false)
  const changing = now?.state === "pulling" || now?.state === "starting" || busy
  useEffect(() => {
    if (!changing) return
    const timer = setInterval(refresh, 2500)
    return () => clearInterval(timer)
  }, [changing, refresh])
  const act = (run: () => Promise<unknown>) => {
    setBusy(true)
    void run().finally(() => {
      setBusy(false)
      refresh()
    })
  }
  if (!now) return null
  const off = now.state === "off" || now.state === "stopped"
  return (
    <div className="flex flex-col gap-2 pt-1">
      <p className="flex items-center gap-2 text-sm">
        <Tag>
          <span className={TONE[now.state]}>{t(`computer.state.${now.state}`)}</span>
        </Tag>
        <span className="text-muted">{now.problem ?? t(`computer.stateHint.${now.state}`)}</span>
      </p>
      <span className="flex flex-wrap gap-1.5">
        {off && (
          <Button size="sm" variant="secondary" isPending={busy} onPress={() => act(() => start({ params: { id: agentId } }))}>
            {t("computer.start")}
          </Button>
        )}
        <Button size="sm" variant="ghost" onPress={() => void open({ params: { id: agentId } })}>
          <FolderOpen />
          {t("computer.openFolder")}
        </Button>
        {(now.state === "running" || now.state === "stopped") && (
          <Button size="sm" variant="ghost" isPending={busy} onPress={() => act(() => restart({ params: { id: agentId } }))}>
            <RefreshCw />
            {t("computer.restart")}
          </Button>
        )}
        {now.state !== "off" && (
          <ConfirmButton size="sm" variant="ghost" title={t("computer.eraseTitle")} description={t("computer.eraseBody")} confirmLabel={t("computer.erase")} onConfirm={() => act(() => erase({ params: { id: agentId }, reactivityKeys: ["computer"] }))}>
            {t("computer.erase")}
          </ConfirmButton>
        )}
      </span>
    </div>
  )
}

// The folders of this computer lent to it, besides the chat's project folder. The desktop app picks one with the
// system's dialog; elsewhere the path is typed. The server checks each (inside home, not hidden or Zorel's own).
function LentFolders({ value, onChange }: { value: ReadonlyArray<string>; onChange: (paths: ReadonlyArray<string>) => void }) {
  const [typed, setTyped] = useState("")
  const add = (path: string) => {
    const p = path.trim()
    if (p && !value.includes(p)) onChange([...value, p])
    setTyped("")
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="flex flex-1 flex-col">
          <span className="text-sm font-medium">{t("computer.lentTitle")}</span>
          <span className="text-sm text-muted">{t("computer.lentHint")}</span>
        </span>
        {pickFolder && (
          <Button size="sm" variant="secondary" onPress={() => void pickFolder().then((p) => p && add(p))}>
            <Plus />
            {t("computer.lend")}
          </Button>
        )}
      </div>
      {value.map((path) => (
        <span key={path} className="flex items-center gap-2 rounded-control bg-surface px-2.5 py-1.5 text-sm">
          <Folder className="size-4 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
          <IconButton label={t("computer.unlend", { path })} size="xs" onPress={() => onChange(value.filter((x) => x !== path))}>
            <X className="size-3.5" />
          </IconButton>
        </span>
      ))}
      {!pickFolder && (
        <span className="flex gap-2">
          <Input size="sm" className="flex-1" placeholder={t("computer.lentPath")} aria-label={t("computer.lend")} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => {
              if (e.key !== "Enter") return
              e.preventDefault()
              add(typed)
            }} />
          <Button size="sm" variant="secondary" isDisabled={!typed.trim()} onPress={() => add(typed)}>
            {t("computer.lend")}
          </Button>
        </span>
      )}
    </div>
  )
}
