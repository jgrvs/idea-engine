'use client'

import { useState } from 'react'
import type { MockKind, MockVersion } from '@/lib/types'

const KIND_LABEL: Record<MockKind, string> = { app: 'App mock', landing: 'Landing page' }

// Renders a mock version in a sandboxed iframe served by GET /api/ideas/:id/mock.
// `allow-scripts` without `allow-same-origin` lets the mock's own JS run while
// keeping it cut off from the dashboard's origin, cookies, and storage.
export default function MockView({ ideaId, versions, landingVersions }: {
  ideaId: string
  versions: MockVersion[]
  landingVersions: MockVersion[]
}) {
  const kinds = (['app', 'landing'] as const).filter(k => (k === 'app' ? versions : landingVersions).length > 0)
  const [kind, setKind] = useState<MockKind>(kinds[0] ?? 'app')
  // null means "follow the latest", so a freshly generated version shows up
  // without the user having to pick it.
  const [picked, setPicked] = useState<Record<MockKind, number | null>>({ app: null, landing: null })

  const list = kind === 'app' ? versions : landingVersions
  const version = picked[kind] ?? list[0]?.version ?? 1
  const src = `/api/ideas/${ideaId}/mock?kind=${kind}&v=${version}`
  const current = list.find(v => v.version === version)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {kinds.length > 1 && (
          <div className="flex gap-0.5 mr-2">
            {kinds.map(k => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`text-xs font-mono px-2 py-1 rounded transition-colors ${
                  k === kind ? 'chip-on' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        )}
        <span className="text-xs font-mono text-zinc-500">Version</span>
        {list.map(v => (
          <button
            key={v.version}
            onClick={() => setPicked(p => ({ ...p, [kind]: v.version }))}
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
        title={`${KIND_LABEL[kind]} v${version}`}
        className="w-full rounded border border-zinc-800 bg-white"
        style={{ height: '640px' }}
      />

      {current?.path && (
        <p className="text-xs font-mono text-zinc-600 truncate" title={current.path}>{current.path}</p>
      )}
    </div>
  )
}
