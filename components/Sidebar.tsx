'use client'

import { useState, useMemo } from 'react'
import type { Idea, IdeaStatus } from '@/lib/types'
import { StatusBadge } from './StatusBadge'

const FILTERS: { label: string; value: IdeaStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'New', value: 'generated' },
  { label: 'Analyzed', value: 'analyzed' },
  { label: 'Built', value: 'prototyped' },
  { label: 'Dismissed', value: 'dismissed' },
]

interface Props {
  ideas: Idea[]
  selectedId: string | null
  onSelect: (id: string) => void
  loading: boolean
  // bulk select — checkboxes are always visible
  checkedIds: Set<string>
  onToggleCheck: (id: string) => void
  onCheckAll: (ids: string[]) => void
}

type SortField = 'date' | 'title' | 'score'

export default function Sidebar({
  ideas, selectedId, onSelect, loading,
  checkedIds, onToggleCheck, onCheckAll,
}: Props) {
  const [filter, setFilter] = useState<IdeaStatus | 'all'>('all')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Dismissed ideas only appear under the Dismissed tab.
  const visible = useMemo(() => {
    const base = filter === 'dismissed'
      ? ideas.filter(i => i.status === 'dismissed')
      : filter === 'all'
        ? ideas.filter(i => i.status !== 'dismissed')
        : ideas.filter(i => i.status !== 'dismissed' && i.status === filter)

    const dir = sortDir === 'asc' ? 1 : -1
    return [...base].sort((a, b) => {
      let cmp = 0
      if (sortField === 'title') {
        cmp = a.title.localeCompare(b.title)
      } else if (sortField === 'score') {
        // Nulls always sort last regardless of direction
        const av = a.viability_score, bv = b.viability_score
        if (av == null && bv == null) cmp = 0
        else if (av == null) return 1
        else if (bv == null) return -1
        else cmp = av - bv
      } else {
        cmp = a.created_at.localeCompare(b.created_at)
      }
      return cmp * dir
    })
  }, [ideas, filter, sortField, sortDir])

  const countFor = (value: IdeaStatus | 'all') => {
    if (value === 'dismissed') return ideas.filter(i => i.status === 'dismissed').length
    const live = ideas.filter(i => i.status !== 'dismissed')
    return value === 'all' ? live.length : live.filter(i => i.status === value).length
  }

  const allChecked = visible.length > 0 && visible.every(i => checkedIds.has(i.id))

  return (
    <aside className="w-72 shrink-0 border-r border-zinc-800 flex flex-col overflow-hidden bg-[#111]">
      {/* Filter tabs */}
      <div className="flex gap-0.5 p-2 border-b border-zinc-800 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`text-xs font-mono px-2 py-1 rounded transition-colors ${
              filter === f.value ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {f.label}
            <span className="ml-1 text-zinc-600">{countFor(f.value)}</span>
          </button>
        ))}
      </div>

      {/* Sort control */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
        <span className="text-xs font-mono text-zinc-600">Sort</span>
        <div className="flex gap-0.5">
          {([['date', 'Date'], ['title', 'A-Z'], ['score', 'Score']] as [SortField, string][]).map(([f, label]) => (
            <button
              key={f}
              onClick={() => setSortField(f)}
              className={`text-xs font-mono px-1.5 py-0.5 rounded transition-colors ${
                sortField === f ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
          className="text-xs font-mono text-zinc-400 hover:text-zinc-200 ml-auto px-1"
          title={sortDir === 'desc' ? 'Descending' : 'Ascending'}
        >
          {sortDir === 'desc' ? '↓' : '↑'}
        </button>
      </div>

      {/* Select-all row */}
      {visible.length > 0 && (
        <button
          onClick={() => onCheckAll(visible.map(i => i.id))}
          className="text-xs font-mono text-zinc-400 hover:text-zinc-200 px-4 py-2 border-b border-zinc-800 text-left"
        >
          {allChecked ? '☑ Deselect all' : '☐ Select all'} ({visible.length})
        </button>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="text-zinc-600 font-mono text-xs text-center py-8">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-zinc-600 font-mono text-xs text-center py-8">No ideas</p>
        ) : (
          visible.map(idea => {
            const checked = checkedIds.has(idea.id)
            return (
              <div
                key={idea.id}
                className={`flex items-start border-b border-zinc-900 transition-colors ${
                  idea.id === selectedId ? 'bg-zinc-800' : 'hover:bg-zinc-900'
                }`}
              >
                <button
                  onClick={() => onToggleCheck(idea.id)}
                  className="pl-3 pt-3.5 shrink-0 text-sm font-mono text-zinc-400 hover:text-zinc-200"
                  aria-label="Select idea"
                >
                  {checked ? '☑' : '☐'}
                </button>
                <button
                  onClick={() => onSelect(idea.id)}
                  className="flex-1 text-left px-4 py-3 min-w-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-sans font-semibold leading-snug line-clamp-1">{idea.title}</span>
                    {idea.viability_score != null && (
                      <span className="shrink-0 text-xs font-mono text-zinc-500 mt-0.5">
                        {idea.viability_score.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 font-mono mt-0.5 line-clamp-1">{idea.tagline}</p>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <StatusBadge status={idea.status} />
                    {idea.market_sector && (
                      <span className="text-xs font-mono text-zinc-600">{idea.market_sector}</span>
                    )}
                  </div>
                </button>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
