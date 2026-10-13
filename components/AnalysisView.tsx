import type { Analysis } from '@/lib/types'
import { RecommendationBadge } from './StatusBadge'

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round((value / 10) * 100)
  const color = value >= 7 ? 'bg-green-500' : value >= 5 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div>
      <div className="flex justify-between text-xs font-mono text-zinc-400 mb-1">
        <span>{label}</span>
        <span>{value.toFixed(1)}</span>
      </div>
      <div className="h-1 bg-zinc-800 rounded-full">
        <div className={`h-1 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function AnalysisView({ analysis }: { analysis: Analysis }) {
  return (
    <div className="space-y-6">
      {/* Recommendation */}
      <div className="flex items-start gap-4">
        <div>
          {analysis.recommendation && (
            <RecommendationBadge rec={analysis.recommendation} />
          )}
          {analysis.recommendation_rationale && (
            <p className="text-sm text-zinc-300 mt-2">{analysis.recommendation_rationale}</p>
          )}
        </div>
      </div>

      {/* Scores */}
      {(analysis.feasibility_score != null || analysis.founder_fit_score != null) && (
        <div className="space-y-3">
          {analysis.feasibility_score != null && (
            <ScoreBar label="Technical Feasibility" value={analysis.feasibility_score} />
          )}
          {analysis.founder_fit_score != null && (
            <ScoreBar label="Founder Fit" value={analysis.founder_fit_score} />
          )}
        </div>
      )}

      {/* Market sizing */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'TAM', value: analysis.tam },
          { label: 'SAM', value: analysis.sam },
          { label: 'SOM', value: analysis.som },
        ].map(({ label, value }) =>
          value ? (
            <div key={label} className="bg-zinc-900 rounded p-3">
              <p className="text-xs font-mono text-zinc-500 mb-1">{label}</p>
              <p className="text-sm font-sans">{value}</p>
            </div>
          ) : null
        )}
      </div>

      {/* Timing */}
      {analysis.market_timing && (
        <div>
          <p className="text-xs font-mono text-zinc-500 mb-1">Market Timing</p>
          <p className="text-sm text-zinc-300">{analysis.market_timing}</p>
        </div>
      )}

      {/* Revenue model */}
      {analysis.revenue_model && (
        <div>
          <p className="text-xs font-mono text-zinc-500 mb-1">Revenue Model</p>
          <p className="text-sm text-zinc-300">{analysis.revenue_model}</p>
          {analysis.pricing_strategy && (
            <p className="text-sm text-zinc-400 mt-1">{analysis.pricing_strategy}</p>
          )}
        </div>
      )}

      {/* Competitors */}
      {analysis.competitors && analysis.competitors.length > 0 && (
        <div>
          <p className="text-xs font-mono text-zinc-500 mb-2">Competitors</p>
          <div className="space-y-2">
            {analysis.competitors.map((c, i) => (
              <div key={i} className="bg-zinc-900 rounded p-3">
                <p className="text-sm font-sans font-semibold">{c.name}</p>
                <p className="text-xs text-zinc-400 mt-0.5">{c.description}</p>
                <p className="text-xs text-green-400 mt-1">↳ {c.weakness}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Technical feasibility */}
      {analysis.technical_feasibility && (
        <div>
          <p className="text-xs font-mono text-zinc-500 mb-1">Technical Feasibility</p>
          <p className="text-sm text-zinc-300">{analysis.technical_feasibility}</p>
        </div>
      )}

      {/* Risks & Opportunities */}
      <div className="grid grid-cols-2 gap-4">
        {analysis.risks && analysis.risks.length > 0 && (
          <div>
            <p className="text-xs font-mono text-zinc-500 mb-2">Risks</p>
            <ul className="space-y-1.5">
              {analysis.risks.map((r, i) => (
                <li key={i} className="text-xs text-zinc-400 flex gap-1.5">
                  <span className="text-red-500 shrink-0">↑</span>{r}
                </li>
              ))}
            </ul>
          </div>
        )}
        {analysis.opportunities && analysis.opportunities.length > 0 && (
          <div>
            <p className="text-xs font-mono text-zinc-500 mb-2">Opportunities</p>
            <ul className="space-y-1.5">
              {analysis.opportunities.map((o, i) => (
                <li key={i} className="text-xs text-zinc-400 flex gap-1.5">
                  <span className="text-green-500 shrink-0">↑</span>{o}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
