'use client'

import { useState } from 'react'
import type { SliceSummary } from '@/lib/types'

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable; the text is selectable */ }
  }
  return (
    <div>
      <p className="text-xs font-mono text-zinc-500 mb-1">{label}</p>
      <div className="flex items-center gap-2 panel px-3 py-2">
        <code className="text-xs font-mono text-zinc-300 flex-1 truncate select-all" title={value}>{value}</code>
        <button onClick={copy} className="text-xs font-mono text-zinc-500 hover:text-cyan-300 shrink-0 transition-colors">
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
    </div>
  )
}

function Check({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  const color = ok === null ? 'text-zinc-600' : ok ? 'text-green-400' : 'text-red-400'
  return (
    <div className="flex-1 min-w-0">
      <p className="text-xs font-mono text-zinc-500 mb-1">{label}</p>
      <span className={`badge px-1.5 py-px ${color}`}>{detail}</span>
    </div>
  )
}

// What the slice run produced: the two automatic gates (build, smoke test),
// what the agent says it built, and how to run it for the human half.
export default function SliceView({ slice }: { slice: SliceSummary }) {
  const smokeDetail = slice.smoke_status != null
    ? `GET / ${slice.smoke_status}`
    : slice.build_ok ? 'no response' : 'not run'

  return (
    <div className="space-y-5">
      <div className="panel hud p-4 space-y-4">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-mono text-zinc-500">Slice v{slice.version}</p>
          <p className="text-xs font-mono text-zinc-600">
            {slice.turns} turn{slice.turns === 1 ? '' : 's'} · {slice.files_written.length} file{slice.files_written.length === 1 ? '' : 's'} written · {slice.model}
          </p>
        </div>
        <div className="flex gap-4">
          <Check ok={slice.build_ok} label="Build" detail={slice.build_ok ? 'green' : slice.build_exit_code != null ? `exit ${slice.build_exit_code}` : 'did not run'} />
          <Check ok={slice.build_ok ? slice.smoke_ok : null} label="Smoke test" detail={smokeDetail} />
          <Check ok={slice.agent_finished ? true : null} label="Agent" detail={slice.agent_finished ? 'finished' : 'ran out of turns'} />
        </div>
      </div>

      {slice.error && (
        <div className="rounded border border-red-900 bg-red-950/40 px-4 py-3">
          <p className="text-xs font-mono text-red-400 mb-1">Run failed</p>
          <p className="text-xs font-mono text-red-300/80 break-words">{slice.error}</p>
        </div>
      )}

      {slice.scope_flag && (
        <div className="rounded border border-yellow-900 bg-yellow-950 px-4 py-3">
          <p className="text-xs font-mono text-yellow-400 mb-1">Scope check</p>
          <p className="text-xs font-mono text-yellow-300">{slice.scope_flag}</p>
        </div>
      )}

      <div>
        <p className="text-xs font-mono text-zinc-500 mb-1">The one feature</p>
        <p className="text-sm text-zinc-300 leading-relaxed">{slice.feature}</p>
      </div>

      {slice.agent_summary && (
        <div>
          <p className="text-xs font-mono text-zinc-500 mb-1">What was built</p>
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">{slice.agent_summary}</p>
        </div>
      )}

      {slice.how_to_try && (
        <div>
          <p className="text-xs font-mono text-zinc-500 mb-1">How to try it</p>
          <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">{slice.how_to_try}</p>
        </div>
      )}

      {slice.directory && (
        <div className="space-y-3">
          <CopyRow label="Run it" value={slice.run_command} />
          <CopyRow label="Directory" value={slice.directory} />
        </div>
      )}

      {slice.files_written.length > 0 && (
        <details>
          <summary className="text-xs font-mono text-zinc-500 cursor-pointer hover:text-zinc-300">
            Files written ({slice.files_written.length}; {slice.files_added} new)
          </summary>
          <ul className="mt-2 panel p-3 space-y-0.5">
            {slice.files_written.map(f => (
              <li key={f} className="text-xs font-mono text-zinc-400">{f}</li>
            ))}
          </ul>
        </details>
      )}

      {slice.build_log_tail && (
        <details open={!slice.build_ok}>
          <summary className="text-xs font-mono text-zinc-500 cursor-pointer hover:text-zinc-300">
            Build log (last lines)
          </summary>
          <pre className="mt-2 text-xs font-mono text-zinc-400 panel p-4 whitespace-pre-wrap leading-relaxed max-h-96 overflow-auto">
            {slice.build_log_tail}
          </pre>
        </details>
      )}
    </div>
  )
}
