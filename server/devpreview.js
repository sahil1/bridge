// A project's app on another of your computers, shown here (Remote Screen and Preview, a Beta
// Feature): what an agent there serves on its localhost (a dev server: Vite, Next, Django...) reaches
// this computer through the same encrypted link as everything else, nothing opened to the network.
//
// On the computer serving it (serve): /_preview/<port>/<path> is that port on its localhost, for
// your other devices only (each request comes through its link, relay.js, which says which paired
// device asked), only while the Beta Feature is on there, and only for a port it lists as one of its
// own dev servers (servers.js: a process started in an agent's folder), never Bridge AI's own ports.
// Requests and WebSockets (hot reload) both; redirects to itself kept on it; cookies, which the link
// carries none of, go in headers of their own (shared/remote.js PREVIEW_HEADERS).
//
// On the computer showing it (ports): each app gets an address of its own on 127.0.0.1, a port
// picked for it, where everything it asks goes to that computer's /_preview/<port>/. To the browser
// it's a site of its own, at its root as on its own computer (an app's absolute paths, its cookies,
// its hot reload all work), and not this Bridge AI's: it can't use this computer's API (guard.js
// turns away any page whose Origin isn't Bridge AI's own), and Bridge AI's own cookie never goes
// with its requests. The address is for this computer only (127.0.0.1): a browser here can open it
// too ("Open in a browser").
import http from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import { PREVIEW, PREVIEW_HEADERS as H } from '../shared/remote.js'

const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'host', 'content-length', 'accept-encoding', 'cookie', 'authorization', 'origin', 'referer'])
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const PROTO = '__bridge_proto' // a WebSocket's subprotocol (Vite's hot reload asks for one), carried in its address over the link
const json = (res, status, o) => { if (!res.headersSent) { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)) } else res.destroy() }

// ---------- the computer serving it ----------
// trialOn(), deviceOf(id) (relay.js), isDevPort(port), thisName().
export function serve({ trialOn, deviceOf, isDevPort, thisName }) {
  // Whether this request may reach that port: { port, path } or why not.
  async function check(req, url) {
    const m = PREVIEW.exec(new URL(url, 'http://x').pathname)
    if (!m) return { status: 404, error: 'Not found' }
    if (!deviceOf(req.headers['x-bridge-relay'])) return { status: 403, error: 'Previews are for your other devices, through their link to this computer.' }
    if (!trialOn()) return { status: 404, error: `Remote Screen and Preview is off on ${thisName()}. Turn it on there in Settings › About & Updates › Beta Features.`, trial: 'remote-screen' }
    const port = Number(m[1])
    if (!(port > 1023 && port < 65536) || !(await isDevPort(port))) return { status: 403, error: `Port ${port} isn't one of the apps ${thisName()} serves (only a server an agent's project started there is shown).`, code: 'port' }
    const u = new URL(url, 'http://x')
    u.searchParams.delete(PROTO)
    return { port, path: `${m[2] || '/'}${u.search}`, root: req.headers[H.root] === '1' }
  }
  // The headers the dev server gets: the request's own (what the link carried), with what a browser
  // keeps for a site (its cookies, Authorization) from their own headers, and its Origin as the
  // server's own when the page was its own (on the computer showing it, at its address there).
  const toServer = (req, port) => {
    const out = {}
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && !k.startsWith('x-bridge-') && !k.startsWith('sec-')) out[k] = v
    out.host = `localhost:${port}`
    // As it is, never compressed: the link says nothing of an encoding (relay.js), and the relay sees
    // only how big each message is.
    out['accept-encoding'] = 'identity'
    if (req.headers[H.cookie]) out.cookie = req.headers[H.cookie]
    if (req.headers[H.authorization]) out.authorization = req.headers[H.authorization]
    const o = req.headers[H.origin]
    if (o) out.origin = o === 'self' ? `http://localhost:${port}` : o
    return out
  }
  // A redirect to the server itself stays on it: at its root on the computer showing it, or under
  // /_preview/<port>/ beside Bridge AI's own page.
  const where = (loc, port, root) => {
    let u
    try { u = new URL(loc, `http://localhost:${port}/`) } catch { return loc }
    const own = LOOPBACK.has(u.hostname) && Number(u.port || 80) === port
    if (!own && /^[a-z]+:/i.test(loc)) return loc
    const p = `${u.pathname}${u.search}${u.hash}`
    return root ? p : `/_preview/${port}${p}`
  }
  async function httpHandler(req, res) {
    const c = await check(req, req.originalUrl || req.url)
    if (c.error) return json(res, c.status, { error: c.error, ...(c.trial ? { trial: c.trial } : {}), ...(c.code ? { code: c.code } : {}) })
    const up = http.request({ host: 'localhost', port: c.port, method: req.method, path: c.path, headers: toServer(req, c.port), autoSelectFamily: true, timeout: 60000 }, (r) => {
      res.statusCode = r.statusCode
      for (const [k, v] of Object.entries(r.headers)) {
        if (HOP.has(k) && k !== 'content-length') continue
        if (k === 'set-cookie') { res.setHeader(H['set-cookie'], JSON.stringify([].concat(v))); continue }
        if (k === 'location') { res.setHeader(k, where(String(v), c.port, c.root)); continue }
        res.setHeader(k, v)
      }
      r.pipe(res)
    })
    up.on('error', (e) => json(res, 502, { error: `Nothing answered on port ${c.port} on ${thisName()} (${e.code || e.message}). Is the app still running there?`, code: 'down' }))
    up.on('timeout', () => up.destroy(new Error('it took too long')))
    res.on('close', () => { if (!res.writableFinished) up.destroy() })
    req.pipe(up)
  }
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false })
  async function upgrade(req, socket, head) {
    const c = await check(req, req.url)
    if (c.error) { socket.write(`HTTP/1.1 ${c.status} ${c.status === 404 ? 'Not Found' : 'Forbidden'}\r\n\r\n`); return socket.destroy() }
    const proto = new URL(req.url, 'http://x').searchParams.get(PROTO)
    const ws = new WebSocket(`ws://localhost:${c.port}${c.path}`, proto ? proto.split(',').map((x) => x.trim()).filter(Boolean) : [], { headers: { origin: `http://localhost:${c.port}` }, autoSelectFamily: true, handshakeTimeout: 15000 })
    const early = []
    let client = null
    ws.on('open', () => wss.handleUpgrade(req, socket, head, (cl) => {
      client = cl
      for (const [d, b] of early.splice(0)) cl.send(d, { binary: b })
      cl.on('message', (d, b) => { if (ws.readyState === 1) ws.send(d, { binary: b }) })
      cl.on('close', (code, why) => { try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, String(why || '')) } catch { /* closed */ } })
      cl.on('error', () => {})
    }))
    ws.on('message', (d, b) => { if (client?.readyState === 1) client.send(d, { binary: b }); else early.push([d, b]) })
    ws.on('close', (code, why) => { try { client?.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, String(why || '')) } catch { /* closed */ } })
    ws.on('error', () => { if (!client) { socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); socket.destroy() } })
  }
  const isPath = (u) => PREVIEW.test(String(u || '').split('?')[0])
  // For the computer showing it, before it opens an address: may it, and if not, why.
  async function may(req, port) {
    const c = await check(req, `/_preview/${Number(port) || 0}/`)
    return c.error ? { ok: false, error: c.error, ...(c.trial ? { trial: c.trial } : {}), ...(c.code ? { code: c.code } : {}) } : { ok: true }
  }
  return { http: httpHandler, upgrade, isPath, may }
}

// ---------- the computer showing it ----------
// machines: exchange(id, …) and socketOn(id, u, handlers) (machines.js). linked(): your computers linked
// here. A port for each (computer, app) shown here, opened when it's asked for and closed after it's
// gone unused for a while, or once that computer is unlinked.
const IDLE_MS = 30 * 60000
const BODY_MAX = 50 * 1024 * 1024
export function ports({ machines, linked }) {
  const open = new Map() // `${id}:${rport}` -> { server, port, id, rport, last }
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, handleProtocols: (ps) => ps.values().next().value || false })
  const ownHost = (req, p) => { const h = String(req.headers.host || '').toLowerCase(); return h === `127.0.0.1:${p}` || h === `localhost:${p}` }

  const headersFor = (req, p) => {
    const h = []
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && !k.startsWith('x-bridge-') && !k.startsWith('sec-') && !k.startsWith('proxy-')) h.push([k, Array.isArray(v) ? v.join(', ') : String(v)])
    // Its cookies, never Bridge AI's own (a browser sends every cookie for 127.0.0.1 to every port).
    const cookie = String(req.headers.cookie || '').split(';').map((x) => x.trim()).filter((x) => x && !/^bridge-ai-\d+=/.test(x)).join('; ')
    if (cookie) h.push([H.cookie, cookie])
    if (req.headers.authorization) h.push([H.authorization, String(req.headers.authorization)])
    const o = req.headers.origin
    if (o) h.push([H.origin, o === `http://127.0.0.1:${p}` || o === `http://localhost:${p}` ? 'self' : String(o)])
    h.push([H.root, '1'])
    return h
  }
  const readBody = (req) => new Promise((resolve, reject) => {
    const parts = []
    let n = 0
    req.on('data', (c) => { n += c.length; if (n > BODY_MAX) { reject(new Error('That\'s more than a preview sends at once (50 MB)')); req.destroy() } else parts.push(c) })
    req.on('end', () => resolve(parts.length ? Buffer.concat(parts) : null))
    req.on('error', reject)
  })

  function handler(entry) {
    return async (req, res) => {
      entry.last = Date.now()
      if (!ownHost(req, entry.port)) return json(res, 403, { error: 'Host not allowed' })
      let body = null
      try { body = ['GET', 'HEAD'].includes(req.method) ? null : await readBody(req) } catch (e) { return json(res, 413, { error: e.message }) }
      let r
      try {
        r = await machines.exchange(entry.id, { method: req.method, u: `/_preview/${entry.rport}${req.url}`, headers: headersFor(req, entry.port), body, ms: 30000 })
      } catch (e) {
        const accept = String(req.headers.accept || '')
        if (/text\/html/.test(accept) && req.method === 'GET') { res.statusCode = 503; res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('refresh', '5'); return res.end(`<!doctype html><meta charset="utf-8"><title>Not reachable</title><body style="font:15px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0"><p>${String(e.message).replace(/[<&>]/g, '')}<br><small>Trying again every few seconds.</small></p></body>`) }
        return json(res, 503, { error: e.message })
      }
      res.statusCode = r.status
      for (const [k, v] of r.headers || []) {
        const key = k.toLowerCase()
        if (key === H['set-cookie']) {
          let list = []
          try { list = JSON.parse(v) } catch { /* not a list */ }
          res.setHeader('set-cookie', (Array.isArray(list) ? list : []).map((c) => String(c).split(';').filter((x) => !/^\s*domain=/i.test(x)).join(';')))
          continue
        }
        if (HOP.has(key) && key !== 'content-length') continue
        if (key.startsWith('x-bridge-')) continue
        res.appendHeader?.(k, v) ?? res.setHeader(k, v)
      }
      res.on('close', () => { if (!res.writableFinished) r.cancel() })
      try {
        for (let c = await r.next(); c; c = await r.next()) {
          if (!res.write(c)) await new Promise((ok) => res.once('drain', ok))
          r.took(c.byteLength)
        }
        res.end()
      } catch { res.destroy() }
    }
  }
  function upgrader(entry) {
    return (req, socket, head) => {
      entry.last = Date.now()
      if (!ownHost(req, entry.port)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy() }
      const proto = String(req.headers['sec-websocket-protocol'] || '')
      const sep = req.url.includes('?') ? '&' : '?'
      const u = `/_preview/${entry.rport}${req.url}${proto ? `${sep}${PROTO}=${encodeURIComponent(proto)}` : ''}`
      wss.handleUpgrade(req, socket, head, (client) => {
        let remote = null
        let ready = false
        const early = []
        client.on('error', () => {})
        machines.socketOn(entry.id, u, {
          onOpen: () => { ready = true; for (const [d, b] of early.splice(0)) remote.send(d, b) },
          onMessage: (d, b) => { if (client.readyState === 1) client.send(d, { binary: b }) },
          onClose: (c) => { try { client.close(c?.c >= 1000 && c.c < 5000 && c.c !== 1005 && c.c !== 1006 ? c.c : 1011, String(c?.r || '').slice(0, 120)) } catch { /* closed */ } },
          onError: () => { try { client.close(1011) } catch { /* closed */ } },
        }).then((s) => { remote = s }, (e) => { try { client.close(1011, String(e.message).slice(0, 120)) } catch { /* closed */ } })
        client.on('message', (d, b) => { const buf = Buffer.isBuffer(d) ? d : Buffer.from(d); entry.last = Date.now(); if (ready && remote) remote.send(buf, b); else early.push([buf, b]) })
        client.on('close', (c, why) => remote?.close(c, String(why || '')))
      })
    }
  }

  // The address for that computer's app: opened now when it isn't.
  async function address(id, rport) {
    const key = `${id}:${Number(rport)}`
    let e = open.get(key)
    if (!e) {
      e = { id, rport: Number(rport), port: 0, last: Date.now() }
      e.server = http.createServer(handler(e))
      e.server.on('upgrade', upgrader(e))
      await new Promise((ok, no) => { e.server.once('error', no); e.server.listen(0, '127.0.0.1', () => { e.server.off('error', no); ok() }) })
      e.port = e.server.address().port
      open.set(key, e)
    }
    e.last = Date.now()
    return { port: e.port, url: `http://127.0.0.1:${e.port}/` }
  }
  const closeOne = (key) => { const e = open.get(key); if (!e) return; open.delete(key); e.server.close(); e.server.closeAllConnections?.() }
  // Unused for a while, or that computer unlinked: closed.
  setInterval(() => {
    const ids = new Set(linked().map((m) => m.id))
    for (const [key, e] of open) if (!ids.has(e.id) || Date.now() - e.last > IDLE_MS) closeOne(key)
  }, 60000).unref()
  const portsOpen = () => [...open.values()].map((e) => e.port)
  return { address, portsOpen, close: closeOne }
}
