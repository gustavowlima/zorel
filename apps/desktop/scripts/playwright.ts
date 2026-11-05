// Copies playwright-core next to the compiled server (build/playwright-core). The server doesn't carry it inside
// its binary: the package reads its own files through __dirname at run time (see apps/server/src/browser.ts).
// The source is a link into Bun's store on every system, so it is resolved and copied as real files.
import { cpSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"

const from = realpathSync(join(import.meta.dir, "../../server/node_modules/playwright-core"))
const to = join(import.meta.dir, "../build/playwright-core")
rmSync(to, { recursive: true, force: true })
cpSync(from, to, { recursive: true, dereference: true })
console.info(`playwright-core copied from ${from}`)
