// Connectors and MCP servers (global in Settings, or per project). Connectors: services people use most, one click
// (OAuth in the browser, or a token, or nothing). Servers: mode, on/off, test the connection and see the tools each
// mode exposes, add local (command) or remote (URL) servers. Secrets go to the system keychain.
import type { McpServer, ToolInfo } from "@zero/contracts"
import { t } from "@zero/i18n"
import { type FormEvent, useEffect, useState } from "react"
import { splitCommand } from "../labels.ts"
import { mutations, serversAtom, signedInAtom, useInvalidate, useMutation, useReading } from "../client.ts"
import { ReadingState } from "./reading.tsx"
import { Badge, Button, Check, Code, ConfirmButton, Field, IconButton, Input, Menu, MenuItem, MoreHorizontal, Plus, Section, Select, Spinner, Switch, Textarea, EmptyState, Plug, Trash2 } from "@/ui"

const MODES = ["read", "approve", "auto"] as const
const modeOptions = () => MODES.map((m) => ({ value: m, label: t(`mcp.modes.${m}`) }))
const CLS_TONE = { read: "neutral", write: "warning", sensitive: "danger" } as const

export function McpSection({ projectId }: { projectId: string | null }) {
  const reading = useReading(serversAtom)
  const all = reading.items.filter((s) => s.projectId === projectId)
  const servers = all.filter((s) => !CONNECTORS.some((c) => matches(c, s))) // connectors have their own cards
  const invalidate = useInvalidate()
  const [adding, setAdding] = useState(false)
  return (
    <div className="flex flex-col gap-8">
      {projectId === null && <Connectors servers={all} />}
      <Section
        title={projectId ? t("settings.mcp") : t("mcp.servers")}
        description={projectId ? t("mcp.projectIntro") : t("mcp.intro")}
        action={
          !adding && servers.length > 0 && (
            <Button size="sm" variant="secondary" onPress={() => setAdding(true)}>
              <Plus />
              {t("mcp.add")}
            </Button>
          )
        }
      >
        {adding && <NewServer projectId={projectId} onDone={() => setAdding(false)} />}
        <ReadingState loading={reading.loading} failed={reading.failed} onRetry={() => invalidate(["servers"])} />
        {!reading.loading && !reading.failed && servers.length === 0 && !adding && (
          <EmptyState
            icon={<Plug />}
            title={t("mcp.empty")}
            hint={t("mcp.emptyHint")}
            action={
              <Button size="sm" variant="default" onPress={() => setAdding(true)}>
                <Plus />
                {t("mcp.add")}
              </Button>
            }
          />
        )}
        {servers.length > 0 && (
          <div className="flex flex-col divide-y divide-subtle border-y border-subtle">
            {servers.map((s) => (
              <ServerRow key={s.id} server={s} />
            ))}
          </div>
        )}
      </Section>
      {/* Reference, quieter than the list. */}
      <Section title={t("mcp.modesTitle")}>
        <dl className="grid grid-cols-3 gap-x-6 gap-y-1.5 text-sm">
          {MODES.map((m) => (
            <div key={m} className="contents">
              <dt className="text-secondary">{t(`mcp.modes.${m}`)}</dt>
              <dd className="col-span-2 text-muted">{t(`mcp.modeHints.${m}`)}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  )
}

function ServerRow({ server: s }: { server: McpServer }) {
  const update = useMutation(mutations.updateServer)
  const remove = useMutation(mutations.removeServer)
  const inspect = useMutation(mutations.inspectServer)
  const [tools, setTools] = useState<{ tools: ReadonlyArray<ToolInfo>; error: string | null }>()
  const [testing, setTesting] = useState(false)
  const [failed, setFailed] = useState<string>()
  const patch = (payload: { mode?: McpServer["mode"]; enabled?: boolean }) => {
    setFailed(undefined)
    update({ params: { id: s.id }, payload, reactivityKeys: ["servers"] }).catch(() => setFailed(t("mcp.updateFailed", { name: s.name })))
  }
  const test = () => {
    setTesting(true)
    setTools(undefined)
    inspect({ params: { id: s.id } })
      .then(setTools, (e: unknown) => setTools({ tools: [], error: String(e) }))
      .finally(() => setTesting(false))
  }
  const visible = (cls: ToolInfo["cls"]) => s.mode !== "read" || cls === "read"

  return (
    <div className="flex flex-col gap-3 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">
            {s.name}
            <span className="font-normal text-muted">{` · ${s.url ? t("mcp.remote") : t("mcp.local")}`}</span>
          </span>
          <span className="truncate font-mono text-sm text-muted">{s.url || [s.command, ...s.args].join(" ")}</span>
        </span>
        <Select size="sm" className="w-48" value={s.mode} onChange={(v) => patch({ mode: v as McpServer["mode"] })} options={modeOptions()} aria-label={t("mcp.mode")} />
        <Button size="sm" variant="ghost" isPending={testing} onPress={test}>
          {testing ? <Spinner size={12} /> : null}
          {t("mcp.test")}
        </Button>
        <ConfirmButton size="sm" variant="ghost" title={t("mcp.removeTitle", { name: s.name })} confirmLabel={t("common.remove")} onConfirm={() => void remove({ params: { id: s.id }, reactivityKeys: ["servers"] }).catch(() => setFailed(t("mcp.removeFailed", { name: s.name })))}>
          {t("common.remove")}
        </ConfirmButton>
        <Switch isSelected={s.enabled} onChange={(enabled) => patch({ enabled })} aria-label={t("mcp.enabled", { name: s.name })} />
      </div>
      {failed && <p className="text-sm text-danger">{failed}</p>}
      {tools?.error && <p className="text-sm text-danger">{t("mcp.failed", { error: tools.error })}</p>}
      {tools && !tools.error && (
        <ul className="flex flex-col gap-1.5">
          {tools.tools.map((tool) => (
            <li key={tool.name} className={visible(tool.cls) ? "flex items-center gap-2" : "flex items-center gap-2 opacity-40"} title={visible(tool.cls) ? tool.description : t("mcp.hiddenInReadMode")}>
              <Badge tone={CLS_TONE[tool.cls]}>{t(`mcp.cls.${tool.cls}`)}</Badge>
              <Code>{tool.name}</Code>
              <span className="truncate text-sm text-muted">{tool.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// NAME=value per line.
const parseEnv = (text: string) =>
  Object.fromEntries(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  )

function NewServer({ projectId, onDone }: { projectId: string | null; onDone: () => void }) {
  const create = useMutation(mutations.createServer)
  const [kind, setKind] = useState<"stdio" | "http">("stdio")
  const [name, setName] = useState("")
  const [command, setCommand] = useState("")
  const [url, setUrl] = useState("")
  const [env, setEnv] = useState("")
  const [mode, setMode] = useState<McpServer["mode"]>("approve")
  const [error, setError] = useState<string>()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const [cmd = "", ...args] = splitCommand(command)
    const payload = { projectId, name: name.trim(), command: kind === "stdio" ? cmd : "", args: kind === "stdio" ? args : [], url: kind === "http" ? url.trim() : "", env: parseEnv(env), mode }
    create({ payload, reactivityKeys: ["servers"] }).then(onDone, (err: unknown) => setError(String(err)))
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 border-y border-subtle py-5">
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("mcp.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required spellCheck={false} placeholder={t("mcp.namePlaceholder")} />
        </Field>
        <Field label={t("mcp.type")}>
          <Select
            value={kind}
            onChange={(v) => setKind(v as "stdio" | "http")}
            aria-label={t("mcp.type")}
            options={[
              { value: "stdio", label: t("mcp.local") },
              { value: "http", label: t("mcp.remote") }
            ]}
          />
        </Field>
        <Field label={t("mcp.mode")}>
          <Select value={mode} onChange={(v) => setMode(v as McpServer["mode"])} options={modeOptions()} aria-label={t("mcp.mode")} />
        </Field>
      </div>
      {kind === "stdio" ? (
        <Field label={t("mcp.command")} hint={t("mcp.commandHint")}>
          <Input value={command} onChange={(e) => setCommand(e.target.value)} required spellCheck={false} className="font-mono" />
        </Field>
      ) : (
        <Field label={t("mcp.url")} hint={t("mcp.urlHint")}>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} type="url" required spellCheck={false} className="font-mono" />
        </Field>
      )}
      <Field label={kind === "stdio" ? t("mcp.env") : t("mcp.headers")} hint={t("mcp.envHint")}>
        <Textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={3} spellCheck={false} className="font-mono" />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="default" isDisabled={!name.trim()}>
          {t("common.add")}
        </Button>
        <Button variant="ghost" onPress={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  )
}

// The connectors: hosted MCP servers that sign in with OAuth (discovery + dynamic registration, oauth.ts), GitHub
// with a token (its server doesn't register clients), and a few that need nothing. Writes wait for approval.
type Connector = { id: string; name: string; url?: string; command?: string; auth: "oauth" | "token" | "none"; tokenUrl?: string }
const CONNECTORS: ReadonlyArray<Connector> = [
  { id: "github", name: "GitHub", url: "https://api.githubcopilot.com/mcp/", auth: "token", tokenUrl: "https://github.com/settings/personal-access-tokens/new" },
  { id: "notion", name: "Notion", url: "https://mcp.notion.com/mcp", auth: "oauth" },
  { id: "linear", name: "Linear", url: "https://mcp.linear.app/mcp", auth: "oauth" },
  { id: "atlassian", name: "Jira & Confluence", url: "https://mcp.atlassian.com/v1/mcp", auth: "oauth" },
  { id: "sentry", name: "Sentry", url: "https://mcp.sentry.dev/mcp", auth: "oauth" },
  { id: "vercel", name: "Vercel", url: "https://mcp.vercel.com", auth: "oauth" },
  { id: "supabase", name: "Supabase", url: "https://mcp.supabase.com/mcp", auth: "oauth" },
  { id: "stripe", name: "Stripe", url: "https://mcp.stripe.com", auth: "oauth" },
  { id: "context7", name: "Context7", url: "https://mcp.context7.com/mcp", auth: "none" },
  { id: "figma", name: "Figma", url: "http://127.0.0.1:3845/mcp", auth: "none" },
  { id: "playwright", name: "Playwright", command: "npx -y @playwright/mcp@latest", auth: "none" }
]
const matches = (c: Connector, s: McpServer) => (c.url ? s.url === c.url : [s.command, ...s.args].join(" ") === c.command)
const WAIT_MS = 5 * 60_000

function Connectors({ servers }: { servers: ReadonlyArray<McpServer> }) {
  const signedIn = useReading(signedInAtom).items
  const invalidate = useInvalidate()
  const [waiting, setWaiting] = useState<string>() // server id whose sign-in is open in the browser
  // While the person signs in, in the browser: look again every 2 s (the callback lands on the server).
  useEffect(() => {
    if (!waiting) return
    if (signedIn.includes(waiting)) return setWaiting(undefined)
    const tick = setInterval(() => invalidate(["servers"]), 2000)
    const stop = setTimeout(() => setWaiting(undefined), WAIT_MS)
    return () => {
      clearInterval(tick)
      clearTimeout(stop)
    }
  }, [waiting, signedIn, invalidate])
  return (
    <Section title={t("connectors.title")} description={t("connectors.intro")}>
      <div className="grid items-start gap-2 sm:grid-cols-2">
        {CONNECTORS.map((c) => {
          const server = servers.find((s) => matches(c, s))
          return <ConnectorCard key={c.id} connector={c} server={server} signedIn={!!server && signedIn.includes(server.id)} waiting={!!server && waiting === server.id} onWaiting={setWaiting} />
        })}
      </div>
    </Section>
  )
}

function ConnectorCard({ connector: c, server, signedIn, waiting, onWaiting }: { connector: Connector; server: McpServer | undefined; signedIn: boolean; waiting: boolean; onWaiting: (id: string) => void }) {
  const create = useMutation(mutations.createServer)
  const signIn = useMutation(mutations.signInServer)
  const remove = useMutation(mutations.removeServer)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false) // the token field (GitHub)
  const [token, setToken] = useState("")
  const [failed, setFailed] = useState(false)
  const connected = !!server && (c.auth !== "oauth" || signedIn)

  const connect = async () => {
    setBusy(true)
    setFailed(false)
    try {
      const s =
        server ??
        (await create({
          payload: {
            projectId: null,
            name: c.name,
            command: c.command?.split(" ")[0] ?? "",
            args: c.command?.split(" ").slice(1) ?? [],
            url: c.url ?? "",
            env: c.auth === "token" ? { Authorization: `Bearer ${token.trim()}` } : {},
            mode: "approve",
            auth: c.auth === "oauth" ? "oauth" : "none"
          },
          reactivityKeys: ["servers"]
        }))
      if (c.auth === "oauth") {
        const { authorizeUrl } = await signIn({ params: { id: s.id }, reactivityKeys: ["servers"] })
        if (authorizeUrl) {
          window.open(authorizeUrl, "_blank", "noopener") // the desktop app opens it in the default browser
          onWaiting(s.id)
        }
      }
      setAsking(false)
      setToken("")
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  const disconnect = () => server && void remove({ params: { id: server.id }, reactivityKeys: ["servers"] }).catch(() => setFailed(true))

  return (
    <div className="flex flex-col gap-3 rounded-card border border-subtle p-3">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-control text-sm font-semibold text-secondary">
          {c.name[0]}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{c.name}</span>
          <span className={failed ? "truncate text-sm text-danger" : "truncate text-sm text-muted"}>
            {failed ? t("connectors.failed") : waiting ? t("connectors.waiting") : t(`connectors.about.${c.id}` as "connectors.about.github")}
          </span>
        </span>
        {connected ? (
          <>
            <Badge tone="success">
              <Check className="-ml-0.5 mr-1 size-3" />
              {t("connectors.connected")}
            </Badge>
            <Menu
              label={t("connectors.actions", { name: c.name })}
              trigger={
                <IconButton size="sm" label={t("connectors.actions", { name: c.name })}>
                  <MoreHorizontal />
                </IconButton>
              }
            >
              <MenuItem icon={<Trash2 />} tone="danger" onAction={disconnect}>
                {t("connectors.disconnect")}
              </MenuItem>
            </Menu>
          </>
        ) : (
          !asking && (
            <Button size="sm" variant="secondary" isPending={busy || waiting} onPress={() => (c.auth === "token" ? setAsking(true) : void connect())}>
              {busy || waiting ? <Spinner size={12} /> : null}
              {server && c.auth === "oauth" ? t("connectors.signIn") : t("connectors.connect")}
            </Button>
          )
        )}
      </div>
      {asking && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void connect()
          }}
        >
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t("connectors.tokenPlaceholder")} aria-label={t("connectors.token", { name: c.name })} autoFocus required spellCheck={false} className="font-mono" />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" variant="default" isPending={busy} isDisabled={!token.trim()}>
              {t("connectors.connect")}
            </Button>
            <Button size="sm" variant="ghost" onPress={() => setAsking(false)}>
              {t("common.cancel")}
            </Button>
            {c.tokenUrl && (
              <a href={c.tokenUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-sm text-accent-text hover:underline">
                {t("connectors.createToken")}
              </a>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
