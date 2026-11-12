// JSON bodies of the routes outside HttpApi (raw uploads and downloads, spec 019 typed them for every client). The
// sockets are in browser.ts and terminal.ts; the RPC in events.ts. Team, device and sign-in routes on a team server
// come with the native client's team servers (spec 019 T047).
import { Schema } from "effect"

// Any of these routes failing: a code the client translates.
export const RouteError = Schema.Struct({ error: Schema.String })
export type RouteError = typeof RouteError.Type

// POST /api/chats/:id/attachments takes the raw file (name URI-encoded in x-file-name, type in content-type) and
// answers the contract's Attachment. GET /api/attachments/:id answers the file itself.
export const ATTACHMENT_NAME_HEADER = "x-file-name"

// GET /api/workspace/import: whether an import waits for the next start. POST (the export's .tar.gz as the body)
// answers it with what the file holds; DELETE drops it (204). GET /api/workspace/export answers the .tar.gz.
export const WorkspaceImport = Schema.Struct({ pending: Schema.Boolean, projects: Schema.optional(Schema.Number), chats: Schema.optional(Schema.Number) })
export type WorkspaceImport = typeof WorkspaceImport.Type

// GET /api/server: only a team server has it (a local one answers the web app instead).
export const ServerInfo = Schema.Struct({ mode: Schema.Literal("server"), needsOwner: Schema.Boolean })
export type ServerInfo = typeof ServerInfo.Type
