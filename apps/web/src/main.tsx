import "./styles.css"
import { lazy, StrictMode, Suspense, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"

// Theme follows the system (dark is the tokens' default).
const light = matchMedia("(prefers-color-scheme: light)")
const applyTheme = () => (document.documentElement.dataset.theme = light.matches ? "light" : "dark")
applyTheme()
light.addEventListener("change", applyTheme)

// /#/dev/ui: the primitives gallery, only in development (never part of the production build).
const Gallery = import.meta.env.DEV ? lazy(() => import("./dev/gallery.tsx")) : undefined

function Root() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener("hashchange", on)
    return () => removeEventListener("hashchange", on)
  }, [])
  if (Gallery && hash === "#/dev/ui")
    return (
      <Suspense>
        <Gallery />
      </Suspense>
    )
  return <App />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
