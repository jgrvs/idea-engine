import { connection } from 'next/server'
import { getDb } from '@/lib/db'

// Placeholder home page. It shows the pattern every database-backed page in
// this project follows: wait for a request, then query.
export default async function Home() {
  // better-sqlite3 is synchronous, so without this the query would run once at
  // build time and the result would be baked into the page.
  await connection()

  const row = getDb().prepare(`SELECT value FROM meta WHERE key = 'created_at'`).get() as { value: string } | undefined

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Slice template</h1>
      <p className="mt-2 text-slate-600">
        Nothing is built here yet. Database ready since {row?.value ?? 'unknown'}.
      </p>
    </main>
  )
}
