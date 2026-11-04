// A file's change as an editor marks it: A (added), M (modified), D (deleted), R (renamed), in the status colors,
// named for screen readers. Nothing (an empty slot of the same width) when it didn't change.
import { t } from "@zorel/i18n"
import { cn } from "@/lib/utils"

export type FileStatus = "added" | "modified" | "deleted" | "renamed"

export const StatusMark = ({ status }: { status: FileStatus | null }) =>
  status ? (
    <span
      role="img"
      aria-label={t(`workspace.${status}`)}
      className={cn(
        "w-3 shrink-0 text-center font-mono text-xs font-semibold",
        status === "added" && "text-success",
        status === "deleted" && "text-danger",
        status === "modified" && "text-warning",
        status === "renamed" && "text-accent-text"
      )}
    >
      {status[0]!.toUpperCase()}
    </span>
  ) : (
    <span className="w-3 shrink-0" />
  )
