import { NextRequest, NextResponse } from 'next/server'
import { addExperiment, getDb, getIdeaWithRelations, listExperiments } from '@/lib/db'
import { EXPERIMENT_METHODS } from '@/lib/types'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json(listExperiments(id))
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Add an experiment by hand, beyond the ones seeded from the spec. Returns the
// whole idea so the client can replace its copy in one step.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json().catch(() => ({})) as { assumption?: string; method?: string }
    const assumption = body.assumption?.trim()
    if (!assumption) return NextResponse.json({ error: 'assumption is required' }, { status: 400 })
    if (body.method && !(EXPERIMENT_METHODS as readonly string[]).includes(body.method)) {
      return NextResponse.json({ error: `method must be one of: ${EXPERIMENT_METHODS.join(', ')}` }, { status: 400 })
    }
    const exists = getDb().prepare('SELECT 1 FROM ideas WHERE id = ?').get(id)
    if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    addExperiment(id, assumption, body.method ?? null)
    return NextResponse.json(getIdeaWithRelations(id))
  } catch (err) {
    console.error('[POST /api/ideas/:id/experiments]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
