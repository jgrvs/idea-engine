'use client'

import { useState, useEffect } from 'react'

interface StageUsage {
  stage: string
  inputTokens: number
  outputTokens: number
  cost: number
  calls: number
}

interface UsageSummary {
  month: string
  totalCost: number
  totalInputTokens: number
  totalOutputTokens: number
  byStage: StageUsage[]
}

const fmtUSD = (n: number) => `$${n.toFixed(n < 0.01 ? 4 : 2)}`
const fmtTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`

const STAGE_COLOR: Record<string, string> = {
  generate: 'bg-blue-500',
  analyze: 'bg-amber-500',
  spec: 'bg-cyan-500',
  mock: 'bg-teal-400',
  prototype: 'bg-purple-500',
}

export default function UsagePanel({ onClose }: { onClose: () => void }) {
  const [usage, setUsage] = useState<UsageSummary | null>(null)

  useEffect(() => {
    fetch('/api/usage').then(r => r.json()).then(setUsage)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg panel hud p-6 shadow-[0_0_60px_-20px_var(--color-cyan-400)]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display font-bold tracking-wide text-lg">Spend this month</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 font-mono text-sm">close</button>
        </div>
        <p className="text-xs font-mono text-zinc-600 mb-5">
          {usage?.month} · estimated from logged tokens at Sonnet 4.6 pricing ($3/$15 per 1M)
        </p>

        {!usage ? (
          <p className="text-zinc-500 font-mono text-sm">Loading…</p>
        ) : usage.byStage.length === 0 ? (
          <p className="text-zinc-500 font-mono text-sm">No usage logged this month yet.</p>
        ) : (
          <>
            <div className="mb-6">
              <p className="text-4xl font-display font-bold tracking-wide text-cyan-300 text-glow">{fmtUSD(usage.totalCost)}</p>
              <p className="text-xs font-mono text-zinc-500 mt-1">
                {fmtTokens(usage.totalInputTokens)} in · {fmtTokens(usage.totalOutputTokens)} out
              </p>
            </div>

            {/* Stacked cost bar */}
            <div className="h-2 flex rounded-full overflow-hidden mb-4 bg-zinc-900">
              {usage.byStage.map(s => (
                <div
                  key={s.stage}
                  className={STAGE_COLOR[s.stage] ?? 'bg-zinc-500'}
                  style={{ width: `${usage.totalCost > 0 ? (s.cost / usage.totalCost) * 100 : 0}%` }}
                  title={`${s.stage}: ${fmtUSD(s.cost)}`}
                />
              ))}
            </div>

            <div className="space-y-2">
              {usage.byStage.map(s => (
                <div key={s.stage} className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${STAGE_COLOR[s.stage] ?? 'bg-zinc-500'}`} />
                  <span className="text-sm font-mono text-zinc-300 capitalize flex-1">{s.stage}</span>
                  <span className="text-xs font-mono text-zinc-600">{s.calls} calls</span>
                  <span className="text-xs font-mono text-zinc-500 w-28 text-right">
                    {fmtTokens(s.inputTokens)} / {fmtTokens(s.outputTokens)}
                  </span>
                  <span className="text-sm font-mono text-zinc-200 w-16 text-right">{fmtUSD(s.cost)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="text-xs font-mono text-zinc-600 mt-6 pt-4 border-t border-zinc-800 leading-relaxed">
          This is local spend tracking — Anthropic exposes no prepaid-balance API for individual
          accounts. Check your remaining balance in the Console.
        </p>
      </div>
    </div>
  )
}
