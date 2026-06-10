import fs from 'fs'
import path from 'path'
import type { PrototypeFile } from './types'

// Where generated prototypes are written. Set SANDBOX_PATH to an absolute path
// for your machine (e.g. C:\dev\Repositories\prototypes on Windows, or
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
