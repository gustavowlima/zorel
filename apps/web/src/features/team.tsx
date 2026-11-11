// Settings › Team (server mode, spec 014 M2): who's in the team and their roles, invites (a link and its QR, a day,
// the role fixed when made), removing someone, and your own sessions. Admin actions may answer "step_up": the server
// wants a confirmation from the last 5 minutes, so the person signs in again (passkey, else password and code) and
// the action runs again.
import { t } from "@zorel/i18n"
import { useEffect, useState } from "react"
import { renderSVG } from "uqr"
import { authClient } from "../auth-client.ts"
import { Button, CheckList, ConfirmButton, Copy, Dialog, Field, Input, KeyRound, Rows, Section, Select, SettingRow, Tag, Trash2, X } from "@/ui"

type Role = "owner" | "admin" | "member"
type Member = { userId: string; role: Role; name: string; email: string; since: string }
type Invitation = { id: string; email: string; role: Role; expiresAt: string; link: string }
type Team = { me: { id: string; role: Role }; members: Member[]; invitations: Invitation[] }
type Answer = { ok: boolean; status: number; error?: string | undefined; data?: unknown }

const call = (path: string, init?: { method?: string; body?: unknown }): Promise<Answer> =>
  fetch(path, { method: init?.method ?? (init?.body === undefined ? "GET" : "POST"), credentials: "same-origin", headers: init?.body ? { "content-type": "application/json" } : {}, ...(init?.body !== undefined && { body: JSON.stringify(init.body) }) }).then(
    async (r) => {
      const data = await r.json().catch(() => undefined)
      return { ok: r.ok, status: r.status, error: (data as { error?: string } | undefined)?.error, data }
    },
    () => ({ ok: false, status: 0, error: "network" })
  )
const ROLES: ReadonlyArray<Role> = ["member", "admin", "owner"]
const qr = (text: string) => `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(text, { border: 1 }))}`

export function TeamSection() {
  const [team, setTeam] = useState<Team>()
  const [stepUp, setStepUp] = useState<() => void>()
  const [error, setError] = useState<string>()
  const load = () => void call("/api/team").then((r) => r.ok && setTeam(r.data as Team))
  useEffect(load, [])
  // An admin action: when the server asks for a recent confirmation, ask for it and run the action again.
  const admin = async (run: () => Promise<Answer>): Promise<Answer | undefined> => {
    setError(undefined)
    const r = await run()
    if (r.error === "step_up") {
      setStepUp(() => () => void admin(run))
      return undefined
    }
    if (!r.ok) setError(t(`people.error.${r.error ?? "failed"}` as "people.error.failed"))
    load()
    return r
  }
  if (!team) return null
  const isAdmin = team.me.role !== "member"
  return (
    <>
      <Section title={t("people.members")} description={t("people.membersHint")}>
        <Rows>
          {team.members.map((m) => (
            <SettingRow key={m.userId} title={m.userId === team.me.id ? t("people.you", { name: m.name }) : m.name} hint={m.email}>
              {isAdmin && m.userId !== team.me.id ? (
                <>
                  <Select size="sm" className="w-32" aria-label={t("people.role")} value={m.role} onChange={(role) => void admin(() => call(`/api/team/members/${m.userId}`, { method: "PATCH", body: { role } }))} options={ROLES.map((r) => ({ value: r, label: t(`people.roles.${r}`) }))} />
                  <ConfirmButton size="sm" variant="ghost" title={t("people.removeTitle", { name: m.name })} description={t("people.removeBody")} confirmLabel={t("people.remove")} onConfirm={() => void admin(() => call(`/api/team/members/${m.userId}`, { method: "DELETE" }))}>
                    <Trash2 />
                  </ConfirmButton>
                </>
              ) : (
                <Tag>{t(`people.roles.${m.role}`)}</Tag>
              )}
            </SettingRow>
          ))}
        </Rows>
        {error && <p className="text-sm text-danger">{error}</p>}
      </Section>
      {isAdmin && <Invites team={team} admin={admin} />}
      <Devices team={team} />
      <Sessions />
      <StepUp open={!!stepUp} onClose={() => setStepUp(undefined)} onConfirmed={() => {
        const again = stepUp
        setStepUp(undefined)
        again?.()
      }} />
    </>
  )
}

function Invites({ team, admin }: { team: Team; admin: (run: () => Promise<Answer>) => Promise<Answer | undefined> }) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("member")
  const [made, setMade] = useState<{ link: string }>()
  const invite = async () => {
    const r = await admin(() => call("/api/team/invitations", { body: { email, role } }))
    if (r?.ok) {
      setMade(r.data as { link: string })
      setEmail("")
    }
  }
  return (
    <Section title={t("people.invite")} description={t("people.inviteHint")}>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (email.includes("@")) void invite()
        }}
      >
        <Field label={t("people.inviteEmail")} className="min-w-56 flex-1">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t("people.role")}>
          <Select className="w-36" aria-label={t("people.role")} value={role} onChange={(v) => setRole(v as Role)} options={ROLES.filter((r) => r !== "owner" || team.me.role === "owner").map((r) => ({ value: r, label: t(`people.roles.${r}`) }))} />
        </Field>
        <Button type="submit" isDisabled={!email.includes("@")}>
          {t("people.createInvite")}
        </Button>
      </form>
      {made && <InviteLink link={made.link} onClose={() => setMade(undefined)} />}
      {team.invitations.length > 0 && (
        <Rows>
          {team.invitations.map((i) => (
            <SettingRow key={i.id} title={i.email} hint={t("people.pending", { role: t(`people.roles.${i.role}`) })}>
              <Button size="sm" variant="ghost" onPress={() => void navigator.clipboard.writeText(i.link)}>
                <Copy />
                {t("people.copyLink")}
              </Button>
              <Button size="sm" variant="ghost" onPress={() => void admin(() => call(`/api/team/invitations/${i.id}`, { method: "DELETE" }))}>
                <X />
                {t("people.cancelInvite")}
              </Button>
            </SettingRow>
          ))}
        </Rows>
      )}
    </Section>
  )
}

// The link just made: to copy, or as a QR code to scan with a phone.
function InviteLink({ link, onClose }: { link: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-4 rounded-card border border-subtle bg-surface p-4">
      <img src={qr(link)} alt={t("people.qr")} className="size-28 shrink-0 rounded-control bg-white p-1" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm text-muted">{t("people.linkHint")}</p>
        <code className="truncate rounded bg-control px-2 py-1 font-mono text-xs">{link}</code>
        <span className="flex gap-1.5">
          <Button size="sm" variant="secondary" onPress={() => void navigator.clipboard.writeText(link)}>
            <Copy />
            {t("people.copyLink")}
          </Button>
          <Button size="sm" variant="ghost" onPress={onClose}>
            {t("common.close")}
          </Button>
        </span>
      </div>
    </div>
  )
}

// Paired phones (spec 014 M4): a one-time QR (5 min) for the app to scan, then confirming the device by its name.
// Waiting devices are checked while the QR is open, so the new one shows up to confirm.
type Device = { id: string; personId: string; name: string; state: "waiting" | "active"; usedAt: number | null }
const loadDevices = (set: (d: Device[]) => void) => void call("/api/devices").then((r) => r.ok && set((r.data as { devices: Device[] }).devices))
function Devices({ team }: { team: Team }) {
  const [list, setList] = useState<Device[]>([])
  const [pairing, setPairing] = useState<{ qr: string; expiresAt: number }>()
  const load = () => loadDevices(setList)
  useEffect(() => loadDevices(setList), [])
  useEffect(() => {
    if (!pairing) return
    const timer = setInterval(() => (Date.now() > pairing.expiresAt ? setPairing(undefined) : loadDevices(setList)), 2000)
    return () => clearInterval(timer)
  }, [pairing])
  const nameOf = (personId: string) => team.members.find((m) => m.userId === personId)?.name ?? ""
  return (
    <Section title={t("people.devices")} description={t("people.devicesHint")}>
      {pairing ? (
        <div className="flex items-center gap-4 rounded-card border border-subtle bg-surface p-4">
          <img src={qr(pairing.qr)} alt={t("people.qr")} className="size-36 shrink-0 rounded-control bg-white p-1" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-sm text-muted">{t("people.pairHint")}</p>
            <Button size="sm" variant="ghost" className="self-start" onPress={() => setPairing(undefined)}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="self-start" onPress={() => void call("/api/devices/pair", { method: "POST", body: {} }).then((r) => r.ok && setPairing(r.data as { qr: string; expiresAt: number }))}>
          {t("people.pair")}
        </Button>
      )}
      {list.length > 0 && (
        <Rows>
          {list.map((d) => (
            <SettingRow key={d.id} title={d.name} hint={[d.personId === team.me.id ? "" : nameOf(d.personId), d.state === "waiting" ? t("people.deviceWaiting") : d.usedAt ? new Date(d.usedAt).toLocaleString() : ""].filter(Boolean).join(" · ")}>
              {d.state === "waiting" && (
                <Button size="sm" onPress={() => void call(`/api/devices/${d.id}/confirm`, { method: "POST", body: {} }).then(load)}>
                  {t("people.confirmDevice")}
                </Button>
              )}
              <ConfirmButton size="sm" variant="ghost" title={t("people.revokeTitle", { name: d.name })} description={t("people.revokeBody")} confirmLabel={t("people.revoke")} onConfirm={() => void call(`/api/devices/${d.id}`, { method: "DELETE" }).then(load)}>
                <Trash2 />
              </ConfirmButton>
            </SettingRow>
          ))}
        </Rows>
      )}
    </Section>
  )
}

// Your own sessions (browsers and apps signed in): where and when, and signing one out.
type Session = { token: string; userAgent?: string | null; ipAddress?: string | null; updatedAt: string | Date }
function Sessions() {
  const [list, setList] = useState<Session[]>([])
  const [current, setCurrent] = useState<string>()
  const load = () => {
    void authClient.listSessions().then((r) => setList((r.data ?? []) as Session[]))
    void authClient.getSession().then((r) => setCurrent(r.data?.session.token))
  }
  useEffect(load, [])
  return (
    <Section title={t("people.sessions")} description={t("people.sessionsHint")}>
      <Rows>
        {list.map((s) => (
          <SettingRow key={s.token} title={s.token === current ? t("people.thisSession") : browserOf(s.userAgent)} hint={`${s.ipAddress ?? ""} · ${new Date(s.updatedAt).toLocaleString()}`}>
            {s.token !== current && (
              <Button size="sm" variant="ghost" onPress={() => void authClient.revokeSession({ token: s.token }).then(load)}>
                {t("people.signOut")}
              </Button>
            )}
          </SettingRow>
        ))}
      </Rows>
    </Section>
  )
}
const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Edg\//, "Edge"],
  [/Chrome\//, "Chrome"],
  [/Firefox\//, "Firefox"],
  [/Safari\//, "Safari"],
  [/Electron\//, "Zorel"]
]
const browserOf = (ua: string | null | undefined) => BROWSERS.find(([re]) => re.test(ua ?? ""))?.[1] ?? t("people.otherDevice")

// "Confirm it's you": a new sign-in now (passkey, else password and code), which makes the session recent.
export function StepUp({ open, onClose, onConfirmed }: { open: boolean; onClose: () => void; onConfirmed: () => void }) {
  const [form, setForm] = useState({ email: "", password: "" })
  const [error, setError] = useState<string>()
  const passkey = async () => {
    const r = await authClient.signIn.passkey().catch(() => ({ error: true }))
    if (r?.error) setError(t("server.passkeyFailed"))
    else onConfirmed()
  }
  const password = async () => {
    const r = await authClient.signIn.email({ email: form.email, password: form.password }).catch(() => ({ error: true }))
    if (r?.error) setError(t("server.signInFailed"))
    else onConfirmed()
  }
  return (
    <Dialog title={t("people.stepUpTitle")} isOpen={open} onOpenChange={(o) => !o && onClose()}>
      {() => (
        <>
          <p className="text-secondary">{t("people.stepUpBody")}</p>
          <Button onPress={() => void passkey()}>
            <KeyRound />
            {t("server.withPasskey")}
          </Button>
          <form
            className="flex flex-col gap-3 border-t border-subtle pt-4"
            onSubmit={(e) => {
              e.preventDefault()
              void password()
            }}
          >
            <Field label={t("server.email")}>
              <Input type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label={t("server.password")}>
              <Input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" variant="secondary" isDisabled={!form.email || !form.password}>
              {t("server.withPassword")}
            </Button>
          </form>
        </>
      )}
    </Dialog>
  )
}

// A project's people on a team server (admins choose): members see its chats, files and agents. Owners and admins see
// every project, so only members are listed to tick.
export function ProjectPeople({ projectId }: { projectId: string }) {
  const [team, setTeam] = useState<Team>()
  const [inIt, setInIt] = useState<ReadonlyArray<string>>([])
  const load = () => {
    void call("/api/team").then((r) => r.ok && setTeam(r.data as Team))
    void call(`/api/team/projects/${projectId}/members`).then((r) => r.ok && setInIt((r.data as { members: string[] }).members))
  }
  useEffect(load, [projectId])
  if (!team || team.me.role === "member") return null
  const members = team.members.filter((m) => m.role === "member")
  return (
    <Section title={t("people.projectTitle")} description={t("people.projectHint")}>
      {members.length ? (
        <CheckList
          label={t("people.projectTitle")}
          value={[...inIt]}
          onChange={(next) => {
            const added = next.filter((id) => !inIt.includes(id))
            const removed = inIt.filter((id) => !next.includes(id))
            void Promise.all([...added.map((personId) => call(`/api/team/projects/${projectId}/members`, { method: "PUT", body: { personId, member: true } })), ...removed.map((personId) => call(`/api/team/projects/${projectId}/members`, { method: "PUT", body: { personId, member: false } }))]).then(load)
          }}
          options={members.map((m) => ({ value: m.userId, label: <span className="truncate">{m.name}</span>, trailing: <span className="text-sm text-muted">{m.email}</span> }))}
        />
      ) : (
        <p className="text-sm text-muted">{t("people.projectNone")}</p>
      )}
    </Section>
  )
}
