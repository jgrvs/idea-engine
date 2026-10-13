import { NextRequest, NextResponse } from 'next/server'
import { getConfig, setConfig } from '@/lib/db'
import { DEFAULT_SCORING, type ScoringConfig } from '@/lib/scoring'

export async function GET() {
  try {
    return NextResponse.json(getConfig<ScoringConfig>('scoring', DEFAULT_SCORING))
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<ScoringConfig>
    const merged: ScoringConfig = {
      ...DEFAULT_SCORING,
      ...body,
      weights: { ...DEFAULT_SCORING.weights, ...(body.weights ?? {}) },
    }
    setConfig('scoring', merged)
    return NextResponse.json(merged)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
