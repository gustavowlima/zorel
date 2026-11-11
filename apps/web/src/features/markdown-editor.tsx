// A page written as it reads (TipTap with its official Markdown extension): headings, lists, bold, links and code show
// as they will look, typing "## " or "- " turns into them, a small toolbar does the same for those who don't type
// Markdown, and what is saved is still plain Markdown (what agents read and write). Loaded only when a page is being
// written.
import { t } from "@zorel/i18n"
import { Placeholder } from "@tiptap/extensions"
import { Markdown } from "@tiptap/markdown"
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import type { ReactNode } from "react"
import { Bold, Code2, Heading1, Heading2, Heading3, IconButton, Italic, List, ListOrdered, TextQuote } from "@/ui"

// The toolbar: each button, whether it's on where the cursor is, and what it toggles.
type Tool = { key: string; icon: ReactNode; on: (e: Editor) => boolean; run: (e: Editor) => void }
const TOOLS: ReadonlyArray<ReadonlyArray<Tool>> = [
  [1, 2, 3].map((level) => ({
    key: `h${level}`,
    icon: [<Heading1 key="1" />, <Heading2 key="2" />, <Heading3 key="3" />][level - 1],
    on: (e: Editor) => e.isActive("heading", { level }),
    run: (e: Editor) => e.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run()
  })),
  [
    { key: "bold", icon: <Bold />, on: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
    { key: "italic", icon: <Italic />, on: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
    { key: "code", icon: <Code2 />, on: (e) => e.isActive("code"), run: (e) => e.chain().focus().toggleCode().run() }
  ],
  [
    { key: "bullets", icon: <List />, on: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
    { key: "numbers", icon: <ListOrdered />, on: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
    { key: "quote", icon: <TextQuote />, on: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() }
  ]
]

export default function MarkdownEditor({ value, onChange, label, placeholder, autoFocus }: { value: string; onChange: (markdown: string) => void; label: string; placeholder?: string; autoFocus?: boolean }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), Markdown, Placeholder.configure({ placeholder: placeholder ?? "" })],
    content: value,
    contentType: "markdown",
    autofocus: autoFocus ? "end" : false,
    immediatelyRender: true,
    // The page's own reading styles, so writing it looks like reading it.
    editorProps: { attributes: { class: "prose-chat prose-page text-chat min-h-80 px-4 py-3 outline-none", "aria-label": label, "aria-multiline": "true", role: "textbox" } },
    onUpdate: ({ editor: e }) => onChange(e.getMarkdown())
  })
  // Which tools are on where the cursor is (re-read as it moves or the text changes).
  const on = useEditorState({ editor, selector: ({ editor: e }) => (e ? Object.fromEntries(TOOLS.flat().map((tool) => [tool.key, tool.on(e)])) : {}) })
  return (
    <div className="flex flex-col rounded-control border border-strong bg-field transition-colors focus-within:border-fg/25 hover:border-fg/20">
      <div role="toolbar" aria-label={t("pages.format")} className="flex flex-wrap items-center gap-0.5 border-b border-subtle px-1.5 py-1">
        {TOOLS.map((group, g) => (
          <span key={group[0]!.key} className={g > 0 ? "flex items-center gap-0.5 border-l border-subtle pl-1.5 ml-1" : "flex items-center gap-0.5"}>
            {group.map((tool) => (
              <IconButton key={tool.key} size="xs" label={t(`pages.tool.${tool.key}` as "pages.tool.bold")} aria-pressed={!!on?.[tool.key]} className={on?.[tool.key] ? "bg-control-active text-fg" : ""} onPress={() => editor && tool.run(editor)}>
                {tool.icon}
              </IconButton>
            ))}
          </span>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
