// Message box (the chosen redesign): one bar — attach, the text, the slots the screen passes (agent, model,
// context), then stop and a round send. The text is a Tiptap editor so references are chips inside it:
// "@" picks an agent of the chat or a file of the project, "$" a skill, "/" runs a command. Chips go to the server as plain text
// (@handle, $skill-handle), which it already reads; commands never leave the browser. Enter sends,
// Shift+Enter breaks the line. "#" picks who answers (the chat's lead) and, like "/", leaves nothing in the text.
// Attachments sit as chips above the bar.
import { type Attachment, MAX_ATTACHMENTS } from "@zorel/contracts"
import { t } from "@zorel/i18n"
import Document from "@tiptap/extension-document"
import Mention from "@tiptap/extension-mention"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import { Extension } from "@tiptap/core"
import { Placeholder, UndoRedo } from "@tiptap/extensions"
import { EditorContent, useEditor } from "@tiptap/react"
import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from "@tiptap/suggestion"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { attachmentUrl } from "../client.ts"
import { ArrowUp, cx, File, IconButton, OptionList, OptionRow, pickFiles, Plus, Spinner, Square, Tooltip, X } from "@/ui"

// Something "@", "#", "$" or "/" can pick. `id` is what the text carries after the trigger (an agent's handle, a
// skill's handle); commands run `run` instead of leaving a chip, and a command without `run` (the engine's own)
// is written out as "/id " for the engine to run when the message is sent.
export interface ComposerOption {
  readonly id: string
  readonly label: string
  readonly hint?: string
  readonly icon?: ReactNode
  readonly run?: () => void
}

// A reason to show as it is when a submit fails (the other failures read "Couldn't send").
export class SendError extends Error {}
export interface ComposerSources {
  readonly agents?: ReadonlyArray<ComposerOption> // "@": mention a member in the message, or a file (path as id)
  readonly skills?: ReadonlyArray<ComposerOption> // "$"
  readonly commands?: ReadonlyArray<ComposerOption> // "/" at the start of a line
  readonly leads?: ReadonlyArray<ComposerOption> // "#": call an agent (the same chip as "@")
}

type Trigger = "@" | "$" | "/" | "#"
// Triggers that run their option instead of leaving a chip.
const ACTIONS: ReadonlySet<Trigger> = new Set(["/"])
const LIST_LABELS = { "@": "composer.agents", $: "composer.skills", "/": "composer.commands", "#": "composer.leads" } as const
type Menu = { trigger: Trigger; items: ReadonlyArray<ComposerOption>; selected: number; pick: (o: ComposerOption) => void }

const MAX_OPTIONS = 8
const ENTER = "Enter" // a ProseMirror key name (spelled as a constant so lint doesn't read it as a component)
// Options whose id or a word of the label starts with the query come first, then those that only contain it.
const match = (options: ReadonlyArray<ComposerOption> | undefined, query: string) => {
  const q = query.toLowerCase()
  const rank = (o: ComposerOption) => {
    const words = [o.id, ...o.label.split(/[\s/]+/)].map((w) => w.toLowerCase()) // a file also matches by its name
    if (words.some((w) => w.startsWith(q))) return words[0]?.startsWith(q) ? 0 : 1
    return o.id.toLowerCase().includes(q) || o.label.toLowerCase().includes(q) ? 2 : 3
  }
  return (options ?? [])
    .map((o) => ({ o, r: rank(o) }))
    .filter((x) => x.r < 3)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.o)
    .slice(0, MAX_OPTIONS)
}

export function Composer({
  onSubmit,
  upload,
  busy = false,
  onStop,
  placeholder,
  tools,
  sources,
  initialText = "",
  autoFocus,
  insertRef
}: {
  onSubmit: (text: string, attachmentIds: ReadonlyArray<string>) => Promise<unknown>
  upload: (file: File) => Promise<Attachment>
  busy?: boolean
  onStop?: () => void
  placeholder: string
  tools?: ReactNode
  sources?: ComposerSources
  initialText?: string // a queued message brought back to edit
  autoFocus?: boolean
  insertRef?: { current: ((text: string) => void) | undefined } // others add text at the end (terminal output)
}) {
  const [files, setFiles] = useState<ReadonlyArray<Attachment>>([])
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const [empty, setEmpty] = useState(!initialText)
  const [menu, setMenu] = useState<Menu>()
  // The editor is built once; what changes later (sources, files, the submit itself) is read through refs.
  const live = useRef({ sources, menu, placeholder, submit: () => {}, attach: (_: Iterable<File>) => {} })

  const attach = (list: Iterable<File>) => {
    setError(undefined)
    for (const f of [...list].slice(0, MAX_ATTACHMENTS - files.length)) {
      setUploading((n) => n + 1)
      upload(f)
        .then(
          (a) => setFiles((x) => [...x, a]),
          (e: unknown) => setError(e instanceof Error ? e.message : String(e))
        )
        .finally(() => setUploading((n) => n - 1))
    }
  }

  const editor = useEditor({
    autofocus: autoFocus ? "end" : false,
    immediatelyRender: true,
    content: textToDoc(initialText),
    extensions: [
      Document,
      Paragraph,
      Text,
      UndoRedo,
      Placeholder.configure({ placeholder: () => live.current.placeholder }),
      Mention.configure({
        deleteTriggerWithBackspace: true,
        renderText: ({ node }) => `${node.attrs.mentionSuggestionChar}${node.attrs.id}`,
        renderHTML: ({ node }) => [
          "span",
          { class: cx("rounded-control px-1 py-px font-medium", node.attrs.mentionSuggestionChar === "@" ? "bg-accent-soft text-accent-text" : "bg-surface text-fg"), "data-ref": node.attrs.mentionSuggestionChar },
          `${node.attrs.mentionSuggestionChar}${node.attrs.label ?? node.attrs.id}`
        ],
        suggestions: [suggestion("@", live, setMenu), suggestion("$", live, setMenu), suggestion("/", live, setMenu), suggestion("#", live, setMenu)]
      }),
      // Enter sends unless a list of options is open; Shift+Enter is a new line.
      Extension.create({
        name: "send",
        addKeyboardShortcuts: () => ({
          [ENTER]: () => {
            if (live.current.menu) return false
            live.current.submit()
            return true
          }
        })
      })
    ],
    editorProps: {
      attributes: { class: "composer-editor", "aria-label": t("composer.label"), "aria-multiline": "true", role: "textbox" },
      handlePaste: (_view, event) => {
        if (!event.clipboardData?.files.length) return false
        live.current.attach(event.clipboardData.files)
        return true
      },
      handleDrop: (_view, event) => !!(event as DragEvent).dataTransfer?.files.length // the form takes the files
    },
    onUpdate: ({ editor: e }) => setEmpty(e.isEmpty)
  })
  // Text from elsewhere (a terminal selection) goes after what is already typed, on new lines, and keeps focus.
  useEffect(() => {
    if (!insertRef || !editor) return
    insertRef.current = (text: string) => {
      const blocks = textToDoc(text).content
      editor.chain().focus("end").insertContent(editor.isEmpty ? blocks : [{ type: "paragraph" }, ...blocks]).run()
    }
    return () => {
      insertRef.current = undefined
    }
  }, [editor, insertRef])

  const canSend = (!empty || files.length > 0) && uploading === 0
  const submit = () => {
    if (!editor || !canSend) return
    const body = editor.getText({ blockSeparator: "\n" }).trim() || t("composer.seeAttachments")
    const ids = files.map((f) => f.id)
    editor.commands.clearContent(true)
    setFiles([])
    setError(undefined)
    onSubmit(body, ids).catch((e: unknown) => {
      // Nothing is lost: the text comes back so it can be sent again.
      if (editor.isEmpty) editor.commands.setContent(textToDoc(body))
      setError(e instanceof SendError ? e.message : t("chat.sendFailed"))
    })
    editor.commands.focus()
  }
  live.current = { sources, menu, placeholder: dragging ? t("composer.dropHere") : placeholder, submit, attach }

  // The placeholder follows the drag state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the view only needs a redraw
  useEffect(() => {
    editor?.view.dispatch(editor.state.tr)
  }, [dragging, placeholder])

  return (
    <form
      aria-label={t("composer.label")}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        attach(e.dataTransfer.files)
      }}
      className={cx(
        "relative flex flex-col gap-1.5 rounded-card border bg-canvas p-1.5 pl-2 transition-colors duration-150 ease-out motion-reduce:transition-none",
        dragging ? "border-accent-line bg-accent-faint" : "border-strong"
      )}
    >
      {menu && <MenuOptions menu={menu} onHover={(i) => setMenu({ ...menu, selected: i })} />}
      {(files.length > 0 || uploading > 0) && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {files.map((f) => (
            <AttachmentChip key={f.id} file={f} onRemove={() => setFiles((x) => x.filter((y) => y.id !== f.id))} />
          ))}
          {uploading > 0 && (
            <span className="inline-flex h-control-sm items-center gap-1.5 px-2 text-sm text-muted">
              <Spinner size={12} /> {t("composer.attaching")}
            </span>
          )}
        </div>
      )}
      {/* The message's controls (model, access, context) in a row above the text, so the text keeps the full width. */}
      {tools && <div className="flex min-w-0 items-center gap-0.5">{tools}</div>}
      <div className="flex items-end gap-1">
        <IconButton label={t("composer.attach")} className="size-control" isDisabled={files.length >= MAX_ATTACHMENTS} onPress={() => void pickFiles().then(attach)}>
          <Plus />
        </IconButton>
        <EditorContent editor={editor} className="min-w-0 flex-1 self-center" />
        {busy && onStop && (
          <Tooltip content={t("composer.stop")}>
            <IconButton label={t("composer.stop")} variant="secondary" shape="pill" size="md" onPress={onStop}>
              <Square className="size-3 fill-current" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip content={busy ? t("composer.queue") : t("composer.send")}>
          <IconButton label={busy ? t("composer.queue") : t("composer.send")} variant="default" type="submit" shape="pill" size="md" isDisabled={!canSend}>
            <ArrowUp />
          </IconButton>
        </Tooltip>
      </div>
      {error && (
        <p role="alert" className="px-2 text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  )
}

// Plain text (with @handle and $handle as text) back into the editor: one paragraph per line.
const textToDoc = (text: string) => ({
  type: "doc",
  content: (text ? text.split("\n") : [""]).map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] }))
})

// One trigger's suggestion: options from the screen's sources, the list drawn by OptionList above the bar, the
// keys handled here. "/" only at the start of a line, and it runs the command instead of leaving a chip.
function suggestion(
  char: Trigger,
  live: { current: { sources: ComposerSources | undefined; menu: Menu | undefined } },
  setMenu: (m: Menu | undefined) => void
): Omit<SuggestionOptions<ComposerOption>, "editor"> {
  const sourceOf = () => ({ "@": live.current.sources?.agents, $: live.current.sources?.skills, "/": live.current.sources?.commands, "#": live.current.sources?.leads })[char]
  const show = (props: SuggestionProps<ComposerOption>) =>
    setMenu(props.items.length ? { trigger: char, items: props.items, selected: Math.min(live.current.menu?.trigger === char ? live.current.menu.selected : 0, props.items.length - 1), pick: (o) => props.command(o) } : undefined)
  return {
    char,
    startOfLine: char === "/",
    allowSpaces: false,
    items: ({ query }) => match(sourceOf(), query),
    command: ({ editor, range, props }) => {
      if (ACTIONS.has(char) && props.run) {
        editor.chain().focus().deleteRange(range).run()
        props.run()
        return
      }
      if (char === "/") {
        editor.chain().focus().insertContentAt(range, `/${props.id} `).run()
        return
      }
      // "#" calls an agent exactly as "@" does: the same chip, and "@handle" in the text.
      const mark = char === "#" ? "@" : char
      editor
        .chain()
        .focus()
        .insertContentAt(range, [{ type: "mention", attrs: { id: props.id, label: props.label, mentionSuggestionChar: mark } }, { type: "text", text: " " }])
        .run()
    },
    render: () => ({
      onStart: show,
      onUpdate: show,
      onExit: () => setMenu(undefined),
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        const m = live.current.menu
        if (!m) return false
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const step = event.key === "ArrowDown" ? 1 : -1
          setMenu({ ...m, selected: (m.selected + step + m.items.length) % m.items.length })
          return true
        }
        if (event.key === "Enter" || event.key === "Tab") {
          const item = m.items[m.selected]
          if (item) m.pick(item)
          return true
        }
        if (event.key === "Escape") {
          setMenu(undefined)
          return true
        }
        return false
      }
    })
  }
}

// The options of the open trigger, above the bar. The editor keeps the focus: arrows move, Enter picks.
function MenuOptions({ menu, onHover }: { menu: Menu; onHover: (i: number) => void }) {
  return (
    <OptionList label={t(LIST_LABELS[menu.trigger])} className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-72 rounded-card border border-strong bg-float shadow-float backdrop-blur-xl backdrop-saturate-150">
      {menu.items.map((o, i) => (
        <OptionRow key={o.id} selected={i === menu.selected} icon={o.icon} onHover={() => onHover(i)} onPick={() => menu.pick(o)} className="h-control">
          <span className="max-w-1/2 shrink-0 truncate">{o.label}</span>
          <span className="min-w-0 truncate text-sm text-muted">{o.hint ?? `${menu.trigger}${o.id}`}</span>
        </OptionRow>
      ))}
    </OptionList>
  )
}

function AttachmentChip({ file, onRemove }: { file: Attachment; onRemove: () => void }) {
  const image = file.mime.startsWith("image/")
  return (
    <span className="inline-flex h-control-sm max-w-60 items-center gap-1.5 rounded-full bg-surface pr-0.5 pl-1 text-sm text-secondary">
      {image ? (
        <img src={attachmentUrl(file.id)} alt="" className="size-5 rounded-full object-cover" />
      ) : (
        <span className="flex size-5 items-center justify-center text-muted">
          <File className="size-3.5" />
        </span>
      )}
      <span className="truncate">{file.name}</span>
      <IconButton label={t("composer.removeFile", { name: file.name })} size="xs" shape="pill" onPress={onRemove}>
        <X className="size-3.5" />
      </IconButton>
    </span>
  )
}
