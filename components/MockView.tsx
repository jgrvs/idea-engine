'use client'

import { useState } from 'react'
import type { MockVersion } from '@/lib/types'

// Renders a mock version in a sandboxed iframe served by GET /api/ideas/:id/mock.
// `allow-scripts` without `allow-same-origin` lets the mock's own JS run while
// keeping it cut off from the dashboard's origin, cookies, and storage.
export default function MockView({ ideaId, versions }: { ideaId: string; versions: MockVersion[] }) {
  const latest = versions[0]?.version ?? 1
  const [version, setVersion] = useState(latest)
  const src = `/api/ideas/${ideaId}/mock?v=${version}`
  const current = versions.find(v => v.version === version)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-mono text-zinc-500">Version</span>
        {versions.map(v => (
          <button
            key={v.version}
            onClick={() => setVersion(v.version)}
            className={`text-xs font-mono px-2 py-0.5 rounded border transition-colors ${
              v.version === version ? 'chip-on' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            v{v.version}
          </button>
        ))}
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs font-mono text-zinc-500 hover:text-zinc-300"
        >
          Open in new tab ↗
        </a>
      </div>

      <iframe
        key={src}
        src={src}
        sandbox="allow-scripts"
        title={`Mock v${version}`}
        className="w-full rounded border border-zinc-800 bg-white"
        style={{ height: '640px' }}
      />

      {current?.path && (
        <p className="text-xs font-mono text-zinc-600 truncate" title={current.path}>{current.path}</p>
      )}
    </div>
  )
}
