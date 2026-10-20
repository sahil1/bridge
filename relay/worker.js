// Bridge AI relay: a Cloudflare Worker you run on your own (free) Cloudflare account, so your phone
// can reach Bridge AI on your computer from anywhere, without a VPN and without opening a port.
//
// Your computer keeps one connection open to it (/_relay/host, with the token only your computer
// has). A phone connects to /_relay/link, and the relay passes bytes between the two. Everything
// past the handshake is end-to-end encrypted between phone and computer (see web/link.js), so the
// relay, and Cloudflare, see sizes and times, never content. Nothing is stored except when your
// computer was last online.
//
// It also serves the small page your phone opens (web/), which pairs with your computer and then
// shows Bridge AI from it, through the encrypted link.
//
// Deployed by Bridge AI (Settings › Phone & notifications), as one module: FILES is filled in then.
/* global FILES, RELAY_BUILD */

const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', webmanifest: 'application/manifest+json', png: 'image/png', svg: 'image/svg+xml' }
const MAX_PHONES = 16
const OP = { DATA: 1, OPEN: 2, CLOSE: 3, OK: 4 }

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

// One per relay: holds your computer's connection and the phones'. Uses WebSocket hibernation,
// so while nobody is talking it isn't running (and isn't billed).
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
      server.send(JSON.stringify({ host: !!h, seen: (await this.ctx.storage.get('seen')) || null }))
      if (h) h.send(frame(OP.OPEN, id))
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg === 'string') return // keepalives
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
}
