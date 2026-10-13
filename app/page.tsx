'use client'

import { useState, useEffect, useCallback } from 'react'
import { PROCESSING_STATUSES, type Idea, type IdeaStatus, type KillReason, type MockKind, type Spec } from '@/lib/types'
import Sidebar from '@/components/Sidebar'
import IdeaDetail from '@/components/IdeaDetail'
import SettingsPanel from '@/components/SettingsPanel'
import UsagePanel from '@/components/UsagePanel'
import KillReasonPicker from '@/components/KillReasonPicker'

type RequestedStatus = IdeaStatus | 'restore'

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
  const [bulkDismissOpen, setBulkDismissOpen] = useState(false)

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

  const hasProcessing = ideas.some(i => PROCESSING_STATUSES.includes(i.status))
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
      addLog('ok', `Generated ${body.count} ideas${body.screened ? `, ${body.screened} screened out` : ''} (batch ${body.batchId?.slice(0, 8)})`)
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

  // Background stage jobs share one shape: optimistic status, POST, then let
  // polling pick up the completed/failed state. The route answers 409 if the
  // idea isn't at the right gate, which surfaces in the log.
  const startStage = async (id: string, stage: 'spec' | 'mock' | 'slice', optimistic: IdeaStatus, body?: unknown) => {
    setIdeas(prev => prev.map(i => i.id === id ? { ...i, status: optimistic, stage_error: null, stage_progress: null } : i))
    addLog('info', `${stage[0].toUpperCase() + stage.slice(1)} started for ${id.slice(0, 8)}…`)
    try {
      const res = await fetch(`/api/ideas/${id}/${stage}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      setTimeout(fetchIdeas, 1500)
    } catch (e) {
      addLog('error', `Could not start ${stage}: ${e instanceof Error ? e.message : e}`)
      await fetchIdeas()
    }
  }

  const handleSpec = (id: string) => startStage(id, 'spec', 'specing')
  const handleMock = (id: string, opts?: { feedback?: string; kind?: MockKind }) => startStage(id, 'mock', 'mocking', opts)
  const handleSlice = (id: string) => startStage(id, 'slice', 'slicing')

  // Swap in a fresher copy of one idea (experiment edits return the whole idea).
  const replaceIdea = (idea: Idea) => setIdeas(prev => prev.map(i => i.id === idea.id ? idea : i))

  const handleSaveSpec = async (id: string, spec: Spec): Promise<boolean> => {
    const res = await fetch(`/api/ideas/${id}/spec`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spec),
    })
    if (res.ok) {
      const updated = await res.json()
      setIdeas(prev => prev.map(i => i.id === id ? updated : i))
      addLog('ok', `Spec saved as v${updated.spec?.version ?? '?'}`)
      return true
    }
    addLog('error', (await res.json().catch(() => ({}))).error ?? `Spec save failed (HTTP ${res.status})`)
    return false
  }

  // Returns true on success so callers can chain (e.g. queue then build).
  const handleStatusUpdate = async (id: string, status: RequestedStatus, reason?: KillReason, note?: string): Promise<boolean> => {
    const res = await fetch(`/api/ideas/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, reason, note }),
    })
    if (res.ok) {
      const updated = await res.json()
      setIdeas(prev => prev.map(i => i.id === id ? updated : i))
      return true
    }
    const body = await res.json().catch(() => ({}))
    addLog('error', body.error ?? `Status update failed (HTTP ${res.status})`)
    return false
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

  const bulkApply = async (status: RequestedStatus, reason?: KillReason, note?: string) => {
    const ids = [...checkedIds]
    if (!ids.length) return
    addLog('info', `Applying ${status} to ${ids.length} ideas…`)
    const res = await fetch('/api/ideas/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status, reason, note }),
    })
    if (res.ok) {
      const body = await res.json() as { updated: number; skipped: { id: string; error: string }[] }
      if (body.skipped.length) {
        addLog('error', `Updated ${body.updated}, skipped ${body.skipped.length} (e.g. ${body.skipped[0].error})`)
      } else {
        addLog('ok', `Updated ${body.updated} ideas`)
      }
      await fetchIdeas()
      clearChecks()
    } else {
      addLog('error', `Bulk update failed: ${(await res.json()).error}`)
    }
  }

  const healthDot = health === null
    ? 'bg-zinc-600 text-zinc-600'
    : isHealthy
    ? 'bg-green-400 text-green-400 shadow-[0_0_8px_currentColor]'
    : 'bg-red-500 text-red-500 shadow-[0_0_8px_currentColor]'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <header className="shrink-0 h-14 border-b border-zinc-800 bg-surface neon-rule z-10 flex items-center justify-between px-6">
        <h1 className="font-display font-bold text-xl uppercase tracking-[0.18em] leading-none select-none">
          <span className="text-zinc-100">Idea</span>
          <span className="text-pink-400 mx-1.5">{'//'}</span>
          <span className="text-cyan-400 text-glow">Engine</span>
        </h1>
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
            className="text-xs font-mono px-3 py-1.5 neon text-zinc-400 hover:text-cyan-300"
          >
            Usage
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="text-xs font-mono px-3 py-1.5 neon text-zinc-400 hover:text-cyan-300"
          >
            Settings
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-xs font-mono px-3 py-1.5 neon text-cyan-400"
          >
            {generating ? 'Generating…' : '+ Generate now'}
          </button>
        </div>
      </header>

      {/* Bulk action bar — appears once anything is checked */}
      {checkedIds.size > 0 && (
        <div className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-6 py-2.5 flex items-center gap-3">
          <span className="text-xs font-mono text-zinc-400">{checkedIds.size} selected</span>
          {bulkDismissOpen ? (
            <div className="ml-2">
              <KillReasonPicker
                label={`Dismiss ${checkedIds.size}`}
                onConfirm={(reason, note) => { setBulkDismissOpen(false); bulkApply('dismissed', reason, note) }}
                onCancel={() => setBulkDismissOpen(false)}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 ml-2">
              <button
                onClick={() => bulkApply('selected_analysis')}
                className="text-xs font-mono px-3 py-1.5 neon text-blue-400"
              >
                Send to Analysis
              </button>
              <button
                onClick={() => setBulkDismissOpen(true)}
                className="text-xs font-mono px-3 py-1.5 neon text-red-400"
              >
                Dismiss…
              </button>
              <button
                onClick={() => bulkApply('restore')}
                className="text-xs font-mono px-3 py-1.5 neon text-zinc-400 hover:text-cyan-300"
              >
                Restore
              </button>
            </div>
          )}
          <button
            onClick={() => { clearChecks(); setBulkDismissOpen(false) }}
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

        <main className="flex-1 overflow-y-auto bg-grid">
          {selectedIdea ? (
            <IdeaDetail
              key={selectedIdea.id}
              idea={selectedIdea}
              onAnalyze={() => handleAnalyze(selectedIdea.id)}
              onSpec={() => handleSpec(selectedIdea.id)}
              onMock={opts => handleMock(selectedIdea.id, opts)}
              onSaveSpec={spec => handleSaveSpec(selectedIdea.id, spec)}
              onSlice={() => handleSlice(selectedIdea.id)}
              onIdeaChange={replaceIdea}
              onStatusUpdate={(status, reason, note) => handleStatusUpdate(selectedIdea.id, status, reason, note)}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="panel hud px-10 py-8 text-center space-y-2">
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
