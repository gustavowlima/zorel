import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { readFileSync } from "node:fs"
import { defineConfig } from "vite"

// The app's version, one place for it: the desktop package (Settings › General › About shows it).
const version = JSON.parse(readFileSync(new URL("../desktop/package.json", import.meta.url), "utf8")).version as string

// The server the dev proxy reaches: 4317 (`bun run dev`), or the desktop's dev port (ZOREL_DEV_PORT, set by
// `bun run desktop:dev` so both can run at once).
const api = process.env.ZOREL_DEV_PORT ?? "4317"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __ZOREL_VERSION__: JSON.stringify(version) },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  // The proxy keeps the browser's Host (no changeOrigin, which Vite's string shorthand turns on): the server refuses a
  // request whose Origin and Host differ, so a rewritten Host made every POST in dev a 403.
  // http targets with ws: plain requests under a socket's path (/api/browser/picture) pass too; a ws:// target broke them.
  server: { proxy: { "/api/terminals": { target: `http://localhost:${api}`, ws: true }, "/api/browser": { target: `http://localhost:${api}`, ws: true }, "/api": { target: `http://localhost:${api}` }, "/rpc": { target: `http://localhost:${api}`, ws: true } } }
})
