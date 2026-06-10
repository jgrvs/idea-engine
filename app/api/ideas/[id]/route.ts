import { NextRequest, NextResponse } from 'next/server'
import { getDb, getIdeaWithRelations } from '@/lib/db'

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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json() as { status?: string; dismiss_reason?: string }
    const db = getDb()
    const now = new Date().toISOString()

    const allowed = new Set(['selected_analysis', 'selected_prototype', 'dismissed', 'generated', 'restore'])
    if (body.status && !allowed.has(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    if (body.status === 'dismissed') {
      db.prepare(`UPDATE ideas SET status='dismissed', dismissed_at=?, dismiss_reason=? WHERE id=?`)
        .run(now, body.dismiss_reason ?? null, id)
    } else if (body.status === 'restore') {
      // Send a dismissed idea back to the furthest stage it had reached
      const row = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM prototypes WHERE idea_id = ?) AS has_proto,
          (SELECT COUNT(*) FROM analyses   WHERE idea_id = ?) AS has_analysis
      `).get(id, id) as { has_proto: number; has_analysis: number }
      const restored = row.has_proto > 0 ? 'prototyped' : row.has_analysis > 0 ? 'analyzed' : 'generated'
      db.prepare(`UPDATE ideas SET status=?, dismissed_at=NULL, dismiss_reason=NULL WHERE id=?`)
        .run(restored, id)
    } else if (body.status === 'selected_analysis') {
      db.prepare(`UPDATE ideas SET status='selected_analysis', selected_for_analysis_at=? WHERE id=?`)
        .run(now, id)
    } else if (body.status === 'selected_prototype') {
      db.prepare(`UPDATE ideas SET status='selected_prototype', selected_for_prototype_at=? WHERE id=?`)
        .run(now, id)
    } else if (body.status) {
      db.prepare(`UPDATE ideas SET status=? WHERE id=?`).run(body.status, id)
    }

    const idea = getIdeaWithRelations(id)
    return NextResponse.json(idea)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
