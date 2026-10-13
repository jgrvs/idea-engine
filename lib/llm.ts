import Anthropic from '@anthropic-ai/sdk'

// One place for which model runs which stage, and what each costs.
export const MODELS = {
  // Generation, analysis, spec, and mock are single-shot calls.
  default: 'claude-sonnet-4-6',
  // The slice agent writes and debugs real code over many turns, so it gets
  // the stronger model. Change this one line to trade capability for cost.
  slice: 'claude-opus-5-5',
} as const

export interface ModelPrice { input: number; output: number; cacheRead: number; cacheWrite: number }

// List prices, USD per 1M tokens. Cache writes are the 5-minute rate (1.25x input).
export const PRICING: Record<string, ModelPrice> = {
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-opus-5-5':   { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
}

// Usage rows logged before per-model tracking existed carry no model.
export function priceFor(model: string | null | undefined): ModelPrice {
  return (model && PRICING[model]) || PRICING[MODELS.default]
}

// Construct the client per call so a hot-reloaded API key is always picked up,
// and fail loudly if the key is missing rather than sending an empty header.
export function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — check .env.local and restart the dev server')
  return new Anthropic({ apiKey })
}
