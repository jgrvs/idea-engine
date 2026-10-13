import { NextRequest, NextResponse } from 'next/server'
import { startMock } from '@/lib/pipeline'
import { getArtifact } from '@/lib/db'
import { TransitionError } from '@/lib/stages'
import type { MockKind } from '@/lib/types'

const isKind = (v: unknown): v is MockKind => v === 'app' || v === 'landing'

// Generate a mock in the background. Body: { kind?: 'app' | 'landing', feedback? }.
//   app, from spec_ready      → approves the spec, builds the first mock
//   app, from a later stage   → iterates it; `feedback` is required
//   landing                   → one-screen marketing page for demand testing
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json().catch(() => ({})) as { feedback?: string; kind?: string }
    if (body.kind != null && !isKind(body.kind)) {
      return NextResponse.json({ error: "kind must be 'app' or 'landing'" }, { status: 400 })
    }
    startMock(id, { actor: 'human', feedback: body.feedback, kind: body.kind as MockKind | undefined })
    return NextResponse.json({ started: true })
  } catch (err) {
    if (err instanceof TransitionError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus })
    }
    const message = err instanceof Error ? err.message : String(err)
    const status = /needs feedback|come after/.test(message) ? 400 : 500
    if (status === 500) console.error('[POST /api/ideas/:id/mock]', err)
    return NextResponse.json({ error: message }, { status })
  }
}

// Serve a mock version as a page, for the sandboxed iframe in the dashboard.
// ?kind=landing selects the landing page; ?v=N a version (default: latest).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const v = req.nextUrl.searchParams.get('v')
  const version = v ? Number.parseInt(v, 10) : undefined
  const artifactKind = req.nextUrl.searchParams.get('kind') === 'landing' ? 'landing' : 'html'
  const mock = getArtifact(id, 'mock', artifactKind, Number.isFinite(version) ? version : undefined)
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
