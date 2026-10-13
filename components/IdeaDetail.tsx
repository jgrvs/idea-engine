'use client'

import { useState } from 'react'
import {
  PROCESSING_STATUSES,
  type Decision, type Idea, type IdeaStatus, type KillReason, type MockKind, type Spec, type VcReview,
} from '@/lib/types'
import { StatusBadge } from './StatusBadge'
import AnalysisView from './AnalysisView'
import SpecView from './SpecView'
import MockView from './MockView'
import ExperimentsView from './ExperimentsView'
import SliceView from './SliceView'
import KillReasonPicker from './KillReasonPicker'

const FUND_STYLE: Record<string, string> = {
  fund: 'bg-green-950 text-green-400 border-green-900',
  explore: 'bg-yellow-950 text-yellow-400 border-yellow-900',
  pass: 'bg-red-950 text-red-400 border-red-900',
}

const ACTOR_STYLE: Record<string, string> = {
  human: 'text-blue-400',
  auto: 'text-zinc-500',
  model: 'text-amber-400',
}

const BTN = 'text-sm font-mono px-4 py-2 neon'
const BTN_BLUE = `${BTN} text-blue-400`
const BTN_CYAN = `${BTN} text-cyan-400`
const BTN_TEAL = `${BTN} text-teal-300`
const BTN_ORANGE = `${BTN} text-orange-400`
const BTN_PURPLE = `${BTN} text-purple-400`
const BTN_GREEN = `${BTN} text-green-400`
const BTN_GREY = `${BTN} text-zinc-400 hover:text-cyan-300`

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
        <h3 className="text-sm font-display font-bold tracking-wide text-zinc-200">VC Review</h3>
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

// Compact audit trail from the decisions table: who moved the idea, where, why.
function DecisionLog({ decisions }: { decisions: Decision[] }) {
  if (!decisions.length) return null
  return (
    <div>
      <p className="text-xs font-mono text-zinc-500 mb-2">History</p>
      <ul className="space-y-1">
        {decisions.map(d => (
          <li key={d.id} className="text-xs font-mono text-zinc-500 flex gap-2 items-baseline">
            <span className="text-zinc-600 shrink-0">{new Date(d.created_at).toLocaleString()}</span>
            <span className="text-zinc-400 whitespace-nowrap">{d.from_status} <span className="text-cyan-400">→</span> {d.to_status}</span>
            <span className={ACTOR_STYLE[d.actor] ?? 'text-zinc-500'}>{d.actor}</span>
            {d.reason && <span className="text-zinc-500 truncate">· {d.reason}{d.note ? `: ${d.note}` : ''}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ErrorBanner({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="mb-6 rounded border border-red-900 bg-red-950/40 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-mono text-red-400 mb-1">{title}</p>
          <p className="text-xs font-mono text-red-300/80 break-words">{message}</p>
        </div>
        {onRetry && (
          <button onClick={onRetry} className="shrink-0 text-xs font-mono px-3 py-1.5 neon text-red-300">
            ↻ Retry
          </button>
        )}
      </div>
    </div>
  )
}

interface Props {
  idea: Idea
  onAnalyze: () => void
  onSpec: () => void
  onMock: (opts?: { feedback?: string; kind?: MockKind }) => void
  onSaveSpec: (spec: Spec) => Promise<boolean>
  onSlice: () => void
  // Replace this idea with a fresher copy (after an experiment edit).
  onIdeaChange: (idea: Idea) => void
  // Resolves true when the server accepted the move; false on a gate rejection.
  onStatusUpdate: (status: IdeaStatus | 'restore', reason?: KillReason, note?: string) => Promise<boolean>
}

const PILL = 'text-xs font-mono px-2 py-0.5 rounded-sm border border-zinc-800 bg-zinc-900 text-zinc-400'

function ScoreRow({ label, value }: { label: string; value: number }) {
  const pct = Math.round((value / 10) * 100)
  const color = value >= 7 ? 'text-green-400' : value >= 4.5 ? 'text-yellow-400' : 'text-red-400'
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-mono text-zinc-500 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-zinc-800 rounded-full">
        <div className={`h-1 rounded-full neon-bar ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-zinc-400 w-7 text-right">{value.toFixed(1)}</span>
    </div>
  )
}

function ScoreBreakdown({ idea }: { idea: Idea }) {
  return (
    <div className="panel hud p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs font-mono text-zinc-500">Viability breakdown</p>
        {idea.viability_score != null && (
          <span className="text-sm font-mono text-zinc-500"><span className="text-lg text-cyan-300 text-glow">{idea.viability_score.toFixed(1)}</span> / 10</span>
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

const PROCESSING_TEXT: Partial<Record<IdeaStatus, string>> = {
  specing: '⟳ Drafting the one-page spec…',
  mocking: '⟳ Building the mock…',
  slicing: '⟳ Building the slice…',
}

type Tab = 'brief' | 'analysis' | 'spec' | 'mock' | 'validate' | 'slice'
const TABS: readonly Tab[] = ['brief', 'analysis', 'spec', 'mock', 'validate', 'slice']

// Gates that need a sentence from the human before they proceed. One inline
// box serves all three; which one is open decides its wording and its action.
type Ask = 'iterate' | 'override' | 'broken'
const ASK_COPY: Record<Ask, { label: string; placeholder: string }> = {
  iterate: {
    label: 'What should change in the next version?',
    placeholder: 'e.g. The first screen should be the queue, not a dashboard. Drop the settings page.',
  },
  override: {
    label: 'No assumption is confirmed yet. Why build anyway? This goes on the record.',
    placeholder: 'e.g. The only way to test this one is to put working software in front of two pilot users.',
  },
  broken: {
    label: 'What is broken? This is recorded and shown on the idea.',
    placeholder: 'e.g. The checklist renders, but ticking an item does not persist after reload.',
  },
}

// States from which the validation tab makes sense even with no rows yet.
const VALIDATION_STAGES: readonly IdeaStatus[] = ['validating', 'selected_slice', 'slicing', 'slice_built', 'slice_failed', 'slice_verified']

export default function IdeaDetail({ idea, onAnalyze, onSpec, onMock, onSaveSpec, onSlice, onIdeaChange, onStatusUpdate }: Props) {
  const [tab, setTab] = useState<Tab>('brief')
  const [dismissOpen, setDismissOpen] = useState(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [askText, setAskText] = useState('')

  const isProcessing = PROCESSING_STATUSES.includes(idea.status)
  const mocks = idea.mock_versions ?? []
  const landings = idea.landing_versions ?? []
  const experiments = idea.experiments ?? []
  const confirmed = experiments.filter(e => e.status === 'confirmed').length
  const hasMock = mocks.length + landings.length > 0

  const tabEnabled: Record<Tab, boolean> = {
    brief: true,
    analysis: !!idea.analysis,
    spec: !!idea.spec,
    mock: hasMock,
    validate: experiments.length > 0 || VALIDATION_STAGES.includes(idea.status),
    slice: !!idea.slice,
  }

  const closeAsk = () => { setAsk(null); setAskText('') }
  const submitAsk = () => {
    const text = askText.trim()
    if (!ask || !text) return
    if (ask === 'iterate') onMock({ feedback: text })
    if (ask === 'override') onStatusUpdate('selected_slice', undefined, text)
    if (ask === 'broken') onStatusUpdate('slice_failed', undefined, text)
    closeAsk()
  }
  const askSubmitLabel =
    ask === 'iterate' ? `Generate v${(mocks[0]?.version ?? 0) + 1} →`
    : ask === 'override' ? 'Queue the slice anyway →'
    : 'Mark broken'

  // What "Retry" means depends on where the failed stage left the idea.
  const retryStage: (() => void) | undefined =
    idea.status === 'analyzed' ? onSpec
    : idea.status === 'spec_ready' ? () => onMock()
    : idea.status === 'slice_failed' || idea.status === 'selected_slice' ? onSlice
    : undefined

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 mb-1">
          <h2 className="text-3xl font-display font-bold tracking-wide leading-tight">{idea.title}</h2>
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

      {/* Error banners. stage_error arrives already labelled with its stage. */}
      {idea.analysis_error && idea.status !== 'analyzing' && (
        <ErrorBanner title="Analysis failed" message={idea.analysis_error} onRetry={onAnalyze} />
      )}
      {idea.stage_error && !isProcessing && (
        <ErrorBanner title="Last stage" message={idea.stage_error} onRetry={retryStage} />
      )}

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-zinc-800 mb-6">
        {TABS.map(t => {
          const disabled = !tabEnabled[t]
          return (
            <button
              key={t}
              onClick={() => !disabled && setTab(t)}
              disabled={disabled}
              className={`px-3 py-2 text-sm font-mono capitalize transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'tab-on'
                  : disabled
                  ? 'border-transparent text-zinc-600/50 cursor-default'
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
          {idea.decisions && idea.decisions.length > 0 && (
            <div className="pt-4 border-t border-zinc-900">
              <DecisionLog decisions={idea.decisions} />
            </div>
          )}
        </div>
      )}

      {tab === 'analysis' && idea.analysis && (
        <div className="space-y-8">
          <AnalysisView analysis={idea.analysis} />
          {idea.vc_review && <VcReviewView review={idea.vc_review} />}
        </div>
      )}

      {tab === 'spec' && idea.spec && (
        <SpecView
          key={idea.spec.version}
          spec={idea.spec}
          editable={idea.status === 'spec_ready' || idea.status === 'mock_ready'}
          onSave={onSaveSpec}
        />
      )}

      {tab === 'mock' && hasMock && (
        <MockView ideaId={idea.id} versions={mocks} landingVersions={landings} />
      )}

      {tab === 'validate' && tabEnabled.validate && (
        <ExperimentsView
          ideaId={idea.id}
          experiments={experiments}
          editable={idea.status === 'validating'}
          hasLanding={landings.length > 0}
          onIdea={onIdeaChange}
        />
      )}

      {tab === 'slice' && idea.slice && (
        <SliceView slice={idea.slice} />
      )}

      {/* Actions: one row per gate the idea is currently parked at */}
      {!isProcessing && idea.status !== 'dismissed' && (
        <div className="mt-8 pt-6 border-t border-zinc-800 space-y-3">
          {ask && (
            <div className="space-y-2">
              <p className="text-xs font-mono text-zinc-500">{ASK_COPY[ask].label}</p>
              <textarea
                value={askText}
                onChange={e => setAskText(e.target.value)}
                rows={3}
                autoFocus
                placeholder={ASK_COPY[ask].placeholder}
                className="w-full text-sm font-sans bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-zinc-200 placeholder-zinc-600 focus:outline-none resize-y"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={submitAsk}
                  disabled={!askText.trim()}
                  className={ask === 'broken' ? `${BTN} text-red-400` : ask === 'override' ? BTN_PURPLE : BTN_TEAL}
                >
                  {askSubmitLabel}
                </button>
                <button onClick={closeAsk} className="text-xs font-mono text-zinc-600 hover:text-zinc-400">Cancel</button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {idea.status === 'generated' && (
              <button onClick={() => onStatusUpdate('selected_analysis')} className={BTN_BLUE}>Send to Analysis →</button>
            )}
            {idea.status === 'screened_out' && (
              <button onClick={() => onStatusUpdate('generated')} className={BTN_GREY}>↑ Promote to New</button>
            )}
            {idea.status === 'selected_analysis' && (
              <button onClick={onAnalyze} className={BTN_BLUE}>Run Analysis →</button>
            )}
            {idea.status === 'analyzed' && (
              <>
                <button onClick={onAnalyze} className={BTN_GREY}>Re-analyze</button>
                <button onClick={onSpec} className={BTN_CYAN}>Draft spec →</button>
              </>
            )}
            {idea.status === 'spec_ready' && (
              <>
                <button onClick={onSpec} className={BTN_GREY}>Redraft spec</button>
                <button onClick={() => onMock()} className={BTN_TEAL}>Approve spec &amp; build mock →</button>
              </>
            )}
            {idea.status === 'mock_ready' && !ask && (
              <>
                <button onClick={() => onStatusUpdate('spec_ready')} className={BTN_GREY}>← Back to spec</button>
                <button onClick={() => setAsk('iterate')} className={BTN_GREY}>Iterate mock…</button>
                <button onClick={() => onStatusUpdate('validating')} className={BTN_ORANGE}>Advance to validation →</button>
              </>
            )}
            {idea.status === 'validating' && !ask && (
              <>
                <button onClick={() => onStatusUpdate('mock_ready')} className={BTN_GREY}>← Back to mock</button>
                <button onClick={() => onMock({ kind: 'landing' })} className={BTN_GREY}>
                  {landings.length ? 'New landing page' : 'Generate landing page'}
                </button>
                <button
                  onClick={() => (confirmed > 0 ? onStatusUpdate('selected_slice') : setAsk('override'))}
                  className={BTN_PURPLE}
                >
                  Advance to slice →
                </button>
              </>
            )}
            {idea.status === 'selected_slice' && (
              <>
                <button onClick={() => onStatusUpdate('validating')} className={BTN_GREY}>← Back to validation</button>
                <button onClick={onSlice} className={BTN_PURPLE}>Build slice →</button>
              </>
            )}
            {idea.status === 'slice_failed' && (
              <>
                <button onClick={() => onStatusUpdate('validating')} className={BTN_GREY}>← Back to validation</button>
                <button onClick={onSlice} className={BTN_PURPLE}>Rebuild slice →</button>
              </>
            )}
            {idea.status === 'slice_built' && !ask && (
              <>
                <button onClick={() => setAsk('broken')} className={BTN_GREY}>Mark broken…</button>
                <button onClick={() => onStatusUpdate('slice_verified')} className={BTN_GREEN}>I ran it and it works ✓</button>
              </>
            )}
            {idea.status === 'slice_verified' && (
              <button onClick={() => onStatusUpdate('selected_slice')} className={BTN_GREY}>Queue a rebuild</button>
            )}

            {/* Dismiss */}
            {!dismissOpen ? (
              <button
                onClick={() => setDismissOpen(true)}
                className="text-sm font-mono px-4 py-2 neon text-zinc-600 hover:text-red-400 ml-auto"
              >
                Dismiss
              </button>
            ) : (
              <div className="ml-auto">
                <KillReasonPicker
                  onConfirm={(reason, note) => { setDismissOpen(false); onStatusUpdate('dismissed', reason, note) }}
                  onCancel={() => setDismissOpen(false)}
                />
              </div>
            )}
          </div>

          {idea.status === 'selected_slice' && (
            <p className="text-xs font-mono text-zinc-600 leading-relaxed">
              Building a slice installs dependencies, then builds and briefly runs code a model wrote, on this machine.
              It takes several minutes. Queued slices also build at 11 PM.
            </p>
          )}
        </div>
      )}

      {isProcessing && (
        <div className="mt-8 pt-6 border-t border-zinc-800">
          <p className="text-sm font-mono text-amber-400">
            {idea.status === 'analyzing'
              ? idea.analysis_stage === 'verdict'
                ? '⟳ Verdict — reconciling analyst and VC…'
                : idea.analysis_stage === 'vc'
                  ? '⟳ VC review — pressure-testing the analysis…'
                  : '⟳ Analyst — researching market, competitors, feasibility…'
              : PROCESSING_TEXT[idea.status] ?? '⟳ Working…'}
          </p>
          {idea.stage_progress && idea.status !== 'analyzing' && (
            <p className="text-xs font-mono text-zinc-500 mt-2">{idea.stage_progress}</p>
          )}
          {idea.status === 'analyzing' && (
            <div className="flex gap-2 mt-3">
              {(['analyst', 'vc', 'verdict'] as const).map((s, i) => {
                const order = ['analyst', 'vc', 'verdict']
                const cur = order.indexOf(idea.analysis_stage ?? 'analyst')
                const cls = i === cur ? 'bg-amber-950 text-amber-400' : i < cur ? 'bg-green-950 text-green-500' : 'bg-zinc-900 text-zinc-600'
                return (
                  <span key={s} className={`text-xs font-mono px-2 py-0.5 rounded ${cls}`}>
                    {i + 1} · {s === 'vc' ? 'VC review' : s[0].toUpperCase() + s.slice(1)}
                  </span>
                )
              })}
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
            onClick={() => onStatusUpdate('restore')}
            className="text-sm font-mono px-4 py-2 neon text-zinc-300 hover:text-cyan-300 ml-auto"
          >
            ↩ Restore
          </button>
        </div>
      )}
    </div>
  )
}
