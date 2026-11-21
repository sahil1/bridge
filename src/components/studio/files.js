import { api, BASE } from '../../api.js'

// A Studio file is named as Files names it: root (an agent's pane, or place:<id>) and a path in
// it. In another computer's window, BASE is that computer's, so all of this reaches its files.
export const q = (f) => `root=${encodeURIComponent(f.root)}&path=${encodeURIComponent(f.path)}`
export const rawUrl = (f) => `${BASE}/api/agents/${encodeURIComponent(f.root)}/raw?path=${encodeURIComponent(f.path)}`
export const versionUrl = (f, id) => `${BASE}/api/studio/version?${q(f)}&id=${encodeURIComponent(id)}`

export async function bytesOf(url) {
  const r = await fetch(url, { credentials: 'same-origin' })
  if (!r.ok) { const j = await r.json().catch(() => null); throw Object.assign(new Error(j?.error || `Couldn't read it (${r.status})`), { status: r.status, code: j?.code, data: j }) }
  return r.arrayBuffer()
}

// ---------- A big file, in parts ----------
// A big Word, Excel or PowerPoint file (meta.inParts, from /studio/open: server/studioparts.js)
// comes as its XML, with a few bytes naming each picture and other big part in its place (left:
// what's left on its computer, each with its size, and a picture's in px), and each of those comes
// when it's shown: a picture at the width it's drawn at. A big PDF is read by pdf.js in the parts it
// shows (the file route answers a range). Everything else comes whole, as it always has.
const v = (meta) => `&v=${Math.round(meta.mtime || 0)}`
export const partUrl = (f, meta, name, w = 0) => `${BASE}/api/studio/part?${q(f)}&name=${encodeURIComponent(name)}${w ? `&w=${Math.round(w)}` : ''}${v(meta)}`
// The width a picture is asked for at, in the screen's pixels: px wide in a drawing along px wide
// (a slide), drawn at most as wide as the window; or (along 0) px wide on a page, at the screen's
// pixel density. Never wider than the window, nor 3840.
export function shownWidth(px, along = 0) {
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
  const screenPx = Math.min(3840, (typeof window !== 'undefined' ? Math.max(320, window.innerWidth) : 1440) * dpr)
  return Math.max(160, Math.min(screenPx, Math.round(px * (along > 0 ? screenPx / along : dpr))))
}
export function partsOf(f, meta) {
  const left = new Map((meta.left || []).map((x) => [x.name, x]))
  const got = new Map() // name -> its bytes, once asked for whole
  return {
    left,
    has: (name) => left.has(name),
    size: (name) => left.get(name) || null,
    // Where the page shows it from (an <img>'s src), at about w px wide.
    url: (name, w = 0) => partUrl(f, meta, name, w),
    // Its bytes, whole (copying a picture to another deck, a slide as a picture).
    bytes: async (name) => { if (!got.has(name)) got.set(name, bytesOf(partUrl(f, meta, name)).then((b) => new Uint8Array(b))); return got.get(name) },
  }
}
// The slim zip of one in parts (server/studio.js slimFile): of the file as it was opened (mtime), or
// one of its versions (version, its id).
export const slimUrl = (f, { mtime = null, version = null } = {}) => `${BASE}/api/studio/slim?${q(f)}${mtime != null ? `&mtime=${encodeURIComponent(mtime)}` : ''}${version ? `&version=${encodeURIComponent(version)}` : ''}`
// The file as its editor opens it: { data } its bytes (whole, or the slim zip of one in parts,
// with parts its helper above), or { url } for pdf.js to read in parts.
export async function loadFile(f, meta) {
  if (meta.inParts && meta.ext === '.pdf') return { data: null, url: rawUrl(f) }
  if (meta.inParts) return { data: await bytesOf(slimUrl(f, { mtime: meta.mtime })), parts: partsOf(f, meta) }
  return { data: await bytesOf(rawUrl(f)) }
}
export const textOf = (buf) => new TextDecoder().decode(buf)

// Saved as bytes (Word, Excel, PowerPoint) or text, only over the version you loaded (mtime)
// unless force: { mtime, versions } back, or an error with conflict: true. auto: saved as you type
// (its version made one with the last few minutes' others).
// inParts: opened in parts, so the parts it never had are put back from the file (server/studioparts.js).
export async function saveFile(f, data, { mtime, force = false, auto = false, inParts = false } = {}) {
  const body = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const r = await fetch(`${BASE}/api/studio/file?${q(f)}&mtime=${encodeURIComponent(mtime ?? '')}${force ? '&force=1' : ''}${auto ? '&auto=1' : ''}${inParts ? '&parts=1' : ''}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body, credentials: 'same-origin' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || `Couldn't save it (${r.status})`), { conflict: r.status === 409, code: j.code, data: j })
  return j
}
export const openFile = (f, where) => api(`/studio/open?${q(f)}${where ? `&where=${encodeURIComponent(where)}` : ''}`)
export const changedSince = (f, since) => api(`/studio/changed?${q(f)}&since=${encodeURIComponent(since)}`)
export const restoreVersion = (f, id) => api('/studio/restore', { method: 'POST', body: { ...f, id } })

// Bytes as base64, for a new file's first contents.
export function base64(buf) {
  const b = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
export const extOf = (name) => (/\.[^.]+$/.exec(String(name))?.[0] || '').toLowerCase()
