'use client'

import { useState } from 'react'
import type { Idea, IdeaStatus, VcReview } from '@/lib/types'
import { StatusBadge } from './StatusBadge'
import AnalysisView from './AnalysisView'
import PrototypeView from './PrototypeView'

const FUND_STYLE: Record<string, string> = {
  fund: 'bg-green-950 text-green-400 border-green-900',
  explore: 'bg-yellow-950 text-yellow-400 border-yellow-900',
  pass: 'bg-red-950 text-red-400 border-red-900',
}

function VcList({ label, items, marker }: { label: string; items: string[] | null; marker: string }) {
  if (!items || items.length === 0) return null
  return (
    <div>
      <p className="text-xs font-mono text-zinc-500 mb-2">{label}</p>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-sm text-zinc-300 flex gap-2">
            <span className="shrink-0 text-zinc-600">{marker}</span>{it}
          </li>
        ))}
      </ul>
    </div>
  )
}

function VcReviewView({ review }: { review: VcReview }) {
  return (
    <div className="border-t border-zinc-800 pt-6">
      <div className="flex items-center gap-3 mb-4">
        <h3 className="text-sm font-sans font-bold text-zinc-200">VC Review</h3>
        {review.would_fund && (
          <span className={`text-xs font-mono px-2 py-0.5 rounded border ${FUND_STYLE[review.would_fund] ?? 'bg-zinc-900 text-zinc-400 border-zinc-800'}`}>
            would {review.would_fund}
          </span>
        )}
      </div>

      {review.verdict_rationale && (
        <p className="text-sm text-zinc-300 mb-5">{review.verdict_rationale}</p>
      )}

      <div className="grid grid-cols-2 gap-5 mb-5">
        <VcList label="Strengths" items={review.strengths} marker="+" />
        <VcList label="Weaknesses" items={review.weaknesses} marker="−" />
      </div>

      <div className="space-y-5">
        <VcList label="Key concerns (most likely to kill it)" items={review.key_concerns} marker="⚑" />
        <VcList label="What would need to be true to invest" items={review.needs_to_be_true} marker="→" />
      </div>
    </div>
  )
}

interface Props {
  idea: Idea
  onAnalyze: () => void
  onPrototype: () => void
  onStatusUpdate: (status: IdeaStatus, reason?: string) => void
}

const PILL = 'text-xs font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-400'

function ScoreRow({ label, value }: { label: string; value: number }) {
  const pct = Math.round((value / 10) * 100)
  const color = value >= 7 ? 'bg-green-500' : value >= 4.5 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-mono text-zinc-500 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-zinc-800 rounded-full">
        <div className={`h-1 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-zinc-400 w-7 text-right">{value.toFixed(1)}</span>
    </div>
  )
}

function ScoreBreakdown({ idea }: { idea: Idea }) {
  return (
    <div className="bg-zinc-900 rounded p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs font-mono text-zinc-500">Viability breakdown</p>
        {idea.viability_score != null && (
          <span className="text-sm font-mono text-zinc-200">{idea.viability_score.toFixed(1)} / 10</span>
        )}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-mono text-zinc-600">Attainability</p>
        {idea.score_technical != null && <ScoreRow label="Technical" value={idea.score_technical} />}
        {idea.score_deployment != null && <ScoreRow label="Deployment" value={idea.score_deployment} />}
        {idea.score_barrier != null && <ScoreRow label="Barrier" value={idea.score_barrier} />}
        <p className="text-xs font-mono text-zinc-600 pt-1">Market value</p>
        {idea.score_appetite != null && <ScoreRow label="Appetite" value={idea.score_appetite} />}
        {idea.score_market_size != null && <ScoreRow label="Market size" value={idea.score_market_size} />}
      </div>
    </div>
  )
}

export default function IdeaDetail({ idea, onAnalyze, onPrototype, onStatusUpdate }: Props) {
  const [tab, setTab] = useState<'brief' | 'analysis' | 'prototype'>('brief')
  const [dismissOpen, setDismissOpen] = useState(false)
  const [dismissReason, setDismissReason] = useState('')

  const isProcessing = idea.status === 'analyzing' || idea.status === 'prototyping'

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2 className="text-2xl font-sans font-bold leading-tight">{idea.title}</h2>
          <StatusBadge status={idea.status} />
        </div>
        <p className="text-zinc-400 font-mono text-sm">{idea.tagline}</p>
        {idea.domain && (
          <p className="text-xs font-mono text-zinc-600 mt-1">{idea.domain}</p>
        )}
      </div>

      {/* Market brief pills */}
      <div className="flex flex-wrap gap-1.5 mb-6">
        {idea.market_sector    && <span className={PILL}>{idea.market_sector}</span>}
        {idea.market_audience  && <span className={PILL}>{idea.market_audience}</span>}
        {idea.business_model   && <span className={PILL}>{idea.business_model}</span>}
        {idea.moat_type        && <span className={PILL}>{idea.moat_type}</span>}
        {idea.tam_estimate     && <span className={PILL}>TAM {idea.tam_estimate}</span>}
        {idea.time_to_first_revenue && <span className={PILL}>Rev: {idea.time_to_first_revenue}</span>}
        {idea.viability_score != null && (
          <span className={`${PILL} text-zinc-300`}>Viability {idea.viability_score.toFixed(1)}</span>
        )}
      </div>

      {/* Analysis error banner */}
      {idea.analysis_error && idea.status !== 'analyzing' && (
        <div className="mb-6 rounded border border-red-900 bg-red-950/40 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-mono text-red-400 mb-1">Analysis failed</p>
              <p className="text-xs font-mono text-red-300/80 break-words">{idea.analysis_error}</p>
            </div>
            <button
              onClick={onAnalyze}
              className="shrink-0 text-xs font-mono px-3 py-1.5 rounded border border-red-800 text-red-300 hover:bg-red-950 transition-colors"
            >
              ↻ Retry
            </button>
          </div>
        </div>
      )}

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-zinc-800 mb-6">
        {(['brief', 'analysis', 'prototype'] as const).map(t => {
          const disabled = (t === 'analysis' && !idea.analysis) || (t === 'prototype' && !idea.prototype)
          return (
            <button
              key={t}
              onClick={() => !disabled && setTab(t)}
              disabled={disabled}
              className={`px-3 py-2 text-sm font-mono capitalize transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'border-zinc-300 text-zinc-100'
                  : disabled
                  ? 'border-transparent text-zinc-700 cursor-default'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {tab === 'brief' && (
        <div className="space-y-5">
          {idea.score_technical != null && <ScoreBreakdown idea={idea} />}
          {idea.named_competitors && idea.named_competitors.length > 0 && (
            <div>
              <p className="text-xs font-mono text-zinc-500 mb-1">Known Competitors</p>
              <p className="text-sm text-zinc-300">{idea.named_competitors.join(', ')}</p>
            </div>
          )}
          {[
            { label: 'Problem', value: idea.problem },
            { label: 'Solution', value: idea.solution },
          ].map(({ label, value }) =>
            value ? (
              <div key={label}>
                <p className="text-xs font-mono text-zinc-500 mb-1">{label}</p>
                <p className="text-sm text-zinc-300 leading-relaxed">{value}</p>
              </div>
            ) : null
          )}
        </div>
      )}

      {tab === 'analysis' && idea.analysis && (
        <div className="space-y-8">
          <AnalysisView analysis={idea.analysis} />
          {idea.vc_review && <VcReviewView review={idea.vc_review} />}
        </div>
      )}

      {tab === 'prototype' && idea.prototype && (
        <PrototypeView prototype={idea.prototype} />
      )}

      {/* Actions */}
      {!isProcessing && idea.status !== 'dismissed' && (
        <div className="mt-8 pt-6 border-t border-zinc-800 flex flex-wrap gap-2">
          {idea.status === 'generated' && (
            <button
              onClick={() => onStatusUpdate('selected_analysis')}
              className="text-sm font-mono px-4 py-2 rounded border border-blue-900 text-blue-400 hover:bg-blue-950 transition-colors"
            >
              Send to Analysis →
            </button>
          )}
          {idea.status === 'analyzed' && (
            <>
              <button
                onClick={onAnalyze}
                className="text-sm font-mono px-4 py-2 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-900 transition-colors"
              >
                Re-analyze
              </button>
              <button
                onClick={() => { onStatusUpdate('selected_prototype'); onPrototype() }}
                className="text-sm font-mono px-4 py-2 rounded border border-purple-900 text-purple-400 hover:bg-purple-950 transition-colors"
              >
                Build Prototype →
              </button>
            </>
          )}
          {idea.status === 'selected_analysis' && (
            <button
              onClick={onAnalyze}
              className="text-sm font-mono px-4 py-2 rounded border border-blue-900 text-blue-400 hover:bg-blue-950 transition-colors"
            >
              Run Analysis →
            </button>
          )}
          {idea.status === 'selected_prototype' && (
            <button
              onClick={onPrototype}
              className="text-sm font-mono px-4 py-2 rounded border border-purple-900 text-purple-400 hover:bg-purple-950 transition-colors"
            >
              Build Prototype →
            </button>
          )}

          {/* Dismiss */}
          {!dismissOpen ? (
            <button
              onClick={() => setDismissOpen(true)}
              className="text-sm font-mono px-4 py-2 rounded border border-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors ml-auto"
            >
              Dismiss
            </button>
          ) : (
            <div className="flex items-center gap-2 ml-auto">
              <input
                value={dismissReason}
                onChange={e => setDismissReason(e.target.value)}
                placeholder="Reason (optional)"
                className="text-xs font-mono bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-300 placeholder-zinc-600 w-48 focus:outline-none"
              />
              <button
                onClick={() => { onStatusUpdate('dismissed', dismissReason || undefined); setDismissOpen(false) }}
                className="text-xs font-mono text-red-400 hover:text-red-300"
              >
                Confirm
              </button>
              <button
                onClick={() => setDismissOpen(false)}
                className="text-xs font-mono text-zinc-600 hover:text-zinc-400"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {isProcessing && (
        <div className="mt-8 pt-6 border-t border-zinc-800">
          <p className="text-sm font-mono text-amber-400">
            {idea.status === 'analyzing'
              ? idea.analysis_stage === 'vc'
                ? '⟳ VC review — pressure-testing the analysis…'
                : '⟳ Analyst — researching market, competitors, feasibility…'
              : '⟳ Building prototype…'}
          </p>
          {idea.status === 'analyzing' && (
            <div className="flex gap-2 mt-3">
              {(['analyst', 'vc'] as const).map(s => (
                <span
                  key={s}
                  className={`text-xs font-mono px-2 py-0.5 rounded ${
                    idea.analysis_stage === s
                      ? 'bg-amber-950 text-amber-400'
                      : (s === 'analyst' && idea.analysis_stage === 'vc')
                        ? 'bg-green-950 text-green-500'
                        : 'bg-zinc-900 text-zinc-600'
                  }`}
                >
                  {s === 'analyst' ? '1 · Analyst' : '2 · VC review'}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {idea.status === 'dismissed' && (
        <div className="mt-8 pt-6 border-t border-zinc-800 flex items-center gap-3">
          {idea.dismiss_reason && (
            <span className="text-xs font-mono text-zinc-600 flex-1">
              Dismissed: {idea.dismiss_reason}
            </span>
          )}
          <button
            onClick={() => onStatusUpdate('restore' as IdeaStatus)}
            className="text-sm font-mono px-4 py-2 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-900 transition-colors ml-auto"
          >
            ↩ Restore
          </button>
        </div>
      )}
    </div>
  )
}
