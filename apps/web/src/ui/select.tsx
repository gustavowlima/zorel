// Select: React Aria (botão + popover + lista), API simples por opções. Gerado pelo shadcn e reduzido.
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { Button, ListBox, ListBoxItem, Popover, Select as SelectPrimitive, SelectValue } from "react-aria-components"
import { cn } from "@/lib/utils"
import { field } from "./input"

export type SelectOption = { value: string; label: string }

// Chaves do React Aria não podem ser vazias; "" (ex.: "Sem agente") vira "v:".
const key = (v: string) => `v:${v}`

export function Select({
  value,
  onChange,
  options,
  placeholder,
  size = "md",
  className,
  "aria-label": ariaLabel
}: {
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<SelectOption>
  placeholder?: string
  size?: "sm" | "md"
  className?: string
  "aria-label"?: string
}) {
  const selected = options.some((o) => o.value === value) ? key(value) : null
  return (
    <SelectPrimitive
      data-slot="select"
      value={selected}
      onChange={(k) => k != null && onChange(String(k).slice(2))}
      {...(placeholder !== undefined && { placeholder })}
      {...(ariaLabel !== undefined && { "aria-label": ariaLabel })}
      className={cn("w-full", className)}
    >
      <Button className={cn(field, "flex items-center justify-between gap-1.5 text-left", size === "sm" ? "h-control-sm px-2.5 text-sm" : "h-control")}>
        <SelectValue className="truncate data-placeholder:text-dim" />
        <ChevronDownIcon className="size-4 shrink-0 text-muted" />
      </Button>
      <Popover className="z-50 w-(--trigger-width) min-w-40 overflow-hidden rounded-control border border-strong bg-raised p-1 text-fg data-entering:animate-in data-entering:fade-in-0 data-exiting:animate-out data-exiting:fade-out-0 motion-reduce:animate-none">
        <ListBox className="max-h-72 overflow-y-auto outline-none" items={options.map((o) => ({ ...o, id: key(o.value) }))}>
          {(o) => (
            <ListBoxItem
              textValue={o.label}
              className="relative flex h-control-sm cursor-default items-center rounded-md pr-8 pl-2 text-base text-secondary outline-none select-none data-focused:bg-control-hover data-focused:text-fg data-disabled:opacity-50"
            >
              {({ isSelected }) => (
                <>
                  <span className="truncate">{o.label}</span>
                  {isSelected && <CheckIcon className="absolute right-2 size-4 text-accent-text" />}
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </SelectPrimitive>
  )
}
