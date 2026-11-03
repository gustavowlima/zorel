import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: { proxy: { "/api/terminals": { target: "ws://localhost:4317", ws: true }, "/api": "http://localhost:4317", "/rpc": { target: "ws://localhost:4317", ws: true } } }
})
