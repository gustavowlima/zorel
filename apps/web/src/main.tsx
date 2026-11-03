import "./styles.css"
import { RegistryProvider } from "@effect/atom-react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { applyTheme } from "./state.ts"

// Theme: the saved preference, else the system (dark is the tokens' default).
applyTheme()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RegistryProvider>
      <App />
    </RegistryProvider>
  </StrictMode>
)
