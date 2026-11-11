// The desktop app's build and dev (electron-vite): the main process and the preload, bundled as CommonJS into dist/,
// and the window's interface, which is apps/web (its own Vite config: plugins, aliases, the proxy to the server).
// `electron-vite dev --watch`: the interface updates in place (HMR), a preload change reloads the window, a main change
// restarts Electron. The server isn't watched: restarting it would stop the agents' turns.
import { fileURLToPath } from "node:url"
import { defineConfig } from "electron-vite"
import web from "../web/vite.config.ts"

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url))
// One entry into dist/<name>.cjs; dist holds both, so neither build empties it.
const bundle = (name: string) => ({
  outDir: at("dist"),
  emptyOutDir: false,
  rollupOptions: { input: { [name]: at(`src/${name}.ts`) }, output: { format: "cjs" as const, entryFileNames: "[name].cjs" } }
})

export default defineConfig({
  main: { build: bundle("main") },
  preload: { build: bundle("preload") },
  renderer: {
    ...web,
    root: at("../web"),
    // 127.0.0.1, not localhost: the server only accepts a local Host, and the app adds its secret to 127.0.0.1 only.
    server: { ...web.server, host: "127.0.0.1" },
    build: { outDir: at("../web/dist"), emptyOutDir: true, rollupOptions: { input: at("../web/index.html") } }
  }
})
