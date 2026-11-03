// What a Settings list shows before it has an answer: "Checking…" while the first reading runs, and a warning
// row with a retry when it failed (DESIGN.md › Layout › Páginas). Nothing else may read as "empty" then.
import { t } from "@zero/i18n"
import { Button, Rows } from "@/ui"

export function ReadingState({ loading, failed, onRetry }: { loading: boolean; failed: boolean; onRetry: () => void }) {
  if (failed)
    return (
      <Rows>
        <div className="flex flex-wrap items-center gap-3 py-3.5">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-medium">{t("common.loadFailed")}</span>
            <span className="text-sm text-warning">{t("common.loadFailedHint")}</span>
          </span>
          <Button size="sm" variant="secondary" onPress={onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      </Rows>
    )
  if (loading)
    return (
      <Rows>
        <p className="py-3.5 text-sm text-muted">{t("common.checking")}</p>
      </Rows>
    )
  return null
}
