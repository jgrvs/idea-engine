'use client'

import { useState } from 'react'
import { KILL_REASONS, KILL_REASON_LABELS, type KillReason } from '@/lib/types'

// Inline reason picker used by every kill action (single and bulk). A reason
// is mandatory; 'other' additionally needs a note. Matches the API contract
// enforced in lib/stages.ts, so the server never sees a reasonless dismiss.
export default function KillReasonPicker({
  onConfirm,
  onCancel,
  label = 'Confirm',
}: {
  onConfirm: (reason: KillReason, note?: string) => void
  onCancel: () => void
  label?: string
}) {
  const [reason, setReason] = useState<KillReason | ''>('')
  const [note, setNote] = useState('')

  const needsNote = reason === 'other'
  const valid = reason !== '' && (!needsNote || note.trim().length > 0)

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={reason}
        onChange={e => setReason(e.target.value as KillReason | '')}
        className="text-xs font-mono bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-300 focus:outline-none"
      >
        <option value="">Reason…</option>
        {KILL_REASONS.map(r => (
          <option key={r} value={r}>{KILL_REASON_LABELS[r]}</option>
        ))}
      </select>
      <input
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder={needsNote ? 'Required: explain' : 'Note (optional)'}
        className="text-xs font-mono bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-300 placeholder-zinc-600 w-56 focus:outline-none"
      />
      <button
        onClick={() => valid && onConfirm(reason as KillReason, note.trim() || undefined)}
        disabled={!valid}
        className="text-xs font-mono text-red-400 hover:text-red-300 disabled:opacity-40 disabled:hover:text-red-400"
      >
        {label}
      </button>
      <button onClick={onCancel} className="text-xs font-mono text-zinc-600 hover:text-zinc-400">
        Cancel
      </button>
    </div>
  )
}
