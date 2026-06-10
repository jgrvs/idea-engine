import cron from 'node-cron'
import { runGenerate, runNightlyPrototypes } from './pipeline'

const g = globalThis as typeof globalThis & { _schedulerInitialized?: boolean }

export function initScheduler() {
  if (g._schedulerInitialized) return
  g._schedulerInitialized = true

  // 3 AM: generate fresh ideas
  cron.schedule('0 3 * * *', async () => {
    console.log('[scheduler] 3 AM — running idea generation')
    try {
      const result = await runGenerate()
      console.log(`[scheduler] Generated ${result.count} ideas`)
    } catch (err) {
      console.error('[scheduler] Generation failed:', err)
    }
  })

  // 11 PM: prototype selected ideas
  cron.schedule('0 23 * * *', async () => {
    console.log('[scheduler] 11 PM — running prototype pipeline')
    try {
      await runNightlyPrototypes()
      console.log('[scheduler] Prototype run complete')
    } catch (err) {
      console.error('[scheduler] Prototype run failed:', err)
    }
  })

  console.log('[scheduler] Initialized — 3 AM generation, 11 PM prototype')
}
