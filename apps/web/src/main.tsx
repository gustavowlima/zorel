import "./styles.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"

// Tema segue o sistema (dark é o padrão dos tokens).
const light = matchMedia("(prefers-color-scheme: light)")
const applyTheme = () => (document.documentElement.dataset.theme = light.matches ? "light" : "dark")
applyTheme()
light.addEventListener("change", applyTheme)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
