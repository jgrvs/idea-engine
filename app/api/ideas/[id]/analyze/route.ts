import { NextRequest, NextResponse } from 'next/server'
import { runAnalyze } from '@/lib/pipeline'
import { getDb } from '@/lib/db'

// Kick off analysis as a background job and return immediately. runAnalyze sets
// status='analyzing' synchronously before its first await, so the client sees
// the transition on its next poll. It owns its own completion/error states.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const db = getDb()
    const idea = db.prepare('SELECT id FROM ideas WHERE id = ?').get(id)
    if (!idea) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Fire and forget — do NOT await. The long-lived Next server keeps running it.
    void runAnalyze(id).catch(err => console.error('[analyze job]', err))

    return NextResponse.json({ started: true })
  } catch (err) {
    console.error('[POST /api/ideas/:id/analyze]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
