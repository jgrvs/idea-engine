export interface GenerateConfig {
  sectors: string[]
  audiences: string[]
  businessModels: string[]
  moatTypes: string[]
  focus: string
  ideaCount: number
  customPrompt: string | null
  isCustom: boolean
  dedupEnabled: boolean
  dedupThreshold: number  // cosine similarity at/above which a candidate is a dupe
}

export const DEFAULT_GENERATE_CONFIG: GenerateConfig = {
  sectors: ['defense/gov', 'logistics', 'devtools/infra', 'cybersecurity'],
  audiences: ['b2b-enterprise', 'b2b-smb', 'b2g'],
  businessModels: ['saas', 'usage-based'],
  moatTypes: ['technical-complexity', 'integration-depth', 'regulatory/compliance'],
  focus: '',
  ideaCount: 15,
  customPrompt: null,
  isCustom: false,
  dedupEnabled: true,
  dedupThreshold: 0.82,
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
  "score_deployment": <1-10 float — ease of SHIPPING & OPERATING. 10 = pure self-serve SaaS, no compliance; 5 = some onboarding/integration, light compliance; 1 = FedRAMP/ATO, hardware, physical ops, or long procurement>,
  "score_barrier": <1-10 float — ease of ENTERING the market (NOT your moat). 10 = anyone can enter, buy with a credit card; 5 = some trust/relationships needed; 1 = clearances, licenses, heavy capital, or entrenched incumbent lock-in>,
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

  const lines: string[] = [
    'You are an entrepreneurial idea generator for a technically sophisticated founder with a TPM background and US Army service history.',
    '',
    'Generate ideas that:',
  ]

  if (config.sectors.length)
    lines.push(`- Focus on these market sectors: ${config.sectors.join(', ')}`)
  if (config.audiences.length)
    lines.push(`- Target these audiences: ${config.audiences.join(', ')}`)
  if (config.businessModels.length)
    lines.push(`- Prefer these business models: ${config.businessModels.join(', ')}`)
  if (config.moatTypes.length)
    lines.push(`- Build a defensible moat of these types: ${config.moatTypes.join(', ')}`)

  lines.push('- Favor founder-fit: operations at scale, cross-functional leadership, building under constraints, mission-critical reliability')

  if (config.focus.trim())
    lines.push(`- Extra focus from the founder: ${config.focus.trim()}`)

  lines.push(avoidBlock(avoid), '', SCHEMA_BLOCK, '', SCHEMA_TAIL)
  return lines.join('\n')
}

export const ANALYZE_SYSTEM = `You are a venture analyst performing deep due diligence on early-stage startup ideas for a solo technical founder with a TPM background and US Army service history.

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
  "founder_fit_score": <float 1-10, weighted toward TPM/Army veteran background>,
  "market_timing": "Why now? What tailwind or inflection point makes this timely?",
  "risks": ["Risk 1 (1 sentence)", "Risk 2", "Risk 3"],
  "opportunities": ["Opportunity 1 (1 sentence)", "Opportunity 2", "Opportunity 3"],
  "recommendation": "<exactly one of: go | explore | no-go>",
  "recommendation_rationale": "2-3 sentences explaining the verdict"
}

Return ONLY the JSON object — no markdown, no explanation.`

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

// Rotating daily domains aligned with the founder profile
export const NIGHTLY_DOMAINS = [
  'Defense contractor compliance, program tracking, and government acquisition tools',
  'Military logistics, field operations software, and supply chain visibility for primes and subs',
  'AI-powered tooling for technical program managers, engineering leads, and cross-functional teams',
  'Government contractor onboarding, clearance tracking, and workforce management',
  'DevSecOps, compliance automation, and security tooling for federal and defense contractors',
  'Enterprise SaaS for mission-critical operations, incident management, and field teams',
  'Data infrastructure, analytics pipelines, and operational intelligence for defense and logistics',
]

export function getTodayDomain(): string {
  return NIGHTLY_DOMAINS[new Date().getDay()]
}
