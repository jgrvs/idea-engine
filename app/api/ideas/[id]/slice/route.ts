import { NextRequest, NextResponse } from 'next/server'
import { startSlice } from '@/lib/slice'
import { TransitionError } from '@/lib/stages'

// Gate, then build the slice in the background. The idea must be in the slice
// queue (or retrying a failed slice), and only one slice builds at a time.
// Returns as soon as the `slicing` transition is recorded; the client polls
// the idea for progress and the result.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    startSlice(id, 'human')
    return NextResponse.json({ started: true })
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus })
    }
    const message = err instanceof Error ? err.message : String(err)
    const busy = /already building/.test(message)
    if (!busy) console.error('[POST /api/ideas/:id/slice]', err)
    return NextResponse.json({ error: message }, { status: busy ? 409 : 500 })
  }
}
