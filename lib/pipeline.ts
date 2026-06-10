import Anthropic from '@anthropic-ai/sdk'
import { getDb, logUsage, getIdeaWithRelations, getConfig } from './db'
import {
  ANALYZE_SYSTEM,
  PROTOTYPE_SYSTEM,
  getTodayDomain,
  composeGeneratePrompt,
  DEFAULT_GENERATE_CONFIG,
  type GenerateConfig,
} from './prompts'
import { writeSandbox } from './sandbox'
import { computeViability, DEFAULT_SCORING, type ScoringConfig } from './scoring'

// Construct the client per call so a hot-reloaded API key is always picked up,
// and fail loudly if the key is missing rather than sending an empty header.
function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — check .env.local and restart the dev server')
  return new Anthropic({ apiKey })
}

function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
  if (fenced) return JSON.parse(fenced[1].trim())

  const arr = text.match(/\[[\s\S]*\]/)
  if (arr) return JSON.parse(arr[0])

  const obj = text.match(/\{[\s\S]*\}/)
  if (obj) return JSON.parse(obj[0])

  throw new Error('No JSON found in model response')
}

// ── Stage 1: Generate ─────────────────────────────────────────────────────────

export async function runGenerate(domain?: string, count?: number) {
  const db = getDb()
  const batchId = crypto.randomUUID()
  const config = getConfig<GenerateConfig>('generate', DEFAULT_GENERATE_CONFIG)
  const targetDomain = domain ?? getTodayDomain()
  const targetCount = count ?? config.ideaCount ?? 15
  const systemPrompt = composeGeneratePrompt(config)
  const now = new Date().toISOString()

  db.prepare(`INSERT INTO batches (id, type, status, domain, created_at) VALUES (?, 'generate', 'running', ?, ?)`)
    .run(batchId, targetDomain, now)

  try {
    const msg = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Domain: ${targetDomain}\n\nGenerate exactly ${targetCount} ideas.` }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const ideas = extractJSON(text) as Record<string, unknown>[]
    const tokens = msg.usage.input_tokens + msg.usage.output_tokens

    const scoring = getConfig<ScoringConfig>('scoring', DEFAULT_SCORING)

    const insert = db.prepare(`
      INSERT INTO ideas
        (id, batch_id, domain, title, tagline, problem, solution,
         market_sector, market_audience, business_model, moat_type,
         tam_estimate, named_competitors, time_to_first_revenue,
         score_technical, score_deployment, score_barrier, score_appetite, score_market_size,
         viability_score, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?)
    `)

    const num = (v: unknown) => (typeof v === 'number' ? v : null)

    db.transaction(() => {
      for (const idea of ideas) {
        const sub = {
          technical: num(idea.score_technical),
          deployment: num(idea.score_deployment),
          barrier: num(idea.score_barrier),
          appetite: num(idea.score_appetite),
          marketSize: num(idea.score_market_size),
        }
        insert.run(
          crypto.randomUUID(), batchId, targetDomain,
          idea.title, idea.tagline, idea.problem, idea.solution,
          idea.market_sector, idea.market_audience, idea.business_model, idea.moat_type,
          idea.tam_estimate, JSON.stringify(idea.named_competitors ?? []),
          idea.time_to_first_revenue,
          sub.technical, sub.deployment, sub.barrier, sub.appetite, sub.marketSize,
          computeViability(sub, scoring),
          new Date().toISOString()
        )
      }
    })()

    db.prepare(`UPDATE batches SET status='completed', ideas_count=?, tokens_used=?, completed_at=? WHERE id=?`)
      .run(ideas.length, tokens, new Date().toISOString(), batchId)

    logUsage('generate', null, msg.usage.input_tokens, msg.usage.output_tokens)
    return { batchId, count: ideas.length }
  } catch (err) {
    db.prepare(`UPDATE batches SET status='failed', error=?, completed_at=? WHERE id=?`)
      .run(err instanceof Error ? err.message : String(err), new Date().toISOString(), batchId)
    throw err
  }
}

// ── Stage 3: Analyze ──────────────────────────────────────────────────────────

export async function runAnalyze(ideaId: string) {
  const db = getDb()
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(ideaId) as Record<string, unknown>
  if (!idea) throw new Error(`Idea ${ideaId} not found`)

  const now = new Date().toISOString()
  db.prepare(`UPDATE ideas SET status='analyzing', analysis_started_at=? WHERE id=?`).run(now, ideaId)

  try {
    const userContent = [
      `Title: ${idea.title}`,
      `Tagline: ${idea.tagline}`,
      `Problem: ${idea.problem}`,
      `Solution: ${idea.solution}`,
      `Market sector: ${idea.market_sector}`,
      `Market audience: ${idea.market_audience}`,
      `Business model: ${idea.business_model}`,
      `Moat type: ${idea.moat_type}`,
      `TAM estimate: ${idea.tam_estimate}`,
      `Competitors: ${idea.named_competitors}`,
      `Time to first revenue: ${idea.time_to_first_revenue}`,
    ].join('\n')

    const msg = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: ANALYZE_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const analysis = extractJSON(text) as Record<string, unknown>
    const tokens = msg.usage.input_tokens + msg.usage.output_tokens
    const completedAt = new Date().toISOString()

    db.transaction(() => {
      db.prepare(`
        INSERT INTO analyses
          (id, idea_id, tam, sam, som, competitors, revenue_model, pricing_strategy,
           technical_feasibility, feasibility_score, founder_fit_score, market_timing,
           risks, opportunities, recommendation, recommendation_rationale, tokens_used, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(), ideaId,
        analysis.tam, analysis.sam, analysis.som,
        JSON.stringify(analysis.competitors ?? []),
        analysis.revenue_model, analysis.pricing_strategy,
        analysis.technical_feasibility, analysis.feasibility_score,
        analysis.founder_fit_score, analysis.market_timing,
        JSON.stringify(analysis.risks ?? []),
        JSON.stringify(analysis.opportunities ?? []),
        analysis.recommendation, analysis.recommendation_rationale,
        tokens, completedAt
      )

      db.prepare(`UPDATE ideas SET status='analyzed', analysis_completed_at=? WHERE id=?`)
        .run(completedAt, ideaId)
    })()

    logUsage('analyze', ideaId, msg.usage.input_tokens, msg.usage.output_tokens)
    return getIdeaWithRelations(ideaId)
  } catch (err) {
    db.prepare(`UPDATE ideas SET status='selected_analysis' WHERE id=?`).run(ideaId)
    throw err
  }
}

// ── Stage 5: Prototype ────────────────────────────────────────────────────────

export async function runPrototype(ideaId: string) {
  const db = getDb()
  const idea = db.prepare(`
    SELECT i.*, a.recommendation, a.feasibility_score, a.technical_feasibility,
           a.revenue_model, a.risks
    FROM ideas i
    LEFT JOIN analyses a ON a.idea_id = i.id
    WHERE i.id = ?
  `).get(ideaId) as Record<string, unknown>

  if (!idea) throw new Error(`Idea ${ideaId} not found`)

  const now = new Date().toISOString()
  db.prepare(`UPDATE ideas SET status='prototyping', prototype_started_at=? WHERE id=?`).run(now, ideaId)

  try {
    const userContent = [
      `Title: ${idea.title}`,
      `Tagline: ${idea.tagline}`,
      `Problem: ${idea.problem}`,
      `Solution: ${idea.solution}`,
      `Market: ${idea.market_sector} / ${idea.market_audience}`,
      `Business model: ${idea.business_model}`,
      `Moat: ${idea.moat_type}`,
      idea.technical_feasibility ? `Technical feasibility notes: ${idea.technical_feasibility}` : '',
      idea.revenue_model ? `Revenue model: ${idea.revenue_model}` : '',
      idea.risks ? `Key risks to address: ${idea.risks}` : '',
    ].filter(Boolean).join('\n')

    const msg = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: PROTOTYPE_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    })

    const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
    const proto = extractJSON(text) as { files: Array<{ path: string; content: string; language: string }>; stack?: string[]; readme?: string }
    const tokens = msg.usage.input_tokens + msg.usage.output_tokens

    const slug = (idea.title as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
    const date = new Date().toISOString().slice(0, 10)
    const dirPath = writeSandbox(`${date}-${slug}`, proto.files)

    const completedAt = new Date().toISOString()

    db.transaction(() => {
      db.prepare(`
        INSERT INTO prototypes
          (id, idea_id, directory_path, file_count, file_tree, stack, readme, tokens_used, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(), ideaId, dirPath,
        proto.files.length,
        JSON.stringify(proto.files),
        JSON.stringify(proto.stack ?? []),
        proto.readme ?? null,
        tokens, completedAt
      )

      db.prepare(`UPDATE ideas SET status='prototyped', prototype_completed_at=? WHERE id=?`)
        .run(completedAt, ideaId)
    })()

    logUsage('prototype', ideaId, msg.usage.input_tokens, msg.usage.output_tokens)
    return getIdeaWithRelations(ideaId)
  } catch (err) {
    db.prepare(`UPDATE ideas SET status='selected_prototype' WHERE id=?`).run(ideaId)
    throw err
  }
}

// ── Nightly prototype run (called by scheduler) ───────────────────────────────

export async function runNightlyPrototypes() {
  const db = getDb()
  const selected = db.prepare(`SELECT id FROM ideas WHERE status = 'selected_prototype'`).all() as { id: string }[]
  console.log(`[pipeline] Nightly prototype run: ${selected.length} ideas queued`)
  for (const { id } of selected) {
    await runPrototype(id)
  }
}
