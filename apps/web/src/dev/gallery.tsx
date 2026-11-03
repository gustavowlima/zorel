// /#/dev/ui (development only): every primitive in every state, in both themes. Replaces Storybook
// (ARCHITECTURE §10.3). New primitive in src/ui? Add it here before using it in a screen.
import { type ReactNode, useState } from "react"
import {
  AgentAvatar, ArrowUp, Badge, BookOpen, Button, Card, ChatStatusIcon, Check, ConfirmButton, DisclosurePill, Dot, EmptyState, Field, FieldButton, Folder, GroupRow, IconButton,
  Inbox, Input, Menu, MenuItem, MenuSeparator, Meter, ModelAvatar, MoreHorizontal, NavItem, NavLabel, OptionButton, Paperclip, Pencil, Plus, Popover, ProviderIcon, RailButton,
  Select, Spinner, Switch, Tab, TabList, TabPanel, Tabs, Textarea, Tooltip, Trash2, TreeItem
} from "@/ui"

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-subtle py-6 last:border-0">
      <h2 className="font-mono text-xs text-muted">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  )
}

export default function Gallery() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? "dark")
  const [on, setOn] = useState(true)
  const [pick, setPick] = useState("opus")
  const flip = (t: string) => {
    document.documentElement.dataset.theme = t
    setTheme(t)
  }
  return (
    <div className="flex h-full bg-frame p-3">
      <main className="mx-auto w-full max-w-4xl overflow-auto rounded-sheet border border-subtle bg-canvas px-8">
        <header className="flex items-center gap-3 border-b border-subtle py-4">
          <h1 className="flex-1 text-lg font-semibold">Primitivas</h1>
          <Tabs selectedKey={theme} onSelectionChange={(k) => flip(String(k))}>
            <TabList label="Tema">
              <Tab id="dark">Escuro</Tab>
              <Tab id="light">Claro</Tab>
            </TabList>
          </Tabs>
        </header>

        <Row title="Button">
          <Button variant="default">Default</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="default" size="sm">Small</Button>
          <Button variant="default" size="lg">Large</Button>
          <Button isDisabled>Disabled</Button>
          <Button variant="default" isPending>
            <Spinner /> Saving
          </Button>
        </Row>

        <Row title="IconButton, Tooltip, Menu">
          <IconButton label="Anexar">
            <Paperclip />
          </IconButton>
          <IconButton label="Enviar" variant="default">
            <ArrowUp />
          </IconButton>
          <Tooltip content="Resume a conversa até aqui">
            <Button variant="ghost">Com tooltip</Button>
          </Tooltip>
          <Menu
            label="Ações"
            trigger={
              <IconButton label="Mais ações">
                <MoreHorizontal />
              </IconButton>
            }
          >
            <MenuItem icon={<Pencil />} onAction={() => {}}>
              Renomear
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} tone="danger" onAction={() => {}}>
              Apagar
            </MenuItem>
          </Menu>
          <ConfirmButton variant="ghost" title="Apagar este chat?" description="Todas as mensagens serão apagadas." onConfirm={() => {}}>
            Confirmação
          </ConfirmButton>
        </Row>

        <Row title="Field, Input, Textarea, Select, Switch">
          <div className="grid w-full grid-cols-2 gap-4">
            <Field label="Nome" hint="Como aparece na barra lateral.">
              <Input placeholder="core" />
            </Field>
            <Field label="Modelo">
              <Select value={pick} onChange={setPick} options={[{ value: "opus", label: "Opus" }, { value: "sonnet", label: "Sonnet" }, { value: "haiku", label: "Haiku" }]} aria-label="Modelo" />
            </Field>
            <Field label="Instruções">
              <Textarea rows={3} placeholder="Papel, jeito de trabalhar…" />
            </Field>
            <div className="flex flex-col gap-3 pt-5">
              <Switch isSelected={on} onChange={setOn}>
                Trocar de conta quando o limite acabar
              </Switch>
              <Switch isDisabled>Desligado</Switch>
              <Input disabled placeholder="Disabled" />
            </div>
          </div>
        </Row>

        <Row title="Tabs">
          <Tabs defaultSelectedKey="all" className="w-full">
            <TabList label="Filtro">
              <Tab id="all" count={4}>
                All
              </Tab>
              <Tab id="approvals" count={2}>
                Approvals
              </Tab>
              <Tab id="questions">Questions</Tab>
            </TabList>
            <TabPanel id="all" className="text-muted">
              Todos os pedidos.
            </TabPanel>
            <TabPanel id="approvals" className="text-muted">
              Só aprovações.
            </TabPanel>
            <TabPanel id="questions" className="text-muted">
              Só perguntas.
            </TabPanel>
          </Tabs>
        </Row>

        <Row title="AgentAvatar">
          {["Architect", "Coder", "Reviewer", "Pia", "Bia", "Nico"].map((n, i) => (
            <span key={n} className="inline-flex items-center gap-2 pr-2">
              <AgentAvatar id={`agent-${n}`} name={n} tone={i} size={28} />
              <span className="text-secondary">{n}</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-2 border-l border-subtle pl-4">
            {([16, 20, 28, 32] as const).map((s) => (
              <AgentAvatar key={s} id="agent-Architect" name="Architect" tone={0} size={s} />
            ))}
          </span>
        </Row>

        <Row title="ProviderIcon">
          {["claude", "codex", "opencode", "openrouter", "ollama"].map((p) => (
            <span key={p} className="inline-flex items-center gap-2 pr-2 text-secondary">
              <ProviderIcon provider={p} size={20} />
              {p}
            </span>
          ))}
        </Row>

        <Row title="Status">
          <span className="inline-flex items-center gap-2 pr-2 text-secondary">
            <ChatStatusIcon state="running" /> rodando
          </span>
          <span className="inline-flex items-center gap-2 pr-2 text-secondary">
            <ChatStatusIcon state="waiting" /> esperando você
          </span>
          <span className="inline-flex items-center gap-2 pr-2 text-secondary">
            <ChatStatusIcon state="failed" /> falhou
          </span>
        </Row>

        <Row title="NavItem, NavLabel, GroupRow, TreeItem">
          <div className="flex w-62 flex-col gap-0.5 rounded-card bg-frame p-3">
            <NavItem icon={<Inbox />} active onPress={() => {}} trailing={<Badge tone="accent">3</Badge>}>
              Needs you
            </NavItem>
            <NavItem icon={<BookOpen />} onPress={() => {}}>
              Knowledge
            </NavItem>
            <NavLabel
              action={
                <IconButton label="Novo" size="sm">
                  <Plus className="size-3.5" />
                </IconButton>
              }
            >
              Projects
            </NavLabel>
            <GroupRow icon={<Folder />} name="core" expanded onToggle={() => {}} trailing={<span className="pr-1.5 text-sm text-muted">2</span>} />
            <div className="ml-4.5 flex flex-col gap-0.5 border-l border-strong pl-1.5">
              <TreeItem
                active
                title="Context builder"
                detail={
                  <span className="flex items-center gap-1.5 text-accent-text">
                    <ChatStatusIcon state="waiting" /> Coder waits for your OK
                  </span>
                }
                onPress={() => {}}
              />
              <TreeItem title="Approvals UX" trailing={<span className="text-sm text-muted">2d</span>} onPress={() => {}} />
            </div>
          </div>
        </Row>

        <Row title="DisclosurePill, Dot, Meter, ModelAvatar">
          <DisclosurePill expanded={false} onToggle={() => {}} leading={<Dot tone="success" />}>
            Used 3 tools · 14s
          </DisclosurePill>
          <DisclosurePill expanded onToggle={() => {}} leading={<Spinner size={12} className="text-success" />}>
            Run bun test · 4s
          </DisclosurePill>
          <Meter value={0.42} label="42%" className="w-40" />
          <Meter value={0.9} warnAt={0.8} label="90%" className="w-40" />
          <ModelAvatar provider="claude-cli" size={32} />
          <ModelAvatar provider="codex-cli" size={32} />
        </Row>

        <Row title="Popover, RailButton, OptionButton, FieldButton">
          <Popover
            label="Modelo"
            placement="bottom start"
            className="w-80"
            trigger={
              <Button size="sm">
                <ProviderIcon provider="claude" size={14} /> Sonnet
              </Button>
            }
          >
            <div className="flex">
              <div className="flex flex-col gap-1.5 border-r border-subtle p-2.5">
                <RailButton selected label="Claude" onPress={() => {}}>
                  <ProviderIcon provider="claude" size={20} />
                </RailButton>
                <RailButton selected={false} label="Codex" badge="W" onPress={() => {}}>
                  <ProviderIcon provider="codex" size={20} />
                </RailButton>
              </div>
              <div className="flex flex-1 flex-col gap-0.5 p-2.5">
                <OptionButton selected title="Sonnet" note="Balanced" onPress={() => {}} />
                <OptionButton selected={false} title="Opus" note="Deepest reasoning" onPress={() => {}} />
              </div>
            </div>
          </Popover>
          <div className="w-64">
            <FieldButton aria-label="Modelo">
              <ProviderIcon provider="claude" size={14} /> Opus
            </FieldButton>
          </div>
        </Row>

        <Row title="EmptyState">
          <div className="w-full rounded-card border border-subtle">
            <EmptyState icon={<Check />} title="Nada precisa de você" hint="Pedidos e memórias propostas aparecem aqui." />
          </div>
        </Row>

        <Row title="Badge">
          <Badge>neutral</Badge>
          <Badge tone="accent">accent</Badge>
          <Badge tone="success">success</Badge>
          <Badge tone="warning">warning</Badge>
          <Badge tone="danger">danger</Badge>
        </Row>

        <Row title="Card">
          <Card className="w-80">
            <div className="font-medium">Card</div>
            <p className="text-muted">Superfície plana, borda sutil, sem sombra.</p>
          </Card>
        </Row>
      </main>
    </div>
  )
}
