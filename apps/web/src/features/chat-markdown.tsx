// A message's text as Markdown (GFM), in the chat's reading size: code blocks in a CodeBlock (language, Copy) and
// tables in a TableFrame, both able to scroll sideways; the rest is styled by .prose-chat (styles.css).
import { Children, isValidElement, type ReactNode } from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { CodeBlock, TableFrame } from "@/ui"

// The code element inside a <pre>: its text and the language GFM put in its class ("language-ts").
function codeOf(children: ReactNode): { code: string; language: string | undefined } {
  const el = Children.toArray(children).find(isValidElement) as { props: { className?: string; children?: ReactNode } } | undefined
  const raw = el ? el.props.children : children
  const code = (Array.isArray(raw) ? raw.join("") : String(raw ?? "")).replace(/\n$/, "")
  return { code, language: /language-([\w+-]+)/.exec(el?.props.className ?? "")?.[1] }
}

const components: Components = {
  pre: ({ children }) => <CodeBlock {...codeOf(children)} />,
  table: ({ children }) => (
    <TableFrame>
      <table>{children}</table>
    </TableFrame>
  )
}

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="prose-chat text-chat">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  )
}
