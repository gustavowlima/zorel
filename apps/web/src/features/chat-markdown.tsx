// A message's text as Markdown (GFM), in the chat's reading size: code blocks in a CodeBlock (language, Copy) and
// tables in a TableFrame, both able to scroll sideways; the rest is styled by .prose-chat (styles.css).
import { Children, isValidElement, type ReactNode, useMemo } from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { agentsAtom, useList } from "../client.ts"
import { MentionChip } from "./mention.tsx"
import { agentUrl, linkMentions } from "./mentions.ts"
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

// Teammates named with @handle are links to their page (linkMentions); here they draw as chips.
export function ChatMarkdown({ text }: { text: string }) {
  const agents = useList(agentsAtom)
  const plugins = useMemo(() => [remarkGfm, linkMentions(agents)], [agents])
  const withMentions = useMemo<Components>(
    () => ({
      ...components,
      a: ({ href, children, node: _node, ...props }) => {
        const agent = href?.startsWith(agentUrl("")) ? agents.find((a) => a.id === href.slice(agentUrl("").length)) : undefined
        return agent ? <MentionChip agent={agent} agents={agents} /> : <a href={href} {...props}>{children}</a>
      }
    }),
    [agents]
  )
  return (
    <div className="prose-chat text-chat">
      <Markdown remarkPlugins={plugins} components={withMentions}>
        {text}
      </Markdown>
    </div>
  )
}
