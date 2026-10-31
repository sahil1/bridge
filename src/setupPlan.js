import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'

// What's left to set up on this computer (server: /api/setup/plan and /api/setup/run), looked at
// once for everything that shows it: setup, Settings › General and the top bar's "Setting up". Again
// every 2 seconds while something's going or waiting for you, else every 15, and only while one of
// them wants it (the top bar's only during a run).
const shared = { plan: null, subs: new Set(), wants: 0, timer: null, pending: null }
export const publish = (p) => { shared.plan = p; for (const f of shared.subs) f(p) }
export const loadPlan = () => (shared.pending ||= api('/setup/plan').then((p) => { publish(p); return p }).finally(() => { shared.pending = null }))
const busy = (p) => !!(p?.running || p?.needsYou)
function tick() {
  clearTimeout(shared.timer)
  if (!shared.wants) return
  shared.timer = setTimeout(() => { (document.hidden ? Promise.resolve() : loadPlan().catch(() => {})).finally(tick) }, busy(shared.plan) ? 2000 : 15000)
}

export function useSetupPlan(on = true) {
  const [plan, setPlan] = useState(shared.plan)
  useEffect(() => {
    shared.subs.add(setPlan)
    setPlan(shared.plan)
    return () => { shared.subs.delete(setPlan) }
  }, [])
  useEffect(() => {
    if (!on) return
    shared.wants++
    loadPlan().catch(() => {}).finally(tick)
    return () => { shared.wants--; if (!shared.wants) clearTimeout(shared.timer) }
  }, [on])
  const load = useCallback(() => loadPlan().catch(() => {}), [])
  const run = async (level) => { const p = await api('/setup/run', { method: 'POST', body: { level } }); publish(p); tick(); return p }
  return { plan, load, run }
}

// This run's own items (what it set out to do), how many are ready, and what's left for you once
// nothing's going: to allow, to try again, or not set up (a tab closed before it was done).
export function runProgress(plan) {
  const ids = plan?.run?.ids || []
  const mine = (plan?.items || []).filter((i) => ids.includes(i.id))
  const ready = mine.filter((i) => i.state === 'done' || i.state === 'restart').length
  const left = mine.filter((i) => !['done', 'restart', 'running'].includes(i.state))
  return { total: mine.length, ready, left }
}
