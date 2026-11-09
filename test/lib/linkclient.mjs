// A phone (or another of your computers) spoken for in Node, through a relay to a Bridge AI, with
// relay/web/link.js as the phone page uses it: for checking what the computer believes of what
// travels in the clear, and that a phone from before (no ABOUT, no seal) still gets in.
//   const c = await linkAs(relayUrl, { code, name, about: { name }, old, hello: { kind: 'computer' } })
//   c.refused: the computer's (or the relay's) refusal, in the clear; else a session:
//   await c.request('GET', '/api/version') -> { status, json, error }
//   await c.next() -> the next sealed record ({ kind, id, body }); c.close()
// code: a pairing code (the first time); hostKey: the computer's key from then (after). about: sent
// sealed first, as a phone does now (old: none, and no seal in the hello, as before).
import WebSocket from 'ws'
import { newKey, phoneHello, phoneFinish, plainFrame, readPlain, splitCode, K, pack, unpack, json, text } from '../../relay/web/link.js'

export async function linkAs(relayUrl, { device = null, code = null, hostKey = null, name = 'Node phone', about = null, old = false, hello = {}, ms = 10000 } = {}) {
  device ||= await newKey(true)
  const ws = new WebSocket(`${relayUrl.replace(/^http/, 'ws')}/_relay/link`)
  const got = []
  let wake = null
  let closed = false
  ws.on('message', (data, bin) => {
    if (!bin) { const s = String(data); if (s[0] === '{') try { const m = JSON.parse(s); if ('host' in m) got.push({ status: m }) } catch { /* not that */ } }
    else got.push({ data: new Uint8Array(data) })
    wake?.()
  })
  ws.on('close', () => { closed = true; wake?.() })
  ws.on('error', () => {})
  // The next binary message (or the relay's word on the computer, with status: true).
  const next = async (wait = ms, status = false) => {
    const until = Date.now() + wait
    for (;;) {
      const i = got.findIndex((x) => (status ? x.status : x.data))
      if (i >= 0) return got.splice(i, 1)[0][status ? 'status' : 'data']
      if (closed) throw new Error('closed')
      const left = until - Date.now()
      if (left <= 0) throw new Error('nothing came')
      await new Promise((r) => { const t = setTimeout(r, left); wake = () => { clearTimeout(t); r() } })
      wake = null
    }
  }
  const st = await next(ms, true)
  if (!st.host) { ws.close(); return { offline: true, device } }
  const pair = code ? splitCode(code) : null
  const state = await phoneHello(device, pair, name)
  if (old) delete state.hello.seal
  Object.assign(state.hello, hello)
  ws.send(plainFrame(state.hello))
  let answer
  try { answer = readPlain(await next()) } catch (e) { ws.close(); return { unanswered: e.message, device } }
  if (answer?.t !== 'welcome') { ws.close(); return { refused: answer, device } }
  const done = await phoneFinish(state, device, answer, { hostKey, pair })
  const session = done.session
  let ids = 1
  const c = {
    device, hostKey: done.hostKey, deviceId: done.deviceId, welcome: answer,
    send: async (kind, id, body) => ws.send(await session.seal(pack(kind, id, body))),
    next: async (wait = ms) => unpack(await session.open(await next(wait))),
    // A request through the link, as the phone page makes one; its answer, or why there was none.
    async request(m, u, body) {
      const id = ids++
      await c.send(K.REQ, id, { m, u, h: [['content-type', 'application/json']], body: !!body })
      if (body) { await c.send(K.BODY, id, new TextEncoder().encode(JSON.stringify(body))); await c.send(K.END, id) }
      let head = null
      let out = ''
      for (;;) {
        const r = await c.next()
        if (r.kind === K.GONE) return { gone: true }
        if (r.id !== id) continue
        if (r.kind === K.HEAD) head = json(r.body)
        else if (r.kind === K.BODY) out += text(r.body)
        else if (r.kind === K.ERR) return { error: text(r.body) }
        else if (r.kind === K.END) { let j = null; try { j = JSON.parse(out) } catch { /* not JSON */ } return { status: head?.s, json: j } }
      }
    },
    close: () => ws.close(),
  }
  if (about) await c.send(K.ABOUT, 0, about)
  return c
}
