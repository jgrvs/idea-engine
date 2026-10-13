import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

// Apply one status transition to many ideas at once.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { ids?: string[]; status?: string; dismiss_reason?: string }
    const ids = body.ids ?? []
    const status = body.status

    if (!ids.length) return NextResponse.json({ error: 'No ids provided' }, { status: 400 })

    const allowed = new Set(['selected_analysis', 'selected_prototype', 'dismissed', 'restore'])
    if (!status || !allowed.has(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const db = getDb()
    const now = new Date().toISOString()

    const apply = db.transaction((targetIds: string[]) => {
      for (const id of targetIds) {
        if (status === 'dismissed') {
          db.prepare(`UPDATE ideas SET status='dismissed', dismissed_at=?, dismiss_reason=? WHERE id=?`)
            .run(now, body.dismiss_reason ?? null, id)
        } else if (status === 'restore') {
          const row = db.prepare(`
            SELECT
              (SELECT COUNT(*) FROM prototypes WHERE idea_id = ?) AS has_proto,
              (SELECT COUNT(*) FROM analyses   WHERE idea_id = ?) AS has_analysis
          `).get(id, id) as { has_proto: number; has_analysis: number }
          const restored = row.has_proto > 0 ? 'prototyped' : row.has_analysis > 0 ? 'analyzed' : 'generated'
          db.prepare(`UPDATE ideas SET status=?, dismissed_at=NULL, dismiss_reason=NULL WHERE id=?`)
            .run(restored, id)
        } else if (status === 'selected_analysis') {
          db.prepare(`UPDATE ideas SET status='selected_analysis', selected_for_analysis_at=? WHERE id=?`)
            .run(now, id)
        } else if (status === 'selected_prototype') {
          db.prepare(`UPDATE ideas SET status='selected_prototype', selected_for_prototype_at=? WHERE id=?`)
            .run(now, id)
        }
      }
    })

    apply(ids)
    return NextResponse.json({ updated: ids.length })
  } catch (err) {
    console.error('[POST /api/ideas/bulk]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
