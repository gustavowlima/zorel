// The bridge for a team server's window (servers.ts): only switching servers and the system's notification settings.
// Nothing of this computer (folders, apps, login items, updates) is offered to a page another machine serves.
import { contextBridge, ipcRenderer } from "electron"

contextBridge.exposeInMainWorld("zorelDesktop", {
  notificationSettings: (): Promise<boolean> => ipcRenderer.invoke("notifications:settings"),
  servers: {
    list: (): Promise<{ servers: Array<{ origin: string; name: string }>; current: string }> => ipcRenderer.invoke("servers:list"),
    open: (target: string): Promise<boolean> => ipcRenderer.invoke("servers:open", target),
    // Whether each server answers now (spec 017): origin → { state, seenAt }.
    check: (): Promise<Record<string, { state: "online" | "offline"; seenAt: number | null }>> => ipcRenderer.invoke("servers:check")
  }
})
