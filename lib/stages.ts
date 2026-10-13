// The idea lifecycle as an explicit state machine. Every status change in the
// app goes through transition(), which validates the move against TRANSITIONS,
// runs any gate guarding it, applies the per-status side columns, and records
// a row in `decisions` so there is a durable "who moved this and why" trail.

import { experimentCounts, getArtifact, getDb, getIdeaWithRelations, seedExperiments } from './db'
import { KILL_REASONS, PROCESSING_STATUSES, type Actor, type IdeaStatus, type KillReason } from './types'

// Allowed moves. Keys are the current status, values are reachable statuses.
// Gates are enforced by omission: nothing reaches `slicing` except from the
// slice queue, and nothing reaches the queue except from `validating`.
//
//   generated ─► selected_analysis ─► analyzing ─► analyzed ─► specing ─► spec_ready
//      │                                                                     │ approve
//      └─► screened_out (auto)                        mock_ready ◄─ mocking ◄┘
//                                                        │ advance
//                                                    validating ─► selected_slice ─► slicing
//                                                                                      │
//                                       slice_verified ◄─ slice_built ◄─(build + smoke)┤
//                                                              └────► slice_failed ◄───┘
export const TRANSITIONS: Record<IdeaStatus, readonly IdeaStatus[]> = {
  generated:         ['selected_analysis', 'screened_out', 'dismissed'],
  screened_out:      ['generated', 'dismissed'],                          // promote back by hand
  selected_analysis: ['analyzing', 'generated', 'dismissed'],
  analyzing:         ['analyzed', 'selected_analysis'],                   // success | failure revert
  analyzed:          ['analyzing', 'specing', 'dismissed'],               // re-analyze | draft spec
  specing:           ['spec_ready', 'analyzed'],                          // success | failure revert
  spec_ready:        ['specing', 'mocking', 'analyzed', 'dismissed'],     // redraft | approve+mock | unqueue
  mocking:           ['mock_ready', 'spec_ready', 'validating'],          // returns to wherever it was started
  mock_ready:        ['mocking', 'validating', 'spec_ready', 'dismissed'],// iterate | advance | back
  validating:        ['mocking', 'selected_slice', 'mock_ready', 'dismissed'], // landing page | gate | back
  selected_slice:    ['slicing', 'validating', 'dismissed'],
  slicing:           ['slice_built', 'slice_failed', 'selected_slice'],   // green | red | interrupted
  slice_built:       ['slice_verified', 'slice_failed', 'dismissed'],     // human: works | broken
  slice_failed:      ['slicing', 'selected_slice', 'validating', 'dismissed'], // retry | requeue | back
  slice_verified:    ['selected_slice', 'dismissed'],                     // rebuild
  dismissed:         ['generated', 'analyzed', 'spec_ready', 'mock_ready', 'validating'], // restore
}

// Statuses a human may request directly via the API. Processing states are
// only ever set by the pipeline itself.
export const HUMAN_SETTABLE: readonly IdeaStatus[] = [
  'generated', 'selected_analysis', 'analyzed', 'spec_ready', 'mock_ready',
  'validating', 'selected_slice', 'slice_failed', 'slice_verified', 'dismissed',
]

const STAGE_LABEL: Partial<Record<IdeaStatus, string>> = {
  analyzing: 'Analysis', specing: 'Spec', mocking: 'Mock', slicing: 'Slice',
}

export type RequestedStatus = IdeaStatus | 'restore'

export function isRequestable(s: unknown): s is RequestedStatus {
  return s === 'restore' || (typeof s === 'string' && (HUMAN_SETTABLE as readonly string[]).includes(s))
}

export function canTransition(from: IdeaStatus, to: IdeaStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export class TransitionError extends Error {
  constructor(
    public readonly ideaId: string,
    public readonly from: IdeaStatus | null,
    public readonly to: IdeaStatus,
    message?: string,
  ) {
    super(message ?? (from ? `Cannot move idea from '${from}' to '${to}'` : `Idea ${ideaId} not found`))
    this.name = 'TransitionError'
  }
  get httpStatus() { return this.from === null ? 404 : 409 }
}

export interface TransitionOpts {
  actor: Actor
  reason?: string   // short code: a KillReason for kills, a label otherwise
  note?: string     // free text: why, feedback, or what is broken
  error?: string    // set when a stage failed; recorded and surfaced on the idea
}

// A dismissed idea restores to the furthest human gate it had reached. Slices
// restore to validation: the build is cheap to redo, the evidence is not.
export function restoreTarget(ideaId: string): IdeaStatus {
  const row = getDb().prepare(`
    SELECT
      (SELECT COUNT(*) FROM experiments WHERE idea_id = ?) AS has_experiments,
      (SELECT COUNT(*) FROM artifacts   WHERE idea_id = ? AND stage = 'mock') AS has_mock,
      (SELECT COUNT(*) FROM artifacts   WHERE idea_id = ? AND stage = 'spec') AS has_spec,
      (SELECT COUNT(*) FROM analyses    WHERE idea_id = ?) AS has_analysis
  `).get(ideaId, ideaId, ideaId, ideaId) as { has_experiments: number; has_mock: number; has_spec: number; has_analysis: number }
  if (row.has_experiments > 0) return 'validating'
  if (row.has_mock > 0) return 'mock_ready'
  if (row.has_spec > 0) return 'spec_ready'
  if (row.has_analysis > 0) return 'analyzed'
  return 'generated'
}

// ── Gates ────────────────────────────────────────────────────────────────────
// Checks that depend on more than the transition table. Each throws a
// TransitionError carrying the idea's real `from` so the API answers 409.

function guard(ideaId: string, from: IdeaStatus, to: IdeaStatus, opts: TransitionOpts): string | undefined {
  if (to === 'dismissed') {
    const reason = opts.reason as KillReason | undefined
    if (!reason || !(KILL_REASONS as readonly string[]).includes(reason)) {
      throw new TransitionError(ideaId, from, to, `A kill reason is required (one of: ${KILL_REASONS.join(', ')})`)
    }
    if (reason === 'other' && !opts.note?.trim()) {
      throw new TransitionError(ideaId, from, to, "Kill reason 'other' needs a note")
    }
  }

  // Validation gate: at least one assumption confirmed before a build is
  // queued. A human can still override, but has to say why, on the record.
  if (from === 'validating' && to === 'selected_slice') {
    const { confirmed, total } = experimentCounts(ideaId)
    if (confirmed === 0) {
      if (!opts.note?.trim()) {
        throw new TransitionError(ideaId, from, to,
          `No assumption is confirmed yet (0 of ${total}). Record a confirming result, or add a note saying why you are building anyway.`)
      }
      return 'unvalidated-override'
    }
    return `${confirmed}/${total} confirmed`
  }

  // Smoke-test gate, human half: "broken" has to say what is broken.
  if (from === 'slice_built' && to === 'slice_failed' && !opts.error && !opts.note?.trim()) {
    throw new TransitionError(ideaId, from, to, 'Marking a slice broken needs a note saying what is wrong')
  }
  return undefined
}

// Per-target column updates that ride along with the status change. Returns
// SQL assignments and their parameters.
function sideColumns(from: IdeaStatus, to: IdeaStatus, opts: TransitionOpts, now: string): [string[], unknown[]] {
  const sets: string[] = ['stage_progress=NULL']
  const params: unknown[] = []
  const add = (sql: string, ...p: unknown[]) => { sets.push(sql); params.push(...p) }

  // A stage failed: record it against the stage that was running.
  if (opts.error) {
    if (from === 'analyzing') add('analysis_stage=NULL, analysis_error=?', opts.error)
    else add('stage_error=?', `${STAGE_LABEL[from] ?? from} failed: ${opts.error}`)
    return [sets, params]
  }

  if (from === 'dismissed') add('dismissed_at=NULL, dismiss_reason=NULL')

  switch (to) {
    case 'selected_analysis':
      add('selected_for_analysis_at=?', now); break
    case 'analyzing':
      add('analysis_stage=?, analysis_error=NULL, analysis_started_at=?', 'analyst', now); break
    case 'analyzed':
      if (from === 'analyzing') add('analysis_stage=NULL, analysis_completed_at=?', now)
      break
    case 'specing':
    case 'mocking':
    case 'slicing':
      add('stage_error=NULL'); break
    case 'slice_failed':
      if (from === 'slice_built') add('stage_error=?', `Marked broken: ${opts.note?.trim()}`)
      break
    case 'slice_verified':
      add('stage_error=NULL'); break
    case 'dismissed': {
      const label = opts.note?.trim() ? `${opts.reason}: ${opts.note.trim()}` : String(opts.reason)
      add('dismissed_at=?, dismiss_reason=?', now, label); break
    }
  }
  return [sets, params]
}

// Move one idea to `to`. Throws TransitionError if the idea is missing, the
// move is not allowed from its current status, or a gate rejects it.
// Returns the idea with relations (including the new decision row).
export function transition(ideaId: string, to: IdeaStatus, opts: TransitionOpts) {
  const db = getDb()

  db.transaction(() => {
    const row = db.prepare('SELECT status FROM ideas WHERE id = ?').get(ideaId) as { status: IdeaStatus } | undefined
    if (!row) throw new TransitionError(ideaId, null, to)
    const from = row.status
    if (!canTransition(from, to)) throw new TransitionError(ideaId, from, to)
    const gateReason = guard(ideaId, from, to, opts)

    const now = new Date().toISOString()
    const [sets, params] = sideColumns(from, to, opts, now)
    db.prepare(`UPDATE ideas SET status=?, ${sets.join(', ')} WHERE id=?`).run(to, ...params, ideaId)

    // Entering validation seeds one experiment per spec assumption (once).
    if (to === 'validating') {
      const spec = getArtifact(ideaId, 'spec', 'json')
      try {
        const assumptions = spec?.content ? (JSON.parse(spec.content).assumptions as string[] | undefined) : undefined
        if (Array.isArray(assumptions)) seedExperiments(ideaId, assumptions)
      } catch { /* a malformed spec just means nothing to seed */ }
    }

    const reason = opts.error ? 'failed' : (opts.reason ?? gateReason ?? null)
    const note = opts.error ?? (opts.note?.trim() || null)
    db.prepare(`
      INSERT INTO decisions (id, idea_id, from_status, to_status, actor, reason, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), ideaId, from, to, opts.actor, reason, note, now)
  })()

  return getIdeaWithRelations(ideaId)
}

// Apply the same requested move to many ideas, isolating failures per idea so
// one bad row (already past that stage, missing reason) doesn't block the rest.
export function transitionMany(ids: string[], requested: RequestedStatus, opts: TransitionOpts) {
  const updated: string[] = []
  const skipped: { id: string; error: string }[] = []
  for (const id of ids) {
    try {
      const to = requested === 'restore' ? restoreTarget(id) : requested
      transition(id, to, opts)
      updated.push(id)
    } catch (err) {
      skipped.push({ id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { updated, skipped }
}

// Where a processing stage was started from: the `from` of the decision that
// put the idea into it. Lets a stage return to its origin on failure.
export function originOf(ideaId: string, processing: IdeaStatus): IdeaStatus | undefined {
  const row = getDb().prepare(
    `SELECT from_status FROM decisions WHERE idea_id = ? AND to_status = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).get(ideaId, processing) as { from_status: IdeaStatus } | undefined
  return row?.from_status
}

// Stage jobs live in this process. If the server restarts mid-job, the idea
// would sit in a processing status forever, so on boot each one is returned
// to a state a human can retry from, with the reason on the record.
export function recoverInterrupted(): number {
  const placeholders = PROCESSING_STATUSES.map(() => '?').join(', ')
  const stuck = getDb().prepare(`SELECT id, status FROM ideas WHERE status IN (${placeholders})`)
    .all(...PROCESSING_STATUSES) as { id: string; status: IdeaStatus }[]
  const fallback: Partial<Record<IdeaStatus, IdeaStatus>> = {
    analyzing: 'selected_analysis', specing: 'analyzed', mocking: 'spec_ready', slicing: 'selected_slice',
  }
  let n = 0
  for (const { id, status } of stuck) {
    const origin = status === 'mocking' ? originOf(id, status) : undefined
    const to = origin && canTransition(status, origin) ? origin : fallback[status]
    if (!to) continue
    try {
      transition(id, to, { actor: 'auto', error: 'interrupted by a server restart' })
      n++
    } catch (err) {
      console.error(`[stages] could not recover ${id} from ${status}:`, err instanceof Error ? err.message : err)
    }
  }
  if (n) console.log(`[stages] recovered ${n} idea(s) left mid-stage by a restart`)
  return n
}
