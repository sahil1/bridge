// Remote Screen and Preview (a Beta Feature; server/remote.js): what the viewer's pages share. Another
// computer's screen is seen from here through its link (its own Bridge AI at /m/<id>/ here); a
// session is one WebSocket there, which carries the offer and answer for a peer-to-peer connection,
// or the pictures themselves when that can't be made, and what you press while you control it.
import { useEffect, useState } from 'react'
import { BASE, machineId, viaRelay, openSocketAt } from '../../api.js'
import { P2P_WAIT_MS, INPUT_PER_SECOND, unpackFrame, pointAt } from '../../../shared/remote.js'

// Where a computer's pages are from this page: the one it shows (BASE), or another linked to the
// computer it comes from (/m/<id>). A window showing one computer can't reach another through it
// (server/machinepages.js); a phone can.
export const baseFor = (machine) => (!machine || machine === machineId ? BASE : `/m/${machine}`)
export const canReach = (machine) => viaRelay || !machineId || !machine || machine === machineId
// In the desktop app, a window of its own, sized to that screen on the display it opens on
// (desktop/remote.js view); elsewhere, over the page (App.jsx).
export const viewScreen = (machine, name) => {
  if (window.bridgeApp?.remote?.view) { window.bridgeApp.remote.view({ machine: machine || null, name: name || '' }).catch?.(() => {}); return }
  window.dispatchEvent(new CustomEvent('bridge-view-screen', { detail: { machine: machine || null, name: name || '' } }))
}

// The sessions this page is viewing (ScreenView): the card in this window leaves them out, as it's
// showing them (Here.jsx ScreenLive). Each change said with bridge-viewing.
export const viewing = new Set()
export const setViewing = (id, on) => { if (!id) return; if (on) viewing.add(id); else viewing.delete(id); window.dispatchEvent(new Event('bridge-viewing')) }

// That computer's word on its screen, its control and its sessions (GET /api/remote).
export async function remoteStatus(base, { sources = false } = {}) {
  const res = await fetch(`${base}/api/remote${sources ? '?sources=1' : ''}`, { headers: { Accept: 'application/json' } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(res.status === 404 ? 'update' : data.error || `HTTP ${res.status}`), { status: res.status, data })
  return data
}
export async function remoteDo(base, path, body) {
  const res = await fetch(`${base}/api/remote${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, code: data.code })
  return data
}
// That status, looked at every ms while on.
export function useRemote(base, ms = 3000, on = true) {
  const [st, setSt] = useState({ data: null, error: null })
  useEffect(() => {
    if (!on) return
    let live = true
    const look = () => remoteStatus(base).then((data) => live && setSt({ data, error: null }), (e) => live && setSt((x) => ({ data: x.data, error: e })))
    look()
    const tm = setInterval(() => { if (!document.hidden) look() }, ms)
    const now = () => look()
    window.addEventListener('bridge-remote', now)
    return () => { live = false; clearInterval(tm); window.removeEventListener('bridge-remote', now) }
  }, [base, ms, on])
  return { ...st, refresh: () => window.dispatchEvent(new Event('bridge-remote')) }
}

// ---------- a session ----------
// connect({ base, source, control, slow, fix, on }): the WebSocket, then peer-to-peer when both ends
// can and the network lets them within P2P_WAIT_MS, else pictures over it. A screen's session takes
// what fixes one that can't be shown (fixes=1: server/remote.js screenFor); fix: the one chosen
// before connecting. on: { hello(m), mode(m), track(stream), frame(f), message(m), closed(code,
// reason) }. Returns { input(evs), send(m), ack(), close() }.
export function connect({ base, source, control = false, slow = false, page = null, fix = null, on }) {
  const p2p = typeof RTCPeerConnection === 'function' && !page
  const q = new URLSearchParams({ source, ...(control ? { control: '1' } : {}), ...(p2p ? { p2p: '1' } : {}), ...(slow ? { slow: '1' } : {}), ...(page ? { w: String(page.w), h: String(page.h) } : { fixes: '1', ...(fix ? { fix } : {}) }) })
  const ws = openSocketAt(base, `/api/remote/view?${q}`)
  ws.binaryType = 'arraybuffer'
  let pc = null
  let dc = null
  let timer = null
  let mode = 'connecting'
  let closed = false
  const send = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)) }
  const setMode = (m) => { if (mode === m) return; mode = m; on.mode?.(m) }
  const fallback = () => {
    if (mode === 'relay' || closed) return
    clearTimeout(timer)
    try { pc?.close() } catch { /* closed */ }
    pc = null
    dc = null
    send({ t: 'fallback' })
    setMode('relay')
  }
  const startP2P = (ice) => {
    try { pc = new RTCPeerConnection({ iceServers: ice || [] }) } catch { return fallback() }
    pc.ontrack = (e) => on.track?.(e.streams?.[0] || new MediaStream([e.track]))
    pc.ondatachannel = (e) => { dc = e.channel }
    pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'ice', c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }) }
    pc.onconnectionstatechange = () => {
      if (!pc) return
      if (pc.connectionState === 'connected') { clearTimeout(timer); send({ t: 'p2p', state: 'connected' }); setMode('p2p') } else if (['failed', 'closed'].includes(pc.connectionState) && mode !== 'p2p') fallback()
      else if (pc.connectionState === 'failed' && mode === 'p2p') fallback()
    }
    timer = setTimeout(fallback, P2P_WAIT_MS)
  }
  ws.onmessage = async (e) => {
    if (typeof e.data !== 'string') { const f = unpackFrame(new Uint8Array(e.data)); if (f) on.frame?.(f); return }
    let m
    try { m = JSON.parse(e.data) } catch { return }
    if (m.t === 'hello') { on.hello?.(m); if (m.p2p) startP2P(m.p2p.ice); else setMode('relay'); return }
    if (m.t === 'offer' && pc) {
      try {
        await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp })
        const a = await pc.createAnswer()
        await pc.setLocalDescription(a)
        send({ t: 'answer', sdp: a.sdp })
      } catch { fallback() }
      return
    }
    if (m.t === 'ice' && pc) { pc.addIceCandidate(m.c).catch(() => {}); return }
    on.message?.(m)
  }
  ws.onclose = (e) => { closed = true; clearTimeout(timer); try { pc?.close() } catch { /* closed */ } on.closed?.(e.code, e.reason) }
  // What you press: over the peer-to-peer channel when there is one, else over the link, a few
  // times a second at most, moves in between joined into the last.
  let queue = []
  let flushAt = 0
  let flushTimer = null
  const flush = () => {
    flushTimer = null
    if (!queue.length) return
    const evs = queue
    queue = []
    flushAt = Date.now()
    send({ t: 'input', evs })
  }
  const input = (evs) => {
    if (dc?.readyState === 'open') { dc.send(JSON.stringify(evs)); return }
    for (const ev of evs) {
      const last = queue[queue.length - 1]
      if (ev.t === 'move' && last?.t === 'move') queue[queue.length - 1] = ev
      else queue.push(ev)
    }
    const gap = 1000 / (slow ? INPUT_PER_SECOND.hosted : INPUT_PER_SECOND.own)
    const urgent = evs.some((ev) => ev.t !== 'move')
    if (urgent && Date.now() - flushAt >= gap / 2) { clearTimeout(flushTimer); flush() } else if (!flushTimer) flushTimer = setTimeout(flush, Math.max(0, gap - (Date.now() - flushAt)))
  }
  return {
    input, send,
    ack: () => send({ t: 'ack' }),
    close: () => { closed = true; clearTimeout(timer); clearTimeout(flushTimer); try { pc?.close() } catch { /* closed */ } try { ws.close(1000) } catch { /* closed */ } },
  }
}

// Where on the picture a point of the element showing it falls, from 0 to 1 each way (the picture
// is fitted inside the element, centred; zoomed or at Actual Size, the element is the picture), or
// null when it's outside the picture.
export const pointOn = (el, w, h, clientX, clientY) => (el ? pointAt(el.getBoundingClientRect(), w, h, clientX, clientY) : null)
