// The idea lifecycle as an explicit state machine. Every status change in the
// app goes through transition(), which validates the move against TRANSITIONS,
// applies the per-status side columns, and records a row in `decisions` so
// there is a durable "who moved this and why" trail for every idea.

import { getDb, getIdeaWithRelations } from './db'
import { KILL_REASONS, type Actor, type IdeaStatus, type KillReason } from './types'

// Allowed moves. Keys are the current status, values are reachable statuses.
// Gates are enforced by omission: e.g. nothing reaches `prototyping` except
// from `selected_prototype`, and nothing reaches `selected_prototype` except
// from a reviewed mock (`mock_ready`) or a rebuild of a prior prototype.
//
//   generated ─► selected_analysis ─► analyzing ─► analyzed ─► specing ─► spec_ready
//      │                                                                     │ approve
//      └─► screened_out (auto)                        mock_ready ◄─ mocking ◄┘
//                                                        │ advance      ▲ iterate
//                                   prototyped ◄─ prototyping ◄─ selected_prototype
export const TRANSITIONS: Record<IdeaStatus, readonly IdeaStatus[]> = {
  generated:          ['selected_analysis', 'screened_out', 'dismissed'],
  screened_out:       ['generated', 'dismissed'],                         // promote back by hand
  selected_analysis:  ['analyzing', 'generated', 'dismissed'],
  analyzing:          ['analyzed', 'selected_analysis'],                  // success | failure revert
  analyzed:           ['analyzing', 'specing', 'dismissed'],              // re-analyze | draft spec
  specing:            ['spec_ready', 'analyzed'],                         // success | failure revert
  spec_ready:         ['specing', 'mocking', 'analyzed', 'dismissed'],    // redraft | approve+mock | unqueue
  mocking:            ['mock_ready', 'spec_ready'],                       // success | failure revert
  mock_ready:         ['mocking', 'selected_prototype', 'spec_ready', 'dismissed'], // iterate | advance | back
  selected_prototype: ['prototyping', 'mock_ready', 'dismissed'],
  prototyping:        ['prototyped', 'selected_prototype'],               // success | failure revert
  prototyped:         ['selected_prototype', 'dismissed'],                // rebuild
  dismissed:          ['generated', 'analyzed', 'spec_ready', 'mock_ready', 'prototyped'], // restore
}

// Statuses a human may request directly via the API. Processing states are
// only ever set by the pipeline itself.
export const HUMAN_SETTABLE: readonly IdeaStatus[] = [
  'generated', 'selected_analysis', 'analyzed', 'spec_ready', 'mock_ready', 'selected_prototype', 'dismissed',
]

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
  reason?: string   // for kills: a KillReason code; for failures: the error message
  note?: string     // free text; required when reason === 'other'
}

// A dismissed idea restores to the furthest stage it had actually reached.
export function restoreTarget(ideaId: string): IdeaStatus {
  const row = getDb().prepare(`
    SELECT
      (SELECT COUNT(*) FROM prototypes WHERE idea_id = ?) AS has_proto,
      (SELECT COUNT(*) FROM artifacts  WHERE idea_id = ? AND stage = 'mock') AS has_mock,
      (SELECT COUNT(*) FROM artifacts  WHERE idea_id = ? AND stage = 'spec') AS has_spec,
      (SELECT COUNT(*) FROM analyses   WHERE idea_id = ?) AS has_analysis
  `).get(ideaId, ideaId, ideaId, ideaId) as { has_proto: number; has_mock: number; has_spec: number; has_analysis: number }
  if (row.has_proto > 0) return 'prototyped'
  if (row.has_mock > 0) return 'mock_ready'
  if (row.has_spec > 0) return 'spec_ready'
  if (row.has_analysis > 0) return 'analyzed'
  return 'generated'
}

// `from` is the idea's real current status so the error maps to 409, not 404
// (TransitionError treats from === null as "idea not found").
function validateKill(ideaId: string, from: IdeaStatus, opts: TransitionOpts) {
  const reason = opts.reason as KillReason | undefined
  if (!reason || !(KILL_REASONS as readonly string[]).includes(reason)) {
    throw new TransitionError(ideaId, from, 'dismissed',
      `A kill reason is required (one of: ${KILL_REASONS.join(', ')})`)
  }
  if (reason === 'other' && !opts.note?.trim()) {
    throw new TransitionError(ideaId, from, 'dismissed', "Kill reason 'other' needs a note")
  }
}

// Per-target column updates that ride along with the status change. Returns a
// SQL fragment (without leading comma) and its parameters.
function sideColumns(from: IdeaStatus, to: IdeaStatus, opts: TransitionOpts, now: string): [string, unknown[]] {
  const restoring = from === 'dismissed'
  const clearDismiss: [string, unknown[]] = ['dismissed_at=NULL, dismiss_reason=NULL', []]
  const none: [string, unknown[]] = ['', []]
  const failed = (col: string): [string, unknown[]] => [`${col}=?`, [opts.reason ?? 'stage failed']]

  switch (to) {
    case 'generated':
      return restoring ? clearDismiss : none
    case 'screened_out':
      return none
    case 'selected_analysis':
      return from === 'analyzing' ? ['analysis_stage=NULL, analysis_error=?', [opts.reason ?? 'analysis failed']]
                                  : ['selected_for_analysis_at=?', [now]]
    case 'analyzing':
      return ['analysis_stage=?, analysis_error=NULL, analysis_started_at=?', ['analyst', now]]
    case 'analyzed':
      if (restoring) return clearDismiss
      if (from === 'analyzing') return ['analysis_stage=NULL, analysis_completed_at=?', [now]]
      if (from === 'specing') return failed('stage_error')
      return none
    case 'specing':
    case 'mocking':
      return ['stage_error=NULL', []]
    case 'spec_ready':
      if (restoring) return clearDismiss
      if (from === 'mocking') return failed('stage_error')
      return none
    case 'mock_ready':
      return restoring ? clearDismiss : none
    case 'selected_prototype':
      return from === 'prototyping' ? failed('prototype_error') : ['selected_for_prototype_at=?', [now]]
    case 'prototyping':
      return ['prototype_started_at=?, prototype_error=NULL', [now]]
    case 'prototyped':
      return restoring ? clearDismiss : ['prototype_completed_at=?', [now]]
    case 'dismissed': {
      const label = opts.note?.trim() ? `${opts.reason}: ${opts.note.trim()}` : String(opts.reason)
      return ['dismissed_at=?, dismiss_reason=?', [now, label]]
    }
  }
}

// Move one idea to `to`. Throws TransitionError if the idea is missing, the
// move is not allowed from its current status, or a kill lacks a reason.
// Returns the idea with relations (including the new decision row).
export function transition(ideaId: string, to: IdeaStatus, opts: TransitionOpts) {
  const db = getDb()

  db.transaction(() => {
    const row = db.prepare('SELECT status FROM ideas WHERE id = ?').get(ideaId) as { status: IdeaStatus } | undefined
    if (!row) throw new TransitionError(ideaId, null, to)
    const from = row.status
    if (!canTransition(from, to)) throw new TransitionError(ideaId, from, to)
    if (to === 'dismissed') validateKill(ideaId, from, opts)

    const now = new Date().toISOString()
    const [extra, params] = sideColumns(from, to, opts, now)
    db.prepare(`UPDATE ideas SET status=?${extra ? ', ' + extra : ''} WHERE id=?`)
      .run(to, ...params, ideaId)

    db.prepare(`
      INSERT INTO decisions (id, idea_id, from_status, to_status, actor, reason, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), ideaId, from, to, opts.actor, opts.reason ?? null, opts.note?.trim() || null, now)
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
