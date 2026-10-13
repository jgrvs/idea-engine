import type { IdeaStatus, Recommendation, Verdict } from '@/lib/types'

const STATUS_STYLES: Record<IdeaStatus, string> = {
  generated:           'bg-zinc-800 text-zinc-400',
  screened_out:        'bg-zinc-900 text-zinc-600',
  selected_analysis:   'bg-blue-950 text-blue-400',
  analyzing:           'bg-amber-950 text-amber-400',
  analyzed:            'bg-blue-900 text-blue-200',
  specing:             'bg-amber-950 text-amber-400',
  spec_ready:          'bg-cyan-950 text-cyan-300',
  mocking:             'bg-amber-950 text-amber-400',
  mock_ready:          'bg-teal-950 text-teal-300',
  selected_prototype:  'bg-purple-950 text-purple-400',
  prototyping:         'bg-purple-900 text-purple-300',
  prototyped:          'bg-green-950 text-green-400',
  dismissed:           'bg-zinc-900 text-zinc-600',
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
  go:      'bg-green-950 text-green-400',
  explore: 'bg-yellow-950 text-yellow-400',
  'no-go': 'bg-red-950 text-red-400',
}

const VERDICT_STYLES: Record<Verdict, string> = {
  advance:          'bg-green-950 text-green-300 border-green-800',
  'validate-first': 'bg-yellow-950 text-yellow-300 border-yellow-800',
  kill:             'bg-red-950 text-red-300 border-red-800',
}

export function StatusBadge({ status }: { status: IdeaStatus }) {
  return (
    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${STATUS_STYLES[status] ?? 'bg-zinc-800 text-zinc-400'}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export function RecommendationBadge({ rec }: { rec: Recommendation }) {
  return (
    <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${REC_STYLES[rec]}`}>
      {rec}
    </span>
  )
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`text-sm font-mono px-2.5 py-1 rounded border ${VERDICT_STYLES[verdict] ?? 'bg-zinc-900 text-zinc-300 border-zinc-700'}`}>
      {verdict}
    </span>
  )
}
