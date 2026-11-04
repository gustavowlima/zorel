// The app window's bridge (sandboxed preload): the Browser panel places the native agent browser and hears when a
// person clicks it. Only for Zorel's own page; agent tabs get no preload.
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("zorelDesktop", {
  browser: (state: { tab: string; rect: { x: number; y: number; width: number; height: number }; overlay: boolean } | null) => ipcRenderer.send("browser:show", state),
  // Open Zorel at login (it then starts without a window).
  openAtLogin: { get: (): Promise<boolean> => ipcRenderer.invoke("login:get"), set: (on: boolean): Promise<boolean> => ipcRenderer.invoke("login:set", on) },
  onTake: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on("browser:take", listener)
    return () => void ipcRenderer.off("browser:take", listener)
  }
})
