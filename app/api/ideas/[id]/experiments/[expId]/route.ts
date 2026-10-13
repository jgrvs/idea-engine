import { NextRequest, NextResponse } from 'next/server'
import { deleteExperiment, getIdeaWithRelations, updateExperiment } from '@/lib/db'
import { EXPERIMENT_METHODS, EXPERIMENT_STATUSES } from '@/lib/types'

type Ctx = { params: Promise<{ id: string; expId: string }> }

// Record what an experiment found. Any subset of the fields may be sent.
// Returns the whole idea so the validation gate count updates with the row.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id, expId } = await params
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const patch: Record<string, string | null> = {}

    if ('assumption' in body) {
      const v = typeof body.assumption === 'string' ? body.assumption.trim() : ''
      if (!v) return NextResponse.json({ error: 'assumption cannot be empty' }, { status: 400 })
      patch.assumption = v
    }
    if ('method' in body) {
      const v = body.method || null
      if (v !== null && !(EXPERIMENT_METHODS as readonly unknown[]).includes(v)) {
        return NextResponse.json({ error: `method must be one of: ${EXPERIMENT_METHODS.join(', ')}` }, { status: 400 })
      }
      patch.method = v as string | null
    }
    if ('status' in body) {
      if (!(EXPERIMENT_STATUSES as readonly unknown[]).includes(body.status)) {
        return NextResponse.json({ error: `status must be one of: ${EXPERIMENT_STATUSES.join(', ')}` }, { status: 400 })
      }
      patch.status = body.status as string
    }
    if ('result' in body) patch.result = typeof body.result === 'string' && body.result.trim() ? body.result.trim() : null
    if ('evidence_url' in body) {
      const v = typeof body.evidence_url === 'string' ? body.evidence_url.trim() : ''
      if (v && !/^https?:\/\//i.test(v)) return NextResponse.json({ error: 'evidence_url must start with http:// or https://' }, { status: 400 })
      patch.evidence_url = v || null
    }

    if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    if (!updateExperiment(id, expId, patch)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(getIdeaWithRelations(id))
  } catch (err) {
    console.error('[PATCH /api/ideas/:id/experiments/:expId]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id, expId } = await params
  try {
    if (!deleteExperiment(id, expId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(getIdeaWithRelations(id))
  } catch (err) {
    console.error('[DELETE /api/ideas/:id/experiments/:expId]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
