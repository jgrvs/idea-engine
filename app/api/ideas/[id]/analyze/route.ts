import { NextRequest, NextResponse } from 'next/server'
import { startAnalyze } from '@/lib/pipeline'
import { TransitionError } from '@/lib/stages'

// Gate, then kick off analysis in the background and return immediately.
// startAnalyze performs the `analyzing` transition synchronously, so an idea
// that isn't queued (or doesn't exist) is rejected before any model call.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    startAnalyze(id, 'human')
    return NextResponse.json({ started: true })
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus })
    }
    console.error('[POST /api/ideas/:id/analyze]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
