'use client'

import { useState } from 'react'
import type { Prototype, PrototypeFile } from '@/lib/types'

function langColor(lang: string) {
  const map: Record<string, string> = {
    typescript: 'text-blue-400',
    javascript: 'text-yellow-400',
    json: 'text-green-400',
    css: 'text-pink-400',
    html: 'text-orange-400',
    markdown: 'text-zinc-400',
    sql: 'text-purple-400',
  }
  return map[lang.toLowerCase()] ?? 'text-zinc-400'
}

export default function PrototypeView({ prototype: proto }: { prototype: Prototype }) {
  const [selectedFile, setSelectedFile] = useState<PrototypeFile | null>(
    proto.file_tree?.[0] ?? null
  )
  const [copied, setCopied] = useState(false)

  const copyPath = async () => {
    if (!proto.directory_path) return
    await navigator.clipboard.writeText(proto.directory_path)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      {/* Directory path */}
      {proto.directory_path && (
        <div className="flex items-center gap-2 bg-zinc-900 rounded px-3 py-2">
          <span className="text-xs font-mono text-zinc-400 flex-1 truncate">
            {proto.directory_path}
          </span>
          <button
            onClick={copyPath}
            className="text-xs font-mono text-zinc-500 hover:text-zinc-300 shrink-0"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      {/* Stack */}
      {proto.stack && proto.stack.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {proto.stack.map((s, i) => (
            <span key={i} className="text-xs font-mono bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded">
              {s}
            </span>
          ))}
        </div>
      )}

      {/* File tree + viewer */}
      {proto.file_tree && proto.file_tree.length > 0 && (
        <div className="flex gap-0 border border-zinc-800 rounded overflow-hidden" style={{ height: '480px' }}>
          {/* File list */}
          <div className="w-52 shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-900">
            {proto.file_tree.map((f, i) => (
              <button
                key={i}
                onClick={() => setSelectedFile(f)}
                className={`w-full text-left px-3 py-1.5 text-xs font-mono truncate transition-colors ${
                  selectedFile?.path === f.path
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <span className={`mr-1.5 ${langColor(f.language)}`}>•</span>
                {f.path}
              </button>
            ))}
          </div>

          {/* Code viewer */}
          <div className="flex-1 overflow-auto bg-[#0d0d0d]">
            {selectedFile ? (
              <pre className="text-xs font-mono text-zinc-300 p-4 leading-relaxed whitespace-pre">
                {selectedFile.content}
              </pre>
            ) : (
              <div className="h-full flex items-center justify-center text-zinc-600 text-xs font-mono">
                Select a file
              </div>
            )}
          </div>
        </div>
      )}

      {/* README */}
      {proto.readme && (
        <details className="group">
          <summary className="text-xs font-mono text-zinc-500 cursor-pointer hover:text-zinc-300">
            README.md
          </summary>
          <pre className="mt-2 text-xs font-mono text-zinc-400 bg-zinc-900 rounded p-4 whitespace-pre-wrap leading-relaxed">
            {proto.readme}
          </pre>
        </details>
      )}
    </div>
  )
}
