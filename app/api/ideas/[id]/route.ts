import { NextRequest, NextResponse } from 'next/server'
import { getIdeaWithRelations } from '@/lib/db'
import { isRequestable, restoreTarget, transition, TransitionError } from '@/lib/stages'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const idea = getIdeaWithRelations(id)
    if (!idea) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(idea)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Move one idea through the state machine. Body: { status, reason?, note? }.
// `status` is a human-settable status or 'restore'. Illegal moves get 409;
// a kill without a reason gets 409 with the message explaining what's needed.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json() as { status?: string; reason?: string; note?: string }
    if (!isRequestable(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const target = body.status === 'restore' ? restoreTarget(id) : body.status
    const idea = transition(id, target, { actor: 'human', reason: body.reason, note: body.note })
    return NextResponse.json(idea)
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus })
    }
    console.error('[PATCH /api/ideas/:id]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
