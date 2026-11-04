// MCP servers (global in Settings, or per project): mode, on/off, test the connection and see the tools
// each mode exposes, add local (command) or remote (URL) servers. Secrets go to the system keychain.
import type { McpServer, ToolInfo } from "@zero/contracts"
import { t } from "@zero/i18n"
import { type FormEvent, useState } from "react"
import { splitCommand } from "../labels.ts"
import { mutations, serversAtom, useInvalidate, useMutation, useReading } from "../client.ts"
import { ReadingState } from "./reading.tsx"
import { Badge, Button, Code, ConfirmButton, Field, Input, Plus, Section, Select, Spinner, Switch, Textarea } from "@/ui"

const MODES = ["read", "approve", "auto"] as const
const modeOptions = () => MODES.map((m) => ({ value: m, label: t(`mcp.modes.${m}`) }))
const CLS_TONE = { read: "neutral", write: "warning", sensitive: "danger" } as const

export function McpSection({ projectId }: { projectId: string | null }) {
  const reading = useReading(serversAtom)
  const servers = reading.items.filter((s) => s.projectId === projectId)
  const invalidate = useInvalidate()
  const [adding, setAdding] = useState(false)
  return (
    <div className="flex flex-col gap-8">
      <Section
        title={t("settings.mcp")}
        description={projectId ? t("mcp.projectIntro") : t("mcp.intro")}
        action={
          !adding && (
            <Button size="sm" variant="secondary" onPress={() => setAdding(true)}>
              <Plus />
              {t("mcp.add")}
            </Button>
          )
        }
      >
        {adding && <NewServer projectId={projectId} onDone={() => setAdding(false)} />}
        <ReadingState loading={reading.loading} failed={reading.failed} onRetry={() => invalidate(["servers"])} />
        {!reading.loading && !reading.failed && servers.length === 0 && !adding && <p className="text-muted">{t("mcp.empty")}</p>}
        {servers.length > 0 && (
          <div className="flex flex-col divide-y divide-subtle border-y border-subtle">
            {servers.map((s) => (
              <ServerRow key={s.id} server={s} />
            ))}
          </div>
        )}
      </Section>
      <Section title={t("mcp.modesTitle")}>
        <dl className="grid grid-cols-3 gap-x-6 gap-y-1.5">
          {MODES.map((m) => (
            <div key={m} className="contents">
              <dt className="font-medium">{t(`mcp.modes.${m}`)}</dt>
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

// Connectors people use most, filled in: pick one, then paste the token where the form says. Only servers whose
// address or package is stable; OAuth sign-in in the app is not done yet (these take a token instead).
const CATALOG = [
  { name: "GitHub", kind: "http", url: "https://api.githubcopilot.com/mcp/", env: "Authorization=Bearer <your GitHub token>" },
  { name: "Notion", kind: "stdio", command: "npx -y @notionhq/notion-mcp-server", env: "NOTION_TOKEN=<your Notion integration token>" },
  { name: "Context7", kind: "http", url: "https://mcp.context7.com/mcp", env: "CONTEXT7_API_KEY=<optional key>" },
  { name: "Figma", kind: "http", url: "http://127.0.0.1:3845/mcp", env: "" },
  { name: "Playwright", kind: "stdio", command: "npx -y @playwright/mcp@latest", env: "" },
  { name: "Filesystem", kind: "stdio", command: "npx -y @modelcontextprotocol/server-filesystem <folder>", env: "" },
  { name: "Postgres", kind: "stdio", command: "npx -y @modelcontextprotocol/server-postgres postgresql://user:pass@localhost/db", env: "" }
] as const

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

  const pick = (c: (typeof CATALOG)[number]) => {
    setName(c.name)
    setKind(c.kind)
    if (c.kind === "http") setUrl(c.url)
    else setCommand(c.command)
    setEnv(c.env)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-card border border-subtle p-4">
      {/* The catalog: fills the form; the token (if any) is still yours to paste. */}
      <div className="flex flex-col gap-2">
        <span className="text-sm text-muted">{t("mcp.catalog")}</span>
        <div className="flex flex-wrap gap-1.5">
          {CATALOG.map((c) => (
            <Button key={c.name} size="sm" variant={name === c.name ? "secondary" : "ghost"} shape="pill" onPress={() => pick(c)}>
              {c.name}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("mcp.name")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required spellCheck={false} />
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
