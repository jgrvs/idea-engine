'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface GenerateConfig {
  sectors: string[]
  audiences: string[]
  businessModels: string[]
  moatTypes: string[]
  focus: string
  ideaCount: number
  customPrompt: string | null
  isCustom: boolean
}

const SECTORS = ['defense/gov', 'logistics', 'devtools/infra', 'healthcare', 'fintech', 'cybersecurity', 'hr/workforce', 'manufacturing', 'data/analytics', 'edtech', 'proptech', 'legaltech', 'energy/climate', 'retail']
const AUDIENCES = ['b2b-enterprise', 'b2b-smb', 'b2g', 'b2c', 'prosumer', 'developer-tools', 'b2b2c']
const MODELS = ['saas', 'usage-based', 'marketplace', 'services-led', 'one-time-license', 'hardware+software', 'freemium']
const MOATS = ['data-network-effects', 'switching-costs', 'regulatory/compliance', 'technical-complexity', 'integration-depth', 'brand/community', 'proprietary-data']
const COUNTS = [10, 15, 20]

function Chips({ label, options, selected, onToggle, disabled }: {
  label: string; options: string[]; selected: string[]; onToggle: (v: string) => void; disabled: boolean
}) {
  return (
    <div>
      <p className="text-xs font-mono text-zinc-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => {
          const on = selected.includes(o)
          return (
            <button
              key={o}
              onClick={() => onToggle(o)}
              disabled={disabled}
              className={`text-xs font-mono px-2 py-1 rounded border transition-colors disabled:opacity-40 ${
                on ? 'border-zinc-500 bg-zinc-700 text-zinc-100' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {o}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function SettingsPanel({ onClose, onScoringSaved }: { onClose: () => void; onScoringSaved: () => void }) {
  const [tab, setTab] = useState<'generation' | 'scoring'>('generation')
  const [config, setConfig] = useState<GenerateConfig | null>(null)
  const [preview, setPreview] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => {
      setConfig(d.config)
      setPreview(d.config.isCustom && d.config.customPrompt ? d.config.customPrompt : d.preview)
    })
  }, [])

  // Live-recompose the preview from selectors (only while not detached)
  const recompose = useCallback((c: GenerateConfig) => {
    if (c.isCustom) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const res = await fetch('/api/config/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c),
      })
      if (res.ok) setPreview((await res.json()).preview)
    }, 250)
  }, [])

  const update = (patch: Partial<GenerateConfig>) => {
    if (!config) return
    const next = { ...config, ...patch }
    setConfig(next)
    setSaved(false)
    recompose(next)
  }

  const toggle = (key: keyof GenerateConfig, value: string) => {
    if (!config) return
    const arr = config[key] as string[]
    update({ [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value] } as Partial<GenerateConfig>)
  }

  // Manual edit detaches from selectors
  const onPromptEdit = (text: string) => {
    if (!config) return
    setPreview(text)
    setConfig({ ...config, isCustom: true, customPrompt: text })
    setSaved(false)
  }

  const resetToGenerated = async () => {
    if (!config) return
    const next = { ...config, isCustom: false, customPrompt: null }
    setConfig(next)
    const res = await fetch('/api/config/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
    })
    if (res.ok) setPreview((await res.json()).preview)
    setSaved(false)
  }

  const save = async () => {
    if (!config) return
    setSaving(true)
    const payload = config.isCustom ? { ...config, customPrompt: preview } : config
    const res = await fetch('/api/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    setSaving(false)
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  if (!config) {
    return (
      <Overlay onClose={onClose}>
        <p className="text-zinc-500 font-mono text-sm p-8">Loading config…</p>
      </Overlay>
    )
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          {(['generation', 'scoring'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-sm font-mono px-3 py-1.5 rounded capitalize transition-colors ${
                tab === t ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 font-mono text-sm">close</button>
      </div>

      {tab === 'scoring' && <ScoringTab onSaved={onScoringSaved} />}

      <div className={`space-y-5 ${tab === 'scoring' ? 'hidden' : ''}`}>
        <Chips label="Market sectors" options={SECTORS} selected={config.sectors} onToggle={v => toggle('sectors', v)} disabled={config.isCustom} />
        <Chips label="Audiences" options={AUDIENCES} selected={config.audiences} onToggle={v => toggle('audiences', v)} disabled={config.isCustom} />
        <Chips label="Business models" options={MODELS} selected={config.businessModels} onToggle={v => toggle('businessModels', v)} disabled={config.isCustom} />
        <Chips label="Moat types" options={MOATS} selected={config.moatTypes} onToggle={v => toggle('moatTypes', v)} disabled={config.isCustom} />

        <div className="flex gap-6">
          <div className="flex-1">
            <p className="text-xs font-mono text-zinc-500 mb-1.5">Extra focus (free text)</p>
            <input
              value={config.focus}
              onChange={e => update({ focus: e.target.value })}
              disabled={config.isCustom}
              placeholder="e.g. field operations, compliance automation"
              className="w-full text-xs font-mono bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-300 placeholder-zinc-600 focus:outline-none disabled:opacity-40"
            />
          </div>
          <div>
            <p className="text-xs font-mono text-zinc-500 mb-1.5">Ideas per run</p>
            <div className="flex gap-1">
              {COUNTS.map(n => (
                <button
                  key={n}
                  onClick={() => update({ ideaCount: n })}
                  className={`text-xs font-mono px-3 py-1.5 rounded border transition-colors ${
                    config.ideaCount === n ? 'border-zinc-500 bg-zinc-700 text-zinc-100' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live prompt preview / editor */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-mono text-zinc-500">
              System prompt {config.isCustom
                ? <span className="text-amber-400">· Custom (detached)</span>
                : <span className="text-zinc-600">· live from selectors</span>}
            </p>
            {config.isCustom && (
              <button onClick={resetToGenerated} className="text-xs font-mono text-zinc-500 hover:text-zinc-300">
                Reset to generated
              </button>
            )}
          </div>
          <textarea
            value={preview}
            onChange={e => onPromptEdit(e.target.value)}
            spellCheck={false}
            className="w-full h-64 text-xs font-mono bg-[#0d0d0d] border border-zinc-800 rounded p-3 text-zinc-300 leading-relaxed focus:outline-none focus:border-zinc-600 resize-none"
          />
          <p className="text-xs font-mono text-zinc-600 mt-1">
            Edit the text directly to take full control. Selectors will stop overwriting it until you reset.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={save}
            disabled={saving}
            className="text-sm font-mono px-4 py-2 rounded border border-green-900 text-green-400 hover:bg-green-950 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
          {saved && <span className="text-xs font-mono text-green-400">Saved — applies on next generation</span>}
        </div>
      </div>
    </Overlay>
  )
}

// ── Scoring tab ───────────────────────────────────────────────────────────────

interface ScoringConfig {
  weights: { technical: number; deployment: number; barrier: number; appetite: number; tamFit: number }
  gate: number
  tamTarget: number
  tamStrictness: number
}

const WEIGHT_LABELS: { key: keyof ScoringConfig['weights']; label: string; hint: string }[] = [
  { key: 'technical', label: 'Technical implementation', hint: 'ease of building' },
  { key: 'deployment', label: 'Deployment effort', hint: 'ease of shipping & operating' },
  { key: 'barrier', label: 'Barrier to entry', hint: 'ease of entering the market' },
  { key: 'appetite', label: 'Market appetite', hint: 'demand intensity' },
  { key: 'tamFit', label: 'Market-size fit', hint: 'closeness to your target' },
]

function Slider({ label, hint, value, min, max, step, onChange, fmt }: {
  label: string; hint?: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; fmt?: (v: number) => string
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-xs font-mono text-zinc-400">
          {label}{hint && <span className="text-zinc-600"> · {hint}</span>}
        </span>
        <span className="text-xs font-mono text-zinc-300">{fmt ? fmt(value) : value}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-zinc-400"
      />
    </div>
  )
}

function ScoringTab({ onSaved }: { onSaved: () => void }) {
  const [cfg, setCfg] = useState<ScoringConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { fetch('/api/scoring').then(r => r.json()).then(setCfg) }, [])

  if (!cfg) return <p className="text-zinc-500 font-mono text-sm">Loading scoring…</p>

  const set = (patch: Partial<ScoringConfig>) => { setCfg({ ...cfg, ...patch }); setSaved(false) }
  const setWeight = (k: keyof ScoringConfig['weights'], v: number) => {
    setCfg({ ...cfg, weights: { ...cfg.weights, [k]: v } }); setSaved(false)
  }

  const gateLabel = cfg.gate === 0 ? 'ignore' : cfg.gate < 1 ? 'soft' : cfg.gate === 1 ? 'linear' : 'harsh'

  const save = async () => {
    setSaving(true)
    const res = await fetch('/api/scoring', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg),
    })
    setSaving(false)
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); onSaved() }
  }

  return (
    <div className="space-y-6">
      <p className="text-xs font-mono text-zinc-600 leading-relaxed">
        Overall = market value × attainability<sup>gate</sup>. Attainability blends technical,
        deployment, and barrier; value blends appetite and market-size fit. Changing anything here
        re-ranks every scored idea instantly — no regeneration.
      </p>

      <div>
        <p className="text-xs font-mono text-zinc-500 mb-2">Dimension weights</p>
        <div className="space-y-3">
          {WEIGHT_LABELS.map(w => (
            <Slider
              key={w.key}
              label={w.label}
              hint={w.hint}
              value={cfg.weights[w.key]}
              min={0} max={3} step={0.5}
              onChange={v => setWeight(w.key, v)}
              fmt={v => `${v}×`}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3 pt-2 border-t border-zinc-800">
        <Slider
          label="Attainability gate"
          hint={`how hard low feasibility drags the score (${gateLabel})`}
          value={cfg.gate} min={0} max={2} step={0.25}
          onChange={v => set({ gate: v })}
        />
        <Slider
          label="Ideal market size"
          hint="1 = niche · 10 = massive"
          value={cfg.tamTarget} min={1} max={10} step={1}
          onChange={v => set({ tamTarget: v })}
        />
        <Slider
          label="Market-size strictness"
          hint="penalty for missing the target size"
          value={cfg.tamStrictness} min={0} max={3} step={0.2}
          onChange={v => set({ tamStrictness: v })}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="text-sm font-mono px-4 py-2 rounded border border-green-900 text-green-400 hover:bg-green-950 disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : 'Save scoring'}
        </button>
        {saved && <span className="text-xs font-mono text-green-400">Saved — library re-ranked</span>}
      </div>
    </div>
  )
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4 bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-[#111] border border-zinc-800 rounded-lg p-6"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
