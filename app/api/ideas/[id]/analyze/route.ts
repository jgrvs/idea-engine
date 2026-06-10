import { NextRequest, NextResponse } from 'next/server'
import { runAnalyze } from '@/lib/pipeline'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const idea = await runAnalyze(id)
    return NextResponse.json(idea)
  } catch (err) {
    console.error('[POST /api/ideas/:id/analyze]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
