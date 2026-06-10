import { NextRequest, NextResponse } from 'next/server'
import { DEFAULT_GENERATE_CONFIG, composeGeneratePrompt, type GenerateConfig } from '@/lib/prompts'

// Live-compose a prompt from selector state without persisting it.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<GenerateConfig>
    // Force non-custom so the preview reflects the selectors, not a stored custom prompt
    const config: GenerateConfig = { ...DEFAULT_GENERATE_CONFIG, ...body, isCustom: false, customPrompt: null }
    return NextResponse.json({ preview: composeGeneratePrompt(config) })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
