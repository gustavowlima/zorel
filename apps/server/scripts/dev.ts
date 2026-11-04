// `bun dev`: one session secret for the whole run (watch restarts keep the parent's env), so the login link printed
// once keeps working while the server reloads. The web app is Vite's, so the link points there.
import { randomBytes } from "node:crypto"
import { SESSION_BYTES, SESSION_ENV } from "@zorel/contracts/session"

const VITE = "http://localhost:5173" // apps/web: Vite's default dev address
const env = { ...process.env, [SESSION_ENV]: randomBytes(SESSION_BYTES).toString("hex"), ZOREL_WEB_ORIGIN: VITE }
const proc = Bun.spawn(["bun", "--watch", "src/main.ts"], { env, stdio: ["inherit", "inherit", "inherit"] })
process.exit(await proc.exited)
