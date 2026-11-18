// The capture page (?remote=capture): the desktop app opens it in a window that never shows, when one
// of your devices wants to see this screen (desktop/remote.js), and closes it a while after. It
// takes the screen or window asked for and sends it peer-to-peer (WebRTC, with only the offer, the
// answer and the candidates going over the link, through this computer's server), or, when that
// can't be made, as pictures to the server, which passes them on over the link (server/remote.js).
// A device's input over the peer-to-peer channel goes to the server here too, which decides what's
// done with it. ?fake=1 (tests): a drawn canvas instead of the screen, so nothing real is taken.
import { useEffect, useState } from 'react'
import { openSocket } from '../../api.js'
import { packFrame, MAX_FRAME } from '../../../shared/remote.js'

const FAKE = new URLSearchParams(location.search).get('fake') === '1'
const FAKE_SOURCES = [{ id: 'fake-1', name: 'Test screen', kind: 'screen', w: 640, h: 400, primary: true, bounds: { x: 0, y: 0, width: 640, height: 400 } }]

async function list() {
  if (FAKE) return { sources: FAKE_SOURCES, permission: 'ok' }
  const r = await window.bridgeApp?.remote?.sources?.().catch(() => null)
  return r || { sources: [], permission: null }
}
// A stream of the source: the desktop app's screen or window (Electron's desktop capture), or the
// tests' canvas, drawn on so something changes.
async function streamOf(source) {
  if (FAKE) {
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 400
    const g = c.getContext('2d')
    let n = 0
    const draw = () => { n++; g.fillStyle = `hsl(${(n * 7) % 360} 60% 45%)`; g.fillRect(0, 0, 640, 400); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText(`Test screen ${n}`, 40, 210) }
    draw()
    const tm = setInterval(draw, 200)
    const s = c.captureStream(10)
    s.getVideoTracks()[0].addEventListener('ended', () => clearInterval(tm))
    s.stopDraw = () => clearInterval(tm)
    return s
  }
  return navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id, maxWidth: 2560, maxHeight: 1600, maxFrameRate: 30 } } })
}

export default function Capture() {
  const [said, setSaid] = useState('')
  useEffect(() => {
    const sessions = new Map() // session -> { stream, pc, dc, video, timer, q, scale }
    let ws = null
    let closed = false
    const send = (m) => { if (ws?.readyState === 1) ws.send(JSON.stringify(m)) }
    const hello = async (t) => { const r = await list(); send({ t, sources: r.sources, permission: r.permission, p2p: typeof RTCPeerConnection === 'function' }) }
    const stop = (id) => {
      const s = sessions.get(id)
      if (!s) return
      sessions.delete(id)
      clearTimeout(s.timer)
      try { s.pc?.close() } catch { /* closed */ }
      s.stream?.getTracks().forEach((x) => x.stop())
      s.stream?.stopDraw?.()
      setSaid(sessions.size ? `${sessions.size}` : '')
    }
    // Pictures, a few a second: each as small as it needs to be to go in one message.
    const frames = (id, rate) => {
      const s = sessions.get(id)
      if (!s || s.framing) return
      s.framing = true
      const c = document.createElement('canvas')
      const tick = async () => {
        if (!sessions.has(id)) return
        const v = s.video
        if (v.videoWidth) {
          const w = Math.round(Math.min(1600, v.videoWidth) * s.scale)
          const h = Math.round(w * v.videoHeight / v.videoWidth)
          c.width = w
          c.height = h
          c.getContext('2d').drawImage(v, 0, 0, w, h)
          const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', s.q))
          if (blob) {
            const bytes = new Uint8Array(await blob.arrayBuffer())
            if (bytes.byteLength > MAX_FRAME) { s.q = Math.max(0.3, s.q - 0.15); if (s.q <= 0.3) s.scale = Math.max(0.4, s.scale - 0.15) } else {
              send({ t: 'frame', session: id })
              if (ws?.readyState === 1) ws.send(packFrame('image/jpeg', w, h, bytes))
              if (bytes.byteLength < MAX_FRAME / 3 && s.q < 0.7) s.q = Math.min(0.7, s.q + 0.05)
            }
          }
        }
        s.timer = setTimeout(tick, 1000 / Math.max(0.5, rate))
      }
      tick()
    }
    const start = async (m) => {
      stop(m.session)
      let stream
      try { stream = await streamOf(m.source) } catch (e) {
        const r = await list().catch(() => ({}))
        send({ t: 'error', session: m.session, why: r.permission && r.permission !== 'ok' ? 'macOS hasn\'t allowed Bridge AI to record the screen here yet. Allow it at this computer in System Settings › Privacy & Security › Screen & System Audio Recording, then open Bridge AI again.' : `The screen couldn't be shared: ${e.message}` })
        send({ t: 'sources', sources: r.sources || [], permission: r.permission || null, p2p: typeof RTCPeerConnection === 'function' })
        return
      }
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      await video.play().catch(() => {})
      const s = { stream, video, q: 0.6, scale: 1, timer: null }
      sessions.set(m.session, s)
      setSaid(String(sessions.size))
      const track = stream.getVideoTracks()[0]
      const set = track?.getSettings?.() || {}
      send({ t: 'started', session: m.session, w: set.width || video.videoWidth || 0, h: set.height || video.videoHeight || 0 })
      track?.addEventListener('ended', () => { send({ t: 'error', session: m.session, why: 'The screen stopped being shared here.' }); stop(m.session) })
      if (!m.p2p) return frames(m.session, m.rate)
      try {
        const pc = new RTCPeerConnection({ iceServers: m.p2p.ice || [] })
        s.pc = pc
        stream.getTracks().forEach((x) => pc.addTrack(x, stream))
        const dc = pc.createDataChannel('input', { ordered: true })
        dc.onmessage = (e) => { try { send({ t: 'input', session: m.session, evs: JSON.parse(e.data) }) } catch { /* not that */ } }
        pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'ice', session: m.session, c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }) }
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        send({ t: 'offer', session: m.session, sdp: offer.sdp })
      } catch { frames(m.session, m.rate) }
    }
    const connect = () => {
      if (closed) return
      ws = openSocket('/api/remote/capture')
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => { hello('hello').catch(() => {}) }
      ws.onmessage = async (e) => {
        let m
        try { m = JSON.parse(e.data) } catch { return }
        const s = sessions.get(m.session)
        if (m.t === 'sources?') hello('sources').catch(() => {})
        else if (m.t === 'start') start(m).catch(() => {})
        else if (m.t === 'stop') stop(m.session)
        else if (m.t === 'answer' && s?.pc) s.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(() => {})
        else if (m.t === 'ice' && s?.pc) s.pc.addIceCandidate(m.c).catch(() => {})
        else if (m.t === 'fallback' && s) { try { s.pc?.close() } catch { /* closed */ } s.pc = null; frames(m.session, m.rate) }
        else if (m.t === 'smaller' && s) { s.q = Math.max(0.3, s.q - 0.15); s.scale = Math.max(0.4, s.scale - 0.1) }
      }
      ws.onclose = () => { for (const id of [...sessions.keys()]) stop(id); if (!closed) setTimeout(connect, 2000) }
    }
    connect()
    return () => { closed = true; for (const id of [...sessions.keys()]) stop(id); try { ws?.close() } catch { /* closed */ } }
  }, [])
  return <main className="rs-capture" data-sessions={said}>Bridge AI screen sharing</main>
}
