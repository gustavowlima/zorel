// SQLite local (bun:sqlite, síncrono). Migrations rodam em ordem; PRAGMA user_version guarda até onde foi.
// Nunca editar uma migration publicada: acrescentar outra no fim do array.
import { Database } from "bun:sqlite"
import type { Agent, Chat, McpServer, Memory, Message, Project, Step } from "@zero/contracts"
import { Context, Layer } from "effect"

export const MIGRATIONS = [
  `CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    brief TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );`,
  `CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    summary_until INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    text TEXT NOT NULL,
    model TEXT,
    error TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    at INTEGER NOT NULL
  );
  CREATE INDEX messages_by_chat ON messages (chat_id, at);
  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    text TEXT NOT NULL,
    normalized TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'forgotten')),
    origin TEXT NOT NULL CHECK (origin IN ('auto', 'manual')),
    chat_id TEXT,
    created_at INTEGER NOT NULL,
    confirmed_at INTEGER NOT NULL,
    UNIQUE (scope, normalized)
  );
  CREATE VIRTUAL TABLE memories_fts USING fts5(text, content='memories', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
  CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
  END;
  CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  END;
  CREATE TRIGGER memories_au AFTER UPDATE OF text ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
  END;`,
  // Canais com vários agentes, ferramentas usadas por mensagem, skills e servidores MCP.
  `CREATE TABLE chat_members (
    chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (chat_id, agent_id)
  );
  INSERT INTO chat_members (chat_id, agent_id, position) SELECT id, agent_id, 0 FROM chats WHERE agent_id IS NOT NULL;
  ALTER TABLE messages ADD COLUMN agent_id TEXT;
  ALTER TABLE messages ADD COLUMN steps TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'fact' CHECK (kind IN ('fact', 'skill'));
  ALTER TABLE memories ADD COLUMN title TEXT NOT NULL DEFAULT '';
  -- Índice de busca próprio (título + texto), para skills casarem pelo nome do procedimento.
  DROP TRIGGER memories_ai;
  DROP TRIGGER memories_ad;
  DROP TRIGGER memories_au;
  DROP TABLE memories_fts;
  CREATE VIRTUAL TABLE memory_index USING fts5(id UNINDEXED, body, tokenize='unicode61 remove_diacritics 2');
  INSERT INTO memory_index (id, body) SELECT id, title || ' ' || text FROM memories;
  CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memory_index (id, body) VALUES (new.id, new.title || ' ' || new.text);
  END;
  CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
    DELETE FROM memory_index WHERE id = old.id;
  END;
  CREATE TRIGGER memories_au AFTER UPDATE OF title, text ON memories BEGIN
    UPDATE memory_index SET body = new.title || ' ' || new.text WHERE id = new.id;
  END;
  CREATE TABLE mcp_servers (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    command TEXT NOT NULL DEFAULT '',
    args TEXT NOT NULL DEFAULT '[]',
    url TEXT NOT NULL DEFAULT '',
    env_keys TEXT NOT NULL DEFAULT '[]',
    mode TEXT NOT NULL CHECK (mode IN ('read', 'approve', 'auto')),
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );`
]

export function open(path: string): Database {
  const db = new Database(path, { create: true, strict: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA busy_timeout = 5000")
  const { user_version } = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!
  db.transaction(() => {
    for (const sql of MIGRATIONS.slice(user_version)) db.run(sql)
    db.run(`PRAGMA user_version = ${MIGRATIONS.length}`)
  })()
  return db
}

// "Prefere PRs pequenos." e "prefere prs pequenos" são a mesma memória.
export const normalize = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()

type Row = Record<string, any>
const project = (r: Row): Project => ({ id: r.id, name: r.name, brief: r.brief, createdAt: r.created_at })
const agent = (r: Row): Agent => ({ id: r.id, projectId: r.project_id, name: r.name, instructions: r.instructions, model: r.model, createdAt: r.created_at })
const chat = (r: Row): Chat => ({
  id: r.id, projectId: r.project_id, agentIds: JSON.parse(r.agent_ids), title: r.title, model: r.model,
  summary: r.summary, summaryUntil: r.summary_until, createdAt: r.created_at
})
const message = (r: Row): Message => ({
  id: r.id, chatId: r.chat_id, role: r.role, agentId: r.agent_id, text: r.text, model: r.model, error: r.error,
  steps: JSON.parse(r.steps), inputTokens: r.input_tokens, outputTokens: r.output_tokens, at: r.at
})
const memory = (r: Row): Memory => ({
  id: r.id, scope: r.scope, kind: r.kind, title: r.title, text: r.text, state: r.state, origin: r.origin, chatId: r.chat_id,
  createdAt: r.created_at, confirmedAt: r.confirmed_at
})
const mcpServer = (r: Row): McpServer => ({
  id: r.id, projectId: r.project_id, name: r.name, command: r.command, args: JSON.parse(r.args), url: r.url,
  envKeys: JSON.parse(r.env_keys), mode: r.mode, enabled: !!r.enabled, createdAt: r.created_at
})

const CHAT = `SELECT c.*, (SELECT json_group_array(agent_id) FROM (SELECT agent_id FROM chat_members WHERE chat_id = c.id ORDER BY position)) AS agent_ids FROM chats c`

// Monta "SET a = ?, b = ?" só com os campos presentes.
function patch(db: Database, table: string, id: string, fields: Record<string, unknown>) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined)
  if (entries.length) db.query(`UPDATE ${table} SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...(entries.map(([, v]) => v) as any[]), id)
}

// Relógio monotônico: duas mensagens no mesmo ms ainda ficam em ordem (o resumo corta por `at`).
let last = 0
const now = () => (last = Math.max(Date.now(), last + 1))

export function repository(db: Database) {
  const get = <T>(sql: string, map: (r: Row) => T, ...args: any[]) => {
    const r = db.query(sql).get(...args) as Row | null
    return r ? map(r) : undefined
  }
  const all = <T>(sql: string, map: (r: Row) => T, ...args: any[]) => (db.query(sql).all(...args) as Row[]).map(map)
  // Lista vazia vira (''): falso em IN e verdadeiro em NOT IN (NULL deixaria NOT IN sempre nulo e filtraria tudo).
  const in_ = (xs: ReadonlyArray<unknown>) => xs.map(() => "?").join(",") || "''"
  const setMembers = (chatId: string, agentIds: ReadonlyArray<string>) => {
    db.query("DELETE FROM chat_members WHERE chat_id = ?").run(chatId)
    for (const [i, a] of [...new Set(agentIds)].entries()) db.query("INSERT INTO chat_members (chat_id, agent_id, position) VALUES (?, ?, ?)").run(chatId, a, i)
  }

  return {
    // ---------- projetos ----------
    projects: () => all("SELECT * FROM projects ORDER BY created_at DESC", project),
    project: (id: string) => get("SELECT * FROM projects WHERE id = ?", project, id),
    createProject(input: { name: string; brief: string }): Project {
      const p = { id: crypto.randomUUID(), ...input, createdAt: now() }
      db.query("INSERT INTO projects (id, name, brief, created_at) VALUES (?, ?, ?, ?)").run(p.id, p.name, p.brief, p.createdAt)
      return p
    },
    updateProject(id: string, input: { name?: string | undefined; brief?: string | undefined }) {
      patch(db, "projects", id, input)
      return get("SELECT * FROM projects WHERE id = ?", project, id)
    },
    removeProject(id: string) {
      db.transaction(() => {
        const agents = all("SELECT id FROM agents WHERE project_id = ?", (r) => r.id as string, id)
        db.query(`DELETE FROM memories WHERE scope = ? OR scope IN (${in_(agents)})`).run(`project:${id}`, ...agents.map((a) => `agent:${a}`))
        db.query("DELETE FROM projects WHERE id = ?").run(id) // agentes, chats e servidores MCP caem em cascata
      })()
    },

    // ---------- agentes ----------
    agents: () => all("SELECT * FROM agents ORDER BY created_at", agent),
    agent: (id: string) => get("SELECT * FROM agents WHERE id = ?", agent, id),
    createAgent(input: { projectId: string | null; name: string; instructions: string; model: string }): Agent {
      const a = { id: crypto.randomUUID(), ...input, createdAt: now() }
      db.query("INSERT INTO agents (id, project_id, name, instructions, model, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(a.id, a.projectId, a.name, a.instructions, a.model, a.createdAt)
      return a
    },
    updateAgent(id: string, input: { name?: string | undefined; instructions?: string | undefined; model?: string | undefined }) {
      patch(db, "agents", id, input)
      return get("SELECT * FROM agents WHERE id = ?", agent, id)
    },
    removeAgent(id: string) {
      db.transaction(() => {
        db.query("DELETE FROM memories WHERE scope = ?").run(`agent:${id}`)
        db.query("DELETE FROM agents WHERE id = ?").run(id)
      })()
    },

    // ---------- chats e mensagens ----------
    chats: () => all(`${CHAT} ORDER BY c.created_at DESC`, chat),
    chat: (id: string) => get(`${CHAT} WHERE c.id = ?`, chat, id),
    createChat(input: { projectId: string | null; agentIds: ReadonlyArray<string>; model: string }): Chat {
      const id = crypto.randomUUID()
      db.transaction(() => {
        db.query("INSERT INTO chats (id, project_id, title, model, created_at) VALUES (?, ?, ?, ?, ?)").run(id, input.projectId, "Novo chat", input.model, now())
        setMembers(id, input.agentIds)
      })()
      return get(`${CHAT} WHERE c.id = ?`, chat, id)!
    },
    updateChat(id: string, input: { title?: string | undefined; model?: string | undefined; agentIds?: ReadonlyArray<string> | undefined }) {
      db.transaction(() => {
        patch(db, "chats", id, { title: input.title, model: input.model })
        if (input.agentIds) setMembers(id, input.agentIds)
      })()
      return get(`${CHAT} WHERE c.id = ?`, chat, id)
    },
    setSummary(id: string, summary: string, until: number) {
      db.query("UPDATE chats SET summary = ?, summary_until = ? WHERE id = ?").run(summary, until, id)
    },
    removeChat(id: string) {
      db.query("DELETE FROM chats WHERE id = ?").run(id)
    },
    messages: (chatId: string) => all("SELECT * FROM messages WHERE chat_id = ? ORDER BY at", message, chatId),
    messagesAfter: (chatId: string, at: number) => all("SELECT * FROM messages WHERE chat_id = ? AND at > ? ORDER BY at", message, chatId, at),
    addMessage(input: Omit<Message, "id" | "at">): Message {
      const m: Message = { id: crypto.randomUUID(), ...input, at: now() }
      db.query("INSERT INTO messages (id, chat_id, role, agent_id, text, model, error, steps, input_tokens, output_tokens, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(m.id, m.chatId, m.role, m.agentId, m.text, m.model, m.error, JSON.stringify(m.steps satisfies ReadonlyArray<Step>), m.inputTokens, m.outputTokens, m.at)
      return m
    },

    // ---------- memórias e skills ----------
    // Todas, inclusive as esquecidas (a interface oferece restaurar): pendentes, ativas, esquecidas.
    memories: () => all("SELECT * FROM memories ORDER BY state = 'forgotten', state = 'active', confirmed_at DESC", memory),
    // O que a pessoa mandou esquecer, para a consolidação não propor de novo (nem parafraseado).
    forgottenMemories: (scopes: ReadonlyArray<string>, limit = 50) =>
      all(`SELECT * FROM memories WHERE state = 'forgotten' AND scope IN (${in_(scopes)}) ORDER BY confirmed_at DESC LIMIT ?`, memory, ...scopes, limit),
    pendingCount: (scopes: ReadonlyArray<string>) =>
      (db.query(`SELECT count(*) AS n FROM memories WHERE state = 'pending' AND scope IN (${in_(scopes)})`).get(...scopes) as { n: number }).n,
    memory: (id: string) => get("SELECT * FROM memories WHERE id = ?", memory, id),
    activeMemories: (scopes: ReadonlyArray<string>, kind: Memory["kind"] = "fact") =>
      all(`SELECT * FROM memories WHERE state = 'active' AND kind = ? AND scope IN (${in_(scopes)}) ORDER BY confirmed_at DESC`, memory, kind, ...scopes),
    // Já existente (mesmo texto normalizado no escopo): devolve undefined e não duplica, nem ressuscita uma esquecida.
    addMemory(input: { scope: string; kind?: Memory["kind"]; title?: string; text: string; state: Memory["state"]; origin: Memory["origin"]; chatId: string | null }): Memory | undefined {
      const at = now()
      const m: Memory = { id: crypto.randomUUID(), kind: "fact", title: "", ...input, createdAt: at, confirmedAt: at }
      const r = db
        .query("INSERT OR IGNORE INTO memories (id, scope, kind, title, text, normalized, state, origin, chat_id, created_at, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(m.id, m.scope, m.kind, m.title, m.text, normalize(m.text), m.state, m.origin, m.chatId, m.createdAt, m.confirmedAt)
      return r.changes ? m : undefined
    },
    updateMemory(id: string, input: { state?: Memory["state"] | undefined; title?: string | undefined; text?: string | undefined }) {
      patch(db, "memories", id, { state: input.state, title: input.title, text: input.text, normalized: input.text && normalize(input.text), confirmed_at: now() })
      return get("SELECT * FROM memories WHERE id = ?", memory, id)
    },
    // BM25 (FTS5) entre as ativas dos escopos, fora das já no prompt. Skills também casam pelo título.
    searchMemories(scopes: ReadonlyArray<string>, query: string, exclude: ReadonlyArray<string>, limit: number, kind: Memory["kind"] = "fact"): Memory[] {
      const terms = normalize(query).split(" ").filter((t) => t.length > 2).map((t) => `"${t}"*`)
      if (!terms.length) return []
      return all(
        `SELECT m.* FROM memory_index f JOIN memories m ON m.id = f.id
         WHERE memory_index MATCH ? AND m.state = 'active' AND m.kind = ?
           AND m.scope IN (${in_(scopes)}) AND m.id NOT IN (${in_(exclude)})
         ORDER BY bm25(memory_index) LIMIT ?`,
        memory, terms.join(" OR "), kind, ...scopes, ...exclude, limit
      )
    },

    // ---------- servidores MCP ----------
    mcpServers: () => all("SELECT * FROM mcp_servers ORDER BY created_at", mcpServer),
    mcpServer: (id: string) => get("SELECT * FROM mcp_servers WHERE id = ?", mcpServer, id),
    // Os habilitados que um chat enxerga: globais + os do projeto dele.
    mcpServersFor: (projectId: string | null) =>
      all("SELECT * FROM mcp_servers WHERE enabled = 1 AND (project_id IS NULL OR project_id = ?) ORDER BY created_at", mcpServer, projectId),
    createMcpServer(input: Omit<McpServer, "id" | "enabled" | "createdAt">): McpServer {
      const s: McpServer = { id: crypto.randomUUID(), ...input, enabled: true, createdAt: now() }
      db.query("INSERT INTO mcp_servers (id, project_id, name, command, args, url, env_keys, mode, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)")
        .run(s.id, s.projectId, s.name, s.command, JSON.stringify(s.args), s.url, JSON.stringify(s.envKeys), s.mode, s.createdAt)
      return s
    },
    updateMcpServer(id: string, input: { mode?: McpServer["mode"] | undefined; enabled?: boolean | undefined }) {
      patch(db, "mcp_servers", id, { mode: input.mode, enabled: input.enabled === undefined ? undefined : Number(input.enabled) })
      return get("SELECT * FROM mcp_servers WHERE id = ?", mcpServer, id)
    },
    removeMcpServer(id: string) {
      db.query("DELETE FROM mcp_servers WHERE id = ?").run(id)
    }
  }
}

export type Repository = ReturnType<typeof repository>

export class Store extends Context.Service<Store, Repository>()("Store") {
  static layer = (path: string) => Layer.sync(Store, () => repository(open(path)))
}
