// Before Drizzle: adopts the MVP database and backs up before any pending migration.
// Runs synchronously (bun:sqlite) before SqliteClient opens the file.
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

// Read at call time (not on import): the desktop app sets ZOREL_MIGRATIONS before starting the server.
export const migrationsDir = () => process.env.ZOREL_MIGRATIONS ?? join(import.meta.dir, "..", "drizzle")

// MVP migrations (hand-written SQL + PRAGMA user_version). Frozen: they only bring an old database
// up to version 3, which is exactly the Drizzle baseline (drizzle/*_baseline).
export const LEGACY_MIGRATIONS = [
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
  // Multi-agent channels, tools used per message, skills and MCP servers.
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
  -- Own search index (title + text), so skills match by the name of the procedure.
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

const ts = () => new Date().toISOString().replace(/[:.]/g, "-")
const KEEP = 7
// zero-: backups from before the rename to Zorel, still kept and pruned with the new ones.
export const BACKUP = /^(zorel|zero)-.*\.db$/
const DAY = 24 * 60 * 60_000
const backupsOf = (path: string) => {
  const dir = join(dirname(path), "backups")
  return existsSync(dir) ? readdirSync(dir).filter((f) => BACKUP.test(f)).sort().map((f) => join(dir, f)) : []
}

// Consistent copy (WAL included) to <database folder>/backups/.
export function backup(db: Database, path: string): string {
  const dir = join(dirname(path), "backups")
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `zorel-${ts()}.db`)
  db.run(`VACUUM INTO '${file.replaceAll("'", "''")}'`)
  for (const old of backupsOf(path).slice(0, -KEEP)) rmSync(old) // name with ISO date: alphabetical order = chronological
  return file
}

// Returns the backup path when it made one.
export function prepare(path: string, dir = migrationsDir()): string | undefined {
  if (path === ":memory:" || !existsSync(path)) return
  const db = new Database(path)
  try {
    const hasTables = !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get()
    if (!hasTables) return
    const drizzle = !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get()
    const applied = drizzle ? (db.query("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n : 0
    const local = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).length
    if (applied >= local) {
      // Nothing to migrate: still one backup per day (ARCHITECTURE §12).
      const last = backupsOf(path).at(-1)
      return !last || Date.now() - statSync(last).mtimeMs > DAY ? backup(db, path) : undefined
    }
    const file = backup(db, path)
    if (!drizzle) {
      const { user_version } = db.query("PRAGMA user_version").get() as { user_version: number }
      db.transaction(() => {
        for (const sql of LEGACY_MIGRATIONS.slice(user_version)) db.run(sql)
        db.run(`PRAGMA user_version = ${LEGACY_MIGRATIONS.length}`)
      })()
    }
    return file
  } finally {
    db.close()
  }
}
