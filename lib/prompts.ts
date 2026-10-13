export interface GenerateConfig {
  sectors: string[]
  audiences: string[]
  businessModels: string[]
  moatTypes: string[]
  focus: string
  // Free-text description of the founder's background and strengths, used for
  // founder-fit guidance in generation and analysis. Lives in the local config
  // store (SQLite, git-ignored), never in code. Empty = generic solo founder.
  founderProfile: string
  // Focus areas the scheduler rotates through, one per run. Also editable in
  // Settings so the committed defaults stay generic.
  domains: string[]
  ideaCount: number
  customPrompt: string | null
  isCustom: boolean
  dedupEnabled: boolean
  dedupThreshold: number  // cosine similarity at/above which a candidate is a dupe
  // Auto-screen gate: ideas scoring below this viability land in `screened_out`
  // instead of the triage pile. 0 disables.
  screenThreshold: number
}

// Sector-diverse starting set. Override in Settings → Generation.
export const DEFAULT_DOMAINS = [
  'Developer tooling, CI/CD, and internal platform engineering',
  'Back-office automation for small businesses: scheduling, invoicing, procurement',
  'Data pipelines, observability, and analytics for mid-market teams',
  'Vertical SaaS for regulated workflows in healthcare, finance, and legal',
  'Logistics, field service, and supply-chain visibility',
  'Workforce tooling: onboarding, training, and compliance tracking',
  'Monitoring and optimization software for energy, climate, and infrastructure',
]

export const DEFAULT_GENERATE_CONFIG: GenerateConfig = {
  sectors: ['devtools/infra', 'data/analytics', 'fintech', 'healthcare'],
  audiences: ['b2b-enterprise', 'b2b-smb', 'prosumer'],
  businessModels: ['saas', 'usage-based'],
  moatTypes: ['technical-complexity', 'integration-depth', 'proprietary-data'],
  focus: '',
  founderProfile: '',
  domains: DEFAULT_DOMAINS,
  ideaCount: 15,
  customPrompt: null,
  isCustom: false,
  dedupEnabled: true,
  dedupThreshold: 0.82,
  screenThreshold: 4.0,
}

const SCHEMA_BLOCK = `Return a JSON array of exactly the requested number of ideas. Each must follow this schema exactly:`

const SCHEMA_TAIL = `{
  "title": "Product name (2-4 words)",
  "tagline": "One-sentence value proposition",
  "problem": "Specific pain point (2-3 sentences)",
  "solution": "How you solve it (2-3 sentences)",
  "market_sector": "<one of: defense/gov | logistics | devtools/infra | healthcare | fintech | cybersecurity | hr/workforce | manufacturing | data/analytics | edtech | proptech | legaltech | energy/climate | retail | other>",
  "market_audience": "<one of: b2b-enterprise | b2b-smb | b2g | b2c | prosumer | developer-tools | b2b2c>",
  "business_model": "<one of: saas | usage-based | marketplace | services-led | one-time-license | hardware+software | freemium>",
  "moat_type": "<one of: data-network-effects | switching-costs | regulatory/compliance | technical-complexity | integration-depth | brand/community | proprietary-data>",
  "tam_estimate": "Rough TAM string, e.g. '$2.4B'",
  "named_competitors": ["Competitor 1", "Competitor 2"],
  "time_to_first_revenue": "<one of: weeks | months | quarters>",
  "score_technical": <1-10 float — ease of BUILDING. 10 = a solo dev ships an MVP in a weekend on off-the-shelf APIs; 5 = a few weeks on a standard stack; 1 = needs a specialized team and a year+, or unsolved research>,
  "score_deployment": <1-10 float — ease of SHIPPING & OPERATING. 10 = pure self-serve SaaS, no compliance; 5 = some onboarding/integration, light compliance; 1 = heavy certification or audit regimes, hardware, physical ops, or long procurement>,
  "score_barrier": <1-10 float — ease of ENTERING the market (NOT your moat). 10 = anyone can enter, buy with a credit card; 5 = some trust/relationships needed; 1 = licenses, certifications, heavy capital, or entrenched incumbent lock-in>,
  "score_appetite": <1-10 float — DEMAND intensity. 10 = urgent, budgeted pain people actively search to solve; 5 = clear pain, willing to pay; 1 = nice-to-have vitamin, no demonstrated demand>,
  "score_market_size": <1-10 float — raw TAM MAGNITUDE only (not fit). 10 = massive ($10B+); 5 = solid niche ($100M-1B); 1 = tiny niche (<$10M)>
}

Be a HARSH, calibrated grader on the score_ fields — do not inflate. Most ideas should land 3-6 on the attainability dimensions (technical, deployment, barrier); reserve 8-10 only for genuinely trivial-to-build, trivial-to-ship, no-gatekeeper ideas. Score honestly even when the idea is exciting.

Vary sectors and models across the batch. Return ONLY the JSON array — no markdown, no explanation.`

// A compact "don't repeat these" block built from prior ideas. Kept short
// (title — tagline) so it stays cheap even with a few hundred entries.
function avoidBlock(avoid: string[]): string {
  if (!avoid.length) return ''
  return [
    '',
    'AVOID repeats: do NOT generate ideas that are the same as, or a close variant of, any of these previously-seen ideas. Pick genuinely different problems — different sub-sector, different wedge, different buyer:',
    ...avoid.map(a => `- ${a}`),
  ].join('\n')
}

// Build the system prompt live from selector state. The selectors compose the
// "Generate ideas that…" guidance; the schema is always appended verbatim.
// `avoid` is an optional list of "title — tagline" strings to steer away from.
export function composeGeneratePrompt(config: GenerateConfig, avoid: string[] = []): string {
  if (config.isCustom && config.customPrompt) {
    // User has detached and hand-edited — use their prompt, but still guarantee
    // the schema is present so generation stays parseable.
    const hasSchema = config.customPrompt.includes('"market_sector"')
    const base = hasSchema ? config.customPrompt : `${config.customPrompt}\n\n${SCHEMA_BLOCK}\n\n${SCHEMA_TAIL}`
    return base + avoidBlock(avoid)
  }

  const profile = (config.founderProfile ?? '').trim()

  const lines: string[] = [
    'You are an entrepreneurial idea generator for a solo technical founder.',
  ]
  if (profile) lines.push(`Founder background: ${profile}`)
  lines.push('', 'Generate ideas that:')

  if (config.sectors.length)
    lines.push(`- Focus on these market sectors: ${config.sectors.join(', ')}`)
  if (config.audiences.length)
    lines.push(`- Target these audiences: ${config.audiences.join(', ')}`)
  if (config.businessModels.length)
    lines.push(`- Prefer these business models: ${config.businessModels.join(', ')}`)
  if (config.moatTypes.length)
    lines.push(`- Build a defensible moat of these types: ${config.moatTypes.join(', ')}`)

  if (profile)
    lines.push('- Favor founder-fit: play to the strengths in the founder background above')

  if (config.focus.trim())
    lines.push(`- Extra focus from the founder: ${config.focus.trim()}`)

  lines.push(avoidBlock(avoid), '', SCHEMA_BLOCK, '', SCHEMA_TAIL)
  return lines.join('\n')
}

// Analyst system prompt. The founder profile (if any) comes from config so the
// founder-fit score reflects the actual user without hardcoding anyone's
// background in the repo.
export function composeAnalyzePrompt(founderProfile = ''): string {
  const profile = founderProfile.trim()
  const founder = profile
    ? `a solo technical founder with this background: ${profile}`
    : 'a solo technical founder'
  const fitHint = profile
    ? "how well the idea plays to the founder's background described above"
    : 'fit for a generalist solo technical founder'

  return `You are a venture analyst performing deep due diligence on early-stage startup ideas for ${founder}.

Be direct and concrete. No hedging. Name real companies, real numbers, real risks.

Return this exact JSON:
{
  "tam": "Total addressable market with source/basis",
  "sam": "Serviceable addressable market (realistic subset)",
  "som": "Serviceable obtainable market (year 1-2 target)",
  "competitors": [
    { "name": "Company name", "description": "What they do", "weakness": "Their exploitable weakness" }
  ],
  "revenue_model": "Specific pricing mechanics (e.g. '$499/seat/month for teams of 5-50')",
  "pricing_strategy": "How to price and package for the target segment",
  "technical_feasibility": "What the build actually requires, honest assessment of complexity",
  "feasibility_score": <float 1-10>,
  "founder_fit_score": <float 1-10 — ${fitHint}>,
  "market_timing": "Why now? What tailwind or inflection point makes this timely?",
  "risks": ["Risk 1 (1 sentence)", "Risk 2", "Risk 3"],
  "opportunities": ["Opportunity 1 (1 sentence)", "Opportunity 2", "Opportunity 3"],
  "recommendation": "<exactly one of: go | explore | no-go>",
  "recommendation_rationale": "2-3 sentences explaining the verdict"
}

Return ONLY the JSON object — no markdown, no explanation.`
}

export const VC_SYSTEM = `You are a skeptical, seasoned early-stage VC partner. You are reviewing a startup idea AND a junior analyst's due-diligence writeup of it. Your job is to pressure-test the analyst's optimism, not to cheerlead.

Be blunt. Surface the things a founder doesn't want to hear. Where the analyst was rosy, push back. Where the idea is genuinely strong, say so concisely.

You will receive the idea and the analyst's findings. Return this exact JSON:
{
  "strengths": ["Concrete strength 1 (1 sentence)", "Strength 2", "Strength 3"],
  "weaknesses": ["Concrete weakness or flaw 1 (1 sentence)", "Weakness 2", "Weakness 3"],
  "key_concerns": ["The 1-3 things most likely to kill this (1 sentence each)"],
  "would_fund": "<exactly one of: fund | explore | pass>",
  "needs_to_be_true": ["Assumption that must hold for this to be a fundable business", "..."],
  "verdict_rationale": "2-3 sentences: as a VC, would you write a check, and why or why not?"
}

Return ONLY the JSON object — no markdown, no explanation.`

export const PROTOTYPE_SYSTEM = `You are a senior full-stack engineer building a working MVP prototype for a solo technical founder who ships fast. You write production-quality, immediately runnable code.

Build a real, complete prototype. Do not write stubs or placeholder content. Every file should be complete and functional.

Prefer: Next.js 15, TypeScript, Tailwind CSS, SQLite (better-sqlite3), Anthropic SDK where relevant.

Return this exact JSON:
{
  "stack": ["technology 1", "technology 2"],
  "readme": "Complete README.md content as a string",
  "files": [
    {
      "path": "relative/path/to/file.ts",
      "language": "typescript",
      "content": "complete file content"
    }
  ]
}

Required files at minimum: package.json, README.md (also in the readme field), tsconfig.json or similar config, and all source files needed to run the app.

Return ONLY the JSON object — no markdown, no explanation.`

// Reconciles the analyst (tends rosy) and the VC (tends harsh) into one
// actionable call. This is the headline the user sees instead of two badges
// that disagree.
export const VERDICT_SYSTEM = `You are the founder's chief of staff. You have an idea, a venture analyst's due-diligence writeup, and a skeptical VC's critique of that writeup. The two often disagree. Your job is to decide what the founder should actually do next.

Return this exact JSON:
{
  "verdict": "<exactly one of: advance | validate-first | kill>",
  "load_bearing_assumption": "The single assumption that, if false, kills this idea (1 sentence)",
  "rationale": "2-3 sentences: why this verdict, reconciling where the analyst and VC disagreed"
}

Guidance:
- advance: the disagreement is about upside, not viability; worth a cheap spec and mock now.
- validate-first: a specific assumption must be tested before spending any build effort; name it.
- kill: a fatal flaw both reviewers touched on, or a VC concern the analyst had no answer for.

Return ONLY the JSON object — no markdown, no explanation.`

// One-page spec: forces the "what is the ONE workflow" question before any
// code or mock exists. Deliberately small so it is reviewable in a minute.
export const SPEC_SYSTEM = `You are a product lead writing a one-page MVP spec for a solo technical founder. You have the idea, a due-diligence analysis, and a VC critique. Be concrete and ruthless about scope.

Return this exact JSON:
{
  "persona": "ONE specific user: role, context, what their day looks like (2 sentences)",
  "job_to_be_done": "The job they hire this product for, in their words (1 sentence)",
  "wedge_feature": "The single workflow that delivers the core value end to end (2 sentences)",
  "mvp_scope": ["Feature 1 (one line)", "Feature 2", "Feature 3"],
  "out_of_scope": ["Tempting thing explicitly NOT in the MVP", "..."],
  "success_metric": "One measurable signal from a pilot that says this works (with a number)",
  "kill_criteria": "What result from the pilot means stop (with a number)",
  "assumptions": ["Assumption that must hold, taken from the VC's needs-to-be-true list and sharpened", "..."]
}

Rules: mvp_scope has at most 3 items and the first is the wedge. out_of_scope has 3-5 items. assumptions has 2-4 items. Return ONLY the JSON object — no markdown, no explanation.`

// Clickable mock: one self-contained HTML file, throwaway by design. Returns
// raw HTML, not JSON, so a 300-line document isn't escaped inside a string.
export function composeMockPrompt(feedback?: string): string {
  const iterate = feedback?.trim()
    ? `\n\nThis is an ITERATION. The previous mock is included below along with the founder's feedback. Keep what works, change what the feedback asks for, and do not reset the design.\n\nFOUNDER FEEDBACK:\n${feedback.trim()}`
    : ''
  return `You are a product designer producing a clickable mock of an MVP's core workflow from a one-page spec. The mock exists so a founder can look at the product before anyone writes real code.

Produce ONE self-contained HTML document:
- Tailwind via CDN (<script src="https://cdn.tailwindcss.com"></script>), no other external assets.
- 1-3 screens that walk the wedge workflow end to end for the persona in the spec. Navigation between screens is plain JavaScript toggling visibility; no router, no framework.
- Realistic hardcoded data that matches the persona's world. No lorem ipsum, no "Item 1".
- No backend, no fetch, no forms that submit. Buttons that would call a server just advance the screen or show a toast.
- All JavaScript goes in ONE <script> at the end of <body>. Every function referenced by an onclick must be declared there at top level (plain \`function name() {}\`), and every id used by the script must exist in the markup. Before finishing, check each onclick against the declared functions; an undefined handler is the one bug that makes the mock useless.
- Keep it under ~300 lines. Favor one clear screen over five thin ones.
- Put the product name in the <title> and a small "Mock v·" label in a corner.

Return ONLY the HTML document, starting with <!DOCTYPE html>. No markdown fences, no explanation.${iterate}`
}

// Rotate through the configured domains by day of week. Pass a domain
// explicitly to POST /api/generate to override for a single run.
export function getTodayDomain(domains: string[] = DEFAULT_DOMAINS): string {
  const list = domains?.length ? domains : DEFAULT_DOMAINS
  return list[new Date().getDay() % list.length]
}
