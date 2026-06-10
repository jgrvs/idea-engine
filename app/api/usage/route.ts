import { NextResponse } from 'next/server'
import { getUsageSummary } from '@/lib/db'

export async function GET() {
  try {
    return NextResponse.json(getUsageSummary())
  } catch (err) {
    console.error('[GET /api/usage]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
