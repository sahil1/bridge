// How Bridge AI itself is doing, so it never feels slow without our knowing why: how long its
// event loop was held up (a long hold is every window waiting), its CPU, and which requests took
// the most time, since it started or since the last look. GET /api/perf, Settings › About and the
// perf test read it. Nothing leaves the computer.
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

const loop = monitorEventLoopDelay({ resolution: 20 })
loop.enable()
let since = { at: performance.now(), cpu: process.cpuUsage() }
const routes = new Map() // route -> { n, ms, max }

// Times each request, by its route ("/api/agents/:pane/subagents", not each pane's).
export function timing(req, res, next) {
  const start = performance.now()
  res.on('finish', () => {
    const k = `${req.method} ${req.route?.path || req.path.replace(/\/[0-9a-f-]{8,}(?=\/|$)/gi, '/:id')}`.slice(0, 120)
    const ms = performance.now() - start
    const r = routes.get(k) || { n: 0, ms: 0, max: 0 }
    r.n++; r.ms += ms; r.max = Math.max(r.max, ms)
    routes.set(k, r)
    if (routes.size > 400) routes.delete(routes.keys().next().value)
  })
  next()
}

// The figures since the last reset: CPU as a share of one core, the event loop's delays in ms,
// memory, and the requests that took the most time in all. reset: start counting afresh.
export function snapshot({ reset = false } = {}) {
  const wall = performance.now() - since.at
  const cpu = process.cpuUsage(since.cpu)
  const ms = (ns) => Math.round(ns / 1e5) / 10
  const out = {
    seconds: Math.round(wall / 100) / 10,
    cpu: Math.round(((cpu.user + cpu.system) / 1000 / wall) * 1000) / 10, // % of one core
    loop: { p50: ms(loop.percentile(50)), p99: ms(loop.percentile(99)), max: ms(loop.max) },
    memMB: Math.round(process.memoryUsage().rss / 1e6),
    requests: [...routes].map(([route, r]) => ({ route, n: r.n, ms: Math.round(r.ms), avg: Math.round((r.ms / r.n) * 10) / 10, max: Math.round(r.max) })).sort((a, b) => b.ms - a.ms).slice(0, 25),
  }
  if (reset) { loop.reset(); routes.clear(); since = { at: performance.now(), cpu: process.cpuUsage() } }
  return out
}
