import { NextRequest, NextResponse } from 'next/server'
import { startPrototype } from '@/lib/pipeline'
import { TransitionError } from '@/lib/stages'

// Gate, then build in the background. Previously this awaited the full
// 16k-token generation inside the request; now it returns as soon as the
// `prototyping` transition is recorded and the client polls for completion.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    startPrototype(id, 'human')
    return NextResponse.json({ started: true })
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus })
    }
    console.error('[POST /api/ideas/:id/prototype]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
