import { NextRequest, NextResponse } from 'next/server'
import { getDb, deserializeIdea } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const db = getDb()
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const sector = searchParams.get('sector')

    let query = `
      SELECT i.*,
        a.id as a_id, a.tam, a.sam, a.som, a.competitors, a.revenue_model, a.pricing_strategy,
        a.technical_feasibility, a.feasibility_score, a.founder_fit_score, a.market_timing,
        a.risks, a.opportunities, a.recommendation, a.recommendation_rationale,
        a.tokens_used as a_tokens, a.created_at as a_created_at,
        p.id as p_id, p.directory_path, p.file_count, p.file_tree, p.stack, p.readme,
        p.tokens_used as p_tokens, p.created_at as p_created_at
      FROM ideas i
      LEFT JOIN analyses a ON a.idea_id = i.id
      LEFT JOIN prototypes p ON p.idea_id = i.id
      WHERE 1=1
    `
    const params: string[] = []

    if (status) {
      query += ` AND i.status = ?`
      params.push(status)
    }
    if (sector) {
      query += ` AND i.market_sector = ?`
      params.push(sector)
    }

    query += ` ORDER BY i.created_at DESC`

    const rows = db.prepare(query).all(...params) as Record<string, unknown>[]

    const ideas = rows.map(row => {
      const analysisRow = row.a_id ? {
        id: row.a_id, idea_id: row.id, tam: row.tam, sam: row.sam, som: row.som,
        competitors: row.competitors, revenue_model: row.revenue_model,
        pricing_strategy: row.pricing_strategy,
        technical_feasibility: row.technical_feasibility,
        feasibility_score: row.feasibility_score, founder_fit_score: row.founder_fit_score,
        market_timing: row.market_timing, risks: row.risks, opportunities: row.opportunities,
        recommendation: row.recommendation, recommendation_rationale: row.recommendation_rationale,
        tokens_used: row.a_tokens, created_at: row.a_created_at,
      } : undefined

      const protoRow = row.p_id ? {
        id: row.p_id, idea_id: row.id, directory_path: row.directory_path,
        file_count: row.file_count, file_tree: row.file_tree, stack: row.stack,
        readme: row.readme, tokens_used: row.p_tokens, created_at: row.p_created_at,
      } : undefined

      return deserializeIdea(row, analysisRow, protoRow)
    })

    return NextResponse.json(ideas)
  } catch (err) {
    console.error('[GET /api/ideas]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
