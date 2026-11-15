// Pictures of a call's window cropped to what's shared in them (crop.js), worked out here, on this
// computer: each picture of the screen as the recording keeps it (cropKept), and the ones a meeting
// kept before, as its page opens (useCropping). The crop goes to the server beside the picture
// (meetings.js cropCapture), which keeps both and uses the crop from then on. A look that finds
// nothing to crop says so there too, so it isn't looked at again. CropButton puts a picture back as
// it was taken, or crops it again.
import { useEffect, useRef } from 'react'
import Icon from '../Icon.jsx'
import { api, BASE, onThisComputer } from '../../api.js'
import { t } from '../../i18n/index.js'
import { analyze, steady, VERSION } from './crop.js'

const at = (id, cid, q = '') => `${BASE}/api/meetings/${encodeURIComponent(id)}/captures/${encodeURIComponent(cid)}${q}`
const canvas = (w, h) => (typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }))
async function pixels(blob) {
  const bm = await createImageBitmap(blob)
  const c = canvas(bm.width, bm.height)
  const x = c.getContext('2d', { willReadFrequently: true })
  x.drawImage(bm, 0, 0)
  return { bm, img: x.getImageData(0, 0, bm.width, bm.height) }
}
async function cutOut(bm, r) {
  const c = canvas(r.x1 - r.x0, r.y1 - r.y0)
  c.getContext('2d').drawImage(bm, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 0, 0, r.x1 - r.x0, r.y1 - r.y0)
  return c.convertToBlob ? c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }) : new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9))
}
// What a look saw, as the server keeps it: enough for steady() to weigh the next pictures by.
const seen = (a) => ({ w: a.w, h: a.h, S: a.S, score: a.score, call: a.call, solid: a.solid, content: a.content, room: a.room, cut: a.cut })
const keyOf = (r) => (r ? `${r.x0},${r.y0},${r.x1},${r.y1}` : 'none')

// Each meeting's pictures so far, weighed together (steady), and what's been sent for each.
const meetings = new Map() // id -> Promise<{ steady, sent }>
function meeting(id, captures) {
  if (!meetings.has(id)) {
    meetings.set(id, (async () => {
      const caps = captures || (await api(`/meetings/${encodeURIComponent(id)}`)).captures || []
      const m = { steady: steady(), sent: new Map() }
      for (const c of caps) {
        if (c.crop?.look) m.steady.add(c.id, c.crop.look)
        if (c.crop) m.sent.set(c.id, keyOf(c.crop.sure === false ? null : c.crop.rect))
      }
      return m
    })().catch((e) => { meetings.delete(id); throw e }))
  }
  return meetings.get(id)
}

// One at a time, here: a look takes a moment of the page's time.
let queue = Promise.resolve()
const busy = new Set() // `${id}/${cid}` looked at, or waiting to be
const later = (fn) => { const p = queue.then(fn); queue = p.catch(() => {}); return p }

// r: where to crop it (null: nothing to crop); why: what the look found; saw: seen() of it. sure:
// false for a crop only offered (a call's window, most likely, but not plainly enough to crop).
async function send(id, cid, r, bm, why, saw = null, sure = true) {
  const q = new URLSearchParams({ v: String(VERSION), why: why.slice(0, 200), look: JSON.stringify(saw), sure: sure ? '1' : '0' })
  if (r) for (const [k, v] of Object.entries({ ...r, w: bm.width, h: bm.height })) q.set(k, String(v))
  const body = r ? await cutOut(bm, r) : undefined
  const res = await fetch(at(id, cid, `/crop?${q}`), { method: 'POST', headers: { 'Content-Type': body ? body.type : 'application/octet-stream' }, body })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
}

// A picture of the screen: worked out, and cropped (or said to need none). Earlier ones of the same
// layout that this one backs up, not cropped yet, are cropped too, from the pictures as taken.
async function look(id, c, blob, captures) {
  const m = await meeting(id, captures)
  let a, bm
  try {
    const px = await pixels(blob)
    bm = px.bm
    a = analyze(px.img, { source: c.source || '' })
  } catch (e) {
    bm?.close?.()
    await send(id, c.id, null, null, `couldn't be read: ${e.message}`)
    m.sent.set(c.id, 'none')
    return
  }
  const now = m.steady.add(c.id, seen(a))
  const mine = now.get(c.id) || null
  // Not sure, but it looks like a call: its crop offered, not used.
  const offer = !mine && a.call && a.solid && a.cut ? a.cut : null
  try { await send(id, c.id, mine || offer, bm, a.why.join(', '), seen(a), !!mine) } finally { bm.close?.() }
  m.sent.set(c.id, keyOf(mine))
  for (const [cid, r] of now) {
    if (cid === c.id || !r || (m.sent.get(cid) || 'none') !== 'none') continue
    const res = await fetch(at(id, cid, '?whole=1'))
    if (!res.ok) continue
    const px = await pixels(await res.blob())
    try { await send(id, cid, r, px.bm, 'the same call as the pictures after it') } finally { px.bm.close?.() }
    m.sent.set(cid, keyOf(r))
  }
}

// The recording kept a picture of the screen (c, as the server said; blob, the picture).
export function cropKept(id, c, blob) {
  if (!c?.id || c.kind === 'paste' || typeof createImageBitmap !== 'function') return
  const k = `${id}/${c.id}`
  if (busy.has(k)) return
  busy.add(k)
  later(() => look(id, c, blob)).catch(() => {})
}

// A meeting's page, on this computer: its pictures of the screen not looked at yet, each looked at
// (the oldest first, so the steady crop builds as it would have while it recorded). onChange: when
// one is done.
export function useCropping(id, data, onChange) {
  const changed = useRef(onChange)
  changed.current = onChange
  const caps = data?.captures
  const todo = (caps || []).filter((c) => c.kind !== 'paste' && !c.crop && !busy.has(`${id}/${c.id}`)).map((c) => c.id).join(' ')
  useEffect(() => {
    if (!todo || !onThisComputer() || typeof createImageBitmap !== 'function') return
    for (const cid of todo.split(' ')) {
      const c = caps.find((x) => x.id === cid)
      busy.add(`${id}/${cid}`)
      later(async () => {
        const res = await fetch(at(id, cid))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        await look(id, c, await res.blob(), caps)
        changed.current?.()
      }).catch(() => {})
    }
  }, [id, todo]) // eslint-disable-line react-hooks/exhaustive-deps
}

// On a picture with a crop: the whole screen as it was taken, or the crop again (or for the first
// time: one only offered, or kept aside with cropping off, says so).
export function CropButton({ id, c, onChange, onError }) {
  if (!c.crop?.file) return null
  const on = c.crop.on !== false && c.file === c.crop.file
  const flip = async () => {
    try { await api(`/meetings/${encodeURIComponent(id)}/captures/${encodeURIComponent(c.id)}`, { method: 'PATCH', body: { crop: !on } }); onChange() } catch (e) { onError(e.message) }
  }
  const title = on ? t("Cropped to what's shared, without the people, the call's buttons and its window. Click for the whole screen as it was taken.")
    : c.crop.sure === false && !c.crop.byHand ? t("Left whole: it looks like a call, but not plainly enough to crop by itself. Crop it to the slide or page, without the people, the call's buttons and its window.")
      : t("Crop it to what's shared: the slide or page, without the people, the call's buttons and its window.")
  return (
    <button type="button" className="ghost-btn mt-pic-crop" data-cropped={on ? 'yes' : 'no'} onClick={flip} title={title}>
      <Icon name={on ? 'maximize' : 'crop'} size={12} /> {on ? t('Whole screen') : t('Crop')}
    </button>
  )
}
