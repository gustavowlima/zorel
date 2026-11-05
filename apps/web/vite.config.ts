import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { readFileSync } from "node:fs"
import { defineConfig } from "vite"

// The app's version, one place for it: the desktop package (Settings › General › About shows it).
const version = JSON.parse(readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8")).version as string

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __ZOREL_VERSION__: JSON.stringify(version) },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  // The proxy keeps the browser's Host (no changeOrigin, which Vite's string shorthand turns on): the server refuses a
  // request whose Origin and Host differ, so a rewritten Host made every POST in dev a 403.
  server: { proxy: { "/api/terminals": { target: "ws://localhost:4317", ws: true }, "/api/browser": { target: "ws://localhost:4317", ws: true }, "/api": { target: "http://localhost:4317" }, "/rpc": { target: "ws://localhost:4317", ws: true } } }
})
