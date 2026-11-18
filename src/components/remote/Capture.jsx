// The capture page (?remote=capture): the desktop app opens it in a window that never shows, when one
// of your devices wants to see this screen (desktop/remote.js), and closes it a while after. It
// takes the screen or window asked for and sends it peer-to-peer (WebRTC, with only the offer, the
// answer and the candidates going over the link, through this computer's server), or, when that
// can't be made, as pictures to the server, which passes them on over the link (server/remote.js).
// A device's input over the peer-to-peer channel goes to the server here too, which decides what's
// done with it. ?fake=1 (tests): drawn canvases instead of the screen (three, of different shapes and
// scales), so nothing real is taken. A still of each screen too, when the server asks in a session
// (the viewer's Which screen?).
// Sharp: the screen at its own pixels (shared/remote.js captureSize); peer-to-peer, resolution kept
// over frames when the bandwidth drops, at a bitrate for the size; as pictures, WebP where this page
// can make it, each as good as fits in one message. Another screen in the same session takes the
// place of the first (the viewer picked it), with nothing to connect again.
import { useEffect, useState } from 'react'
import { openSocket } from '../../api.js'
import { packFrame, MAX_FRAME, PICTURE, captureSize, bitrateFor, sdpBitrate } from '../../../shared/remote.js'

const FAKE = new URLSearchParams(location.search).get('fake') === '1'
// The tests' screens: a laptop's own at twice its points (the main one), one beside it at its own
// pixels, and one turned on its side, each drawn on a canvas of its shape.
const FAKE_SOURCES = [
  { id: 'fake-1', name: 'Built-in Retina Display', kind: 'screen', w: 3024, h: 1964, primary: true, scale: 2, bounds: { x: 0, y: 0, width: 1512, height: 982 } },
  { id: 'fake-2', name: 'LG UltraFine', kind: 'screen', w: 2560, h: 1440, scale: 1, bounds: { x: 1512, y: 0, width: 2560, height: 1440 } },
  { id: 'fake-portrait', name: 'Portrait screen', kind: 'screen', w: 1080, h: 1920, scale: 1, bounds: { x: -1080, y: -400, width: 1080, height: 1920 } },
]
// A stand-in screen drawn n times: its colour moves on, with its name in the middle.
const drawFake = (c, source, n) => {
  const g = c.getContext('2d')
  g.fillStyle = `hsl(${(n * 7 + source.w) % 360} 60% 45%)`
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#fff'
  g.font = `${Math.round(Math.min(c.width, c.height) / 12)}px sans-serif`
  g.textAlign = 'center'
  g.fillText(`${source.name} ${n}`, c.width / 2, c.height / 2)
}
const fakeCanvas = (source, most) => {
  const c = document.createElement('canvas')
  const k = Math.min(1, most / Math.max(source.w || 640, source.h || 400))
  c.width = Math.round((source.w || 640) * k)
  c.height = Math.round((source.h || 400) * k)
  return c
}

async function list() {
  if (FAKE) return { sources: FAKE_SOURCES, permission: 'ok' }
  const r = await window.bridgeApp?.remote?.sources?.().catch(() => null)
  return r || { sources: [], permission: null }
}
// A small still of each screen, for the viewer's Which screen? (the server asks only during a
// session): the desktop app's (desktop/remote.js thumbs), or the tests' drawn.
async function thumbs() {
  if (FAKE) return FAKE_SOURCES.map((x) => { const c = fakeCanvas(x, 240); drawFake(c, x, 1); return { id: x.id, data: c.toDataURL('image/jpeg', 0.7) } })
  return (await window.bridgeApp?.remote?.thumbs?.().catch(() => null)) || []
}
// A stream of the source: the desktop app's screen or window (Electron's desktop capture), or the
// tests' canvas, drawn on so something changes.
async function streamOf(source) {
  if (FAKE) {
    const c = fakeCanvas(source, 960)
    let n = 0
    const draw = () => drawFake(c, source, ++n)
    draw()
    const tm = setInterval(draw, 200)
    const s = c.captureStream(10)
    s.getVideoTracks()[0].addEventListener('ended', () => clearInterval(tm))
    s.stopDraw = () => clearInterval(tm)
    return s
  }
  // Its own pixels, its shape kept exactly (a box of another shape would letterbox the picture).
  const size = captureSize(source.w, source.h)
  return navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id, maxWidth: size.w, maxHeight: size.h, maxFrameRate: 30 } } })
}
// Text on a screen: detail over motion.
const forScreen = (stream) => { const v = stream.getVideoTracks()[0]; if (v && 'contentHint' in v) v.contentHint = 'detail'; return v }
// The sender's settings: resolution kept when the bandwidth drops, at most this bitrate.
async function tune(pc, w, h) {
  const sender = pc?.getSenders?.().find((x) => x.track?.kind === 'video')
  if (!sender?.getParameters) return
  try {
    const p = sender.getParameters()
    p.degradationPreference = 'maintain-resolution'
    if (!p.encodings?.length) p.encodings = [{}]
    p.encodings[0].maxBitrate = bitrateFor(w, h)
    p.encodings[0].maxFramerate = 30
    await sender.setParameters(p)
  } catch { /* this browser keeps its own */ }
}
// WebP where this page can make it (sharper than JPEG at the same size), else JPEG.
let webp = null
const pictureType = () => (webp ??= (() => { try { const c = document.createElement('canvas'); c.width = c.height = 2; return c.toDataURL('image/webp').startsWith('data:image/webp') } catch { return false } })()) ? 'image/webp' : 'image/jpeg'


export default function Capture() {
  const [said, setSaid] = useState('')
  useEffect(() => {
    const sessions = new Map() // session -> { stream, pc, dc, video, timer, q, scale }
    // Each start on its way (the screen asked for, not yet taken): stopped meanwhile, it isn't taken.
    const starting = new Map() // session -> a token of that start
    let ws = null
    let closed = false
    const send = (m) => { if (ws?.readyState === 1) ws.send(JSON.stringify(m)) }
    const hello = async (t) => { const r = await list(); send({ t, sources: r.sources, permission: r.permission, p2p: typeof RTCPeerConnection === 'function' }) }
    const stop = (id) => {
      starting.delete(id)
      const s = sessions.get(id)
      if (!s) return
      sessions.delete(id)
      clearTimeout(s.timer)
      try { s.pc?.close() } catch { /* closed */ }
      s.stream?.getTracks().forEach((x) => x.stop())
      s.stream?.stopDraw?.()
      setSaid(sessions.size ? `${sessions.size}` : '')
    }
    // Pictures, a few a second: each as good as fits in one message. Too big, it's made again at a
    // lower quality (then narrower) straight away; well under, the next one is better (then wider).
    const frames = (id, rate) => {
      const s = sessions.get(id)
      if (!s || s.framing) return
      s.framing = true
      const c = document.createElement('canvas')
      const g = c.getContext('2d')
      const type = pictureType()
      const tick = async () => {
        if (!sessions.has(id)) return
        const v = s.video
        if (v.videoWidth) {
          for (let tries = 0; tries < 4; tries++) {
            const w = Math.round(Math.min(v.videoWidth, s.width))
            const h = Math.round(w * v.videoHeight / v.videoWidth)
            if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
            g.imageSmoothingQuality = 'high'
            g.drawImage(v, 0, 0, w, h)
            const blob = await new Promise((ok) => c.toBlob(ok, type, s.q))
            if (!blob || !sessions.has(id)) break
            const bytes = new Uint8Array(await blob.arrayBuffer())
            if (bytes.byteLength > MAX_FRAME) {
              if (s.q > PICTURE.worst) s.q = Math.max(PICTURE.worst, s.q - 0.1)
              else s.width = Math.max(PICTURE.narrowest, Math.round(s.width * 0.82))
              continue
            }
            send({ t: 'frame', session: id })
            if (ws?.readyState === 1) ws.send(packFrame(type, w, h, bytes))
            if (bytes.byteLength < MAX_FRAME * 0.55) {
              if (s.q < PICTURE.best) s.q = Math.min(PICTURE.best, s.q + 0.04)
              else if (s.width < Math.min(PICTURE.widest, v.videoWidth)) s.width = Math.min(PICTURE.widest, Math.round(s.width * 1.12))
            }
            break
          }
        }
        s.timer = setTimeout(tick, 1000 / Math.max(0.5, rate))
      }
      tick()
    }
    const start = async (m) => {
      stop(m.session)
      const token = {}
      starting.set(m.session, token)
      const gone = () => starting.get(m.session) !== token
      let stream
      try { stream = await streamOf(m.source) } catch (e) {
        if (gone()) return
        const r = await list().catch(() => ({}))
        send({ t: 'error', session: m.session, why: r.permission && r.permission !== 'ok' ? 'macOS hasn\'t allowed Bridge AI to record the screen here yet. Allow it at this computer in System Settings › Privacy & Security › Screen & System Audio Recording, then open Bridge AI again.' : `The screen couldn't be shared: ${e.message}` })
        send({ t: 'sources', sources: r.sources || [], permission: r.permission || null, p2p: typeof RTCPeerConnection === 'function' })
        return
      }
      const drop = () => { stream.getTracks().forEach((x) => x.stop()); stream.stopDraw?.() }
      if (gone()) return drop()
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.srcObject = stream
      await video.play().catch(() => {})
      if (gone()) return drop()
      starting.delete(m.session)
      const s = { stream, video, q: PICTURE.quality, width: PICTURE.width, timer: null }
      sessions.set(m.session, s)
      setSaid(String(sessions.size))
      const track = forScreen(stream)
      const set = track?.getSettings?.() || {}
      s.size = { w: set.width || video.videoWidth || 0, h: set.height || video.videoHeight || 0 }
      send({ t: 'started', session: m.session, ...s.size })
      watchEnd(m.session, track)
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
        await tune(pc, s.size.w, s.size.h)
        send({ t: 'offer', session: m.session, sdp: offer.sdp })
      } catch { frames(m.session, m.rate) }
    }
    // The screen's own end (unplugged, taken away): said, and the session stops.
    const watchEnd = (id, track) => track?.addEventListener('ended', () => { const s = sessions.get(id); if (s?.stream?.getVideoTracks()[0] !== track) return; send({ t: 'error', session: id, why: 'The screen stopped being shared here.' }); stop(id) })
    // Another screen picked by the viewer: its stream in place of the last, over the same connection.
    const switchTo = async (m) => {
      const s = sessions.get(m.session)
      if (!s) return
      let stream
      try { stream = await streamOf(m.source) } catch (e) { send({ t: 'error', session: m.session, why: `That screen couldn't be shared: ${e.message}` }); return }
      if (sessions.get(m.session) !== s) { stream.getTracks().forEach((x) => x.stop()); stream.stopDraw?.(); return }
      const old = s.stream
      const track = forScreen(stream)
      s.stream = stream
      s.video.srcObject = stream
      await s.video.play().catch(() => {})
      const set = track?.getSettings?.() || {}
      s.size = { w: set.width || s.video.videoWidth || m.source.w || 0, h: set.height || s.video.videoHeight || m.source.h || 0 }
      s.width = PICTURE.width
      const sender = s.pc?.getSenders?.().find((x) => x.track?.kind === 'video')
      if (sender) { await sender.replaceTrack(track).catch(() => {}); await tune(s.pc, s.size.w, s.size.h) }
      watchEnd(m.session, track)
      old?.getTracks().forEach((x) => x.stop())
      old?.stopDraw?.()
      send({ t: 'started', session: m.session, ...s.size })
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
        else if (m.t === 'thumbs') thumbs().then((list) => send({ t: 'thumbs', session: m.session, list }), () => send({ t: 'thumbs', session: m.session, list: [] }))
        else if (m.t === 'start') start(m).catch(() => {})
        else if (m.t === 'stop') stop(m.session)
        else if (m.t === 'switch' && s) switchTo(m).catch(() => {})
        // Told to start sharp rather than climb from a blur, with a floor that keeps text readable.
        else if (m.t === 'answer' && s?.pc) s.pc.setRemoteDescription({ type: 'answer', sdp: sdpBitrate(m.sdp, { startKbps: Math.min(4000, bitrateFor(s.size?.w, s.size?.h) / 3000), minKbps: 500 }) }).then(() => tune(s.pc, s.size?.w, s.size?.h), () => {})
        else if (m.t === 'ice' && s?.pc) s.pc.addIceCandidate(m.c).catch(() => {})
        else if (m.t === 'fallback' && s) { try { s.pc?.close() } catch { /* closed */ } s.pc = null; frames(m.session, m.rate) }
        else if (m.t === 'smaller' && s) { s.q = Math.max(PICTURE.worst, s.q - 0.1); s.width = Math.max(PICTURE.narrowest, Math.round(s.width * 0.85)) }
      }
      ws.onclose = () => { for (const id of [...sessions.keys()]) stop(id); if (!closed) setTimeout(connect, 2000) }
    }
    connect()
    return () => { closed = true; for (const id of [...sessions.keys()]) stop(id); try { ws?.close() } catch { /* closed */ } }
  }, [])
  return <main className="rs-capture" data-sessions={said}>Bridge AI screen sharing</main>
}
