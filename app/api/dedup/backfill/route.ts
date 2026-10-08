import { NextResponse } from 'next/server'
import { backfillEmbeddings } from '@/lib/dedup'

// One-time (idempotent) — embed any ideas that don't yet have a vector so
// semantic dedup has full history to compare against. Safe to call repeatedly.
export async function POST() {
  try {
    const embedded = await backfillEmbeddings()
    return NextResponse.json({ embedded })
  } catch (err) {
    console.error('[POST /api/dedup/backfill]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
