import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // The slice always builds and runs from its own folder. Pin the root here so
  // a lockfile somewhere above it on disk is never mistaken for the workspace.
  turbopack: { root: process.cwd() },
}

export default nextConfig
