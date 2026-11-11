// A message's text as Markdown (GFM), in the chat's reading size: code blocks in a CodeBlock (language, Copy) and
// tables in a TableFrame, both able to scroll sideways; the rest is styled by .prose-chat (styles.css).
import { Children, isValidElement, type ReactNode, useMemo } from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { t } from "@zorel/i18n"
import { agentsAtom, chatsAtom, useList } from "../client.ts"
import { MentionChip } from "./mention.tsx"
import { agentUrl, linkMentions } from "./mentions.ts"
import { parseTaskReport, type TaskReport, taskIdOf } from "./task-report.ts"
import { ArrowUpRight, Badge, CodeBlock, TableFrame } from "@/ui"

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

// A link to a task a teammate was given (#/chat/<id>): a chip with the task's name, not an underlined link. It stays a
// link, so the chat opens it in its drawer (ChatView catches the click) and the keyboard reaches it.
function TaskLink({ id }: { id: string }) {
  const task = useList(chatsAtom).find((c) => c.id === id)
  return (
    <a href={`#/chat/${id}`} data-chip="" className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-subtle bg-raised py-0.5 pr-3 pl-2 align-middle text-sm font-medium text-secondary no-underline outline-none transition-colors duration-120 ease-out hover:bg-control-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none">
      <ArrowUpRight className="size-3.5 shrink-0 text-muted" />
      <span className="truncate">{task ? t("task.openNamed", { title: task.title.replace(/^[^:]+:\s*/, "") }) : t("task.open")}</span>
    </a>
  )
}

// A teammate's answer to a task in the shape the task asked for: its status as a badge in the state's color, the
// result, how it was checked (quieter), and the task.
const STATUS_TONE = { done: "success", partial: "warning", blocked: "danger" } as const
function TaskReportCard({ report: r }: { report: TaskReport }) {
  return (
    <div className="flex flex-col items-start gap-2.5 rounded-card border border-subtle bg-surface px-4 py-3">
      <Badge tone={STATUS_TONE[r.status]}>{t(`task.status.${r.status}`)}</Badge>
      {r.result && <ChatMarkdown text={r.result} />}
      {r.evidence && (
        <div className="flex flex-col gap-0.5 text-sm">
          <span className="text-dim">{t("task.evidence")}</span>
          <div className="text-muted">
            <ChatMarkdown text={r.evidence} />
          </div>
        </div>
      )}
      <TaskLink id={r.taskId} />
    </div>
  )
}

// Teammates named with @handle are links to their page (linkMentions); here they draw as chips.
export function ChatMarkdown({ text }: { text: string }) {
  const report = parseTaskReport(text)
  if (report) return <TaskReportCard report={report} />
  return <Prose text={text} />
}

function Prose({ text }: { text: string }) {
  const agents = useList(agentsAtom)
  const plugins = useMemo(() => [remarkGfm, linkMentions(agents)], [agents])
  const withMentions = useMemo<Components>(
    () => ({
      ...components,
      a: ({ href, children, node: _node, ...props }) => {
        const agent = href?.startsWith(agentUrl("")) ? agents.find((a) => a.id === href.slice(agentUrl("").length)) : undefined
        if (agent) return <MentionChip agent={agent} agents={agents} />
        const task = taskIdOf(href)
        return task ? <TaskLink id={task} /> : <a href={href} {...props}>{children}</a>
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
