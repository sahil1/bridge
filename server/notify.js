// Notifications: when an agent starts waiting on you, finishes, or a usage quota runs low, tell
// you on every channel you've set up (phone and browser push today; chat apps can plug in the same
// way). Each channel is { name, ready(), send(note) }.
//
// A note is { kind: 'needs-you' | 'finished' | 'quota' | 'test', title, body, paneId?, url, tag }.
// Settings: "notify": { "needsYou": true, "finished": true, "quotaBelow": 15 } (percent left; 0 = off).

const channels = new Set()
export const use = (channel) => { channels.add(channel); return channel }
export const active = () => [...channels].some((c) => c.ready())

export async function send(note) {
  const ready = [...channels].filter((c) => c.ready())
  const results = await Promise.all(ready.map((c) => Promise.resolve().then(() => c.send(note)).then((r) => ({ channel: c.name, ...r }), (e) => ({ channel: c.name, error: e.message }))))
  return results
}

// ---------- Agents ----------
const seen = new Map() // paneId -> { status, seq }
let primed = false
export function onFleet(fleet, cfg = {}) {
  const want = cfg.notify || {}
  for (const a of fleet.agents || []) {
    const before = seen.get(a.paneId)
    seen.set(a.paneId, { status: a.status, seq: a.seq })
    // A change to "needs you" or "finished", or a new agent that shows up already there (after
    // the first look, so a restart doesn't announce everything again).
    const changed = before ? before.status !== a.status || before.seq !== a.seq : primed
    if (!changed) continue
    const label = a.chief ? 'Chief of staff' : a.title || a.tab || a.workspace || 'An agent'
    const where = [a.workspace, a.tab && a.tab !== label ? a.tab : null].filter(Boolean).join(' › ')
    if (a.status === 'blocked' && want.needsYou !== false) {
      send({ kind: 'needs-you', title: `${label} needs you`, body: where || 'Open Bridge AI to answer', paneId: a.paneId, url: `/?agent=${encodeURIComponent(a.paneId)}`, tag: `agent-${a.paneId}` })
    } else if (a.status === 'done' && want.finished !== false) {
      send({ kind: 'finished', title: `${label} finished`, body: where || 'Open Bridge AI to see the result', paneId: a.paneId, url: `/?agent=${encodeURIComponent(a.paneId)}`, tag: `agent-${a.paneId}` })
    }
  }
  primed = true
}

// ---------- Usage quotas ----------
// Once per quota window: "Claude: 12% left in this 5-hour window".
const warned = new Set()
export function onQuota(quota, cfg = {}) {
  const below = cfg.notify?.quotaBelow ?? 15
  if (!below || !quota?.providers) return
  const NAMES = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', copilot: 'Copilot', cursor: 'Cursor', grok: 'Grok', zai: 'Z.ai', kimi: 'Kimi', amp: 'Amp' }
  for (const p of quota.providers) {
    if (!p.usable) continue
    for (const w of p.windows || []) {
      if (w.percentRemaining == null || w.percentRemaining > below) continue
      const key = `${p.provider}:${w.id || w.label}:${w.resetsAt || ''}`
      if (warned.has(key)) continue
      warned.add(key)
      const name = NAMES[p.provider] || p.provider
      const resets = w.resetsAt ? ` Resets ${new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}.` : ''
      send({ kind: 'quota', title: `${name}: ${w.percentRemaining}% left`, body: `Running low${w.label ? ` (${w.label})` : ''}.${resets}`, url: '/?card=gauge', tag: `quota-${p.provider}-${w.id || w.label}` })
    }
  }
}
