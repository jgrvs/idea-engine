export type IdeaStatus =
  | 'generated'
  | 'selected_analysis'
  | 'analyzing'
  | 'analyzed'
  | 'selected_prototype'
  | 'prototyping'
  | 'prototyped'
  | 'dismissed'

export type Recommendation = 'go' | 'explore' | 'no-go'

// Who moved an idea between stages: a person in the UI, the pipeline itself,
// or a model verdict (reserved for future auto-screening).
export type Actor = 'human' | 'auto' | 'model'

// Every kill records one of these so dismissals carry signal, not just a flag.
export const KILL_REASONS = ['duplicate', 'not-for-me', 'too-hard', 'no-demand', 'bad-timing', 'other'] as const
export type KillReason = typeof KILL_REASONS[number]
export const KILL_REASON_LABELS: Record<KillReason, string> = {
  'duplicate':  'Duplicate of something seen',
  'not-for-me': 'Not a fit for me',
  'too-hard':   'Too hard to build or ship',
  'no-demand':  'No real demand',
  'bad-timing': 'Bad timing',
  'other':      'Other (explain)',
}

export interface Decision {
  id: string
  idea_id: string
  from_status: IdeaStatus
  to_status: IdeaStatus
  actor: Actor
  reason: string | null
  note: string | null
  created_at: string
}

// Reviewable output of a stage (spec, mock, build log, experiment evidence).
// Content lives inline for small text, or on disk under `path`.
export interface Artifact {
  id: string
  idea_id: string
  stage: string
  version: number
  kind: string
  content: string | null
  path: string | null
  created_at: string
}

export type MarketSector =
  | 'defense/gov'
  | 'logistics'
  | 'devtools/infra'
  | 'healthcare'
  | 'fintech'
  | 'cybersecurity'
  | 'hr/workforce'
  | 'manufacturing'
  | 'data/analytics'
  | 'edtech'
  | 'proptech'
  | 'legaltech'
  | 'energy/climate'
  | 'retail'
  | 'other'

export type MarketAudience =
  | 'b2b-enterprise'
  | 'b2b-smb'
  | 'b2g'
  | 'b2c'
  | 'prosumer'
  | 'developer-tools'
  | 'b2b2c'

export type BusinessModel =
  | 'saas'
  | 'usage-based'
  | 'marketplace'
  | 'services-led'
  | 'one-time-license'
  | 'hardware+software'
  | 'freemium'

export type MoatType =
  | 'data-network-effects'
  | 'switching-costs'
  | 'regulatory/compliance'
  | 'technical-complexity'
  | 'integration-depth'
  | 'brand/community'
  | 'proprietary-data'

export interface Competitor {
  name: string
  description: string
  weakness: string
}

export interface PrototypeFile {
  path: string
  content: string
  language: string
}

export interface Idea {
  id: string
  batch_id: string | null
  domain: string | null
  title: string
  tagline: string | null
  problem: string | null
  solution: string | null
  market_sector: MarketSector | null
  market_audience: MarketAudience | null
  business_model: BusinessModel | null
  moat_type: MoatType | null
  tam_estimate: string | null
  named_competitors: string[] | null
  time_to_first_revenue: string | null
  viability_score: number | null
  score_technical: number | null
  score_deployment: number | null
  score_barrier: number | null
  score_appetite: number | null
  score_market_size: number | null
  status: IdeaStatus
  created_at: string
  selected_for_analysis_at: string | null
  analysis_started_at: string | null
  analysis_completed_at: string | null
  selected_for_prototype_at: string | null
  prototype_started_at: string | null
  prototype_completed_at: string | null
  dismissed_at: string | null
  dismiss_reason: string | null
  analysis_stage: string | null
  analysis_error: string | null
  prototype_error: string | null
  analysis?: Analysis
  vc_review?: VcReview
  prototype?: Prototype
  decisions?: Decision[]
}

export type FundVerdict = 'fund' | 'explore' | 'pass'

export interface VcReview {
  id: string
  idea_id: string
  strengths: string[] | null
  weaknesses: string[] | null
  key_concerns: string[] | null
  would_fund: FundVerdict | null
  needs_to_be_true: string[] | null
  verdict_rationale: string | null
  tokens_used: number
  created_at: string
}

export interface Analysis {
  id: string
  idea_id: string
  tam: string | null
  sam: string | null
  som: string | null
  competitors: Competitor[] | null
  revenue_model: string | null
  pricing_strategy: string | null
  technical_feasibility: string | null
  feasibility_score: number | null
  founder_fit_score: number | null
  market_timing: string | null
  risks: string[] | null
  opportunities: string[] | null
  recommendation: Recommendation | null
  recommendation_rationale: string | null
  tokens_used: number
  created_at: string
}

export interface Prototype {
  id: string
  idea_id: string
  directory_path: string | null
  file_count: number
  file_tree: PrototypeFile[] | null
  stack: string[] | null
  readme: string | null
  tokens_used: number
  created_at: string
}

export interface Batch {
  id: string
  type: 'generate' | 'analyze' | 'prototype'
  status: 'running' | 'completed' | 'failed'
  domain: string | null
  ideas_count: number
  tokens_used: number
  error: string | null
  created_at: string
  completed_at: string | null
}
