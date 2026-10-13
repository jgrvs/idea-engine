// The idea lifecycle as an explicit state machine. Every status change in the
// app goes through transition(), which validates the move against TRANSITIONS,
// applies the per-status side columns, and records a row in `decisions` so
// there is a durable "who moved this and why" trail for every idea.

import { getDb, getIdeaWithRelations } from './db'
import { KILL_REASONS, type Actor, type IdeaStatus, type KillReason } from './types'

// Allowed moves. Keys are the current status, values are reachable statuses.
// Gates are enforced by omission: e.g. nothing reaches `analyzing` except
// `selected_analysis` (first run) or `analyzed` (re-run).
export const TRANSITIONS: Record<IdeaStatus, readonly IdeaStatus[]> = {
  generated:          ['selected_analysis', 'dismissed'],
  selected_analysis:  ['analyzing', 'generated', 'dismissed'],
  analyzing:          ['analyzed', 'selected_analysis'],            // success | failure revert
  analyzed:           ['analyzing', 'selected_prototype', 'dismissed'],
  selected_prototype: ['prototyping', 'analyzed', 'dismissed'],
  prototyping:        ['prototyped', 'selected_prototype'],         // success | failure revert
  prototyped:         ['selected_prototype', 'dismissed'],          // rebuild
  dismissed:          ['generated', 'analyzed', 'prototyped'],      // restore (see restoreTarget)
}

// Statuses a human may request directly via the API. Processing/terminal
// states are only ever set by the pipeline itself.
export const HUMAN_SETTABLE: readonly IdeaStatus[] = [
  'generated', 'selected_analysis', 'analyzed', 'selected_prototype', 'dismissed',
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
      (SELECT COUNT(*) FROM analyses   WHERE idea_id = ?) AS has_analysis
  `).get(ideaId, ideaId) as { has_proto: number; has_analysis: number }
  return row.has_proto > 0 ? 'prototyped' : row.has_analysis > 0 ? 'analyzed' : 'generated'
}

function validateKill(ideaId: string, opts: TransitionOpts) {
  const reason = opts.reason as KillReason | undefined
  if (!reason || !(KILL_REASONS as readonly string[]).includes(reason)) {
    throw new TransitionError(ideaId, null, 'dismissed',
      `A kill reason is required (one of: ${KILL_REASONS.join(', ')})`)
  }
  if (reason === 'other' && !opts.note?.trim()) {
    throw new TransitionError(ideaId, null, 'dismissed', "Kill reason 'other' needs a note")
  }
}

// Per-target column updates that ride along with the status change. Returns a
// SQL fragment (without leading comma) and its parameters.
function sideColumns(from: IdeaStatus, to: IdeaStatus, opts: TransitionOpts, now: string): [string, unknown[]] {
  const restoring = from === 'dismissed'
  const clearDismiss: [string, unknown[]] = ['dismissed_at=NULL, dismiss_reason=NULL', []]

  switch (to) {
    case 'generated':
      return restoring ? clearDismiss : ['', []]
    case 'selected_analysis':
      return from === 'analyzing'
        ? ['analysis_stage=NULL, analysis_error=?', [opts.reason ?? 'analysis failed']]
        : ['selected_for_analysis_at=?', [now]]
    case 'analyzing':
      return ['analysis_stage=?, analysis_error=NULL, analysis_started_at=?', ['analyst', now]]
    case 'analyzed':
      return restoring ? clearDismiss : ['analysis_stage=NULL, analysis_completed_at=?', [now]]
    case 'selected_prototype':
      return from === 'prototyping'
        ? ['prototype_error=?', [opts.reason ?? 'prototype failed']]
        : ['selected_for_prototype_at=?', [now]]
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
    if (to === 'dismissed') validateKill(ideaId, opts)

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
