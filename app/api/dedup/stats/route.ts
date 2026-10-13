import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { fromBlob, cosine } from '@/lib/embeddings'

// Diagnostic: nearest-neighbor cosine similarity for every idea, so we can
// calibrate the dedup threshold against real data.
export async function GET() {
  try {
    const db = getDb()
    const rows = db.prepare(
      `SELECT id, title, embedding FROM ideas WHERE embedding IS NOT NULL`
    ).all() as { id: string; title: string; embedding: Buffer }[]

    const vecs = rows.map(r => ({ title: r.title, v: fromBlob(r.embedding) }))
    const pairs: { a: string; b: string; sim: number }[] = []
    const nnSims: number[] = []

    for (let i = 0; i < vecs.length; i++) {
      let best = -1, bestJ = -1
      for (let j = 0; j < vecs.length; j++) {
        if (i === j) continue
        const s = cosine(vecs[i].v, vecs[j].v)
        if (s > best) { best = s; bestJ = j }
      }
      if (bestJ >= 0) {
        nnSims.push(best)
        pairs.push({ a: vecs[i].title, b: vecs[bestJ].title, sim: Math.round(best * 1000) / 1000 })
      }
    }

    nnSims.sort((x, y) => x - y)
    const pct = (p: number) => nnSims.length ? nnSims[Math.floor((nnSims.length - 1) * p)] : null
    const topPairs = [...pairs].sort((a, b) => b.sim - a.sim).slice(0, 12)

    return NextResponse.json({
      count: vecs.length,
      dim: vecs[0]?.v.length ?? 0,
      nearestNeighborSim: {
        min: nnSims[0], p25: pct(0.25), median: pct(0.5), p75: pct(0.75), p90: pct(0.9), max: nnSims[nnSims.length - 1],
      },
      topSimilarPairs: topPairs,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
