// Server mode's front door (spec 014): the gate in front of the app, the first owner's setup (with the one-time link
// the server printed), and signing in: a passkey first, else e-mail and password with the authenticator code when
// the account has one. Locally (desktop, local web) the gate renders the app at once.
import { t } from "@zorel/i18n"
import { createContext, type ReactNode, useContext, useEffect, useState } from "react"
import { authClient, type ServerInfo, serverInfo } from "../auth-client.ts"
import { Button, Field, Input, KeyRound, Logo, Spinner } from "@/ui"

type Gate = { state: "checking" } | { state: "local" } | { state: "server"; info: ServerInfo; signedIn: boolean }

// Whether this is a team server (the app shows Settings › Team, sign-out); undefined locally.
const ServerMode = createContext<ServerInfo | undefined>(undefined)
export const useServer = () => useContext(ServerMode)

export function ServerGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>({ state: "checking" })
  const check = () =>
    void serverInfo().then(async (info) => {
      if (!info) return setGate({ state: "local" })
      const session = await authClient.getSession().catch(() => null)
      setGate({ state: "server", info, signedIn: !!session?.data?.user })
    })
  useEffect(check, [])
  if (gate.state === "local") return children
  if (gate.state === "server" && gate.signedIn) return <ServerMode.Provider value={gate.info}>{children}</ServerMode.Provider>
  if (gate.state === "checking")
    return (
      <div className="flex h-full items-center justify-center bg-canvas">
        <Spinner className="size-5 text-muted" />
      </div>
    )
  const token = new URLSearchParams(location.search).get("t")
  const invite = /^\/invite\/([A-Za-z0-9_-]+)$/.exec(location.pathname)?.[1]
  return (
    <div className="flex h-full justify-center overflow-y-auto bg-canvas px-6 py-16">
      <div className="flex w-full max-w-sm flex-col gap-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
        <Logo className="size-8" />
        {gate.info.needsOwner ? token ? <Setup token={token} onDone={check} /> : <NeedsLink /> : invite ? <Join id={invite} onDone={check} /> : <SignIn onDone={check} />}
      </div>
    </div>
  )
}

function NeedsLink() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">{t("server.needsOwner")}</h1>
      <p className="text-muted">{t("server.needsOwnerHint")}</p>
    </div>
  )
}

// The first owner: name, e-mail (only the sign-in name) and password; then a passkey on this device.
function Setup({ token, onDone }: { token: string; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [made, setMade] = useState(false)
  const submit = async () => {
    setBusy(true)
    setError(undefined)
    const r = await fetch("/api/setup", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, token }) }).catch(() => undefined)
    setBusy(false)
    if (!r?.ok) return setError(t(r?.status === 403 ? "server.setupBadLink" : "server.setupFailed"))
    history.replaceState(null, "", "/") // the link is spent
    setMade(true)
  }
  if (made) return <AddPasskey onDone={onDone} />
  const ready = form.name.trim() && form.email.includes("@") && form.password.length >= 10
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) void submit()
      }}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("server.setupTitle")}</h1>
        <p className="text-muted">{t("server.setupHint")}</p>
      </div>
      <Field label={t("server.name")}>
        <Input autoFocus autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label={t("server.email")} hint={t("server.emailHint")}>
        <Input type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <Field label={t("server.password")} hint={t("server.passwordHint")}>
        <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" isPending={busy} isDisabled={!ready}>
        {t("server.createOwner")}
      </Button>
    </form>
  )
}

// Joining the team through an invite link: the invite names the e-mail and the role; the person picks a name and a
// password, then adds a passkey on this device.
function Join({ id, onDone }: { id: string; onDone: () => void }) {
  const [invite, setInvite] = useState<{ email: string; role: string } | null>()
  const [form, setForm] = useState({ name: "", password: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [joined, setJoined] = useState(false)
  useEffect(() => {
    void fetch(`/api/invite/${id}`).then(async (r) => setInvite(r.ok ? ((await r.json()) as { email: string; role: string }) : null), () => setInvite(null))
  }, [id])
  const join = async () => {
    setBusy(true)
    setError(undefined)
    const r = await fetch(`/api/invite/${id}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }).catch(() => undefined)
    setBusy(false)
    if (!r?.ok) return setError(t(r?.status === 409 ? "server.joinExists" : "server.joinFailed"))
    history.replaceState(null, "", "/")
    setJoined(true)
  }
  if (invite === undefined) return <Spinner className="size-5 text-muted" />
  if (invite === null)
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{t("server.inviteGone")}</h1>
        <p className="text-muted">{t("server.inviteGoneHint")}</p>
      </div>
    )
  if (joined) return <AddPasskey onDone={onDone} />
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (form.name.trim() && form.password.length >= 10) void join()
      }}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("server.joinTitle")}</h1>
        <p className="text-muted">{t("server.joinHint", { email: invite.email, role: t(`people.roles.${invite.role}` as "people.roles.member") })}</p>
      </div>
      <Field label={t("server.name")}>
        <Input autoFocus autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field label={t("server.password")} hint={t("server.passwordHint")}>
        <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </Field>
      {error && <p className="text-sm text-danger">{error}</p>}
      <Button type="submit" isPending={busy} isDisabled={!form.name.trim() || form.password.length < 10}>
        {t("server.join")}
      </Button>
    </form>
  )
}

// After the account exists: a passkey on this device, or later.
function AddPasskey({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const add = async () => {
    setBusy(true)
    await authClient.passkey.addPasskey({ name: t("server.thisDevice") }).catch(() => undefined)
    setBusy(false)
    onDone()
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("server.passkeyTitle")}</h1>
      <p className="text-muted">{t("server.passkeyHint")}</p>
      <div className="flex gap-2">
        <Button isPending={busy} onPress={() => void add()}>
          <KeyRound />
          {t("server.addPasskey")}
        </Button>
        <Button variant="ghost" onPress={onDone}>
          {t("server.later")}
        </Button>
      </div>
    </div>
  )
}

// Signing in: a passkey in one gesture, or e-mail and password (then the authenticator code when the account has one).
function SignIn({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ email: "", password: "", code: "" })
  const [needsCode, setNeedsCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const done = (failed: boolean, why = "server.signInFailed") => {
    setBusy(false)
    if (failed) setError(t(why as "server.signInFailed"))
    else onDone()
  }
  const withPasskey = async () => {
    setBusy(true)
    setError(undefined)
    const r = await authClient.signIn.passkey().catch(() => ({ error: true }))
    done(!!r?.error, "server.passkeyFailed")
  }
  const withPassword = async () => {
    setBusy(true)
    setError(undefined)
    if (needsCode) {
      const r = await authClient.twoFactor.verifyTotp({ code: form.code.trim() }).catch(() => ({ error: true }))
      return done(!!r?.error, "server.codeFailed")
    }
    const r = await authClient.signIn.email({ email: form.email.trim(), password: form.password }).catch(() => ({ error: true, data: null }))
    if (!r?.error && (r?.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      setBusy(false)
      return setNeedsCode(true)
    }
    done(!!r?.error)
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{t("server.signInTitle")}</h1>
        <p className="text-muted">{t("server.signInHint")}</p>
      </div>
      <Button isPending={busy && !form.password} onPress={() => void withPasskey()}>
        <KeyRound />
        {t("server.withPasskey")}
      </Button>
      <form
        className="flex flex-col gap-3 border-t border-subtle pt-5"
        onSubmit={(e) => {
          e.preventDefault()
          void withPassword()
        }}
      >
        {needsCode ? (
          <Field label={t("server.code")} hint={t("server.codeHint")}>
            <Input autoFocus inputMode="numeric" autoComplete="one-time-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
        ) : (
          <>
            <Field label={t("server.email")}>
              <Input type="email" autoComplete="username webauthn" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label={t("server.password")}>
              <Input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
          </>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" variant="secondary" isPending={busy && !!form.password} isDisabled={needsCode ? !form.code.trim() : !form.email.trim() || !form.password}>
          {needsCode ? t("server.verify") : t("server.withPassword")}
        </Button>
      </form>
    </div>
  )
}
