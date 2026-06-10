// PM2 process config — cross-platform (Windows, Linux, macOS).
// Runs the production Next.js server and keeps it alive: auto-restart on crash,
// restart on reboot (after `pm2 save` + startup hook). See README → "Run it
// indefinitely". The 3 AM / 11 PM jobs run in-process via node-cron, so this
// one long-lived process is all that's needed.
module.exports = {
  apps: [
    {
      name: 'idea-engine',
      script: 'node_modules/next/dist/bin/next',
      args: 'start',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_restarts: 10,
      // Restart if memory climbs unexpectedly (defensive; normal usage is well under).
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        // ANTHROPIC_API_KEY and SANDBOX_PATH are read from .env.local by Next.js;
        // no need to duplicate them here.
      },
    },
  ],
}
