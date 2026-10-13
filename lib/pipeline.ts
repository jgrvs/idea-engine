import { getDb, logUsage, getConfig, addArtifact, getArtifact, getIdeaWithRelations } from './db'
import { getClient, MODELS } from './llm'
import {
  composeAnalyzePrompt,
  VC_SYSTEM,
  VERDICT_SYSTEM,
  SPEC_SYSTEM,
  composeMockPrompt,
  composeLandingPrompt,
  getTodayDomain,
  composeGeneratePrompt,
  DEFAULT_GENERATE_CONFIG,
  type GenerateConfig,
} from './prompts'
import { writeMockFile } from './sandbox'
import { transition } from './stages'
import type { IdeaStatus, MockKind, Spec } from './types'

const MODEL = MODELS.default

function loadGenerateConfig(): GenerateConfig {
  return { ...DEFAULT_GENERATE_CONFIG, ...getConfig<GenerateConfig>('generate', DEFAULT_GENERATE_CONFIG) }
}

// Pull a full HTML document out of a model response, tolerating a stray fence.
// A missing </html> means the response was cut off (the mock's script lives at
// the end of <body>, so a truncated page is a dead page): fail loudly rather
// than save it.
function extractHTML(text: string): string {
  let s = text.trim()
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/)
  if (fence) s = fence[1].trim()
  const start = s.search(/<!doctype html|<html/i)
  if (start === -1) throw new Error('No HTML document in model response')
  const end = s.lastIndexOf('</html>')
  if (end === -1) throw new Error('Mock HTML was truncated before </html> (response hit the token limit)')
  return s.slice(start, end + '</html>'.length)
}

function ideaContextBlock(idea: Record<string, unknown>): string {
  return [
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
}
import { computeViability, DEFAULT_SCORING, type ScoringConfig } from './scoring'
import { semanticFilter } from './dedup'
import { ideaEmbedText, toBlob } from './embeddings'

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
  const config = loadGenerateConfig()
  const targetDomain = domain ?? getTodayDomain(config.domains)
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
      model: MODEL,
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
    const inserted: { id: string; viability: number | null }[] = []

    db.transaction(() => {
      for (const { item: idea, vector } of kept) {
        const sub = {
          technical: num(idea.score_technical),
          deployment: num(idea.score_deployment),
          barrier: num(idea.score_barrier),
          appetite: num(idea.score_appetite),
          marketSize: num(idea.score_market_size),
        }
        const id = crypto.randomUUID()
        const viability = computeViability(sub, scoring)
        insert.run(
          id, batchId, targetDomain,
          idea.title, idea.tagline, idea.problem, idea.solution,
          idea.market_sector, idea.market_audience, idea.business_model, idea.moat_type,
          idea.tam_estimate, JSON.stringify(idea.named_competitors ?? []),
          idea.time_to_first_revenue,
          sub.technical, sub.deployment, sub.barrier, sub.appetite, sub.marketSize,
          viability,
          vector ? toBlob(vector) : null,
          new Date().toISOString()
        )
        inserted.push({ id, viability })
      }
    })()

    // Auto-screen gate: park low-viability ideas out of the triage pile. They
    // stay visible under their own filter and can be promoted back by hand.
    const threshold = config.screenThreshold ?? 0
    let screened = 0
    if (threshold > 0) {
      for (const { id, viability } of inserted) {
        if (viability != null && viability < threshold) {
          transition(id, 'screened_out', { actor: 'auto', reason: `viability ${viability} below screen threshold ${threshold}` })
          screened++
        }
      }
      if (screened > 0) console.log(`[generate] screened out ${screened} idea(s) below viability ${threshold}`)
    }

    db.prepare(`UPDATE batches SET status='completed', ideas_count=?, tokens_used=?, completed_at=? WHERE id=?`)
      .run(kept.length, tokens, new Date().toISOString(), batchId)

    logUsage('generate', null, msg.usage.input_tokens, msg.usage.output_tokens)
    return { batchId, count: kept.length, screened }
  } catch (err) {
    db.prepare(`UPDATE batches SET status='failed', error=?, completed_at=? WHERE id=?`)
      .run(err instanceof Error ? err.message : String(err), new Date().toISOString(), batchId)
    throw err
  }
}

// ── Stage 3: Analyze ──────────────────────────────────────────────────────────

// Gate + kickoff. The transition to `analyzing` runs synchronously and throws
// a TransitionError if the idea isn't in a state that allows analysis, so the
// route can answer 409 before any model call. The job itself runs detached.
export function startAnalyze(ideaId: string, actor: 'human' | 'auto' = 'human') {
  transition(ideaId, 'analyzing', { actor })
  void runAnalyze(ideaId).catch(err => console.error('[analyze job]', err))
}

// Runs two agents in sequence: a venture analyst, then a skeptical VC who
// critiques the analyst's output. Assumes the idea is already `analyzing`
// (see startAnalyze). Owns its own completion/failure transitions and never
// throws into the caller.
export async function runAnalyze(ideaId: string) {
  const db = getDb()
  const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(ideaId) as Record<string, unknown>
  if (!idea) throw new Error(`Idea ${ideaId} not found`)

  try {
    const ideaContext = ideaContextBlock(idea)

    // ── Agent 1: analyst ──
    // Founder profile comes from config so founder-fit reflects the actual user
    // without anyone's background living in the repo.
    const { founderProfile } = loadGenerateConfig()
    const analystMsg = await getClient().messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: composeAnalyzePrompt(founderProfile),
      messages: [{ role: 'user', content: ideaContext }],
    })
    const analystText = analystMsg.content[0].type === 'text' ? analystMsg.content[0].text : ''
    const analysis = extractJSON(analystText) as Record<string, unknown>
    const analysisCreatedAt = new Date().toISOString()
    const analysisId = crypto.randomUUID()

    db.prepare(`
      INSERT INTO analyses
        (id, idea_id, tam, sam, som, competitors, revenue_model, pricing_strategy,
         technical_feasibility, feasibility_score, founder_fit_score, market_timing,
         risks, opportunities, recommendation, recommendation_rationale, tokens_used, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      analysisId, ideaId,
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
      model: MODEL,
      max_tokens: 4096,
      system: VC_SYSTEM,
      messages: [{ role: 'user', content: vcContext }],
    })
    const vcText = vcMsg.content[0].type === 'text' ? vcMsg.content[0].text : ''
    const vc = extractJSON(vcText) as Record<string, unknown>

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

    // ── Agent 3: reconciled verdict (the headline) ──
    db.prepare(`UPDATE ideas SET analysis_stage='verdict' WHERE id=?`).run(ideaId)
    const verdictMsg = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: VERDICT_SYSTEM,
      messages: [{ role: 'user', content: ['THE IDEA:', ideaContext, '', "ANALYST:", analystText, '', 'VC:', vcText].join('\n') }],
    })
    const verdict = extractJSON(verdictMsg.content[0].type === 'text' ? verdictMsg.content[0].text : '') as Record<string, unknown>
    db.prepare(`UPDATE analyses SET verdict=?, verdict_assumption=?, verdict_rationale=? WHERE id=?`)
      .run(verdict.verdict ?? null, verdict.load_bearing_assumption ?? null, verdict.rationale ?? null, analysisId)
    logUsage('analyze', ideaId, verdictMsg.usage.input_tokens, verdictMsg.usage.output_tokens)

    return transition(ideaId, 'analyzed', { actor: 'auto' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[runAnalyze ${ideaId}]`, message)
    // Revert to Queued so the user can retry; the error lands in
    // ideas.analysis_error and the decisions log.
    transition(ideaId, 'selected_analysis', { actor: 'auto', error: message })
    return null
  }
}

// ── Stage 4: Spec ─────────────────────────────────────────────────────────────

// Gate + kickoff: analyzed | spec_ready -> specing. Throws TransitionError on
// an illegal move so the route can answer 409 before any model call.
export function startSpec(ideaId: string, actor: 'human' | 'auto' = 'human') {
  transition(ideaId, 'specing', { actor })
  void runSpec(ideaId).catch(err => console.error('[spec job]', err))
}

// One-page spec from idea + analysis + VC review. Stored as a versioned
// artifact so human edits (PUT /spec) and redrafts sit side by side.
export async function runSpec(ideaId: string) {
  const idea = getIdeaWithRelations(ideaId) as (Record<string, unknown> & {
    analysis?: Record<string, unknown>; vc_review?: Record<string, unknown>
  }) | null
  if (!idea) throw new Error(`Idea ${ideaId} not found`)

  try {
    const content = [
      'THE IDEA:', ideaContextBlock(idea), '',
      'ANALYSIS:', JSON.stringify(idea.analysis ?? {}, null, 1), '',
      'VC REVIEW:', JSON.stringify(idea.vc_review ?? {}, null, 1),
    ].join('\n')

    const msg = await getClient().messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SPEC_SYSTEM,
      messages: [{ role: 'user', content }],
    })
    const spec = extractJSON(msg.content[0].type === 'text' ? msg.content[0].text : '') as Spec
    if (!Array.isArray(spec.mvp_scope) || !spec.wedge_feature) throw new Error('Spec response missing required fields')
    spec.mvp_scope = spec.mvp_scope.slice(0, 3)

    addArtifact({ ideaId, stage: 'spec', kind: 'json', content: JSON.stringify(spec) })
    logUsage('spec', ideaId, msg.usage.input_tokens, msg.usage.output_tokens)
    return transition(ideaId, 'spec_ready', { actor: 'auto' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[runSpec ${ideaId}]`, message)
    transition(ideaId, 'analyzed', { actor: 'auto', error: message })
    return null
  }
}

// Human edit of the current spec: a new artifact version, no model call.
export function saveSpec(ideaId: string, spec: Spec) {
  const current = getDb().prepare('SELECT status FROM ideas WHERE id = ?').get(ideaId) as { status: string } | undefined
  if (!current) throw new Error(`Idea ${ideaId} not found`)
  if (current.status !== 'spec_ready' && current.status !== 'mock_ready') {
    throw new Error(`Spec can only be edited while spec_ready or mock_ready (idea is ${current.status})`)
  }
  const clean: Spec = {
    persona: String(spec.persona ?? ''),
    job_to_be_done: String(spec.job_to_be_done ?? ''),
    wedge_feature: String(spec.wedge_feature ?? ''),
    mvp_scope: (spec.mvp_scope ?? []).map(String).filter(Boolean).slice(0, 3),
    out_of_scope: (spec.out_of_scope ?? []).map(String).filter(Boolean),
    success_metric: String(spec.success_metric ?? ''),
    kill_criteria: String(spec.kill_criteria ?? ''),
    assumptions: (spec.assumptions ?? []).map(String).filter(Boolean),
  }
  addArtifact({ ideaId, stage: 'spec', kind: 'json', content: JSON.stringify(clean) })
  return getIdeaWithRelations(ideaId)
}

// ── Stage 5: Mock ─────────────────────────────────────────────────────────────

// Which artifact kind and file prefix each mock kind is stored under.
const MOCK_STORE: Record<MockKind, { kind: string; prefix: 'mock' | 'landing' }> = {
  app:     { kind: 'html',    prefix: 'mock' },
  landing: { kind: 'landing', prefix: 'landing' },
}

// Gate + kickoff. Three ways in:
//   spec_ready            → approves the spec and builds the first app mock
//   mock_ready/validating → iterates the app mock (feedback required)
//   mock_ready/validating → generates a landing page for demand testing
// The job returns the idea to wherever it was started from.
export function startMock(ideaId: string, opts: { actor?: 'human' | 'auto'; feedback?: string; kind?: MockKind } = {}) {
  const actor = opts.actor ?? 'human'
  const kind: MockKind = opts.kind ?? 'app'
  const feedback = opts.feedback?.trim()
  const origin = (getDb().prepare('SELECT status FROM ideas WHERE id = ?').get(ideaId) as { status: IdeaStatus } | undefined)?.status

  if (origin && origin !== 'spec_ready') {
    if (kind === 'app' && !feedback) throw new Error('Iterating a mock needs feedback describing what to change')
  } else if (kind === 'landing') {
    throw new Error('Landing pages come after the app mock: approve the spec first')
  }

  const reason = kind === 'landing' ? 'landing page' : feedback ? 'iterate' : 'approve spec'
  transition(ideaId, 'mocking', { actor, reason, note: feedback })
  // `origin` is defined here: transition() throws for an unknown idea.
  const returnTo: IdeaStatus = origin === 'spec_ready' ? 'mock_ready' : origin!
  void runMock(ideaId, { feedback, kind, origin: origin!, returnTo }).catch(err => console.error('[mock job]', err))
}

export async function runMock(
  ideaId: string,
  opts: { feedback?: string; kind?: MockKind; origin?: IdeaStatus; returnTo?: IdeaStatus } = {},
) {
  const db = getDb()
  const kind: MockKind = opts.kind ?? 'app'
  const store = MOCK_STORE[kind]
  const idea = db.prepare('SELECT id, title, tagline, business_model FROM ideas WHERE id = ?')
    .get(ideaId) as { id: string; title: string; tagline: string | null; business_model: string | null } | undefined
  if (!idea) throw new Error(`Idea ${ideaId} not found`)

  try {
    const spec = getArtifact(ideaId, 'spec', 'json')
    if (!spec?.content) throw new Error('No spec to build a mock from')
    const previous = opts.feedback ? getArtifact(ideaId, 'mock', store.kind) : undefined

    const content = [
      `PRODUCT: ${idea.title} — ${idea.tagline ?? ''}`,
      ...(kind === 'landing' && idea.business_model ? [`BUSINESS MODEL: ${idea.business_model}`] : []),
      '',
      'SPEC:', spec.content,
      ...(previous?.content ? ['', `PREVIOUS ${kind === 'landing' ? 'LANDING PAGE' : 'MOCK'} (HTML):`, previous.content] : []),
    ].join('\n')

    // Tailwind-heavy markup is token-dense (~70 tokens/line), so a 300-line
    // mock needs well over 8k output tokens. Budget generously and treat a
    // max_tokens stop as a failure: a cut-off mock has no script and is dead.
    const msg = await getClient().messages.create({
      model: MODEL,
      max_tokens: 20000,
      system: kind === 'landing' ? composeLandingPrompt(opts.feedback) : composeMockPrompt(opts.feedback),
      messages: [{ role: 'user', content }],
    })
    if (msg.stop_reason === 'max_tokens') throw new Error('Mock generation hit the output token limit; tighten the spec or simplify the screens')
    const html = extractHTML(msg.content[0].type === 'text' ? msg.content[0].text : '')

    // Reserve the version first so the file name matches the artifact row.
    const { next } = db.prepare(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM artifacts WHERE idea_id = ? AND stage = 'mock' AND kind = ?`
    ).get(ideaId, store.kind) as { next: number }
    const file = writeMockFile(idea.title, next, html, store.prefix)
    addArtifact({ ideaId, stage: 'mock', kind: store.kind, content: html, path: file })

    logUsage('mock', ideaId, msg.usage.input_tokens, msg.usage.output_tokens)
    return transition(ideaId, opts.returnTo ?? 'mock_ready', { actor: 'auto', reason: kind === 'landing' ? 'landing page ready' : undefined })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[runMock ${ideaId}]`, message)
    transition(ideaId, opts.origin ?? 'spec_ready', { actor: 'auto', error: message })
    return null
  }
}
