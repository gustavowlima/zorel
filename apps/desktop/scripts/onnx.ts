// Puts onnxruntime-node next to the compiled server (build/onnxruntime-node) for recall by meaning (spec 003): its
// JavaScript and onnxruntime-common as one file (from inside the binary, Bun doesn't look for a package's own
// dependencies on disk), and only this build machine's native binary (~44–85 MB instead of all platforms' ~290 MB).
// The server loads dist/index.cjs through ZOREL_ONNX (apps/desktop/src/main.ts).
import { cpSync, mkdirSync, realpathSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"

// The version @huggingface/transformers itself resolves (a link into Bun's store on every system: copied as files).
const transformers = realpathSync(join(import.meta.dir, "../../server/node_modules/@huggingface/transformers"))
const pkg = dirname(dirname(realpathSync(Bun.resolveSync("onnxruntime-node", transformers))))
const to = join(import.meta.dir, "../build/onnxruntime-node")
rmSync(to, { recursive: true, force: true })
const bundled = await Bun.build({ entrypoints: [join(pkg, "dist/index.js")], target: "node", format: "cjs", external: ["*.node"], outdir: join(to, "dist"), naming: "index.cjs" })
if (!bundled.success) throw new Error(bundled.logs.join("\n"))
const bin = join("bin", "napi-v6", process.platform, process.arch)
mkdirSync(join(to, bin), { recursive: true })
cpSync(join(pkg, bin), join(to, bin), { recursive: true, dereference: true })
console.info(`onnxruntime-node (${process.platform}-${process.arch}) copied from ${pkg}`)
