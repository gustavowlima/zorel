// Teams (spec 010) on the Agents screen: named groups of agents, global or in a project. A team is added to a chat in
// one pick (its members join), or called with @ (the one who fits answers; the first when none clearly does). Here:
// the list, a dialog to create or edit one (name, members, their order) and delete with a confirm. Deleting a team
// never touches its agents.
import { type Agent, type AgentTeam, isTeammate, TEAM_MAX } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { useState } from "react"
import { agentsAtom, mutations, projectsAtom, teamsAtom, useList, useMutation } from "../client.ts"
import { agentTint, agentTone, handleOf } from "../labels.ts"
import { go } from "../state.ts"
import { AgentAvatar, Button, CheckList, ConfirmDialog, Dialog, Field, IconButton, Input, ListRow, Menu, MenuItem, MenuSeparator, MoreHorizontal, Pencil, Plus, Rows, Section, Select, SortableList, Trash2, Users } from "@/ui"

// The server's refusal (a taken handle, a member out of reach) is shown as it says it.
const messageOf = (e: unknown): string => {
  const m = e && typeof e === "object" && "message" in e ? e.message : undefined
  return typeof m === "string" && m ? m : t("teams.saveFailed")
}

export function TeamsSection() {
  const teams = useList(teamsAtom)
  const agents = useList(agentsAtom)
  const projects = useList(projectsAtom)
  const remove = useMutation(mutations.removeTeam)
  const [editing, setEditing] = useState<AgentTeam | "new">()
  const [deleting, setDeleting] = useState<AgentTeam>()
  const where = (x: AgentTeam) => (x.projectId ? (projects.find((p) => p.id === x.projectId)?.name ?? "") : t("teams.global"))
  return (
    <Section
      title={teams.length ? `${t("teams.title")} · ${teams.length}` : t("teams.title")}
      description={t("teams.hint")}
      action={
        <Button size="sm" variant="secondary" onPress={() => setEditing("new")}>
          <Plus />
          {t("teams.new")}
        </Button>
      }
    >
      {teams.length > 0 && (
        <Rows>
          {teams.map((x) => {
            const members = x.agentIds.flatMap((id) => agents.find((a) => a.id === id) ?? [])
            return (
              <ListRow
                key={x.id}
                label={t("teams.edit", { name: x.name })}
                onPress={() => setEditing(x)}
                icon={<Users className="size-5 text-muted" />}
                title={x.name}
                hint={`@${x.handle} · ${where(x)} · ${t("teams.count", { count: members.length })}`}
                aside={
                  <span className="flex">
                    {members.slice(0, 6).map((a, i) => (
                      <AgentAvatar key={a.id} id={a.id} name={a.name} tone={agentTone(a, agents)} size={20} className={i ? "-ml-1.5 ring-2 ring-canvas" : "ring-2 ring-canvas"} />
                    ))}
                  </span>
                }
                trailing={
                  <Menu
                    label={t("teams.actions", { name: x.name })}
                    trigger={
                      <IconButton label={t("teams.actions", { name: x.name })}>
                        <MoreHorizontal />
                      </IconButton>
                    }
                  >
                    <MenuItem icon={<Pencil />} onAction={() => setEditing(x)}>
                      {t("teams.edit", { name: x.name })}
                    </MenuItem>
                    <MenuItem icon={<Plus />} onAction={() => go({ view: "new-agent", projectId: x.projectId, teamId: x.id })}>
                      {t("teams.newAgent")}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={<Trash2 />} tone="danger" onAction={() => setDeleting(x)}>
                      {t("common.delete")}
                    </MenuItem>
                  </Menu>
                }
              />
            )
          })}
        </Rows>
      )}
      {editing && <TeamDialog team={editing === "new" ? undefined : editing} agents={agents} projects={projects} onClose={() => setEditing(undefined)} />}
      <ConfirmDialog
        isOpen={!!deleting}
        onOpenChange={(o) => !o && setDeleting(undefined)}
        title={t("teams.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("teams.deleteBody")}
        onConfirm={() => deleting && void remove({ params: { id: deleting.id }, reactivityKeys: ["agents"] })}
      />
    </Section>
  )
}

// Create or edit: name (its @handle shows as typed), where it lives (only when creating), who's in it and in what
// order (the first answers when the router can't tell).
function TeamDialog({ team, agents, projects, onClose }: { team: AgentTeam | undefined; agents: ReadonlyArray<Agent>; projects: ReadonlyArray<{ id: string; name: string }>; onClose: () => void }) {
  const create = useMutation(mutations.createTeam)
  const update = useMutation(mutations.updateTeam)
  const [name, setName] = useState(team?.name ?? "")
  const [projectId, setProjectId] = useState<string | null>(team?.projectId ?? null)
  const [ids, setIds] = useState<string[]>(() => [...(team?.agentIds ?? [])])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  // Who it can hold: a global team, global agents; a project's, that project's and the global ones.
  const reach = agents.filter((a) => isTeammate(a) && (a.projectId === null || a.projectId === projectId))
  const chosen = ids.flatMap((id) => agents.find((a) => a.id === id) ?? [])
  const pick = (next: string[]) => setIds([...ids.filter((id) => next.includes(id)), ...next.filter((id) => !ids.includes(id))]) // new ones last
  const save = () => {
    setBusy(true)
    setError(undefined)
    const agentIds = ids.filter((id) => reach.some((a) => a.id === id))
    const done = team
      ? update({ params: { id: team.id }, payload: { name: name.trim(), agentIds }, reactivityKeys: ["agents"] })
      : create({ payload: { projectId, name: name.trim(), agentIds }, reactivityKeys: ["agents"] })
    void done.then(onClose, (e: unknown) => setError(messageOf(e))).finally(() => setBusy(false))
  }
  return (
    <Dialog title={team ? t("teams.edit", { name: team.name }) : t("teams.new")} isOpen onOpenChange={(o) => !o && onClose()} size="lg">
      {() => (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && !busy) save()
          }}
        >
          <Field label={t("teams.name")} hint={name.trim() ? t("teams.handle", { handle: handleOf({ name }) }) : undefined}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
          </Field>
          {!team && projects.length > 0 && (
            <Field label={t("teams.scope")}>
              <Select
                aria-label={t("teams.scope")}
                value={projectId ?? ""}
                onChange={(v) => setProjectId(v || null)}
                options={[{ value: "", label: t("teams.global") }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
              />
            </Field>
          )}
          <div className="flex flex-col gap-1.5 text-sm text-muted">
            <span>{t("teams.members")}</span>
            {reach.length === 0 ? (
              <p className="text-dim">{t("teams.none")}</p>
            ) : (
              <CheckList
                label={t("teams.members")}
                value={ids}
                onChange={pick}
                className="scroll-quiet max-h-56 overflow-y-auto"
                options={reach.map((a) => ({ value: a.id, tint: agentTint(a, agents), label: <><AgentAvatar id={a.id} name={a.name} tone={agentTone(a, agents)} size={20} /> {a.name}</>, trailing: <span className="truncate text-sm text-muted">{a.title}</span> }))}
              />
            )}
          </div>
          {chosen.length > 1 && (
            <div className="flex flex-col gap-1.5 text-sm text-muted">
              <span>{t("teams.order")}</span>
              <SortableList
                idOf={(a) => a.id}
                items={chosen}
                label={t("teams.order")}
                handleLabel={(a) => t("teams.move", { name: a.name })}
                textOf={(a) => a.name}
                onReorder={(next) => setIds(next.map((a) => a.id))}
              >
                {(a, i) => (
                  <span className="flex items-center gap-2 text-fg">
                    <span className="w-4 text-right text-dim tabular-nums">{i + 1}</span>
                    <AgentAvatar id={a.id} name={a.name} tone={agentTone(a, agents)} size={20} />
                    {a.name}
                  </span>
                )}
              </SortableList>
              <span className="text-dim">{t("teams.orderHint")}</span>
            </div>
          )}
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onPress={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="default" isPending={busy} isDisabled={!name.trim() || busy || ids.length > TEAM_MAX}>
              {team ? t("teams.save") : t("teams.create")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
