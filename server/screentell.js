// Remote Screen and Preview (a Beta Feature): your devices told when a screen is shared. remote.js
// says when a session of this computer's screen starts, when control is taken, when an ask waits on
// Ask Here First, and when a device that couldn't see it had Bridge AI opened or reopened there, or
// Screen Recording asked for there (open, reopen, allow); this tells:
//   your phones          a notification (notify.js: each device that turned notifications on here),
//                        with Stop and Block This Device, leaving out the device doing the viewing
//   your other computers each linked one (machines.js), which passes the notification on to the
//                        devices that get its own (leaving out the viewer, when it came through there)
//                        and shows a card in every window open on it while the session lasts
// Stop and Block are carried out by the computer being viewed (remote.js endFrom): from a phone
// paired with it, through its pairing; from one paired with another of your computers, through that
// computer's link (/api/remote/sessions/:id/end there). Blocking only narrows who may connect, so any
// of your devices may; a device is let back in at that computer only.
// What's live, here and on your other computers (list), goes to every window as it changes, on its
// event feed (index.js /api/events, event: screen).
import { plainName } from '../shared/remote.js'

const HEARD_MS = 75000 // what another computer said of its screen, kept this long unless it says again
const AGAIN_MS = 30000 // while anything's live here, said to the others again this often
// Names as they're shown everywhere (shared/remote.js plainName): no control characters, nor the
// ones that turn text around (bidi) or hide in it.
const clip = (v, n = 60) => plainName(v, n)
const iso = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null)
const kindOf = (k) => (k === 'computer' ? 'computer' : 'phone')
const WHATS = ['view', 'control', 'ask', 'open', 'reopen', 'allow']
const byOf = (b) => ({ name: clip(b?.name) || 'A device', kind: kindOf(b?.kind) })
// A session or an ask as the cards show it, whoever said it: who, the device it's for and its kind.
const cleanOne = (x) => ({ id: clip(x.id, 40), by: byOf(x.by), for: clip(x.for) || null, forKind: x.for ? kindOf(x.forKind) : null, control: !!x.control })
// (waiting: past the guardrails there, its screen not showing yet.)
const cleanLive = (b) => ({
  sessions: (Array.isArray(b?.sessions) ? b.sessions : []).filter((x) => typeof x?.id === 'string').slice(0, 20)
    .map((x) => ({ ...cleanOne(x), controlled: !!x.controlled, started: iso(x.started), ...(x.waiting === true ? { waiting: true } : {}) })),
  asks: (Array.isArray(b?.asks) ? b.asks : []).filter((x) => typeof x?.id === 'string').slice(0, 20)
    .map((x) => ({ ...cleanOne(x), at: iso(x.at), until: iso(x.until) })),
})

// remote(): remote.js's (made after this, with this one's tell). pushDevices(): the devices that
// get this computer's notifications (push.js). onLive(list): what's live changed. out(m): a linked
// computer not let in here (Which Devices May Connect), which is told nothing.
export function makeTell({ remote, notify, machines, relay, pushDevices = () => [], onLive = () => {}, out = () => false }) {
  const there = new Map() // machine id -> { name, at, sessions, asks }: what each said last
  const name = () => relay.thisName()
  const linked = () => machines.list().filter((m) => m.state === 'linked')
  const own = () => { try { return cleanLive(remote().live()) } catch { return { sessions: [], asks: [] } } }

  // ---------- the notification ----------
  // Which computer, from which device and its kind, and how it came ("iPhone (phone) · through
  // Laptop", when it came through another of your computers); view, control or an ask; Stop (Deny,
  // for an ask) and Block This Device.
  const whoOf = (ev) => (ev.for ? `${clip(ev.for)} (${kindOf(ev.forKind)}) · through ${clip(ev.by.name)}` : `${clip(ev.by.name)} (${kindOf(ev.by.kind)})`)
  function noteFor(ev, computer, kind, args) {
    const who = whoOf(ev)
    const not = 'Not you? Stop it, or block that device.'
    const n = ev.what === 'ask'
      ? { title: ev.control ? `${who} asks to see and control ${computer}'s screen` : `${who} asks to see ${computer}'s screen`, body: `It's allowed or denied at ${computer} itself. ${not}` }
      : ev.what === 'control'
        ? { title: `${computer} is being controlled`, body: `From ${who}, with its mouse and keyboard. ${not}` }
        : ev.what === 'open'
          ? { title: `Bridge AI was opened on ${computer}`, body: `From ${who}, to see its screen. ${not}` }
          : ev.what === 'reopen'
            ? { title: `Bridge AI is reopening on ${computer}`, body: `From ${who}, to see its screen. ${not}` }
            : ev.what === 'allow'
              ? { title: `${computer} was asked to allow Screen Recording`, body: `From ${who}: System Settings opened there at it. ${not}` }
              : { title: `${computer}'s screen is being viewed`, body: `From ${who}${ev.control ? ', who may control it too' : ''}. ${not}` }
    const actions = [
      notify.button(kind, { ...args, k: 'stop' }, { action: 'stop', title: ev.what === 'ask' ? 'Deny' : 'Stop' }),
      notify.button(kind, { ...args, k: 'block' }, { action: 'block', title: 'Block This Device' }),
    ]
    return { kind: 'screen', ...n, url: '/', tag: `screen-${ev.id}`, actions }
  }
  const sentOf = (results) => (results || []).reduce((n, r) => n + (Number(r?.sent) || 0), 0)

  // This computer's own (remote.js announce): to the devices that get its notifications, not the
  // viewer's when it's paired here; and to each of your other computers, which says how many of its
  // own it reached. What became of it goes in the record: { sent, computers: [{ name, sent | error }] }.
  async function tell(ev) {
    const viewer = relay.deviceOf(ev.by?.id)
    const mine = notify.send({ ...noteFor(ev, name(), 'screen', { id: ev.id }), skip: { devices: ev.by?.id ? [ev.by.id] : [] } }).then(sentOf, () => 0)
    const others = linked().filter((m) => !out(m)).map(async (m) => {
      // The viewer is that computer itself, or a device paired with it: it leaves that one out.
      const byYou = machines.ofDevice(viewer)?.id === m.id
      const told = { what: ev.what, id: ev.id, by: byOf(ev.by), for: ev.for || null, forKind: ev.forKind || null, forId: byYou ? ev.forId || null : null, byYou, control: !!ev.control }
      try {
        const r = await machines.callOn(m.id, 'POST', '/api/remote/heard', { ...own(), tell: told }, 10000)
        return { name: m.name, sent: Number(r?.sent) || 0 }
      } catch (e) { return { name: m.name, error: e.code === 'offline' ? 'offline' : /\b404\b|not found/i.test(e.message) ? 'old' : 'failed' } }
    })
    const [sent, computers] = await Promise.all([mine, Promise.all(others)])
    return { sent, computers }
  }

  // Another of your computers telling this one (POST /api/remote/heard, from it only): what's live
  // there, for the cards here; and a notification to pass on to the devices that get this one's,
  // whose buttons this computer takes to that one.
  async function heard(m, body = {}) {
    there.set(m.id, { name: m.name, at: Date.now(), ...cleanLive(body) })
    shown()
    const t = body.tell
    if (!t || !WHATS.includes(t.what) || typeof t.id !== 'string') return { ok: true, sent: 0 }
    const ev = { what: t.what, ...cleanOne(t) }
    const forId = clip(t.forId, 40)
    // (Nor any device of this computer's that computer keeps out: machines.js keptFrom.)
    const skip = { devices: forId ? [forId] : [], here: t.byYou === true && !forId, hide: (device) => machines.keptFrom(device).has(m.id) }
    return { ok: true, sent: sentOf(await notify.send({ ...noteFor(ev, m.name, 'screen-there', { m: m.id, id: ev.id }), skip }).catch(() => [])) }
  }

  // ---------- what's live, for the cards ----------
  // Each session and each ask waiting, here (machine null) and on your other computers, with the
  // computer it's on. What another said is let go once it's old or that computer isn't linked.
  function list() {
    const now = Date.now()
    const mine = own()
    const out = [...mine.sessions.map((x) => ({ ...x, machine: null, computer: name(), ask: false })), ...mine.asks.map((x) => ({ ...x, machine: null, computer: name(), ask: true }))]
    for (const [id, t] of there) {
      if (now - t.at > HEARD_MS || !linked().some((m) => m.id === id)) { there.delete(id); continue }
      out.push(...t.sessions.map((x) => ({ ...x, machine: id, computer: t.name, ask: false })))
      out.push(...t.asks.filter((x) => !x.until || Date.parse(x.until) > now).map((x) => ({ ...x, machine: id, computer: t.name, ask: true })))
    }
    return out
  }
  let shownKey = ''
  let expiry = null
  function shown() {
    const l = list()
    const key = JSON.stringify(l)
    if (key !== shownKey) { shownKey = key; onLive(l) }
    // Something heard from another computer goes when it's old, said or not.
    clearTimeout(expiry)
    if (there.size) { expiry = setTimeout(shown, 15000); expiry.unref?.() }
  }
  // This computer's own changed (remote.js onChange): every window here, and your other computers.
  let ownKey = JSON.stringify({ sessions: [], asks: [] })
  let sayTimer = null
  let againTimer = null
  function changed() {
    const key = JSON.stringify(own())
    shown()
    if (key === ownKey) return
    ownKey = key
    clearTimeout(sayTimer)
    sayTimer = setTimeout(say, 200)
  }
  function say() {
    clearTimeout(againTimer)
    const now = own()
    for (const m of linked().filter((x) => !out(x))) machines.callOn(m.id, 'POST', '/api/remote/heard', now, 10000).catch(() => {})
    if (now.sessions.length || now.asks.length) { againTimer = setTimeout(say, AGAIN_MS); againTimer.unref?.() }
  }

  // ---------- Stop and Block ----------
  // From a window here (the card): this computer's own session, or one on another of your computers,
  // through its link. by: who it came from, for that computer's record; h: for a device of this
  // computer's, which (machines.js forDevice).
  async function end({ machine = null, id, block = false }, by, h = []) {
    if (!machine) return remote().endFrom(String(id), { block: !!block, by })
    if (!linked().some((m) => m.id === machine)) throw Object.assign(new Error('That computer isn\'t linked to this one any more'), { status: 404 })
    const r = await machines.callOn(machine, 'POST', `/api/remote/sessions/${encodeURIComponent(String(id))}/end`, { block: !!block, from: by }, 12000, h)
    const t = there.get(machine)
    if (t) { t.sessions = t.sessions.filter((x) => x.id !== id); t.asks = t.asks.filter((x) => x.id !== id); shown() }
    return r
  }
  // Block This Device on a session that came through another of your computers (hop: that one, as a
  // device here): the device it came for is unticked there, so it reaches none of them through it.
  async function blockThere(hop, id) {
    const m = machines.ofDevice(relay.deviceOf(hop))
    if (!m) throw Object.assign(new Error('The computer it came through isn\'t linked to this one any more'), { status: 404 })
    return machines.callOn(m.id, 'POST', '/api/remote/devices/block', { id }, 12000)
  }
  // A notification's buttons: this computer's (remote.js), or another's (through its link).
  notify.onButton('screen', (a, ctx) => remote().endFrom(String(a.id), { block: a.k === 'block', by: ctx.by }))
  notify.onButton('screen-there', (a, ctx) => end({ machine: String(a.m), id: String(a.id), block: a.k === 'block' }, ctx.by, ctx.h))

  // Where this computer's notifications of its screen go, for Settings: the devices that get its
  // notifications, and each linked computer with how many get its own (null: too old to say).
  const notifyTo = () => ({
    devices: pushDevices().map((d) => ({ label: d.label, here: !!d.here })),
    computers: linked().map((m) => ({ id: m.id, name: m.name, online: !!m.online, devices: m.notifies ?? null })),
  })

  return { tell, heard, list, changed, end, notifyTo, blockThere }
}
