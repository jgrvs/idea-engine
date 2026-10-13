import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')

// One connection per process, kept on globalThis so dev-server reloads reuse it.
const g = globalThis as typeof globalThis & { _db?: Database.Database }

export function getDb(): Database.Database {
  if (g._db) return g._db
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const db = new Database(path.join(DATA_DIR, 'app.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  g._db = db
  return db
}

// Create tables and seed data here. Everything must be idempotent: this runs
// every time the process opens the database.
function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('created_at', ?)`).run(new Date().toISOString())
}
