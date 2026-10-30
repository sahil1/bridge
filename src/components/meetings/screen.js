// Watching a screen while a meeting records: the window where someone shares their slides, or a
// whole screen, picked in the browser's (or macOS's) own picker. Every two seconds a small greyscale
// copy of it goes to changes.js, which says when it shows something new: the next slide, another
// page, but not faces on a call, a cursor or a notification. Then the full picture is kept (the
// server keeps it only if its words are new). Capture keeps one now. glance(): whether to send a
// look at it now, for who's talking on the call (the server keeps its text, not the picture);
// onGlance(blob) sends it.
//
// The two-second tick comes from a worker, which a page in the background still hears on time, and
// frames are taken from the shared screen itself (ImageCapture) rather than from a <video> drawn on
// the page, which a background page stops drawing.
import { BASE } from '../../api.js'
import { judge, blank, W, H } from './changes.js'

const TICK = 'let t = setInterval(() => postMessage(0), 2000); onmessage = () => clearInterval(t)'

// The share, as one picture: largest side at most 1920, JPEG.
async function still(src, w0, h0, max = 1920) {
  const k = Math.min(1, max / Math.max(w0, h0))
  const c = document.createElement('canvas')
  c.width = Math.round(w0 * k)
  c.height = Math.round(h0 * k)
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height)
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86))
}

// stream: from getDisplayMedia. onPicture(blob, kind): 'auto' when it changed, 'screen' for Capture.
export function watch(stream, { onPicture, onEnd, glance, onGlance }) {
  const track = stream.getVideoTracks()[0]
  const grabber = typeof ImageCapture === 'function' ? new ImageCapture(track) : null
  // A screen that doesn't change sends no new frames, and grabFrame waits for one: then the
  // last frame, from a <video> that shows the share.
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  video.play().catch(() => {})
  const grab = () => new Promise((resolve, reject) => {
    let late = false
    const t = setTimeout(() => { late = true; reject(new Error('No new frame')) }, 1500)
    grabber.grabFrame().then((b) => { if (late) b.close?.(); else { clearTimeout(t); resolve(b) } }, (e) => { clearTimeout(t); if (!late) reject(e) })
  })
  const small = document.createElement('canvas')
  small.width = W
  small.height = H
  const sctx = small.getContext('2d', { willReadFrequently: true })
  const changes = judge()
  let busy = false
  let stopped = false

  const frame = async () => {
    if (grabber) { try { const b = await grab(); return { src: b, w: b.width, h: b.height, done: () => b.close?.() } } catch { /* nothing new: what's showing */ } }
    if (!video.videoWidth) throw new Error('Nothing to see yet')
    return { src: video, w: video.videoWidth, h: video.videoHeight, done: () => {} }
  }
  const tiny = (f) => {
    sctx.drawImage(f.src, 0, 0, W, H)
    const d = sctx.getImageData(0, 0, W, H).data
    const g = new Uint8Array(W * H)
    for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10
    return g
  }

  const tick = async () => {
    if (busy || stopped || track.readyState !== 'live') return
    busy = true
    let f = null
    try {
      f = await frame()
      const g = tiny(f)
      if (changes.look(g, Date.now())) await onPicture(await still(f.src, f.w, f.h), 'auto')
      if (onGlance && !blank(g) && glance?.()) onGlance(await still(f.src, f.w, f.h))
    } catch { /* a frame missed: next tick */ } finally { f?.done(); busy = false }
  }
  const ticker = new Worker(URL.createObjectURL(new Blob([TICK], { type: 'text/javascript' })))
  ticker.onmessage = () => { tick() }
  const end = () => {
    if (stopped) return
    stopped = true
    ticker.postMessage('stop')
    ticker.terminate()
    stream.getTracks().forEach((t) => t.stop())
    video.srcObject = null
    onEnd?.()
  }
  track.addEventListener('ended', end)
  return {
    label: track.label || 'Your screen',
    // Capture: keep what's showing now.
    now: async () => {
      if (stopped) throw new Error('Not watching a screen')
      const f = await frame()
      try { changes.byHand(tiny(f)); await onPicture(await still(f.src, f.w, f.h), 'screen') } finally { f.done() }
    },
    stop: end,
  }
}

// A picture for a meeting: of the screen, or pasted or dropped into your notes. t: its time in the
// meeting (the server's time now, when it records, if not given).
export async function sendPicture(id, blob, { kind = 'paste', t, note, source } = {}) {
  const q = new URLSearchParams({ kind })
  if (t != null) q.set('t', String(t))
  if (note) q.set('note', note)
  if (source) q.set('source', source)
  const r = await fetch(`${BASE}/api/meetings/${encodeURIComponent(id)}/captures?${q}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
  return d
}
// A look at the screen while someone on the call talks: { kept, stop } (stop: no more are wanted).
export async function sendGlance(id, blob) {
  const r = await fetch(`${BASE}/api/meetings/${encodeURIComponent(id)}/glances`, { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob })
  return r.ok ? r.json().catch(() => ({})) : {}
}
export const pictureUrl = (id, c) => `${BASE}/api/meetings/${encodeURIComponent(id)}/captures/${encodeURIComponent(c.id)}`
