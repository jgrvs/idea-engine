import { pipeline, env } from '@huggingface/transformers'
import path from 'path'

// Cache the model inside the (git-ignored) data dir so it persists across
// `npm install` rebuilds and stays self-contained. Downloaded once from the HF
// hub on first use, then loaded locally — no API key, no per-call cost.
env.cacheDir = path.join(process.cwd(), 'data', 'models')

const MODEL = 'Xenova/all-MiniLM-L6-v2' // 384-dim sentence embeddings

// Lazy singleton — loading the model takes ~1-2s, so do it once per process.
const g = globalThis as typeof globalThis & { _embedder?: Promise<unknown> }
function getExtractor(): Promise<unknown> {
  if (!g._embedder) g._embedder = pipeline('feature-extraction', MODEL)
  return g._embedder
}

export async function embed(text: string): Promise<Float32Array> {
  const extractor = (await getExtractor()) as (
    t: string,
    opts: { pooling: 'mean'; normalize: boolean }
  ) => Promise<{ data: Float32Array }>
  const out = await extractor(text, { pooling: 'mean', normalize: true })
  // Copy out of the model's shared buffer into a standalone array.
  return new Float32Array(out.data)
}

// Cosine similarity. Vectors are L2-normalized at embed time, so this is just a
// dot product, but compute it generally for safety.
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

// Float32Array <-> SQLite BLOB
export function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}
export function fromBlob(b: Buffer): Float32Array {
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
  return new Float32Array(ab)
}

// The text we embed for an idea — what defines its "concept".
export function ideaEmbedText(idea: { title?: unknown; tagline?: unknown; problem?: unknown }): string {
  return [idea.title, idea.tagline, idea.problem].filter(Boolean).join('. ')
}
