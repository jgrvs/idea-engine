import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { computeViability, DEFAULT_SCORING, type ScoringConfig } from './scoring'

const DATA_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DATA_DIR, 'ideas.db')

const g = globalThis as typeof globalThis & { _db?: Database.Database }

export function getDb(): Database.Database {
  if (g._db) return g._db

  fs.mkdirSync(DATA_DIR, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  g._db = db
  return db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      domain TEXT,
      ideas_count INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      batch_id TEXT REFERENCES batches(id),
      domain TEXT,
      title TEXT NOT NULL,
      tagline TEXT,
      problem TEXT,
      solution TEXT,
      market_sector TEXT,
      market_audience TEXT,
      business_model TEXT,
      moat_type TEXT,
      tam_estimate TEXT,
      named_competitors TEXT,
      time_to_first_revenue TEXT,
      viability_score REAL,
      score_technical REAL,
      score_deployment REAL,
      score_barrier REAL,
      score_appetite REAL,
      score_market_size REAL,
      status TEXT NOT NULL DEFAULT 'generated',
      created_at TEXT NOT NULL,
      selected_for_analysis_at TEXT,
      analysis_started_at TEXT,
      analysis_completed_at TEXT,
      selected_for_prototype_at TEXT,
      prototype_started_at TEXT,
      prototype_completed_at TEXT,
      dismissed_at TEXT,
      dismiss_reason TEXT,
      analysis_stage TEXT,
      analysis_error TEXT,
      embedding BLOB
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL REFERENCES ideas(id),
      tam TEXT,
      sam TEXT,
      som TEXT,
      competitors TEXT,
      revenue_model TEXT,
      pricing_strategy TEXT,
      technical_feasibility TEXT,
      feasibility_score REAL,
      founder_fit_score REAL,
      market_timing TEXT,
      risks TEXT,
      opportunities TEXT,
      recommendation TEXT,
      recommendation_rationale TEXT,
      tokens_used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vc_reviews (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL REFERENCES ideas(id),
      strengths TEXT,
      weaknesses TEXT,
      key_concerns TEXT,
      would_fund TEXT,
      needs_to_be_true TEXT,
      verdict_rationale TEXT,
      tokens_used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prototypes (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL REFERENCES ideas(id),
      directory_path TEXT,
      file_count INTEGER DEFAULT 0,
      file_tree TEXT,
      stack TEXT,
      readme TEXT,
      tokens_used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_log (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      stage TEXT NOT NULL,
      idea_id TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ideas_status   ON ideas(status);
    CREATE INDEX IF NOT EXISTS idx_ideas_created  ON ideas(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ideas_sector   ON ideas(market_sector);
    CREATE INDEX IF NOT EXISTS idx_usage_date     ON usage_log(date);
  `)

  // Migration: add per-direction token columns to usage_log if upgrading an
  // older database that only had tokens_used.
  const cols = db.prepare(`PRAGMA table_info(usage_log)`).all() as { name: string }[]
  const names = new Set(cols.map(c => c.name))
  if (!names.has('input_tokens')) {
    db.exec(`ALTER TABLE usage_log ADD COLUMN input_tokens INTEGER DEFAULT 0`)
  }
  if (!names.has('output_tokens')) {
    db.exec(`ALTER TABLE usage_log ADD COLUMN output_tokens INTEGER DEFAULT 0`)
  }

  // Migration: add viability sub-score columns to ideas if upgrading.
  const ideaCols = new Set(
    (db.prepare(`PRAGMA table_info(ideas)`).all() as { name: string }[]).map(c => c.name)
  )
  for (const col of ['score_technical', 'score_deployment', 'score_barrier', 'score_appetite', 'score_market_size']) {
    if (!ideaCols.has(col)) db.exec(`ALTER TABLE ideas ADD COLUMN ${col} REAL`)
  }
  for (const col of ['analysis_stage', 'analysis_error']) {
    if (!ideaCols.has(col)) db.exec(`ALTER TABLE ideas ADD COLUMN ${col} TEXT`)
  }
  if (!ideaCols.has('embedding')) db.exec(`ALTER TABLE ideas ADD COLUMN embedding BLOB`)
}

// ── Embeddings (semantic dedup) ─────────────────────────────────────────────

export function setIdeaEmbedding(ideaId: string, blob: Buffer) {
  getDb().prepare(`UPDATE ideas SET embedding = ? WHERE id = ?`).run(blob, ideaId)
}

// All stored idea embeddings (for similarity comparison at generation time).
export function getStoredEmbeddings(): { id: string; embedding: Buffer }[] {
  return getDb()
    .prepare(`SELECT id, embedding FROM ideas WHERE embedding IS NOT NULL`)
    .all() as { id: string; embedding: Buffer }[]
}

// Ideas missing an embedding (for backfill).
export function getIdeasNeedingEmbedding(): { id: string; title: string; tagline: string | null; problem: string | null }[] {
  return getDb()
    .prepare(`SELECT id, title, tagline, problem FROM ideas WHERE embedding IS NULL`)
    .all() as { id: string; title: string; tagline: string | null; problem: string | null }[]
}

export function logUsage(
  stage: string,
  ideaId: string | null,
  inputTokens: number,
  outputTokens: number
) {
  const db = getDb()
  db.prepare(`
    INSERT INTO usage_log (id, date, stage, idea_id, input_tokens, output_tokens, tokens_used, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    new Date().toISOString().slice(0, 10),
    stage,
    ideaId,
    inputTokens,
    outputTokens,
    inputTokens + outputTokens,
    new Date().toISOString()
  )
}

// Sonnet 4.6 pricing, USD per 1M tokens
const PRICE_INPUT_PER_M = 3.0
const PRICE_OUTPUT_PER_M = 15.0

export interface UsageSummary {
  month: string
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  byStage: { stage: string; inputTokens: number; outputTokens: number; cost: number; calls: number }[]
}

export function getUsageSummary(): UsageSummary {
  const db = getDb()
  const month = new Date().toISOString().slice(0, 7) // YYYY-MM

  const rows = db.prepare(`
    SELECT stage,
           SUM(input_tokens) as input_tokens,
           SUM(output_tokens) as output_tokens,
           COUNT(*) as calls
    FROM usage_log
    WHERE date LIKE ?
    GROUP BY stage
  `).all(`${month}%`) as { stage: string; input_tokens: number; output_tokens: number; calls: number }[]

  const cost = (inp: number, out: number) =>
    (inp / 1_000_000) * PRICE_INPUT_PER_M + (out / 1_000_000) * PRICE_OUTPUT_PER_M

  const byStage = rows.map(r => ({
    stage: r.stage,
    inputTokens: r.input_tokens ?? 0,
    outputTokens: r.output_tokens ?? 0,
    cost: cost(r.input_tokens ?? 0, r.output_tokens ?? 0),
    calls: r.calls,
  }))

  return {
    month,
    totalCost: byStage.reduce((s, r) => s + r.cost, 0),
    totalInputTokens: byStage.reduce((s, r) => s + r.inputTokens, 0),
    totalOutputTokens: byStage.reduce((s, r) => s + r.outputTokens, 0),
    byStage,
  }
}

export function getConfig<T>(key: string, fallback: T): T {
  const db = getDb()
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setConfig(key: string, value: unknown) {
  const db = getDb()
  db.prepare(`
    INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), new Date().toISOString())
}

export function getIdeaWithRelations(ideaId: string) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(ideaId) as Record<string, unknown> | undefined
  if (!row) return null

  const analysis = db.prepare('SELECT * FROM analyses WHERE idea_id = ? ORDER BY created_at DESC LIMIT 1').get(ideaId) as Record<string, unknown> | undefined
  const prototype = db.prepare('SELECT * FROM prototypes WHERE idea_id = ? ORDER BY created_at DESC LIMIT 1').get(ideaId) as Record<string, unknown> | undefined
  const vcReview = db.prepare('SELECT * FROM vc_reviews WHERE idea_id = ? ORDER BY created_at DESC LIMIT 1').get(ideaId) as Record<string, unknown> | undefined

  return deserializeIdea(row, analysis, prototype, vcReview)
}

export function deserializeIdea(
  row: Record<string, unknown>,
  analysis?: Record<string, unknown>,
  prototype?: Record<string, unknown>,
  vcReview?: Record<string, unknown>
) {
  const idea: Record<string, unknown> = {
    ...row,
    named_competitors: row.named_competitors ? JSON.parse(row.named_competitors as string) : null,
  }
  // Never ship the raw embedding BLOB to the client.
  delete idea.embedding

  // Recompute the composite viability from sub-scores using the live config, so
  // re-tuning weights/target re-ranks instantly. Ideas without sub-scores
  // (generated before this scoring existed) keep their stored score.
  const cfg = { ...DEFAULT_SCORING, ...getConfig<ScoringConfig>('scoring', DEFAULT_SCORING) }
  const computed = computeViability({
    technical: row.score_technical as number | null,
    deployment: row.score_deployment as number | null,
    barrier: row.score_barrier as number | null,
    appetite: row.score_appetite as number | null,
    marketSize: row.score_market_size as number | null,
  }, cfg)
  if (computed != null) idea.viability_score = computed

  if (analysis) {
    idea.analysis = {
      ...analysis,
      competitors: analysis.competitors ? JSON.parse(analysis.competitors as string) : null,
      risks: analysis.risks ? JSON.parse(analysis.risks as string) : null,
      opportunities: analysis.opportunities ? JSON.parse(analysis.opportunities as string) : null,
    }
  }

  if (prototype) {
    idea.prototype = {
      ...prototype,
      file_tree: prototype.file_tree ? JSON.parse(prototype.file_tree as string) : null,
      stack: prototype.stack ? JSON.parse(prototype.stack as string) : null,
    }
  }

  if (vcReview) {
    const arr = (v: unknown) => (v ? JSON.parse(v as string) : null)
    idea.vc_review = {
      ...vcReview,
      strengths: arr(vcReview.strengths),
      weaknesses: arr(vcReview.weaknesses),
      key_concerns: arr(vcReview.key_concerns),
      needs_to_be_true: arr(vcReview.needs_to_be_true),
    }
  }

  return idea
}
