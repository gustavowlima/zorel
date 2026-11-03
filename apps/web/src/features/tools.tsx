// Tools (MCP servers) of a project or global, and the Settings page (API keys).
import type { McpServer, ToolInfo } from "@zero/contracts"
import { useEffect, useState, type FormEvent } from "react"
import { call } from "../api.ts"
import { useApp } from "../state.ts"
import { Badge, Button, Card, ConfirmButton, Field, Input, Page, Select, Textarea } from "@/ui"

const MODES: Record<McpServer["mode"], string> = {
  read: "Só leitura",
  approve: "Tudo, escrita com aprovação",
  auto: "Tudo, sem perguntar"
}
const MODE_OPTIONS = Object.entries(MODES).map(([value, label]) => ({ value, label }))
const KIND_OPTIONS = [
  { value: "stdio", label: "Local (comando)" },
  { value: "http", label: "Remoto (URL)" }
]
const CLS = { read: ["leitura", "neutral"], write: ["escrita", "warning"], sensitive: ["sensível", "danger"] } as const

export function ToolsSection({ projectId }: { projectId: string | null }) {
  const { data } = useApp()
  const servers = data.servers.filter((s) => s.projectId === projectId)
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Ferramentas (MCP)</h2>
      <p className="text-sm text-muted">
        {projectId ? "Disponíveis nos chats deste projeto, além das globais." : "Disponíveis em todos os chats."} Os agentes só veem o que o modo permite; ações que
        escrevem podem pedir sua aprovação no chat.
      </p>
      {servers.map((s) => (
        <ServerCard key={s.id} server={s} />
      ))}
      <NewServer projectId={projectId} />
    </section>
  )
}

function ServerCard({ server: s }: { server: McpServer }) {
  const { reload } = useApp()
  const [tools, setTools] = useState<{ tools: ReadonlyArray<ToolInfo>; error: string | null }>()
  const patch = (payload: { mode?: McpServer["mode"]; enabled?: boolean }) => call((c) => c.tools.update({ params: { id: s.id }, payload })).then(reload)
  const remove = () => call((c) => c.tools.remove({ params: { id: s.id } })).then(reload)
  const inspect = () => {
    setTools(undefined)
    call((c) => c.tools.inspect({ params: { id: s.id } })).then(setTools)
  }
  const visible = (cls: ToolInfo["cls"]) => s.mode !== "read" || cls === "read"

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{s.name}</div>
          <div className="truncate text-xs text-dim">{s.url || [s.command, ...s.args].join(" ")}</div>
        </div>
        <Select className="w-60" value={s.mode} onChange={(v) => patch({ mode: v as McpServer["mode"] })} options={MODE_OPTIONS} aria-label="Modo" />
        <Button size="sm" variant="ghost" onPress={() => patch({ enabled: !s.enabled })}>
          {s.enabled ? "Desligar" : "Ligar"}
        </Button>
        <Button size="sm" variant="ghost" onPress={inspect}>
          Testar
        </Button>
        <ConfirmButton size="sm" variant="ghost" title={`Remover ${s.name}?`} confirmLabel="Remover" onConfirm={remove}>
          Remover
        </ConfirmButton>
      </div>
      {!s.enabled && <Badge tone="warning">desligado</Badge>}
      {tools?.error && <div className="text-sm text-danger">Não conectou: {tools.error}</div>}
      {tools && !tools.error && (
        <ul className="flex flex-col gap-1 text-sm">
          {tools.tools.map((t) => (
            <li key={t.name} className={visible(t.cls) ? "" : "opacity-40"} title={visible(t.cls) ? t.description : "Escondida no modo só leitura"}>
              <Badge tone={CLS[t.cls][1]}>{CLS[t.cls][0]}</Badge> <code>{t.name}</code> <span className="text-dim">{t.description.slice(0, 100)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// KEY=value per line.
const parseEnv = (text: string) =>
  Object.fromEntries(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
  )

function NewServer({ projectId }: { projectId: string | null }) {
  const { reload } = useApp()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<"stdio" | "http">("stdio")
  const [name, setName] = useState("")
  const [command, setCommand] = useState("")
  const [url, setUrl] = useState("")
  const [env, setEnv] = useState("")
  const [mode, setMode] = useState<McpServer["mode"]>("approve")
  const [error, setError] = useState<string>()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const [cmd = "", ...args] = command.trim().split(/\s+/) // ponytail: no quoting; an argument with spaces needs hand editing
    const payload = { projectId, name: name.trim(), command: kind === "stdio" ? cmd : "", args: kind === "stdio" ? args : [], url: kind === "http" ? url.trim() : "", env: parseEnv(env), mode }
    call((c) => c.tools.create({ payload }))
      .then(async () => {
        setOpen(false)
        setName("")
        setCommand("")
        setUrl("")
        setEnv("")
        await reload()
      })
      .catch((err) => setError(String(err)))
  }

  if (!open)
    return (
      <Button className="self-start" onPress={() => setOpen(true)}>
        + Servidor MCP
      </Button>
    )
  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="github" maxLength={80} required autoFocus />
          </Field>
          <Field label="Tipo">
            <Select value={kind} onChange={(v) => setKind(v as "stdio" | "http")} options={KIND_OPTIONS} aria-label="Tipo" />
          </Field>
          <Field label="Modo">
            <Select value={mode} onChange={(v) => setMode(v as McpServer["mode"])} options={MODE_OPTIONS} aria-label="Modo" />
          </Field>
        </div>
        {kind === "stdio" ? (
          <Field label="Comando" hint="Ex.: bunx @modelcontextprotocol/server-filesystem /caminho">
            <Input value={command} onChange={(e) => setCommand(e.target.value)} required spellCheck={false} />
          </Field>
        ) : (
          <Field label="URL" hint="Endpoint MCP via HTTP (streamable).">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} type="url" required spellCheck={false} />
          </Field>
        )}
        <Field label={kind === "stdio" ? "Variáveis de ambiente" : "Cabeçalhos"} hint="NOME=valor por linha. Os valores vão para o chaveiro do sistema, nunca para o banco.">
          <Textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={3} spellCheck={false} placeholder={kind === "stdio" ? "GITHUB_TOKEN=..." : "Authorization=Bearer ..."} />
        </Field>
        {error && <div className="text-sm text-danger">{error}</div>}
        <div className="flex gap-2">
          <Button type="submit" variant="default" isDisabled={!name.trim()}>
            Adicionar
          </Button>
          <Button variant="ghost" onPress={() => setOpen(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  )
}

export function SettingsView() {
  const { reload } = useApp()
  const [keys, setKeys] = useState<ReadonlyArray<{ name: string; set: boolean; fromEnv: boolean }>>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const load = () => call((c) => c.settings.keys()).then(setKeys)
  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once when the page opens
  useEffect(() => void load(), [])

  const save = (name: string, value: string) =>
    call((c) => c.settings.setKey({ params: { name }, payload: { value } })).then(async () => {
      setDrafts((d) => ({ ...d, [name]: "" }))
      await Promise.all([load(), reload()])
    })

  return (
    <Page title="Configurações">
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Chaves de API</h2>
        <p className="text-sm text-muted">Guardadas no chaveiro do sistema. Assinaturas (Claude Code, Codex) não precisam de chave: usam a CLI já logada.</p>
        {keys.map((k) => (
          <Card key={k.name} className="flex items-center gap-2 py-2">
            <code className="w-56 text-sm">{k.name}</code>
            {k.fromEnv ? (
              <span className="text-sm text-muted">definida no ambiente do server</span>
            ) : (
              <>
                <Input type="password" autoComplete="off" placeholder={k.set ? "•••••••• (salva)" : "cole a chave"} value={drafts[k.name] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [k.name]: e.target.value }))} />
                <Button size="sm" variant="default" isDisabled={!drafts[k.name]?.trim()} onPress={() => save(k.name, drafts[k.name]!.trim())}>
                  Salvar
                </Button>
                {k.set && (
                  <Button size="sm" variant="ghost" onPress={() => save(k.name, "")}>
                    Apagar
                  </Button>
                )}
              </>
            )}
          </Card>
        ))}
      </section>
      <ToolsSection projectId={null} />
    </Page>
  )
}
