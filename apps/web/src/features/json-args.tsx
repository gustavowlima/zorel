// A tool's arguments as JSON (the form's other mode): CodeMirror with what the tool says about its inputs — its
// fields and their choices offered as you type, a field's description on hover, and what's wrong underlined on the
// key it's on (the same checks as the form, argProblems). Loaded only when the JSON mode is opened.
import { autocompletion, closeBrackets, closeBracketsKeymap, type Completion, type CompletionContext, completionKeymap } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { json, jsonParseLinter } from "@codemirror/lang-json"
import { bracketMatching, HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language"
import { type Diagnostic, linter } from "@codemirror/lint"
import { EditorState } from "@codemirror/state"
import { EditorView, hoverTooltip, keymap, placeholder } from "@codemirror/view"
import type { JsonSchema } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import { tags } from "@lezer/highlight"
import { useEffect, useRef, useState } from "react"
import { argProblems, type Prop } from "./schema-rules.ts"

type Args = Record<string, unknown>

// The theme's own tokens, so the editor reads as one of the app's fields in both themes.
const theme = EditorView.theme({
  "&": { color: "var(--z-text)", backgroundColor: "transparent", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { fontFamily: "var(--font-mono)", padding: "8px 0", minHeight: "128px", caretColor: "var(--z-text)" },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": { display: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--z-accent-soft)" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-placeholder": { color: "var(--z-text-dim)" },
  ".cm-tooltip": { backgroundColor: "var(--z-bg-raised)", border: "1px solid var(--z-border-strong)", borderRadius: "8px", color: "var(--z-text)" },
  ".cm-tooltip-autocomplete > ul > li": { padding: "4px 8px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--z-accent-soft)", color: "var(--z-text)" },
  ".cm-completionDetail": { color: "var(--z-text-muted)", fontStyle: "normal", marginLeft: "8px" },
  ".cm-completionInfo": { padding: "6px 8px", maxWidth: "320px" },
  ".cm-tooltip-lint, .cm-hint": { padding: "6px 8px", maxWidth: "360px", fontSize: "13px" },
  ".cm-hint-type": { color: "var(--z-text-muted)" },
  ".cm-diagnostic": { padding: "0", border: "none" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--z-danger)", textUnderlineOffset: "3px" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--z-warning)", textUnderlineOffset: "3px" }
})
const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--z-accent-text)" },
  { tag: tags.string, color: "var(--z-success)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--z-warning)" },
  { tag: [tags.brace, tags.squareBracket, tags.separator, tags.punctuation], color: "var(--z-text-muted)" }
])

// The key a property name holds (its text without the quotes).
const keyAt = (view: EditorView, from: number, to: number) => {
  try {
    return JSON.parse(view.state.sliceDoc(from, to)) as string
  } catch {
    return undefined
  }
}
// The top-level keys and where each is written.
function topKeys(view: EditorView): Map<string, { from: number; to: number }> {
  const out = new Map<string, { from: number; to: number }>()
  const top = syntaxTree(view.state).topNode.getChild("Object")
  for (let p = top?.firstChild; p; p = p.nextSibling) {
    const name = p.name === "Property" ? p.getChild("PropertyName") : null
    const key = name ? keyAt(view, name.from, name.to) : undefined
    if (name && key !== undefined) out.set(key, { from: name.from, to: name.to })
  }
  return out
}

const typeLabel = (p: Prop) => (p.enum?.length ? p.enum.map((x) => JSON.stringify(x)).join(" | ") : typeof p.type === "string" ? p.type : "")

function extensions(schema: JsonSchema, onText: (text: string) => void) {
  const props = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  // A field's name after "{" or ",", or a choice after "field":.
  const complete = (ctx: CompletionContext) => {
    const before = ctx.state.sliceDoc(0, ctx.pos)
    const value = /"([^"\\]+)"\s*:\s*("?[\w.-]*)$/.exec(before)
    if (value) {
      const p = props[value[1]!]
      const choices = p?.enum?.length ? p.enum : p?.type === "boolean" ? [true, false] : []
      if (!choices.length) return null
      return { from: ctx.pos - value[2]!.length, options: choices.map((x): Completion => ({ label: JSON.stringify(x), type: "constant" })) }
    }
    const name = /[{,]\s*("?[\w$-]*)$/.exec(before)
    if (!name || (!ctx.explicit && !name[1])) return null
    const used = new Set([...ctx.state.doc.toString().matchAll(/"([^"\\]+)"\s*:/g)].map((m) => m[1]!))
    return {
      from: ctx.pos - name[1]!.length,
      options: Object.entries(props)
        .filter(([k]) => !used.has(k))
        .map(([k, p]): Completion => ({ label: `"${k}"`, apply: `"${k}": `, detail: [typeLabel(p), required.has(k) ? "*" : ""].filter(Boolean).join(" "), ...(p.description && { info: p.description }), type: "property", boost: required.has(k) ? 1 : 0 }))
    }
  }
  // The checks the form makes, on the key they're about (a missing field on the opening brace).
  const check = linter((view) => {
    let args: unknown
    try {
      args = JSON.parse(view.state.doc.toString())
    } catch {
      return [] // jsonParseLinter says where the JSON breaks
    }
    const at = topKeys(view)
    return argProblems(schema, args).map((p): Diagnostic => {
      const range = (p.key && at.get(p.key)) || { from: 0, to: Math.min(1, view.state.doc.length) }
      return { ...range, severity: p.key && !props[p.key] ? "warning" : "error", message: p.message }
    })
  })
  // A field's name, its type and its description, on hover.
  const hint = hoverTooltip((view, pos) => {
    const node = syntaxTree(view.state).resolveInner(pos, 1)
    if (node.name !== "PropertyName") return null
    const key = keyAt(view, node.from, node.to)
    const p = key === undefined ? undefined : props[key]
    if (!p || key === undefined) return null
    return {
      pos: node.from,
      end: node.to,
      above: true,
      create: () => {
        const dom = document.createElement("div")
        dom.className = "cm-hint"
        const head = document.createElement("div")
        head.className = "cm-hint-type"
        head.textContent = [key, typeLabel(p), required.has(key) ? t("flows.form.requiredShort") : ""].filter(Boolean).join(" · ")
        dom.append(head)
        if (p.description) dom.append(document.createTextNode(p.description))
        return { dom }
      }
    }
  })
  return [
    history(),
    closeBrackets(),
    bracketMatching(),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
    json(),
    linter(jsonParseLinter()),
    check,
    autocompletion({ override: [complete], icons: false }),
    hint,
    syntaxHighlighting(highlight),
    EditorView.lineWrapping,
    placeholder('{ "…": … }'),
    theme,
    EditorView.contentAttributes.of({ "aria-label": t("flows.form.json") }),
    EditorView.updateListener.of((u) => u.docChanged && onText(u.state.doc.toString()))
  ]
}

// The editor: the arguments as text; each change that parses to an object is the new arguments.
export default function JsonArgs({ schema, value, onChange }: { schema: JsonSchema; value: Args; onChange: (next: Args) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [bad, setBad] = useState(false)
  const change = useRef(onChange)
  change.current = onChange
  // Made once: the caller keys it by tool, so a new tool (a new schema) is a new editor; the text then lives in it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: JSON.stringify(value, null, 2),
        extensions: extensions(schema, (text) => {
          try {
            const parsed: unknown = JSON.parse(text)
            const ok = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            setBad(!ok)
            if (ok) change.current(parsed as Args)
          } catch {
            setBad(true)
          }
        })
      })
    })
    return () => view.destroy()
  }, [])
  return (
    <div className="flex flex-col gap-1.5">
      <div ref={host} className="overflow-hidden rounded-control border border-strong bg-field transition-colors focus-within:border-fg/25 hover:border-fg/20" />
      <span className="text-sm text-dim">{bad ? t("flows.form.badJson") : t("flows.form.jsonHint")}</span>
    </div>
  )
}
