'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Idea, IdeaStatus } from '@/lib/types'
import Sidebar from '@/components/Sidebar'
import IdeaDetail from '@/components/IdeaDetail'
import SettingsPanel from '@/components/SettingsPanel'
import UsagePanel from '@/components/UsagePanel'

interface HealthStatus {
  api_key_present: boolean
  api_key_format: boolean
  api_key_has_whitespace: boolean
  database: boolean
  database_error: string | null
}

interface LogEntry {
  ts: string
  level: 'info' | 'error' | 'ok'
  msg: string
}

function log(entries: LogEntry[], set: React.Dispatch<React.SetStateAction<LogEntry[]>>, level: LogEntry['level'], msg: string) {
  const entry: LogEntry = { ts: new Date().toLocaleTimeString(), level, msg }
  set(prev => [entry, ...prev].slice(0, 20))
}

export default function Home() {
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [logEntries, setLog] = useState<LogEntry[]>([])
  const [showLog, setShowLog] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showUsage, setShowUsage] = useState(false)

  // bulk select — checkboxes always visible; bar shows when anything is checked
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())

  const addLog = useCallback((level: LogEntry['level'], msg: string) => {
    log(logEntries, setLog, level, msg)
  }, [logEntries])

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health')
      const data: HealthStatus = await res.json()
      setHealth(data)
      if (!data.api_key_present) addLog('error', 'API key missing — check .env.local')
      else if (!data.api_key_format) addLog('error', `API key format invalid${data.api_key_has_whitespace ? ' (has whitespace — re-save .env.local)' : ''}`)
      else if (!data.database) addLog('error', `Database error: ${data.database_error}`)
    } catch {
      addLog('error', 'Could not reach /api/health')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchIdeas = useCallback(async () => {
    const res = await fetch('/api/ideas')
    if (res.ok) setIdeas(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchHealth()
    fetchIdeas()
  }, [fetchHealth, fetchIdeas])

  const hasProcessing = ideas.some(i => i.status === 'analyzing' || i.status === 'prototyping')
  useEffect(() => {
    if (!hasProcessing) return
    const t = setInterval(fetchIdeas, 4000)
    return () => clearInterval(t)
  }, [hasProcessing, fetchIdeas])

  const selectedIdea = ideas.find(i => i.id === selectedId) ?? null

  const isHealthy = health?.api_key_present && health?.api_key_format && health?.database

  const handleGenerate = async () => {
    if (!isHealthy) { setShowLog(true); return }
    setGenerating(true)
    addLog('info', 'Generation started — calling Claude API…')
    try {
      const res = await fetch('/api/generate', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      addLog('ok', `Generated ${body.count} ideas (batch ${body.batchId?.slice(0, 8)})`)
      await fetchIdeas()
    } catch (e) {
      addLog('error', e instanceof Error ? e.message : 'Generation failed')
      setShowLog(true)
    } finally {
      setGenerating(false)
    }
  }

  const handleAnalyze = async (id: string) => {
    // Background job: optimistically show analyzing, clear any prior error, then
    // let polling pick up progress (analyst -> vc) and the final state.
    setIdeas(prev => prev.map(i => i.id === id
      ? { ...i, status: 'analyzing' as IdeaStatus, analysis_stage: 'analyst', analysis_error: null }
      : i))
    addLog('info', `Analysis started for ${id.slice(0, 8)} (analyst → VC)…`)
    try {
      const res = await fetch(`/api/ideas/${id}/analyze`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      // Don't await completion — poll handles it. Refetch shortly to catch fast failures.
      setTimeout(fetchIdeas, 1500)
    } catch (e) {
      addLog('error', `Could not start analysis: ${e instanceof Error ? e.message : e}`)
      await fetchIdeas()
    }
  }

  const handlePrototype = async (id: string) => {
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, status: 'prototyping' as IdeaStatus } : i))
    addLog('info', `Building prototype for ${id.slice(0, 8)}…`)
    try {
      const res = await fetch(`/api/ideas/${id}/prototype`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      addLog('ok', `Prototype written to disk for ${id.slice(0, 8)}`)
      setIdeas(prev => prev.map(i => i.id === id ? body : i))
    } catch (e) {
      addLog('error', `Prototype failed: ${e instanceof Error ? e.message : e}`)
      await fetchIdeas()
    }
  }

  const handleStatusUpdate = async (id: string, status: IdeaStatus | 'restore', reason?: string) => {
    const res = await fetch(`/api/ideas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, dismiss_reason: reason }),
    })
    if (res.ok) {
      const updated = await res.json()
      setIdeas(prev => prev.map(i => i.id === id ? updated : i))
    }
  }

  // ── Bulk select ───────────────────────────────────────────────────────────
  const toggleCheck = (id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const checkAll = (ids: string[]) => {
    setCheckedIds(prev => {
      const allOn = ids.every(id => prev.has(id))
      const next = new Set(prev)
      if (allOn) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }

  const clearChecks = () => setCheckedIds(new Set())

  const bulkApply = async (status: 'selected_analysis' | 'selected_prototype' | 'dismissed' | 'restore') => {
    const ids = [...checkedIds]
    if (!ids.length) return
    addLog('info', `Applying ${status} to ${ids.length} ideas…`)
    const res = await fetch('/api/ideas/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status }),
    })
    if (res.ok) {
      addLog('ok', `Updated ${ids.length} ideas`)
      await fetchIdeas()
      clearChecks()
    } else {
      addLog('error', `Bulk update failed: ${(await res.json()).error}`)
    }
  }

  const healthDot = health === null
    ? 'bg-zinc-600'
    : isHealthy
    ? 'bg-green-500'
    : 'bg-red-500'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="shrink-0 h-14 border-b border-zinc-800 flex items-center justify-between px-6">
        <h1 className="font-sans font-bold text-lg tracking-tight">Idea Engine</h1>
        <div className="flex items-center gap-3">
          {/* Health + log toggle */}
          <button
            onClick={() => setShowLog(v => !v)}
            className="flex items-center gap-1.5 text-xs font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
            title={health ? JSON.stringify(health, null, 2) : 'Checking…'}
          >
            <span className={`w-2 h-2 rounded-full ${healthDot}`} />
            {logEntries.length > 0 && (
              <span className={logEntries[0].level === 'error' ? 'text-red-400' : 'text-zinc-500'}>
                {logEntries[0].msg.slice(0, 40)}
              </span>
            )}
          </button>

          <button
            onClick={() => setShowUsage(true)}
            className="text-xs font-mono px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
          >
            Usage
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="text-xs font-mono px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
          >
            Settings
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-xs font-mono px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-40 transition-colors"
          >
            {generating ? 'Generating…' : '+ Generate now'}
          </button>
        </div>
      </header>

      {/* Bulk action bar — appears once anything is checked */}
      {checkedIds.size > 0 && (
        <div className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-6 py-2.5 flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-400">{checkedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-2">
            <button
              onClick={() => bulkApply('selected_analysis')}
              disabled={!checkedIds.size}
              className="text-xs font-mono px-3 py-1.5 rounded border border-blue-900 text-blue-400 hover:bg-blue-950 disabled:opacity-30 transition-colors"
            >
              Send to Analysis
            </button>
            <button
              onClick={() => bulkApply('selected_prototype')}
              disabled={!checkedIds.size}
              className="text-xs font-mono px-3 py-1.5 rounded border border-purple-900 text-purple-400 hover:bg-purple-950 disabled:opacity-30 transition-colors"
            >
              Queue Prototype
            </button>
            <button
              onClick={() => bulkApply('dismissed')}
              disabled={!checkedIds.size}
              className="text-xs font-mono px-3 py-1.5 rounded border border-red-900 text-red-400 hover:bg-red-950 disabled:opacity-30 transition-colors"
            >
              Dismiss
            </button>
            <button
              onClick={() => bulkApply('restore')}
              disabled={!checkedIds.size}
              className="text-xs font-mono px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-900 disabled:opacity-30 transition-colors"
            >
              Restore
            </button>
          </div>
          <button
            onClick={clearChecks}
            className="text-xs font-mono text-zinc-500 hover:text-zinc-300 ml-auto"
          >
            Clear
          </button>
        </div>
      )}

      {/* Activity log drawer */}
      {showLog && (
        <div className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-6 py-3 max-h-40 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-zinc-500">Activity log</span>
            <button onClick={() => setShowLog(false)} className="text-xs font-mono text-zinc-600 hover:text-zinc-400">
              close
            </button>
          </div>
          {health && !isHealthy && (
            <div className="mb-2 space-y-0.5">
              {!health.api_key_present && <p className="text-xs font-mono text-red-400">✗ API key missing</p>}
              {health.api_key_present && !health.api_key_format && (
                <p className="text-xs font-mono text-red-400">
                  ✗ API key format invalid{health.api_key_has_whitespace ? ' — has extra whitespace, re-save .env.local' : ''}
                </p>
              )}
              {!health.database && (
                <p className="text-xs font-mono text-red-400">✗ Database: {health.database_error}</p>
              )}
            </div>
          )}
          {logEntries.length === 0 ? (
            <p className="text-xs font-mono text-zinc-600">No activity yet.</p>
          ) : (
            logEntries.map((e, i) => (
              <p key={i} className={`text-xs font-mono ${
                e.level === 'error' ? 'text-red-400' : e.level === 'ok' ? 'text-green-400' : 'text-zinc-400'
              }`}>
                <span className="text-zinc-600 mr-2">{e.ts}</span>{e.msg}
              </p>
            ))
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          ideas={ideas}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={loading}
          checkedIds={checkedIds}
          onToggleCheck={toggleCheck}
          onCheckAll={checkAll}
        />

        <main className="flex-1 overflow-y-auto">
          {selectedIdea ? (
            <IdeaDetail
              idea={selectedIdea}
              onAnalyze={() => handleAnalyze(selectedIdea.id)}
              onPrototype={() => handlePrototype(selectedIdea.id)}
              onStatusUpdate={(status, reason) => handleStatusUpdate(selectedIdea.id, status, reason)}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center space-y-2">
                <p className="text-zinc-500 font-mono text-sm">
                  {loading ? 'Loading…' : ideas.length > 0 ? 'Select an idea' : 'No ideas yet'}
                </p>
                {!loading && ideas.length === 0 && (
                  <p className="text-zinc-600 font-mono text-xs">
                    3 AM generation is scheduled — or click &quot;+ Generate now&quot; to run immediately.
                  </p>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} onScoringSaved={fetchIdeas} />}
      {showUsage && <UsagePanel onClose={() => setShowUsage(false)} />}
    </div>
  )
}
