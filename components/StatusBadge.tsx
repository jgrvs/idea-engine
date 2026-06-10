import type { IdeaStatus, Recommendation } from '@/lib/types'

const STATUS_STYLES: Record<IdeaStatus, string> = {
  generated:           'bg-zinc-800 text-zinc-400',
  selected_analysis:   'bg-blue-950 text-blue-400',
  analyzing:           'bg-amber-950 text-amber-400',
  analyzed:            'bg-blue-900 text-blue-200',
  selected_prototype:  'bg-purple-950 text-purple-400',
  prototyping:         'bg-purple-900 text-purple-300',
  prototyped:          'bg-green-950 text-green-400',
  dismissed:           'bg-zinc-900 text-zinc-600',
}

const STATUS_LABEL: Record<IdeaStatus, string> = {
  generated:           'New',
  selected_analysis:   'Queued',
  analyzing:           'Analyzing…',
  analyzed:            'Analyzed',
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

export function StatusBadge({ status }: { status: IdeaStatus }) {
  return (
    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${STATUS_STYLES[status]}`}>
      {STATUS_LABEL[status]}
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
