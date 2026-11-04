// The app window's bridge (sandboxed preload): open at login and app updates. Only for Zorel's own page.
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("zorelDesktop", {
  // Open Zorel at login (it then starts without a window).
  openAtLogin: { get: (): Promise<boolean> => ipcRenderer.invoke("login:get"), set: (on: boolean): Promise<boolean> => ipcRenderer.invoke("login:set", on) },
  // A new version: downloading (ready false) or ready to install with a restart.
  update: {
    get: (): Promise<{ version: string; ready: boolean } | null> => ipcRenderer.invoke("update:get"),
    install: (): Promise<boolean> => ipcRenderer.invoke("update:install"),
    on: (callback: (u: { version: string; ready: boolean } | null) => void) => {
      const listener = (_e: unknown, u: { version: string; ready: boolean } | null) => callback(u)
      ipcRenderer.on("update", listener)
      return () => void ipcRenderer.off("update", listener)
    }
  }
})
