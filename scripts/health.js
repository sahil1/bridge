#!/usr/bin/env node
// The Docker image's health check (Dockerfile HEALTHCHECK, also `node scripts/health.js` anywhere):
// Bridge AI answering on this machine and, with Bots on, each bot's connection to Slack, a line each
// (docker inspect shows them under State.Health). Unhealthy (exit 1) when the server doesn't answer,
// or when a bot can't connect until you fix something (Slack turned its token down, Socket Mode is
// off for its app); a bot connecting again by itself is said, not failed.
const port = process.env.BRIDGE_PORT || 7420
try {
  const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(4000) })
  if (!r.ok) { console.log(`Bridge AI answered ${r.status}`); process.exit(1) }
  const j = await r.json()
  console.log(`Bridge AI ${j.version || ''} is running`.replace(/\s+/g, ' '))
  let stuck = false
  for (const b of j.bots || []) {
    const said = b.state === 'connected' ? 'connected to Slack' : b.state === 'no-tokens' ? 'not connected: its Slack app\'s tokens aren\'t here yet' : b.state === 'off' ? 'off' : `${b.state}${b.why ? `: ${b.why}` : ''}`
    console.log(`Bot ${b.name}: ${b.paused ? 'paused, ' : ''}${said}`)
    if (b.state === 'error') stuck = true
  }
  process.exit(stuck ? 1 : 0)
} catch (e) {
  console.log(`Bridge AI isn't answering on port ${port}: ${e.cause?.code || e.message}`)
  process.exit(1)
}
