import Anthropic from '@anthropic-ai/sdk'
import { getDb, logUsage, getIdeaWithRelations, getConfig } from './db'
import {
  ANALYZE_SYSTEM,
  VC_SYSTEM,
  PROTOTYPE_SYSTEM,
  getTodayDomain,
  composeGeneratePrompt,
  DEFAULT_GENERATE_CONFIG,
  type GenerateConfig,
} from './prompts'
import { writeSandbox } from './sandbox'
import { computeViability, DEFAULT_SCORING, type ScoringConfig } from './scoring'
import { semanticFilter } from './dedup'
import { ideaEmbedText, toBlob } from './embeddings'

// Construct the client per call so a hot-reloaded API key is always picked up,
// and fail loudly if the key is missing rather than sending an empty header.
function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — check .env.local and restart the dev server')
  return new Anthropic({ apiKey })
}

// Robustly pull the first complete JSON value out of a model response.
// Bracket-balanced (respects strings/escapes) so it handles a top-level object
// containing nested arrays — the earlier regex approach grabbed a nested array
// and choked on the trailing object fields.
function extractJSON(text: string): unknown {
  let s = text.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()

  // Clean responses (incl. structured outputs) parse directly.
  try { return JSON.parse(s) } catch { /* fall through to scan */ }

  const start = s.search(/[{[]/)
  if (start === -1) throw new Error('No JSON found in model response')
  const open = s[start]
  const close = open === '{' ? '}' : ']'

  let depth = 0, inStr = false, esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close && --depth === 0) return JSON.parse(s.slice(start, i + 1))
  }
  throw new Error('Unbalanced JSON in model response')
}

// ── Dedup (Tier 1: lexical) ─────────────────────────────────────────────────────

// Generic product-name suffixes that don't distinguish ideas, so "FooBoard"
// and "FooBoard AI" collapse to the same key.
const GENERIC_TOKENS = new Set([
  'ai', 'pro', 'io', 'app', 'hq', 'os', 'plus', 'x', 'co', 'inc', 'labs',
  'suite', 'platform', 'cloud', 'the', 'now', 'go', 'one', 'core', 'sync',
])

function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !GENERIC_TOKENS.has(w))
    .join('')
}

// ── Stage 1: Generate ─────────────────────────────────────────────────────────

export async function runGenerate(domain?: string, count?: number) {
  const db = getDb()
  const batchId = crypto.randomUUID()
  // Merge over defaults so configs saved before newer fields (e.g. dedup) still
  // get sane values rather than undefined.
  const config = { ...DEFAULT_GENERATE_CONFIG, ...getConfig<GenerateConfig>('generate', DEFAULT_GENERATE_CONFIG) }
  const targetDomain = domain ?? getTodayDomain()
  const targetCount = count ?? config.ideaCount ?? 15
  const now = new Date().toISOString()

  // Dedup Tier 1: build an avoid-list for the prompt (dismissed first — strongest
  // "don't repeat" signal — then recent), and a set of normalized titles to
  // post-filter against. Cap the prompt list so it stays cheap.
  const priorRows = db.prepare(`
    SELECT title, tagline, status FROM ideas ORDER BY created_at DESC
  `).all() as { title: string; tagline: string | null; status: string }[]
  const existingNorms = new Set(priorRows.map(r => normTitle(r.title)))
  const avoidList = [
    ...priorRows.filter(r => r.status === 'dismissed'),
    ...priorRows.filter(r => r.status !== 'dismissed'),
  ].slice(0, 200).map(r => (r.tagline ? `${r.title} — ${r.tagline}` : r.title))

  const systemPrompt = composeGeneratePrompt(config, avoidList)

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
    const rawIdeas = extractJSON(text) as Record<string, unknown>[]
    const tokens = msg.usage.input_tokens + msg.usage.output_tokens

    // Lexical dedup (Tier 1): drop near-duplicate titles vs prior + within batch.
    const seenThisBatch = new Set<string>()
    const lexFiltered = rawIdeas.filter(idea => {
      const key = normTitle(String(idea.title ?? ''))
      if (!key || existingNorms.has(key) || seenThisBatch.has(key)) return false
      seenThisBatch.add(key)
      return true
    })
    const lexDropped = rawIdeas.length - lexFiltered.length
    if (lexDropped > 0) console.log(`[generate] dropped ${lexDropped} near-duplicate title(s)`)

    // Semantic dedup (Tier 2): drop candidates too close in meaning to any prior
    // idea or earlier-accepted candidate. Carries each kept idea's vector so we
    // store it for future comparisons.
    let kept: { item: Record<string, unknown>; vector: Float32Array | null }[]
    if (config.dedupEnabled) {
      const result = await semanticFilter(lexFiltered, ideaEmbedText, config.dedupThreshold ?? 0.82)
      if (result.dropped > 0) console.log(`[generate] dropped ${result.dropped} semantic duplicate(s)`)
      kept = result.kept.map(k => ({ item: k.item, vector: k.vector }))
    } else {
      kept = lexFiltered.map(item => ({ item, vector: null }))
    }

    const scoring = { ...DEFAULT_SCORING, ...getConfig<ScoringConfig>('scoring', DEFAULT_SCORING) }

    const insert = db.prepare(`
      INSERT INTO ideas
        (id, batch_id, domain, title, tagline, problem, solution,
         market_sector, market_audience, business_model, moat_type,
         tam_estimate, named_competitors, time_to_first_revenue,
         score_technical, score_deployment, score_barrier, score_appetite, score_market_size,
         viability_score, embedding, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', ?)
    `)

    const num = (v: unknown) => (typeof v === 'number' ? v : null)

    db.transaction(() => {
      for (const { item: idea, vector } of kept) {
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
          vector ? toBlob(vector) : null,
          new Date().toISOString()
        )
      }
    })()

    db.prepare(`UPDATE batches SET status='completed', ideas_count=?, tokens_used=?, completed_at=? WHERE id=?`)
      .run(kept.length, tokens, new Date().toISOString(), batchId)

    logUsage('generate', null, msg.usage.input_tokens, msg.usage.output_tokens)
    return { batchId, count: kept.length }
  } catch (err) {
    db.prepare(`UPDATE batches SET status='failed', error=?, completed_at=? WHERE id=?`)
      .run(err instanceof Error ? err.message : String(err), new Date().toISOString(), batchId)
    throw err
  }
}

// ── Stage 3: Analyze ──────────────────────────────────────────────────────────

// Runs two agents in sequence: a venture analyst, then a skeptical VC who
// critiques the analyst's output. Designed to run as a background job — it owns
// its own status transitions and persists any error to ideas.analysis_error
// rather than throwing into the caller (the route fires it and returns).
export async function runAnalyze(ideaId: string) {
  const db = getDb()
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(ideaId) as Record<string, unknown>
  if (!idea) throw new Error(`Idea ${ideaId} not found`)

  const now = new Date().toISOString()
  db.prepare(`
    UPDATE ideas SET status='analyzing', analysis_stage='analyst', analysis_error=NULL, analysis_started_at=? WHERE id=?
  `).run(now, ideaId)

  try {
    const ideaContext = [
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

    // ── Agent 1: analyst ──
    const analystMsg = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: ANALYZE_SYSTEM,
      messages: [{ role: 'user', content: ideaContext }],
    })
    const analystText = analystMsg.content[0].type === 'text' ? analystMsg.content[0].text : ''
    const analysis = extractJSON(analystText) as Record<string, unknown>
    const analysisCreatedAt = new Date().toISOString()

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
      analystMsg.usage.input_tokens + analystMsg.usage.output_tokens, analysisCreatedAt
    )
    logUsage('analyze', ideaId, analystMsg.usage.input_tokens, analystMsg.usage.output_tokens)

    // ── Agent 2: VC review (critiques the analyst's findings) ──
    db.prepare(`UPDATE ideas SET analysis_stage='vc' WHERE id=?`).run(ideaId)

    const vcContext = [
      'THE IDEA:',
      ideaContext,
      '',
      "THE ANALYST'S FINDINGS:",
      analystText,
    ].join('\n')

    const vcMsg = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: VC_SYSTEM,
      messages: [{ role: 'user', content: vcContext }],
    })
    const vc = extractJSON(vcMsg.content[0].type === 'text' ? vcMsg.content[0].text : '') as Record<string, unknown>

    db.prepare(`
      INSERT INTO vc_reviews
        (id, idea_id, strengths, weaknesses, key_concerns, would_fund, needs_to_be_true, verdict_rationale, tokens_used, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(), ideaId,
      JSON.stringify(vc.strengths ?? []),
      JSON.stringify(vc.weaknesses ?? []),
      JSON.stringify(vc.key_concerns ?? []),
      vc.would_fund ?? null,
      JSON.stringify(vc.needs_to_be_true ?? []),
      vc.verdict_rationale ?? null,
      vcMsg.usage.input_tokens + vcMsg.usage.output_tokens, new Date().toISOString()
    )
    logUsage('analyze', ideaId, vcMsg.usage.input_tokens, vcMsg.usage.output_tokens)

    db.prepare(`
      UPDATE ideas SET status='analyzed', analysis_stage=NULL, analysis_completed_at=? WHERE id=?
    `).run(new Date().toISOString(), ideaId)

    return getIdeaWithRelations(ideaId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[runAnalyze ${ideaId}]`, message)
    // Revert to Queued so the user can retry, and persist the error for display.
    db.prepare(`
      UPDATE ideas SET status='selected_analysis', analysis_stage=NULL, analysis_error=? WHERE id=?
    `).run(message, ideaId)
    return null
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
