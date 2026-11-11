// The desktop app's "Quit Zorel?" in Zorel's own dialog (window.zorelDesktop.quit): the app asks when the person
// quits (⌘Q, the menu, the dock), and this answers Quit or Cancel, with "Don't ask again". Only in the desktop app.
import { t } from "@zorel/i18n"
import { useEffect, useState } from "react"
import { Button, Dialog, Tick } from "@/ui"

type QuitBridge = { onAsk: (cb: () => void) => () => void; answer: (a: { quit: boolean; dontAsk: boolean }) => void }
const bridge = (window as { zorelDesktop?: { quit?: QuitBridge } }).zorelDesktop?.quit

export function QuitDialog() {
  const [open, setOpen] = useState(false)
  const [dontAsk, setDontAsk] = useState(false)
  useEffect(() => bridge?.onAsk(() => setOpen(true)), [])
  if (!bridge) return null
  const answer = (quit: boolean) => {
    bridge.answer({ quit, dontAsk: quit && dontAsk })
    setOpen(false)
  }
  return (
    <Dialog title={t("desktop.quit.title")} isOpen={open} onOpenChange={(o) => !o && answer(false)}>
      {() => (
        <>
          <p className="text-secondary">{t("desktop.quit.body")}</p>
          <Tick checked={dontAsk} onChange={setDontAsk}>
            {t("desktop.quit.dontAsk")}
          </Tick>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onPress={() => answer(false)}>
              {t("common.cancel")}
            </Button>
            <Button autoFocus onPress={() => answer(true)}>
              {t("desktop.quit.quit")}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  )
}
