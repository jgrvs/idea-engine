import cron from 'node-cron'
import { runGenerate } from './pipeline'
import { runNightlySlices } from './slice'
import { recoverInterrupted } from './stages'

const g = globalThis as typeof globalThis & { _schedulerInitialized?: boolean }

export function initScheduler() {
  if (g._schedulerInitialized) return
  g._schedulerInitialized = true

  // Stage jobs run inside this process, so a restart orphans whatever was in
  // flight. Put those ideas back where a human can retry them.
  try {
    recoverInterrupted()
  } catch (err) {
    console.error('[scheduler] recovery check failed:', err)
  }

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

  // 11 PM: build the slices a human has queued
  cron.schedule('0 23 * * *', async () => {
    console.log('[scheduler] 11 PM — building queued slices')
    try {
      await runNightlySlices()
    } catch (err) {
      console.error('[scheduler] Slice run failed:', err)
    }
  })

  console.log('[scheduler] Initialized — 3 AM generation, 11 PM slices')
}
