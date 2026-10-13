import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET() {
  const key = process.env.ANTHROPIC_API_KEY ?? ''

  const checks = {
    api_key_present: key.length > 0,
    api_key_format: key.trimEnd().startsWith('sk-ant-'),
    api_key_length: key.trimEnd().length,
    api_key_has_whitespace: key !== key.trim(),
    database: false,
    database_error: null as string | null,
  }

  try {
    const db = getDb()
    db.prepare('SELECT 1').get()
    checks.database = true
  } catch (err) {
    checks.database_error = String(err)
  }

  const ok = checks.api_key_present && checks.api_key_format && checks.database
  return NextResponse.json(checks, { status: ok ? 200 : 500 })
}
