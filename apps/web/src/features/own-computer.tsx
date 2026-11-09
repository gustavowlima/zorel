// An agent's own computer (spec 009): none (it works on this machine, inside its sandbox) or an isolated Linux
// container where it installs and runs anything without asking. Podman first, Docker as the fallback; the row says
// which engine was found or what's missing.
import { useAtomValue } from "@effect/atom-react"
import { AsyncResult } from "effect/reactivity"
import { t } from "@zorel/i18n"
import { computerAtom, mutations, useMutation } from "../client.ts"
import { ConfirmButton, Segmented, Server, SettingRow } from "@/ui"

export function OwnComputer({ value, onChange, agentId }: { value: "none" | "container"; onChange: (v: "none" | "container") => void; agentId: string | undefined }) {
  const status = AsyncResult.getOrElse(useAtomValue(computerAtom), () => undefined)
  const erase = useMutation(mutations.eraseComputer)
  const hint = value === "none" ? t("computer.ownNone") : status?.engine ? t("computer.ownReady", { engine: status.engine === "podman" ? "Podman" : "Docker" }) : (status?.problem ?? t("computer.ownChecking"))
  return (
    <SettingRow icon={<Server />} title={t("computer.own")} hint={value === "container" && !status?.engine && status ? <span className="text-warning">{hint}</span> : hint}>
      <Segmented
        label={t("computer.own")}
        value={value}
        onChange={onChange}
        options={[
          { id: "none", label: t("agent.perm.level.none") },
          { id: "container", label: t("computer.ownContainer") }
        ]}
      />
      {agentId && value === "container" && (
        <ConfirmButton size="sm" variant="ghost" title={t("computer.eraseTitle")} description={t("computer.eraseBody")} confirmLabel={t("computer.erase")} onConfirm={() => void erase({ params: { id: agentId }, reactivityKeys: ["computer"] })}>
          {t("computer.erase")}
        </ConfirmButton>
      )}
    </SettingRow>
  )
}
