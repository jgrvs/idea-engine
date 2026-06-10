// Viability scoring. Claude returns five anchored 1-10 sub-scores; the composite
// is computed here so re-tuning weights/target re-ranks the whole library
// instantly, with no regeneration.

export interface ScoringConfig {
  weights: {
    technical: number   // ease of building (10 = trivial)
    deployment: number  // ease of shipping/operating (10 = pure self-serve SaaS)
    barrier: number     // ease of entering the market (10 = no gatekeepers)
    appetite: number    // demand intensity (10 = urgent budgeted pain)
    tamFit: number      // how well market size matches the founder's target
  }
  gate: number          // attainability exponent: 0 = ignore, 1 = linear, 2 = harsh
  tamTarget: number     // 1-10 ideal market-size magnitude (1 = niche, 10 = massive)
  tamStrictness: number // penalty slope for distance from target
}

export const DEFAULT_SCORING: ScoringConfig = {
  weights: { technical: 1, deployment: 1, barrier: 1, appetite: 1, tamFit: 1 },
  gate: 1,
  tamTarget: 4,        // lean toward reachable markets by default
  tamStrictness: 1.2,
}

export interface SubScores {
  technical: number | null
  deployment: number | null
  barrier: number | null
  appetite: number | null
  marketSize: number | null
}

// Fit-to-target: an idea whose market-size magnitude matches the founder's
// target scores 10; distance in either direction is penalized.
export function tamFit(marketSize: number, cfg: ScoringConfig): number {
  const penalty = Math.abs(marketSize - cfg.tamTarget) * cfg.tamStrictness
  return Math.max(1, Math.min(10, 10 - penalty))
}

function wavg(pairs: [value: number, weight: number][]): number {
  const totalW = pairs.reduce((s, [, w]) => s + w, 0)
  if (totalW <= 0) return 0
  return pairs.reduce((s, [v, w]) => s + v * w, 0) / totalW
}

// Overall = market value × attainability^gate.
// Returns null when sub-scores are missing (e.g. ideas generated before this
// scoring existed — we don't backfill, so their stored score is kept as-is).
export function computeViability(s: SubScores, cfg: ScoringConfig): number | null {
  if (
    s.technical == null || s.deployment == null || s.barrier == null ||
    s.appetite == null || s.marketSize == null
  ) {
    return null
  }

  const w = cfg.weights
  const attainability = wavg([
    [s.technical, w.technical],
    [s.deployment, w.deployment],
    [s.barrier, w.barrier],
  ]) / 10 // normalize to 0-1

  const fit = tamFit(s.marketSize, cfg)
  const value = wavg([
    [s.appetite, w.appetite],
    [fit, w.tamFit],
  ]) // 0-10

  const gated = value * Math.pow(attainability, cfg.gate)
  return Math.round(Math.max(0, Math.min(10, gated)) * 10) / 10
}
