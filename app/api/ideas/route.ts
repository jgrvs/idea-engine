import { NextRequest, NextResponse } from 'next/server'
import { getDb, getIdeaWithRelations } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const db = getDb()
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const sector = searchParams.get('sector')

    let query = `SELECT id FROM ideas WHERE 1=1`
    const params: string[] = []
    if (status) { query += ` AND status = ?`; params.push(status) }
    if (sector) { query += ` AND market_sector = ?`; params.push(sector) }
    query += ` ORDER BY created_at DESC`

    const rows = db.prepare(query).all(...params) as { id: string }[]
    // Resolve each idea with its latest analysis / prototype / VC review.
    // N+1 but in-process SQLite — negligible at this scale, and correct
    // (avoids duplicate rows when an idea has multiple analyses).
    const ideas = rows.map(r => getIdeaWithRelations(r.id))

    return NextResponse.json(ideas)
  } catch (err) {
    console.error('[GET /api/ideas]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
