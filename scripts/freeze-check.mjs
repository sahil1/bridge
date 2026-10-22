// Freeze detector: fires requests that touch the protected folder (they may take as long as they
// like) while pinging /api/version every 200 ms. Any ping slower than 1.5 s means something froze
// the whole server. Run the server under scripts/tcc-sim.mjs, then:
//   node scripts/freeze-check.mjs <base url> <request>...
//   request: "GET /api/dirs?q=..." or "POST /api/x {json}"
const [base, ...reqs] = process.argv.slice(2)
let worst = 0, stalls = 0, stop = false
const ping = async () => {
  while (!stop) {
    const t = Date.now()
    try { await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(30000) }) } catch { /* counted by time */ }
    const ms = Date.now() - t
    worst = Math.max(worst, ms)
    if (ms > 1500) { stalls++; console.log(`STALL: /api/version took ${ms} ms`) }
    await new Promise((r) => setTimeout(r, 200))
  }
}
const pinger = ping()
await new Promise((r) => setTimeout(r, 300))
const results = await Promise.all(reqs.map(async (spec) => {
  const [method, url, ...body] = spec.split(' ')
  const t = Date.now()
  try {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body.length ? body.join(' ') : undefined, signal: AbortSignal.timeout(60000) })
    return `${method} ${url} -> ${r.status} in ${Date.now() - t} ms`
  } catch (e) { return `${method} ${url} -> ${e.name} after ${Date.now() - t} ms` }
}))
await new Promise((r) => setTimeout(r, 500))
stop = true
await pinger
for (const r of results) console.log(r)
console.log(stalls ? `FROZE: ${stalls} stalled pings, worst ${worst} ms` : `OK: server stayed responsive (worst ping ${worst} ms)`)
process.exit(stalls ? 1 : 0)
