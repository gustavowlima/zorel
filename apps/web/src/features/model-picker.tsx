// Escolha de modelo: sugestões conhecidas, mas qualquer "<provider>/<modelo>" vale.
// Confirma no Enter ou ao sair do campo; inválido volta ao valor anterior.
import { useEffect, useId, useState } from "react"
import { useApp } from "../state.ts"
import { cx, Input } from "@/ui"

const VALID = /^[a-z-]+\/\S+$/

export function ModelPicker({ value, onChange, className }: { value: string; onChange: (model: string) => void; className?: string }) {
  const { data } = useApp()
  const list = useId()
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  const provider = draft.split("/")[0]
  const info = data.models.find((m) => m.provider === provider)
  const commit = () => {
    const v = draft.trim()
    if (VALID.test(v) && !v.endsWith("/…")) v !== value && onChange(v)
    else setDraft(value)
  }

  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <Input
        list={list}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          commit()
        }}
        placeholder="provider/modelo"
        aria-label="Modelo"
        spellCheck={false}
      />
      <datalist id={list}>
        {data.models.map((m) => (
          <option key={m.id} value={m.id.replace(/…$/, "")}>
            {`${m.kind === "subscription" ? "assinatura" : "API"}${m.available ? "" : " · indisponível"}`}
          </option>
        ))}
      </datalist>
      {info && !info.available && <span className="text-xs text-warning">Indisponível: {info.hint}</span>}
      {draft && !info && VALID.test(draft) && <span className="text-xs text-warning">Provider desconhecido.</span>}
    </div>
  )
}
