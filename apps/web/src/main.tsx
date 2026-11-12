import "./styles.css"
import { RegistryProvider } from "@effect/atom-react"
import { locale } from "@zorel/i18n"
import { StrictMode } from "react"
import { I18nProvider, MotionConfig } from "@/ui"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { ServerGate } from "./features/sign-in.tsx"
import { applyTheme } from "./state.ts"

// Preferences saved before the rename to Zorel (zero.*): copied once to zorel.*.
try {
  for (const key of Object.keys(localStorage)) {
    const next = key.startsWith("zero.") ? `zorel.${key.slice(5)}` : null
    if (next && localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key) ?? "")
  }
} catch {} // storage blocked: defaults apply

// A rebuild while the page is open replaces its lazy chunks: the next one it asks for (a task's panel, a screen) is
// gone and the press does nothing. Load the new build instead.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault()
  location.reload()
})

// Theme: the saved preference, else the system (dark is the tokens' default).
applyTheme()
// Inside the desktop app (?shell=desktop): the sidebar's brand row is the title bar and leaves room for the
// window buttons.
// The preload's bridge says it too, so a reload that loses the query (dev server) keeps the title bar.
if (new URLSearchParams(location.search).get("shell") === "desktop" || "zorelDesktop" in window) document.documentElement.dataset.shell = "desktop"

// No browser right-click menu over the app: Zorel's own menus open where it has one (ContextMenu). Text fields and
// the terminal keep the native one, for copy and paste.
document.addEventListener("contextmenu", (e) => {
  const el = e.target instanceof Element ? e.target : null
  if (!el?.closest("input, textarea, [contenteditable='true'], .xterm")) e.preventDefault()
})

// Focus rings only for keyboard navigation (styles.css): on with Tab, off with the next pointer press.
addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Tab") document.documentElement.dataset.keyboard = ""
  },
  true
)
addEventListener("pointerdown", () => delete document.documentElement.dataset.keyboard, true)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RegistryProvider>
      {/* React Aria's own strings (drag and drop, tree) follow Zorel's language, not the browser's. */}
      <I18nProvider locale={locale()}>
        {/* Motion follows the system: no movement when it asks for reduced motion. */}
        <MotionConfig reducedMotion="user">
          {/* A team server asks who you are first (spec 014); locally the app opens at once. */}
          <ServerGate>
            <App />
          </ServerGate>
        </MotionConfig>
      </I18nProvider>
    </RegistryProvider>
  </StrictMode>
)
