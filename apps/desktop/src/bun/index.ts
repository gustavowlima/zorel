// Desktop app main process: fixes PATH, starts the Zero server on a free port and opens the window.
import { BrowserWindow, PATHS } from "electrobun/main"
import { join } from "node:path"
import { start } from "../../../server/src/main.ts"

// Apps opened from Finder/Dock don't inherit the shell PATH; without it, `claude` and `codex` aren't found.
async function loginShellPath() {
  const shell = process.env.SHELL || "/bin/zsh"
  try {
    const out = await Bun.$`${shell} -ilc 'printf "__PATH__%s" "$PATH"'`.quiet().text()
    const path = out.split("__PATH__").at(-1)?.trim()
    if (path) process.env.PATH = path
  } catch {
    // ponytail: without a login shell, the default PATH stays; the app reports "not installed" per provider
  }
}

const freePort = () => {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() })
  const port = probe.port!
  probe.stop(true)
  return port
}

if (process.platform !== "win32") await loginShellPath()
process.env.ZERO_MIGRATIONS = join(PATHS.VIEWS_FOLDER, "..", "drizzle")
const url = await start({ port: freePort(), webDir: join(PATHS.VIEWS_FOLDER, "..", "web") })
for (let i = 0; i < 100 && !(await fetch(`${url}/api/models`).catch(() => null)); i++) await Bun.sleep(50)

new BrowserWindow({ title: "Zero", url, frame: { width: 1280, height: 820 }, titleBarStyle: "hiddenInset" })
