// Code in a message: a frame with a header (the language, Copy) over the code, which scrolls sideways rather than
// wrapping. Tables get the same frame (TableFrame) so wide ones scroll inside it.
import { t } from "@zorel/i18n"
import { type ReactNode, useState } from "react"
import { cn } from "@/lib/utils"
import { IconButton } from "./button"
import { Check, Copy } from "./icons"
import { Tooltip } from "./tooltip"

export function CodeBlock({ code, language }: { code: string; language?: string | undefined }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  return (
    <div className="overflow-hidden rounded-card border border-subtle bg-code">
      <div className="flex h-8 items-center justify-between border-b border-subtle pr-1 pl-3 text-xs text-muted">
        <span className="font-mono">{language || t("code.plain")}</span>
        <Tooltip content={copied ? t("common.copied") : t("common.copy")}>
          <IconButton label={t("common.copy")} size="xs" onPress={copy}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </IconButton>
        </Tooltip>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-sm leading-5">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export const TableFrame = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("overflow-x-auto rounded-card border border-subtle", className)}>{children}</div>
)

// A working label with a light sweeping across it (reduced motion: still muted text).
export const ShimmerText = ({ children }: { children: ReactNode }) => <span className="shimmer-text">{children}</span>
