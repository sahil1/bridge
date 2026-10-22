// Bridge AI relay: a Cloudflare Worker you run on your own (free) Cloudflare account, so your phone
// can reach Bridge AI on your computer from anywhere, without a VPN and without opening a port.
//
// Your computer keeps one connection open to it (/_relay/host, with the token only your computer
// has). A phone connects to /_relay/link, and the relay passes bytes between the two. Everything
// past the handshake is end-to-end encrypted between phone and computer (see web/link.js), so the
// relay, and Cloudflare, see sizes and times, never content. What it stores: when your computer was
// last online, and messages your phone left for it while it was offline (sealed, see Hub below).
//
// It also serves the small page your phone opens (web/), which pairs with your computer and then
// shows Bridge AI from it, through the encrypted link.
//
// Deployed by Bridge AI (Settings › Phone & notifications), as one module: FILES is filled in then.
/* global FILES, RELAY_BUILD */

const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', webmanifest: 'application/manifest+json', png: 'image/png', svg: 'image/svg+xml' }
const MAX_PHONES = 16
const OP = { DATA: 1, OPEN: 2, CLOSE: 3, OK: 4 }
// Messages waiting for your computer: how long, how big, how many.
const Q = { DAYS: 7, NOTE: 64 * 1024, PER_BOX: 50, BOX_BYTES: 512 * 1024, BOXES: 16, RECEIPTS: 100 }
const ID = /^[\w-]{22}$/ // a note's id, or a box
const DAY = 24 * 3600 * 1000

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const p = url.pathname
    if (p === '/_relay/host' || p === '/_relay/link') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
      if (p === '/_relay/host' && !(await tokenOk(req.headers.get('Authorization'), env.HOST_TOKEN))) return new Response('Not allowed', { status: 403 })
      return env.HUB.get(env.HUB.idFromName('hub')).fetch(req)
    }
    // Public, so it says only that the relay is up and which version: nothing about your computer.
    if (p === '/_relay/health') return new Response(JSON.stringify({ ok: true, build: RELAY_BUILD }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
    // The page and its files. Anything else is Bridge AI itself, which the page's service worker
    // fetches from your computer; reaching here means the page isn't open yet.
    const name = p === '/' ? 'index.html' : p.slice(1)
    const f = FILES[name]
    if (!f) {
      if (req.headers.get('Sec-Fetch-Dest') === 'document' || req.headers.get('Accept')?.includes('text/html')) return Response.redirect(`${url.origin}/`, 302)
      return new Response('Not found', { status: 404 })
    }
    const body = f.b64 ? Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)) : f.text
    return new Response(body, {
      headers: {
        'Content-Type': TYPES[name.split('.').pop()] || 'application/octet-stream',
        'Cache-Control': 'no-cache', // small, and must change together when the relay is updated
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        ...(name === 'index.html' ? { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' wss: ws:; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'" } : {}),
      },
    })
  },
}

async function tokenOk(header, token) {
  if (!token || !header) return false
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(header)))
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`Bearer ${token}`)))
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

const frame = (op, id, payload) => {
  const b = payload ? new Uint8Array(payload) : new Uint8Array(0)
  const out = new Uint8Array(5 + b.byteLength)
  out[0] = op
  new DataView(out.buffer).setUint32(1, id)
  out.set(b, 5)
  return out
}

// A phone's box: a hash of its key (web/link.js boxId), so notes are kept by phone without the key.
async function boxOf(d) {
  const raw = Uint8Array.from(atob(d.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (d.length % 4)) % 4)), (c) => c.charCodeAt(0))
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...new TextEncoder().encode('bridge box v1'), ...raw])))
  return btoa(String.fromCharCode(...h.subarray(0, 16))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// One per relay: holds your computer's connection and the phones'. Uses WebSocket hibernation,
// so while nobody is talking it isn't running (and isn't billed).
//
// It also keeps the messages a phone leaves while your computer is offline, as text messages on the
// same connections (binary ones are the link, as before):
//   phone:    { t: 'box', box }    which phone this is (its box: a hash of its key), once connected;
//                                  answered with its notes still waiting and the receipts for the rest
//             { t: 'put', note }   leave a note (web/link.js seals it for your computer)
//             { t: 'got', ids }    receipts it has read;  { t: 'drop', ids }  notes it took back
//   computer: { t: 'take', boxes } it takes notes now (all of them, then each new one as it comes),
//                                  and these are its paired phones' boxes ({ t: 'roster' } later)
//             { t: 'ack', box, id, receipt }  done with a note: it's deleted, and the receipt
//                                  (what became of it, sealed for the phone) waits for the phone instead
// A note waits 7 days at most; 64 KB each, 50 or 512 KB a phone. Once your computer has said which
// phones are its own, other boxes can't leave notes; before that (an older Bridge AI), up to 16
// boxes can, and the notes wait until it's updated. Older phones and computers never see any of it.
export class Hub {
  constructor(ctx) {
    this.ctx = ctx
    // Keepalives are answered without waking the hub.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  host(except) { return this.ctx.getWebSockets('host').find((w) => w !== except && w.readyState === 1) || null }

  async fetch(req) {
    const url = new URL(req.url)
    const [client, server] = Object.values(new WebSocketPair())
    if (url.pathname === '/_relay/host') {
      // A new connection from the computer replaces the old one; phones start over with it.
      for (const old of this.ctx.getWebSockets('host')) try { old.close(4000, 'replaced') } catch { /* gone */ }
      for (const ph of this.ctx.getWebSockets('phone')) try { ph.close(4001, 'computer reconnected') } catch { /* gone */ }
      this.ctx.acceptWebSocket(server, ['host'])
      await this.ctx.storage.put('seen', null)
    } else {
      // The address is public, so anyone can connect; only your computer can tell a paired phone
      // (it says so with OK). When full, the oldest connection it hasn't vouched for makes room,
      // so strangers can't crowd out your phones.
      const phones = this.ctx.getWebSockets('phone')
      if (phones.length >= MAX_PHONES) {
        const stranger = phones.map((w) => [w, w.deserializeAttachment() || {}]).filter(([, a]) => !a.ok).sort((a, b) => (a[1].at || 0) - (b[1].at || 0))[0]
        if (!stranger) return new Response('Too many connections', { status: 429 })
        try { stranger[0].close(4004, 'make room') } catch { /* gone */ }
      }
      const id = crypto.getRandomValues(new Uint32Array(1))[0]
      this.ctx.acceptWebSocket(server, ['phone', `p${id}`])
      server.serializeAttachment({ id, at: Date.now() })
      const h = this.host()
      // q: this relay keeps notes (older pages ignore it).
      server.send(JSON.stringify({ host: !!h, seen: (await this.ctx.storage.get('seen')) || null, q: 1 }))
      if (h) h.send(frame(OP.OPEN, id))
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg === 'string') return this.text(ws, msg) // keepalives are answered before here
    if (this.ctx.getTags(ws).includes('host')) {
      const b = new Uint8Array(msg)
      const id = new DataView(b.buffer, b.byteOffset).getUint32(1)
      const ph = this.ctx.getWebSockets(`p${id}`)[0]
      if (!ph) { if (b[0] !== OP.CLOSE) ws.send(frame(OP.CLOSE, id)); return }
      if (b[0] === OP.DATA) ph.send(b.subarray(5))
      else if (b[0] === OP.OK) ph.serializeAttachment({ ...ph.deserializeAttachment(), ok: true })
      else if (b[0] === OP.CLOSE) try { ph.close(4003, 'closed by the computer') } catch { /* gone */ }
      return
    }
    const h = this.host()
    const { id } = ws.deserializeAttachment() || {}
    if (h && id != null) h.send(frame(OP.DATA, id, msg))
  }

  async webSocketClose(ws, code) {
    await this.gone(ws, code)
  }

  async webSocketError(ws) {
    await this.gone(ws, 1011)
  }

  async gone(ws, code) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye') } catch { /* already closed */ }
    if (this.ctx.getTags(ws).includes('host')) {
      if (this.host(ws)) return // a newer connection took over
      const seen = Date.now()
      await this.ctx.storage.put('seen', seen)
      for (const ph of this.ctx.getWebSockets('phone')) try { ph.send(JSON.stringify({ host: false, seen })) } catch { /* gone */ }
      return
    }
    const { id } = ws.deserializeAttachment() || {}
    const h = this.host(ws)
    if (h && id != null) try { h.send(frame(OP.CLOSE, id)) } catch { /* gone */ }
  }

  // ---------- notes waiting for your computer ----------
  async text(ws, s) {
    let m
    try { m = JSON.parse(s) } catch { return }
    if (!m || typeof m !== 'object') return
    const st = this.ctx.storage
    if (this.ctx.getTags(ws).includes('host')) {
      if (m.t === 'take' || m.t === 'roster') await this.roster(m.boxes)
      if (m.t === 'take') {
        ws.serializeAttachment({ ...ws.deserializeAttachment(), takes: true })
        await this.purge()
        const all = [...(await st.list({ prefix: 'n:' })).values()].sort((a, b) => a.at - b.at)
        for (const n of all) ws.send(JSON.stringify({ t: 'note', box: n.box, note: n.note }))
      } else if (m.t === 'ack' && ID.test(m.box || '') && ID.test(m.id || '')) await this.ack(m)
      return
    }
    const a = ws.deserializeAttachment() || {}
    if (m.t === 'box' && ID.test(m.box || '')) {
      ws.serializeAttachment({ ...a, box: m.box })
      await this.purge()
      const waiting = [...(await st.list({ prefix: `n:${m.box}:` })).values()].map((n) => n.note.id)
      const receipts = [...(await st.list({ prefix: `r:${m.box}:` })).values()].map((r) => r.note)
      ws.send(JSON.stringify({ t: 'box', waiting, receipts }))
    } else if (m.t === 'put') await this.put(ws, m.note)
    else if ((m.t === 'got' || m.t === 'drop') && a.box && Array.isArray(m.ids)) {
      await st.delete(m.ids.filter((id) => ID.test(id)).slice(0, 128).map((id) => `${m.t === 'got' ? 'r' : 'n'}:${a.box}:${id}`))
    }
  }

  async put(ws, note) {
    const say = (ok, why) => ws.send(JSON.stringify({ t: 'put', id: note?.id, ok, ...(why ? { why } : {}) }))
    const size = JSON.stringify(note ?? null).length
    if (!ID.test(note?.id || '') || typeof note.d !== 'string' || note.d.length > 100) return say(false, 'bad')
    if (size > Q.NOTE) return say(false, 'too-big')
    const box = await boxOf(note.d).catch(() => null)
    if (!box) return say(false, 'bad')
    const st = this.ctx.storage
    await this.purge()
    const roster = await st.get('roster')
    const mine = await st.list({ prefix: `n:${box}:` })
    if (roster ? !roster.includes(box) : !mine.size && (await this.boxes()) >= Q.BOXES) return say(false, roster ? 'not-paired' : 'full')
    const key = `n:${box}:${note.id}`
    let bytes = size
    let count = 1
    for (const [k, v] of mine) if (k !== key) { bytes += v.size; count++ }
    if (count > Q.PER_BOX || bytes > Q.BOX_BYTES) return say(false, 'full')
    await st.put(key, { box, note, at: Date.now(), size })
    await this.wake()
    say(true)
    // Your computer is here after all (the phone hadn't heard yet): straight on.
    if (this.host()?.deserializeAttachment()?.takes) this.host().send(JSON.stringify({ t: 'note', box, note }))
  }

  async ack({ box, id, receipt }) {
    const st = this.ctx.storage
    await st.delete(`n:${box}:${id}`)
    if (!receipt || JSON.stringify(receipt).length > 4096) return
    await st.put(`r:${box}:${id}`, { box, note: receipt, at: Date.now() })
    const all = [...(await st.list({ prefix: `r:${box}:` }))].sort((x, y) => x[1].at - y[1].at)
    if (all.length > Q.RECEIPTS) await st.delete(all.slice(0, all.length - Q.RECEIPTS).map(([k]) => k))
    for (const ph of this.ctx.getWebSockets('phone')) if (ph.deserializeAttachment()?.box === box) try { ph.send(JSON.stringify({ t: 'receipt', note: receipt })) } catch { /* gone */ }
    await this.wake()
  }

  async roster(boxes) {
    if (Array.isArray(boxes)) await this.ctx.storage.put('roster', boxes.filter((b) => ID.test(b)).slice(0, 64))
  }

  async boxes() { return new Set([...(await this.ctx.storage.list({ prefix: 'n:' })).values()].map((n) => n.box)).size }

  // Notes and receipts go after 7 days: checked whenever they're used, and once a day while any wait.
  async purge() {
    const old = Date.now() - Q.DAYS * DAY
    const st = this.ctx.storage
    const gone = [...(await st.list({ prefix: 'n:' })), ...(await st.list({ prefix: 'r:' }))].filter(([, v]) => v.at < old).map(([k]) => k)
    for (let i = 0; i < gone.length; i += 128) await st.delete(gone.slice(i, i + 128))
  }

  async wake() { if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + DAY) }

  async alarm() {
    await this.purge()
    const st = this.ctx.storage
    if ((await st.list({ prefix: 'n:', limit: 1 })).size || (await st.list({ prefix: 'r:', limit: 1 })).size) await st.setAlarm(Date.now() + DAY)
  }
}
