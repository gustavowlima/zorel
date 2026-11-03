// Message box (DESIGN.md "Campo de mensagem"): a 16px card with a growing text area, attachments as chips
// above the text, and one toolbar: attach, the slots the screen passes (agent, model), then stop and send.
// While a turn runs, sending adds the text to that turn when the engine can (steer), else it queues.
import { type Attachment, MAX_ATTACHMENTS } from "@zero/contracts"
import { t } from "@zero/i18n"
import { type ReactNode, useRef, useState } from "react"
import { attachmentUrl } from "../client.ts"
import { ArrowUp, BareTextarea, cx, File, IconButton, Paperclip, pickFiles, Spinner, Square, Tooltip, X } from "@/ui"

const MAX_ROWS = 10

export function Composer({
  onSubmit,
  upload,
  busy = false,
  onStop,
  placeholder,
  tools,
  autoFocus
}: {
  onSubmit: (text: string, attachmentIds: ReadonlyArray<string>) => Promise<unknown>
  upload: (file: File) => Promise<Attachment>
  busy?: boolean
  onStop?: () => void
  placeholder: string
  tools?: ReactNode
  autoFocus?: boolean
}) {
  const [text, setText] = useState("")
  const [files, setFiles] = useState<ReadonlyArray<Attachment>>([])
  const [uploading, setUploading] = useState(0)
  const [error, setError] = useState<string>()
  const [dragging, setDragging] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)

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

  const canSend = (text.trim().length > 0 || files.length > 0) && uploading === 0
  const submit = () => {
    if (!canSend) return
    const body = text.trim() || t("composer.seeAttachments")
    const ids = files.map((f) => f.id)
    setText("")
    setFiles([])
    setError(undefined)
    onSubmit(body, ids).catch(() => {
      // Nothing is lost: the text comes back so it can be sent again.
      setText((current) => current || body)
      setError(t("chat.sendFailed"))
    })
    box.current?.focus()
  }

  const rows = Math.min(MAX_ROWS, Math.max(2, text.split("\n").length))

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
        "relative flex flex-col gap-2 rounded-sheet border bg-canvas px-2.5 pt-3.5 pb-2.5 transition-colors duration-150 ease-out motion-reduce:transition-none",
        dragging ? "border-accent-line bg-accent-faint" : "border-strong"
      )}
    >
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
      <BareTextarea
        ref={box}
        value={text}
        rows={rows}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          if (!e.clipboardData.files.length) return
          e.preventDefault()
          attach(e.clipboardData.files)
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
          e.preventDefault()
          submit()
        }}
        placeholder={dragging ? t("composer.dropHere") : placeholder}
        aria-label={t("composer.label")}
        {...(autoFocus && { autoFocus })}
      />
      <div className="flex flex-wrap items-center gap-1">
        <IconButton label={t("composer.attach")} isDisabled={files.length >= MAX_ATTACHMENTS} onPress={() => void pickFiles().then(attach)}>
          <Paperclip />
        </IconButton>
        {tools}
        <span className="flex-1" />
        {busy && onStop && (
          <Tooltip content={t("composer.stop")}>
            <IconButton label={t("composer.stop")} variant="secondary" onPress={onStop}>
              <Square className="size-3 fill-current" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip content={busy ? t("composer.steer") : t("composer.send")}>
          <IconButton label={busy ? t("composer.steer") : t("composer.send")} variant="default" type="submit" isDisabled={!canSend}>
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
      <IconButton label={t("composer.removeFile", { name: file.name })} size="sm" className="rounded-full" onPress={onRemove}>
        <X className="size-3.5" />
      </IconButton>
    </span>
  )
}
