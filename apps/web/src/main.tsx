import "./styles.css"
import { RegistryProvider } from "@effect/atom-react"
import { lazy, StrictMode, Suspense, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App.tsx"
import { applyTheme } from "./state.ts"

// Theme: the saved preference, else the system (dark is the tokens' default).
applyTheme()

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
    <RegistryProvider>
      <Root />
    </RegistryProvider>
  </StrictMode>
)
