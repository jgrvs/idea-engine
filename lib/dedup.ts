import { embed, cosine, fromBlob, toBlob, ideaEmbedText } from './embeddings'
import { getStoredEmbeddings, getIdeasNeedingEmbedding, setIdeaEmbedding } from './db'

// Embed any ideas that don't yet have a vector (one-time backfill, then keeps
// new arrivals covered). Returns how many were embedded.
export async function backfillEmbeddings(): Promise<number> {
  const need = getIdeasNeedingEmbedding()
  for (const idea of need) {
    const v = await embed(ideaEmbedText(idea))
    setIdeaEmbedding(idea.id, toBlob(v))
  }
  return need.length
}

export function loadPriorVectors(): Float32Array[] {
  return getStoredEmbeddings().map(r => fromBlob(r.embedding))
}

export interface SemanticKept<T> { item: T; vector: Float32Array }

// Drop candidates whose cosine similarity to any prior idea OR any
// already-accepted candidate in this batch meets/exceeds the threshold.
export async function semanticFilter<T>(
  candidates: T[],
  getText: (c: T) => string,
  threshold: number,
): Promise<{ kept: SemanticKept<T>[]; dropped: number }> {
  await backfillEmbeddings()
  const prior = loadPriorVectors()
  const kept: SemanticKept<T>[] = []
  let dropped = 0

  for (const item of candidates) {
    const vector = await embed(getText(item))
    let maxSim = 0
    for (const p of prior) { const s = cosine(vector, p); if (s > maxSim) maxSim = s }
    for (const k of kept) { const s = cosine(vector, k.vector); if (s > maxSim) maxSim = s }
    if (maxSim >= threshold) { dropped++; continue }
    kept.push({ item, vector })
  }
  return { kept, dropped }
}
