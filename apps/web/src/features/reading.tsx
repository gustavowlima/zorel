// What a Settings list shows before it has an answer: "Checking…" while the first reading runs, and a warning
// row with a retry when it failed (DESIGN.md › Layout › Páginas). Nothing else may read as "empty" then.
import { t } from "@zorel/i18n"
import { Button, Rows, SettingRow } from "@/ui"

export function ReadingState({ loading, failed, onRetry }: { loading: boolean; failed: boolean; onRetry: () => void }) {
  if (failed)
    return (
      <Rows>
        <SettingRow title={t("common.loadFailed")} hint={
              <span className="text-sm text-warning">{t("common.loadFailedHint")}</span>
          }>
          <Button size="sm" variant="secondary" onPress={onRetry}>
            {t("common.retry")}
          </Button>
        </SettingRow>
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
