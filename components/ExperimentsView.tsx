'use client'

import { useState } from 'react'
import { EXPERIMENT_METHODS, EXPERIMENT_STATUSES, type Experiment, type ExperimentStatus, type Idea } from '@/lib/types'

const STATUS_COLOR: Record<ExperimentStatus, string> = {
  planned: 'text-zinc-500',
  running: 'text-amber-400',
  confirmed: 'text-green-400',
  refuted: 'text-red-400',
  inconclusive: 'text-yellow-400',
}

const FIELD = 'w-full text-sm font-sans bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-zinc-200 placeholder-zinc-600 focus:outline-none disabled:opacity-60'
const SELECT = 'text-xs font-mono bg-zinc-950 border border-zinc-800 rounded px-2 py-1 focus:outline-none disabled:opacity-60'

// One assumption and what testing it found. Selects save on change; the text
// fields save when focus leaves them, so nothing is lost and nothing saves
// on every keystroke.
function ExperimentRow({ ideaId, exp, editable, onIdea }: {
  ideaId: string; exp: Experiment; editable: boolean; onIdea: (idea: Idea) => void
}) {
  const [result, setResult] = useState(exp.result ?? '')
  const [url, setUrl] = useState(exp.evidence_url ?? '')
  const [error, setError] = useState<string | null>(null)

  const call = async (method: 'PATCH' | 'DELETE', patch?: Record<string, unknown>) => {
    const res = await fetch(`/api/ideas/${ideaId}/experiments/${exp.id}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: patch ? JSON.stringify(patch) : undefined,
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) { setError(null); onIdea(body as Idea) }
    else setError(body.error ?? `Save failed (HTTP ${res.status})`)
  }

  return (
    <li className="panel p-3 space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={exp.status}
          disabled={!editable}
          onChange={e => call('PATCH', { status: e.target.value })}
          aria-label="Result"
          className={`${SELECT} ${STATUS_COLOR[exp.status]}`}
        >
          {EXPERIMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={exp.method ?? ''}
          disabled={!editable}
          onChange={e => call('PATCH', { method: e.target.value || null })}
          aria-label="Method"
          className={`${SELECT} text-zinc-400`}
        >
          <option value="">method…</option>
          {EXPERIMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {editable && (
          <button
            onClick={() => call('DELETE')}
            className="ml-auto text-xs font-mono text-zinc-600 hover:text-red-400 transition-colors"
            aria-label="Remove experiment"
          >
            remove
          </button>
        )}
      </div>

      <p className="text-sm text-zinc-200 leading-relaxed">{exp.assumption}</p>

      <textarea
        value={result}
        disabled={!editable}
        onChange={e => setResult(e.target.value)}
        onBlur={() => { if (result.trim() !== (exp.result ?? '')) call('PATCH', { result }) }}
        rows={2}
        placeholder="What happened? Numbers, quotes, what you saw."
        className={`${FIELD} resize-y`}
      />
      <input
        value={url}
        disabled={!editable}
        onChange={e => setUrl(e.target.value)}
        onBlur={() => { if (url.trim() !== (exp.evidence_url ?? '')) call('PATCH', { evidence_url: url }) }}
        placeholder="Link to the evidence (optional)"
        className={`${FIELD} font-mono text-xs`}
      />
      {error && <p className="text-xs font-mono text-red-400">{error}</p>}
    </li>
  )
}

// The validation stage: every assumption the spec rests on, and what testing
// it found. The header is the gate: a slice cannot be queued until at least
// one assumption is confirmed (or the human overrides, with a reason).
export default function ExperimentsView({ ideaId, experiments, editable, hasLanding, onIdea }: {
  ideaId: string
  experiments: Experiment[]
  editable: boolean
  hasLanding: boolean
  onIdea: (idea: Idea) => void
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const total = experiments.length
  const confirmed = experiments.filter(e => e.status === 'confirmed').length
  const refuted = experiments.filter(e => e.status === 'refuted').length
  const pct = total ? Math.round((confirmed / total) * 100) : 0

  const add = async () => {
    const assumption = draft.trim()
    if (!assumption) return
    const res = await fetch(`/api/ideas/${ideaId}/experiments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assumption }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok) { setDraft(''); setError(null); onIdea(body as Idea) }
    else setError(body.error ?? `Could not add (HTTP ${res.status})`)
  }

  return (
    <div className="space-y-5">
      <div className="panel hud p-4">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-xs font-mono text-zinc-500">Assumptions confirmed</p>
          <p className="text-sm font-mono text-zinc-500">
            <span className={`text-lg ${confirmed > 0 ? 'text-green-400 text-glow' : 'text-zinc-400'}`}>{confirmed}</span> / {total}
            {refuted > 0 && <span className="text-red-400 ml-3">{refuted} refuted</span>}
          </p>
        </div>
        <div className="h-1 bg-zinc-800 rounded-full">
          <div className="h-1 rounded-full neon-bar text-green-400" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs font-mono text-zinc-600 mt-3 leading-relaxed">
          A slice can be queued once at least one assumption is confirmed. A refuted assumption is a result too:
          it is the cheapest point to change the spec or kill the idea.
          {hasLanding && ' The landing page for demand testing is under the Mock tab.'}
        </p>
      </div>

      {total === 0 ? (
        <p className="text-sm font-mono text-zinc-600">No experiments yet. Add the first assumption to test.</p>
      ) : (
        <ul className="space-y-3">
          {experiments.map(e => (
            <ExperimentRow key={e.id} ideaId={ideaId} exp={e} editable={editable} onIdea={onIdea} />
          ))}
        </ul>
      )}

      {editable && (
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }}
            placeholder="Add another assumption to test"
            className={FIELD}
          />
          <button onClick={add} disabled={!draft.trim()} className="shrink-0 text-xs font-mono px-3 neon text-cyan-400">
            Add
          </button>
        </div>
      )}
      {error && <p className="text-xs font-mono text-red-400">{error}</p>}
    </div>
  )
}
