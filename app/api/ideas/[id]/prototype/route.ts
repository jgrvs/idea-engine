import { NextRequest, NextResponse } from 'next/server'
import { runPrototype } from '@/lib/pipeline'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const idea = await runPrototype(id)
    return NextResponse.json(idea)
  } catch (err) {
    console.error('[POST /api/ideas/:id/prototype]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
