import { api, BASE } from '../../api.js'

// A Studio file is named as Files names it: root (an agent's pane, or place:<id>) and a path in
// it. In another computer's window, BASE is that computer's, so all of this reaches its files.
export const q = (f) => `root=${encodeURIComponent(f.root)}&path=${encodeURIComponent(f.path)}`
export const rawUrl = (f) => `${BASE}/api/agents/${encodeURIComponent(f.root)}/raw?path=${encodeURIComponent(f.path)}`
export const versionUrl = (f, id) => `${BASE}/api/studio/version?${q(f)}&id=${encodeURIComponent(id)}`

export async function bytesOf(url) {
  const r = await fetch(url, { credentials: 'same-origin' })
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `Couldn't read it (${r.status})`)
  return r.arrayBuffer()
}
export const textOf = (buf) => new TextDecoder().decode(buf)

// Saved as bytes (Word, Excel, PowerPoint) or text, only over the version you loaded (mtime)
// unless force: { mtime, versions } back, or an error with conflict: true.
export async function saveFile(f, data, { mtime, force = false } = {}) {
  const body = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const r = await fetch(`${BASE}/api/studio/file?${q(f)}&mtime=${encodeURIComponent(mtime ?? '')}${force ? '&force=1' : ''}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body, credentials: 'same-origin' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || `Couldn't save it (${r.status})`), { conflict: r.status === 409 })
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
