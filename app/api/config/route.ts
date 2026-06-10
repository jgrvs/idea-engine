import { NextRequest, NextResponse } from 'next/server'
import { getConfig, setConfig } from '@/lib/db'
import { DEFAULT_GENERATE_CONFIG, composeGeneratePrompt, type GenerateConfig } from '@/lib/prompts'

export async function GET() {
  try {
    const config = getConfig<GenerateConfig>('generate', DEFAULT_GENERATE_CONFIG)
    return NextResponse.json({ config, preview: composeGeneratePrompt(config) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<GenerateConfig>
    const merged: GenerateConfig = { ...DEFAULT_GENERATE_CONFIG, ...body }
    setConfig('generate', merged)
    return NextResponse.json({ config: merged, preview: composeGeneratePrompt(merged) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
