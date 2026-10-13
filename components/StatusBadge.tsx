import type { IdeaStatus, Recommendation, Verdict } from '@/lib/types'

// Badges are hairline-outlined tags: the `badge` utility draws the outline and
// wash from the text colour, so each entry here only has to pick a hue.
// Hue tracks the funnel: neutral → blue (analysis) → cyan (spec) → teal (mock)
// → violet (prototype) → green (built). Amber always means "working".
const STATUS_STYLES: Record<IdeaStatus, string> = {
  generated:           'text-zinc-400',
  screened_out:        'text-zinc-600',
  selected_analysis:   'text-blue-400',
  analyzing:           'text-amber-400',
  analyzed:            'text-blue-200',
  specing:             'text-amber-400',
  spec_ready:          'text-cyan-300',
  mocking:             'text-amber-400',
  mock_ready:          'text-teal-300',
  selected_prototype:  'text-purple-400',
  prototyping:         'text-amber-400',
  prototyped:          'text-green-400',
  dismissed:           'text-zinc-600',
}

const STATUS_LABEL: Record<IdeaStatus, string> = {
  generated:           'New',
  screened_out:        'Screened',
  selected_analysis:   'Queued',
  analyzing:           'Analyzing…',
  analyzed:            'Analyzed',
  specing:             'Drafting spec…',
  spec_ready:          'Spec review',
  mocking:             'Mocking…',
  mock_ready:          'Mock review',
  selected_prototype:  'Queued',
  prototyping:         'Building…',
  prototyped:          'Prototyped',
  dismissed:           'Dismissed',
}

const REC_STYLES: Record<Recommendation, string> = {
  go:      'text-green-400',
  explore: 'text-yellow-400',
  'no-go': 'text-red-400',
}

const VERDICT_STYLES: Record<Verdict, string> = {
  advance:          'text-green-400',
  'validate-first': 'text-yellow-400',
  kill:             'text-red-400',
}

export function StatusBadge({ status }: { status: IdeaStatus }) {
  return (
    <span className={`badge px-1.5 py-px ${STATUS_STYLES[status] ?? 'text-zinc-400'}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export function RecommendationBadge({ rec }: { rec: Recommendation }) {
  return (
    <span className={`badge px-1.5 py-px ${REC_STYLES[rec] ?? 'text-zinc-400'}`}>
      {rec}
    </span>
  )
}

// The verdict is the headline of the analysis, so it is the one badge that
// carries a halo.
export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`badge px-2.5 py-1 text-xs shadow-[0_0_14px_-5px_currentColor] ${VERDICT_STYLES[verdict] ?? 'text-zinc-300'}`}>
      {verdict}
    </span>
  )
}
