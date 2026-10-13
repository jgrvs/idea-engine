import { NextRequest, NextResponse } from 'next/server'
import { startMock } from '@/lib/pipeline'
import { getArtifact } from '@/lib/db'
import { TransitionError } from '@/lib/stages'

// Generate a mock in the background. From spec_ready this approves the spec;
// from mock_ready it iterates and `feedback` is required.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json().catch(() => ({})) as { feedback?: string }
    startMock(id, { actor: 'human', feedback: body.feedback })
    return NextResponse.json({ started: true })
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus })
    }
    const message = err instanceof Error ? err.message : String(err)
    const status = /needs feedback/.test(message) ? 400 : 500
    if (status === 500) console.error('[POST /api/ideas/:id/mock]', err)
    return NextResponse.json({ error: message }, { status })
  }
}

// Serve a mock version as a page, for the sandboxed iframe in the dashboard.
// ?v=N selects a version; default is the latest.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const v = req.nextUrl.searchParams.get('v')
  const version = v ? Number.parseInt(v, 10) : undefined
  const mock = getArtifact(id, 'mock', 'html', Number.isFinite(version) ? version : undefined)
  if (!mock?.content) return NextResponse.json({ error: 'No mock for this idea' }, { status: 404 })
  return new Response(mock.content, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Belt and braces alongside the iframe sandbox attribute.
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'unsafe-inline' https://cdn.tailwindcss.com; img-src data: https:; font-src https: data:",
      'X-Frame-Options': 'SAMEORIGIN',
    },
  })
}
