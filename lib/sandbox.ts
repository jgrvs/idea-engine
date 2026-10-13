import fs from 'fs'
import path from 'path'

// Where generated mocks and slices are written. Set SANDBOX_PATH to an absolute
// path for your machine (e.g. C:\projects\prototypes on Windows, or
// /srv/idea-engine/prototypes on a Linux server). The fallback is a `prototypes`
// directory sibling to the project root, which is portable across OSes.
// The ignore comment stops the bundler from tracing the whole parent directory
// into the build just because a path is computed from it.
const SANDBOX_BASE = process.env.SANDBOX_PATH ?? path.resolve(/*turbopackIgnore: true*/ process.cwd(), '..', 'prototypes')

export function sandboxRoot(): string {
  return path.resolve(SANDBOX_BASE)
}

export function ensureSandboxExists() {
  fs.mkdirSync(sandboxRoot(), { recursive: true })
}

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'idea'
}

// Everything for one idea lives under <sandbox>/<slug>/. The slug comes from
// model-written text, so confirm the result is still inside the sandbox.
export function ideaDir(title: string): string {
  const root = sandboxRoot()
  const dir = path.join(root, slugify(title))
  if (!dir.startsWith(root + path.sep)) throw new Error(`Sandbox escape attempt: ${dir}`)
  return dir
}

// Mocks sit beside the eventual slice: <sandbox>/<slug>/<prefix>-v<N>.html.
// Versions are kept side by side so an iteration never overwrites its parent.
export function writeMockFile(title: string, version: number, html: string, prefix: 'mock' | 'landing' = 'mock'): string {
  const dir = ideaDir(title)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${prefix}-v${version}.html`)
  fs.writeFileSync(file, html, 'utf-8')
  return file
}

// The slice project: <sandbox>/<slug>/slice. One directory per idea, reused
// across retries so dependencies are installed once.
export function sliceDir(title: string): string {
  return path.join(ideaDir(title), 'slice')
}
