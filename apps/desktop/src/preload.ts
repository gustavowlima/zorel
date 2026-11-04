// The app window's bridge (sandboxed preload): the Browser panel places the native agent browser and hears when a
// person clicks it. Only for Zero's own page; agent tabs get no preload.
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("zeroDesktop", {
  browser: (state: { tab: string; rect: { x: number; y: number; width: number; height: number }; overlay: boolean } | null) => ipcRenderer.send("browser:show", state),
  onTake: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on("browser:take", listener)
    return () => void ipcRenderer.off("browser:take", listener)
  }
})
