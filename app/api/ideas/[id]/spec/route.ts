import { NextRequest, NextResponse } from 'next/server'
import { startSpec, saveSpec } from '@/lib/pipeline'
import { TransitionError } from '@/lib/stages'
import type { Spec } from '@/lib/types'

// Draft (or redraft) the one-page spec in the background. Gate: analyzed or
// spec_ready. Returns as soon as the `specing` transition is recorded.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    startSpec(id, 'human')
    return NextResponse.json({ started: true })
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus })
    }
    console.error('[POST /api/ideas/:id/spec]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Save a human-edited spec as a new artifact version. No model call, no
// status change: editing is part of the spec_ready review, not a stage.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json() as Partial<Spec>
    const idea = saveSpec(id, body as Spec)
    return NextResponse.json(idea)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = /not found/.test(message) ? 404 : /only be edited/.test(message) ? 409 : 500
    if (status === 500) console.error('[PUT /api/ideas/:id/spec]', err)
    return NextResponse.json({ error: message }, { status })
  }
}
