'use client'

import { useState } from 'react'
import type { Spec } from '@/lib/types'

const INPUT = 'w-full text-sm font-sans bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-zinc-600 resize-y'

function Field({ label, value, editing, onChange, rows = 2 }: {
  label: string; value: string; editing: boolean; onChange: (v: string) => void; rows?: number
}) {
  return (
    <div>
      <p className="text-xs font-mono text-zinc-500 mb-1">{label}</p>
      {editing ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} spellCheck={false} className={INPUT} />
      ) : (
        <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">{value || <span className="text-zinc-600/50">—</span>}</p>
      )}
    </div>
  )
}

function ListField({ label, items, editing, onChange, hint }: {
  label: string; items: string[]; editing: boolean; onChange: (v: string[]) => void; hint?: string
}) {
  return (
    <div>
      <p className="text-xs font-mono text-zinc-500 mb-1">
        {label}{hint && <span className="text-zinc-600/50"> · {hint}</span>}
      </p>
      {editing ? (
        <textarea
          value={items.join('\n')}
          onChange={e => onChange(e.target.value.split('\n'))}
          rows={Math.max(2, items.length + 1)}
          spellCheck={false}
          className={INPUT}
        />
      ) : items.length ? (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={i} className="text-sm text-zinc-300 flex gap-2"><span className="text-zinc-600 shrink-0">{i + 1}.</span>{it}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-600/50">—</p>
      )}
    </div>
  )
}

// The one-page spec. Read-only by default; `editable` turns every field into
// a textarea and shows Save, which writes a new artifact version (no model call).
export default function SpecView({
  spec,
  editable,
  onSave,
}: {
  spec: Spec & { version: number }
  editable: boolean
  onSave: (next: Spec) => Promise<boolean>
}) {
  const [draft, setDraft] = useState<Spec>({ ...spec })
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const set = (patch: Partial<Spec>) => setDraft(d => ({ ...d, ...patch }))
  const clean = (arr: string[]) => arr.map(s => s.trim()).filter(Boolean)

  const save = async () => {
    setSaving(true)
    const ok = await onSave({
      ...draft,
      mvp_scope: clean(draft.mvp_scope).slice(0, 3),
      out_of_scope: clean(draft.out_of_scope),
      assumptions: clean(draft.assumptions),
    })
    setSaving(false)
    if (ok) setEditing(false)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono text-zinc-600">Spec v{spec.version}</p>
        {editable && (
          editing ? (
            <div className="flex items-center gap-3">
              <button onClick={save} disabled={saving} className="text-xs font-mono text-green-400 hover:text-green-300 disabled:opacity-40">
                {saving ? 'Saving…' : `Save as v${spec.version + 1}`}
              </button>
              <button onClick={() => { setDraft({ ...spec }); setEditing(false) }} className="text-xs font-mono text-zinc-600 hover:text-zinc-400">
                Cancel
              </button>
            </div>
          ) : (
            <button onClick={() => setEditing(true)} className="text-xs font-mono text-zinc-500 hover:text-zinc-300">
              Edit
            </button>
          )
        )}
      </div>

      <div className="panel hud p-4">
        <Field label="Wedge feature" value={draft.wedge_feature} editing={editing} onChange={v => set({ wedge_feature: v })} />
      </div>

      <div className="grid grid-cols-2 gap-5">
        <Field label="Persona" value={draft.persona} editing={editing} onChange={v => set({ persona: v })} rows={3} />
        <Field label="Job to be done" value={draft.job_to_be_done} editing={editing} onChange={v => set({ job_to_be_done: v })} rows={3} />
      </div>

      <div className="grid grid-cols-2 gap-5">
        <ListField label="MVP scope" hint="max 3" items={draft.mvp_scope} editing={editing} onChange={v => set({ mvp_scope: v.slice(0, 3) })} />
        <ListField label="Out of scope" items={draft.out_of_scope} editing={editing} onChange={v => set({ out_of_scope: v })} />
      </div>

      <div className="grid grid-cols-2 gap-5">
        <Field label="Success metric" value={draft.success_metric} editing={editing} onChange={v => set({ success_metric: v })} />
        <Field label="Kill criteria" value={draft.kill_criteria} editing={editing} onChange={v => set({ kill_criteria: v })} />
      </div>

      <ListField label="Assumptions to validate" items={draft.assumptions} editing={editing} onChange={v => set({ assumptions: v })} />
    </div>
  )
}
