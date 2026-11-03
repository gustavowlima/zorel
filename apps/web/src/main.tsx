import "./styles.css"
import { RegistryProvider } from "@effect/atom-react"
import { locale } from "@zero/i18n"
import { StrictMode } from "react"
import { I18nProvider } from "@/ui"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { applyTheme } from "./state.ts"

// Theme: the saved preference, else the system (dark is the tokens' default).
applyTheme()
// Inside the desktop app (?shell=desktop): the sidebar's brand row is the title bar and leaves room for the
// window buttons.
if (new URLSearchParams(location.search).get("shell") === "desktop") document.documentElement.dataset.shell = "desktop"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RegistryProvider>
      {/* React Aria's own strings (drag and drop, tree) follow Zero's language, not the browser's. */}
      <I18nProvider locale={locale()}>
        <App />
      </I18nProvider>
    </RegistryProvider>
  </StrictMode>
)
