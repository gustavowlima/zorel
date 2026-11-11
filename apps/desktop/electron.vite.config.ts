// The desktop app's build and dev (electron-vite): the main process and the preload, bundled as CommonJS into dist/,
// and the window's interface, which is apps/web (its own Vite config: plugins, aliases, the proxy to the server).
// `electron-vite dev --watch`: the interface updates in place (HMR), a preload change reloads the window, a main change
// restarts Electron. The server isn't watched: restarting it would stop the agents' turns.
import { fileURLToPath } from "node:url"
import { defineConfig } from "electron-vite"
import web from "../web/vite.config.ts"

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url))
// Entries into dist/<name>.cjs; dist holds them all, so no build empties it.
const bundle = (...names: string[]) => ({
  outDir: at("dist"),
  emptyOutDir: false,
  rollupOptions: { input: Object.fromEntries(names.map((n) => [n, at(`src/${n}.ts`)])), output: { format: "cjs" as const, entryFileNames: "[name].cjs" } }
})

export default defineConfig({
  main: { build: bundle("main") },
  preload: { build: bundle("preload", "preload-server") }, // the app's window, and a team server's (servers.ts)
  renderer: {
    ...web,
    root: at("../web"),
    // 127.0.0.1, not localhost: the server only accepts a local Host, and the app adds its secret to 127.0.0.1 only.
    server: { ...web.server, host: "127.0.0.1" },
    build: { outDir: at("../web/dist"), emptyOutDir: true, rollupOptions: { input: at("../web/index.html") } }
  }
})
