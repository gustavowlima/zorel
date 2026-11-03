import "./styles.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"

// Theme follows the system (dark is the tokens' default).
const light = matchMedia("(prefers-color-scheme: light)")
const applyTheme = () => (document.documentElement.dataset.theme = light.matches ? "light" : "dark")
applyTheme()
light.addEventListener("change", applyTheme)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
