// Writes the contract as JSON Schema for clients in other languages (spec 019: the native client generates its Rust
// types from it). wire.json: one draft 2020-12 document whose $defs are every HttpApi endpoint's body and result, the
// RPC payloads, results and stream elements, and the socket and raw-route bodies. Checked in; CI runs this and fails on a diff.
// Run: bun run schema (or with --check to only compare).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Schema } from "effect"
import { RpcSchema } from "effect/rpc"
import { PanelFrame, PanelMessage } from "../src/browser.ts"
import { ZorelRpc } from "../src/events.ts"
import { Api } from "../src/index.ts"
import { RouteError, ServerInfo, WorkspaceImport } from "../src/routes.ts"
import { TerminalFrame, TerminalMessage } from "../src/terminal.ts"

type Endpoint = { identifier: string; success: ReadonlySet<Schema.Top>; payload: ReadonlyMap<string, { schemas: ReadonlyArray<Schema.Top> }> }
const OUT = join(import.meta.dir, "..", "schema")
const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Every wire type by the name the other clients use. A stream RPC contributes its element.
const named = new Map<string, Schema.Top>([
  ["PanelFrame", PanelFrame],
  ["PanelMessage", PanelMessage],
  ["TerminalFrame", TerminalFrame],
  ["TerminalMessage", TerminalMessage],
  ["RouteError", RouteError],
  ["WorkspaceImport", WorkspaceImport],
  ["ServerInfo", ServerInfo]
])
for (const [tag, rpc] of ZorelRpc.requests) {
  const name = pascal(tag)
  named.set(`${name}Payload`, rpc.payloadSchema)
  const success = rpc.successSchema
  named.set(RpcSchema.isStreamSchema(success) ? `${name}Item` : `${name}Success`, RpcSchema.isStreamSchema(success) ? success.success : success)
  named.set(`${name}Error`, rpc.errorSchema)
}

// Every HttpApi endpoint's JSON body and result, named <Group><Endpoint>Payload / <Group><Endpoint>Success (e.g.
// ChatsListSuccess), so a client in another language gets the REST types from the same document.
for (const group of Object.values(Api.groups) as ReadonlyArray<{ identifier: string; endpoints: Record<string, Endpoint> }>) {
  for (const endpoint of Object.values(group.endpoints)) {
    const name = pascal(group.identifier) + pascal(endpoint.identifier)
    const [success] = endpoint.success
    if (success && endpoint.success.size === 1) named.set(`${name}Success`, success)
    const json = endpoint.payload.get("application/json")?.schemas
    if (json?.length === 1) named.set(`${name}Payload`, json[0]!)
  }
}

// One document: each named root and every shared definition under $defs, references rewritten to point there.
function wireDocument() {
  const defs: Record<string, unknown> = {}
  for (const [name, schema] of named) {
    const doc = Schema.toJsonSchemaDocument(schema)
    for (const [k, v] of Object.entries(doc.definitions)) {
      if (k in defs && JSON.stringify(defs[k]) !== JSON.stringify(v)) throw new Error(`two different definitions named ${k}`)
      defs[k] = v
    }
    if (name in defs) throw new Error(`${name} is also a definition name`)
    defs[name] = doc.schema
  }
  return { $schema: "https://json-schema.org/draft/2020-12/schema", $defs: defs }
}

const files = {
  "wire.json": wireDocument()
}

const check = process.argv.includes("--check")
mkdirSync(OUT, { recursive: true })
let stale = false
for (const [file, value] of Object.entries(files)) {
  const path = join(OUT, file)
  const text = `${JSON.stringify(value, null, 2)}\n`
  const current = (() => {
    try {
      return readFileSync(path, "utf8")
    } catch {
      return undefined
    }
  })()
  if (current === text) continue
  if (check) {
    console.error(`${file} is out of date: run bun run schema`)
    stale = true
  } else writeFileSync(path, text)
}
if (stale) process.exit(1)
