import { NextRequest, NextResponse } from 'next/server'
import { isRequestable, transitionMany } from '@/lib/stages'

// Apply one requested move to many ideas. Each idea is validated against the
// state machine independently; the response lists which were updated and
// which were skipped (with why), so a mixed selection never half-fails.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { ids?: string[]; status?: string; reason?: string; note?: string }
    const ids = body.ids ?? []

    if (!ids.length) return NextResponse.json({ error: 'No ids provided' }, { status: 400 })
    if (!isRequestable(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const result = transitionMany(ids, body.status, { actor: 'human', reason: body.reason, note: body.note })
    return NextResponse.json({ updated: result.updated.length, skipped: result.skipped })
  } catch (err) {
    console.error('[POST /api/ideas/bulk]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
