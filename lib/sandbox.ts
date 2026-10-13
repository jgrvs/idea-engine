import fs from 'fs'
import path from 'path'
import type { PrototypeFile } from './types'

// Where generated prototypes are written. Set SANDBOX_PATH to an absolute path
// for your machine (e.g. C:\projects\prototypes on Windows, or
// /srv/idea-engine/prototypes on a Linux server). The fallback is a `prototypes`
// directory sibling to the project root, which is portable across OSes.
const SANDBOX_BASE = process.env.SANDBOX_PATH ?? path.resolve(process.cwd(), '..', 'prototypes')

export function writeSandbox(dirName: string, files: PrototypeFile[]): string {
  const sandboxDir = path.resolve(SANDBOX_BASE)
  const targetDir = path.join(sandboxDir, dirName)

  // Ensure the target is inside the sandbox (prevent traversal)
  if (!targetDir.startsWith(sandboxDir + path.sep) && targetDir !== sandboxDir) {
    throw new Error(`Sandbox escape attempt: ${targetDir}`)
  }

  fs.mkdirSync(targetDir, { recursive: true })

  for (const file of files) {
    // Normalize and verify each file path stays inside targetDir
    const filePath = path.join(targetDir, ...file.path.split('/'))
    if (!filePath.startsWith(targetDir + path.sep)) {
      console.warn(`Skipping unsafe file path: ${file.path}`)
      continue
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, file.content, 'utf-8')
  }

  return targetDir
}

export function ensureSandboxExists() {
  fs.mkdirSync(path.resolve(SANDBOX_BASE), { recursive: true })
}

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'idea'
}

// Mocks live beside the eventual prototype: <sandbox>/<slug>/mock-v<N>.html.
// Versions are kept side by side so an iteration never overwrites its parent.
export function writeMockFile(slug: string, version: number, html: string): string {
  const sandboxDir = path.resolve(SANDBOX_BASE)
  const dir = path.join(sandboxDir, slugify(slug))
  if (!dir.startsWith(sandboxDir + path.sep)) throw new Error(`Sandbox escape attempt: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `mock-v${version}.html`)
  fs.writeFileSync(file, html, 'utf-8')
  return file
}
