// A Share Link's page, spoken for in Node (relay/web/link.js's share links, as relay/web/share.js
// uses them), for what a browser can't show a test: what the computer answers in the clear and
// sealed, a path it's asked for as it's written, and how long it keeps going.
//   const v = await viewAs(link)       link: the share's address with its #s=… (or { at, secret })
//   v.refused / v.offline / v.ended    turned away in the clear, the computer offline, ended (sealed)
//   await v.request('GET', '/.share/about') -> { status, json, text, headers }
//   v.next() -> the next sealed record; v.close()
import WebSocket from 'ws'
import { viewerHello, viewerFinish, plainFrame, readPlain, K, pack, unpack, json, text } from '../../relay/web/link.js'

const loopback = (host, opts, cb) => (opts?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4))
export async function viewAs(link, { ms = 10000, headers = {} } = {}) {
  const u = new URL(link)
  const secret = new URLSearchParams(u.hash.slice(1)).get('s')
  const ws = new WebSocket(`${u.origin.replace(/^http/, 'ws')}/_relay/view`, { headers, ...(/\.localhost$/i.test(u.hostname) ? { lookup: loopback } : {}) })
  const got = []
  let wake = null
  let closed = null
  ws.on('message', (data, bin) => {
    if (!bin) { const s = String(data); if (s[0] === '{') try { got.push({ status: JSON.parse(s) }) } catch { /* not that */ } } else got.push({ data: new Uint8Array(data) })
    wake?.()
  })
  ws.on('close', (code) => { closed = code || 1005; wake?.() })
  ws.on('error', () => {})
  const next = async (wait = ms, status = false) => {
    const until = Date.now() + wait
    for (;;) {
      const i = got.findIndex((x) => (status ? x.status : x.data))
      if (i >= 0) return got.splice(i, 1)[0][status ? 'status' : 'data']
      if (closed) throw Object.assign(new Error('closed'), { code: closed })
      const left = until - Date.now()
      if (left <= 0) throw new Error('nothing came')
      await new Promise((r) => { const t = setTimeout(r, left); wake = () => { clearTimeout(t); r() } })
      wake = null
    }
  }
  const st = await next(ms, true)
  if (st.t === 'limit') { ws.close(); return { limited: st } }
  if (!st.host) { ws.close(); return { offline: st } }
  const state = await viewerHello(secret)
  ws.send(plainFrame(state.hello))
  const answer = readPlain(await next())
  if (answer?.t !== 'welcome') { ws.close(); return { refused: answer } }
  const session = await viewerFinish(state, secret, answer)
  let ids = 1
  const v = {
    ws,
    send: async (kind, id, body) => ws.send(await session.seal(pack(kind, id, body))),
    next: async (wait = ms) => unpack(await session.open(await next(wait))),
    get closed() { return closed },
    // A request, as share.js makes one: its answer whole (or why there was none, or the link's end).
    async request(m, u2, body, h = []) {
      const id = ids++
      const b = body == null ? null : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)
      await v.send(K.REQ, id, { m, u: u2, h: [['content-type', 'application/json'], ...h], body: !!b })
      if (b) { await v.send(K.BODY, id, typeof b === 'string' ? new TextEncoder().encode(b) : b); await v.send(K.END, id) }
      let head = null
      const parts = []
      for (;;) {
        const r = await v.next()
        if (r.kind === K.GONE) { v.ended = json(r.body); return { ended: v.ended } }
        if (r.id !== id) continue
        if (r.kind === K.HEAD) head = json(r.body)
        else if (r.kind === K.BODY) parts.push(Buffer.from(r.body))
        else if (r.kind === K.ERR) return { error: text(r.body) }
        else if (r.kind === K.END) {
          const all = Buffer.concat(parts)
          let j = null
          try { j = JSON.parse(all.toString('utf8')) } catch { /* not JSON */ }
          return { status: head?.s, headers: Object.fromEntries((head?.h || []).map(([k, x]) => [k.toLowerCase(), x])), json: j, text: all.toString('utf8'), bytes: all }
        }
      }
    },
    close: () => ws.close(),
  }
  return v
}
