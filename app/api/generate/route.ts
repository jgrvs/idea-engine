import { NextRequest, NextResponse } from 'next/server'
import { runGenerate } from '@/lib/pipeline'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { domain?: string; count?: number }
    const result = await runGenerate(body.domain, body.count ?? 15)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[POST /api/generate]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
