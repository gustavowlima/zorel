// The app window's bridge (sandboxed preload): open at login and app updates. Only for Zorel's own page.
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("zorelDesktop", {
  // Open Zorel at login (it then starts without a window).
  openAtLogin: { get: (): Promise<boolean> => ipcRenderer.invoke("login:get"), set: (on: boolean): Promise<boolean> => ipcRenderer.invoke("login:set", on) },
  // The system's notification settings for Zorel (false where there's no such page).
  notificationSettings: (): Promise<boolean> => ipcRenderer.invoke("notifications:settings"),
  // Keep the computer awake (on power) so routines run on time.
  keepAwake: { get: (): Promise<boolean> => ipcRenderer.invoke("awake:get"), set: (on: boolean): Promise<boolean> => ipcRenderer.invoke("awake:set", on) },
  // A new version: downloading (ready false) or ready to install with a restart.
  update: {
    get: (): Promise<{ version: string; ready: boolean; percent?: number } | null> => ipcRenderer.invoke("update:get"),
    install: (): Promise<boolean> => ipcRenderer.invoke("update:install"),
    check: (): Promise<"latest" | "available" | "failed" | "unsupported"> => ipcRenderer.invoke("update:check"),
    on: (callback: (u: { version: string; ready: boolean; percent?: number } | null) => void) => {
      const listener = (_e: unknown, u: { version: string; ready: boolean; percent?: number } | null) => callback(u)
      ipcRenderer.on("update", listener)
      return () => void ipcRenderer.off("update", listener)
    }
  }
})
