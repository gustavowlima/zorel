// Compiles the Zorel server into one binary (build/zorel-server). playwright-core and onnxruntime-node stay outside it
// (they read their own files at run time): the first through ZOREL_PLAYWRIGHT (browser.ts), the second through
// ZOREL_ONNX, which this build puts in place of @huggingface/transformers' own require (it loads the runtime with
// createRequire at run time, out of a bundler's reach). sharp (images, unused by text embeddings) becomes empty.
const result = await Bun.build({
  entrypoints: [`${import.meta.dir}/../../server/src/main.ts`],
  compile: { outfile: `${import.meta.dir}/../build/zorel-server` },
  minify: true,
  external: ["chromium-bidi", "chromium-bidi/*", "playwright-core"],
  plugins: [
    {
      name: "local-model-runtime",
      setup(b) {
        b.onResolve({ filter: /^sharp$/ }, () => ({ path: "sharp", namespace: "empty" }))
        b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "export default {}", loader: "js" }))
        b.onLoad({ filter: /transformers\.node\.mjs$/ }, async (a) => {
          const text = await Bun.file(a.path).text()
          const from = 'requireFromHere("onnxruntime-node")'
          if (!text.includes(from)) throw new Error(`${a.path}: "${from}" not found; the ZOREL_ONNX swap needs updating`)
          return { contents: text.replace(from, 'requireFromHere(process.env.ZOREL_ONNX || "onnxruntime-node")'), loader: "js" }
        })
      }
    }
  ]
})
if (!result.success) {
  console.error(result.logs.join("\n"))
  process.exit(1)
}
console.info("build/zorel-server compiled")
