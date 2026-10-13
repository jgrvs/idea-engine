import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { computeViability, DEFAULT_SCORING, type ScoringConfig } from './scoring'
import { MODELS, priceFor } from './llm'

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
      prototype_error TEXT,
      stage_error TEXT,
      embedding BLOB
    );

    -- One row per status transition: the audit trail behind every gate.
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL REFERENCES ideas(id),
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );

    -- Reviewable stage outputs (spec, mock, build log, experiment evidence).
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL REFERENCES ideas(id),
      stage TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      kind TEXT NOT NULL,
      content TEXT,
      path TEXT,
      created_at TEXT NOT NULL
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
      verdict TEXT,
      verdict_assumption TEXT,
      verdict_rationale TEXT,
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
    -- One test of one assumption. Seeded from the spec when validation starts.
    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL REFERENCES ideas(id),
      assumption TEXT NOT NULL,
      method TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      result TEXT,
      evidence_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_decisions_idea ON decisions(idea_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_idea ON artifacts(idea_id, stage, version DESC);
    CREATE INDEX IF NOT EXISTS idx_experiments_idea ON experiments(idea_id, created_at);
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
  // Migration: per-model pricing and prompt-cache accounting.
  if (!names.has('model')) db.exec(`ALTER TABLE usage_log ADD COLUMN model TEXT`)
  for (const col of ['cache_read_tokens', 'cache_write_tokens']) {
    if (!names.has(col)) db.exec(`ALTER TABLE usage_log ADD COLUMN ${col} INTEGER DEFAULT 0`)
  }

  // Migration: add viability sub-score columns to ideas if upgrading.
  const ideaCols = new Set(
    (db.prepare(`PRAGMA table_info(ideas)`).all() as { name: string }[]).map(c => c.name)
  )
  for (const col of ['score_technical', 'score_deployment', 'score_barrier', 'score_appetite', 'score_market_size']) {
    if (!ideaCols.has(col)) db.exec(`ALTER TABLE ideas ADD COLUMN ${col} REAL`)
  }
  for (const col of ['analysis_stage', 'analysis_error', 'prototype_error', 'stage_error', 'stage_progress']) {
    if (!ideaCols.has(col)) db.exec(`ALTER TABLE ideas ADD COLUMN ${col} TEXT`)
  }
  if (!ideaCols.has('embedding')) db.exec(`ALTER TABLE ideas ADD COLUMN embedding BLOB`)

  // Migration: the one-shot prototype stage was retired in favour of
  // validate -> slice. Ideas parked in its statuses fall back to the furthest
  // stage they have an artifact for, so nothing is stranded in a status the
  // state machine no longer knows.
  db.exec(`
    UPDATE ideas SET status = CASE
      WHEN EXISTS (SELECT 1 FROM artifacts a WHERE a.idea_id = ideas.id AND a.stage = 'mock') THEN 'mock_ready'
      WHEN EXISTS (SELECT 1 FROM artifacts a WHERE a.idea_id = ideas.id AND a.stage = 'spec') THEN 'spec_ready'
      WHEN EXISTS (SELECT 1 FROM analyses  a WHERE a.idea_id = ideas.id) THEN 'analyzed'
      ELSE 'generated'
    END
    WHERE status IN ('selected_prototype', 'prototyping', 'prototyped')
  `)

  // Migration: reconciled verdict columns on analyses.
  const analysisCols = new Set(
    (db.prepare(`PRAGMA table_info(analyses)`).all() as { name: string }[]).map(c => c.name)
  )
  for (const col of ['verdict', 'verdict_assumption', 'verdict_rationale']) {
    if (!analysisCols.has(col)) db.exec(`ALTER TABLE analyses ADD COLUMN ${col} TEXT`)
  }
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

// `inputTokens` is the uncached input. Cache reads and writes are logged
// separately because they are priced differently (see lib/llm.ts).
export function logUsage(
  stage: string,
  ideaId: string | null,
  inputTokens: number,
  outputTokens: number,
  opts: { model?: string; cacheReadTokens?: number; cacheWriteTokens?: number } = {}
) {
  const db = getDb()
  const cacheRead = opts.cacheReadTokens ?? 0
  const cacheWrite = opts.cacheWriteTokens ?? 0
  db.prepare(`
    INSERT INTO usage_log
      (id, date, stage, idea_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens_used, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    new Date().toISOString().slice(0, 10),
    stage,
    ideaId,
    opts.model ?? MODELS.default,
    inputTokens,
    outputTokens,
    cacheRead,
    cacheWrite,
    inputTokens + outputTokens + cacheRead + cacheWrite,
    new Date().toISOString()
  )
}

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

  // Group by model as well as stage so each row is priced at its own model's
  // rate, then fold the models back together per stage.
  const rows = db.prepare(`
    SELECT stage, model,
           SUM(input_tokens) as input_tokens,
           SUM(output_tokens) as output_tokens,
           SUM(COALESCE(cache_read_tokens, 0)) as cache_read,
           SUM(COALESCE(cache_write_tokens, 0)) as cache_write,
           COUNT(*) as calls
    FROM usage_log
    WHERE date LIKE ?
    GROUP BY stage, model
  `).all(`${month}%`) as {
    stage: string; model: string | null; input_tokens: number; output_tokens: number
    cache_read: number; cache_write: number; calls: number
  }[]

  const stages = new Map<string, { stage: string; inputTokens: number; outputTokens: number; cost: number; calls: number }>()
  for (const r of rows) {
    const p = priceFor(r.model)
    const inp = r.input_tokens ?? 0, out = r.output_tokens ?? 0
    const cost = (inp * p.input + out * p.output + r.cache_read * p.cacheRead + r.cache_write * p.cacheWrite) / 1_000_000
    const s = stages.get(r.stage) ?? { stage: r.stage, inputTokens: 0, outputTokens: 0, cost: 0, calls: 0 }
    s.inputTokens += inp + r.cache_read + r.cache_write
    s.outputTokens += out
    s.cost += cost
    s.calls += r.calls
    stages.set(r.stage, s)
  }
  const byStage = [...stages.values()]

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

// ── Artifacts ───────────────────────────────────────────────────────────────

// Store a stage output. Version auto-increments per (idea, stage, kind) so
// iterations (mock v1, v2, …) are kept side by side.
export function addArtifact(a: { ideaId: string; stage: string; kind: string; content?: string | null; path?: string | null }) {
  const db = getDb()
  const { next } = db.prepare(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM artifacts WHERE idea_id = ? AND stage = ? AND kind = ?`
  ).get(a.ideaId, a.stage, a.kind) as { next: number }
  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO artifacts (id, idea_id, stage, version, kind, content, path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, a.ideaId, a.stage, next, a.kind, a.content ?? null, a.path ?? null, new Date().toISOString())
  return { id, version: next }
}

export function getArtifacts(ideaId: string, stage?: string) {
  const db = getDb()
  return stage
    ? db.prepare(`SELECT * FROM artifacts WHERE idea_id = ? AND stage = ? ORDER BY version DESC`).all(ideaId, stage)
    : db.prepare(`SELECT * FROM artifacts WHERE idea_id = ? ORDER BY stage, version DESC`).all(ideaId)
}

export interface ArtifactRow {
  id: string; idea_id: string; stage: string; version: number; kind: string
  content: string | null; path: string | null; created_at: string
}

// Latest artifact for (idea, stage, kind), or a specific version.
export function getArtifact(ideaId: string, stage: string, kind: string, version?: number): ArtifactRow | undefined {
  const db = getDb()
  return version != null
    ? db.prepare(`SELECT * FROM artifacts WHERE idea_id = ? AND stage = ? AND kind = ? AND version = ?`).get(ideaId, stage, kind, version) as ArtifactRow | undefined
    : db.prepare(`SELECT * FROM artifacts WHERE idea_id = ? AND stage = ? AND kind = ? ORDER BY version DESC LIMIT 1`).get(ideaId, stage, kind) as ArtifactRow | undefined
}

// ── Experiments (validation stage) ──────────────────────────────────────────

export function listExperiments(ideaId: string) {
  return getDb().prepare(`SELECT * FROM experiments WHERE idea_id = ? ORDER BY created_at, rowid`).all(ideaId) as Record<string, unknown>[]
}

export function addExperiment(ideaId: string, assumption: string, method: string | null = null) {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  getDb().prepare(`
    INSERT INTO experiments (id, idea_id, assumption, method, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'planned', ?, ?)
  `).run(id, ideaId, assumption, method, now, now)
  return id
}

// Seed one planned experiment per spec assumption, once. Re-entering
// validation later never duplicates or resets what a human has recorded.
export function seedExperiments(ideaId: string, assumptions: string[]) {
  const db = getDb()
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM experiments WHERE idea_id = ?`).get(ideaId) as { n: number }
  if (n > 0) return 0
  for (const a of assumptions) if (a?.trim()) addExperiment(ideaId, a.trim())
  return assumptions.length
}

const EXPERIMENT_FIELDS = ['assumption', 'method', 'status', 'result', 'evidence_url'] as const

export function updateExperiment(ideaId: string, expId: string, patch: Partial<Record<typeof EXPERIMENT_FIELDS[number], string | null>>) {
  const sets: string[] = []
  const params: unknown[] = []
  for (const f of EXPERIMENT_FIELDS) {
    if (f in patch) { sets.push(`${f} = ?`); params.push(patch[f] ?? null) }
  }
  if (!sets.length) return false
  const res = getDb().prepare(`UPDATE experiments SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND idea_id = ?`)
    .run(...params, new Date().toISOString(), expId, ideaId)
  return res.changes > 0
}

export function deleteExperiment(ideaId: string, expId: string) {
  return getDb().prepare(`DELETE FROM experiments WHERE id = ? AND idea_id = ?`).run(expId, ideaId).changes > 0
}

export function experimentCounts(ideaId: string) {
  return getDb().prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(status = 'confirmed'), 0) AS confirmed,
           COALESCE(SUM(status = 'refuted'), 0) AS refuted
    FROM experiments WHERE idea_id = ?
  `).get(ideaId) as { total: number; confirmed: number; refuted: number }
}

// Live status line for long-running stages ("installing dependencies",
// "agent · turn 7"). Cleared by the state machine on every transition.
export function setStageProgress(ideaId: string, text: string | null) {
  getDb().prepare(`UPDATE ideas SET stage_progress = ? WHERE id = ?`).run(text, ideaId)
}

type VersionRow = { version: number; path: string | null; created_at: string }

export function getIdeaWithRelations(ideaId: string) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM ideas WHERE id = ?').get(ideaId) as Record<string, unknown> | undefined
  if (!row) return null

  const analysis = db.prepare('SELECT * FROM analyses WHERE idea_id = ? ORDER BY created_at DESC LIMIT 1').get(ideaId) as Record<string, unknown> | undefined
  const vcReview = db.prepare('SELECT * FROM vc_reviews WHERE idea_id = ? ORDER BY created_at DESC LIMIT 1').get(ideaId) as Record<string, unknown> | undefined
  const decisions = db.prepare('SELECT * FROM decisions WHERE idea_id = ? ORDER BY created_at DESC LIMIT 50').all(ideaId) as Record<string, unknown>[]
  const spec = getArtifact(ideaId, 'spec', 'json')
  // Mock HTML is fetched on demand via GET /api/ideas/:id/mock; only list versions here.
  const versions = db.prepare(
    `SELECT version, path, created_at FROM artifacts WHERE idea_id = ? AND stage = 'mock' AND kind = ? ORDER BY version DESC`
  )
  const mocks = versions.all(ideaId, 'html') as VersionRow[]
  const landings = versions.all(ideaId, 'landing') as VersionRow[]
  const experiments = listExperiments(ideaId)
  const slice = getArtifact(ideaId, 'slice', 'json')

  return deserializeIdea(row, { analysis, vcReview, decisions, spec, mocks, landings, experiments, slice })
}

export function deserializeIdea(
  row: Record<string, unknown>,
  rel: {
    analysis?: Record<string, unknown>
    vcReview?: Record<string, unknown>
    decisions?: Record<string, unknown>[]
    spec?: ArtifactRow
    mocks?: VersionRow[]
    landings?: VersionRow[]
    experiments?: Record<string, unknown>[]
    slice?: ArtifactRow
  } = {}
) {
  const { analysis, vcReview, decisions, spec, mocks, landings, experiments, slice } = rel
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

  if (decisions) idea.decisions = decisions

  if (spec?.content) {
    try { idea.spec = { ...JSON.parse(spec.content), version: spec.version } } catch { /* ignore malformed */ }
  }
  if (mocks) idea.mock_versions = mocks
  if (landings) idea.landing_versions = landings
  if (experiments) idea.experiments = experiments
  if (slice?.content) {
    try { idea.slice = { ...JSON.parse(slice.content), version: slice.version } } catch { /* ignore malformed */ }
  }

  return idea
}
