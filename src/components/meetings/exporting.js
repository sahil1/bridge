// Save as Word or PDF: a meeting as one file to share, its pictures in it (the Markdown that Save
// writes keeps them in a folder beside it, which a note sent on its own loses). The server says what
// goes in (meetings.js exportOf: what Save writes as one note with everything, then the transcript);
// the page makes the file, Word with Studio's docx.js and a PDF with docpdf.js, each picture fetched
// and sized to fit the page, and the server keeps it beside the meeting's note, named as the note is.
// Through the relay (a phone) it's downloaded to the phone instead, by the relay's page itself: one
// started inside its frame doesn't happen in Safari, and a download from the computer's address
// would miss the relay's link. The iPhone app takes it from the computer, kept there first, to its
// share sheet (Save to Files); the Android app can't save a file from a page yet, so there it's kept
// on the computer, as from a computer.
import { api, apiUrl, viaRelay, onThisComputer } from '../../api.js'
import { t } from '../../i18n/index.js'

const TYPES = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' }
const iosApp = (() => { try { return window.bridgeNative?.platform === 'ios' && typeof window.bridgeNative.post === 'function' ? window.bridgeNative : null } catch { return null } })()
const androidApp = (() => { try { return typeof window.bridgeAndroid === 'object' && !!window.bridgeAndroid } catch { return false } })()
const tilde = (p) => String(p || '').replace(/^\/Users\/[^/]+/, '~')
const revealLabel = () => (/Mac/.test(navigator.userAgent) ? t('Show in Finder') : /Windows/.test(navigator.userAgent) ? t('Show in Explorer') : t('Show in file manager'))

// A picture in the file: a JPEG (as it is, when it is one) no bigger than 2,000 px a side, shown no
// wider than the page (600 px: A4 less Word's margins) nor taller (860 px).
const MAX = 2000
const dataUrl = (blob) => new Promise((ok, no) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = () => no(f.error); f.readAsDataURL(blob) })
async function decode(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob)
  const img = new Image()
  img.src = URL.createObjectURL(blob)
  try { await img.decode(); return img } finally { URL.revokeObjectURL(img.src) }
}
async function picture(url) {
  const r = await fetch(url, { credentials: 'same-origin' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const blob = await r.blob()
  const img = await decode(blob)
  try {
    const w = img.width, h = img.height
    if (!w || !h) throw new Error('empty')
    const s = Math.min(1, MAX / w, MAX / h)
    let out = blob
    if (!/^image\/jpe?g$/i.test(blob.type) || s < 1) {
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(w * s))
      c.height = Math.max(1, Math.round(h * s))
      const x = c.getContext('2d')
      x.fillStyle = '#fff' // under a picture that's see-through in places
      x.fillRect(0, 0, c.width, c.height)
      x.drawImage(img, 0, 0, c.width, c.height)
      out = await new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('toBlob'))), 'image/jpeg', 0.9))
    }
    const f = Math.min(1, 600 / w, 860 / h)
    return { src: await dataUrl(out), width: Math.round(w * f), height: Math.round(h * f) }
  } finally { img.close?.() }
}

// The meeting as a document (Tiptap JSON, as docx.js and docpdf.js take it): its Markdown as
// Studio's editor reads it, checklists kept, then the transcript, a line each ("[0:12] You: …"),
// and its pictures in it. lost: pictures that couldn't be read, left out.
async function docOf(id, r) {
  const [{ generateJSON }, { default: StarterKit }, { default: ImageNode }, { TaskList, TaskItem }, { Table, TableRow, TableCell, TableHeader }, { marked }, { clean }] = await Promise.all([
    import('@tiptap/core'), import('@tiptap/starter-kit'), import('@tiptap/extension-image'), import('@tiptap/extension-list'), import('@tiptap/extension-table'), import('marked'), import('../../markdown.js'),
  ])
  // "- [ ] Who: what" (the summary's action items) as a checklist, as the editor has them.
  const dom = new DOMParser().parseFromString(marked.parse(r.markdown, { gfm: true }), 'text/html')
  for (const box of dom.querySelectorAll('li > input[type="checkbox"], li > p:first-child > input[type="checkbox"]')) {
    const li = box.closest('li')
    li.setAttribute('data-type', 'taskItem')
    li.setAttribute('data-checked', String(box.checked))
    li.parentElement.setAttribute('data-type', 'taskList')
    box.remove()
  }
  const doc = generateJSON(clean(dom.body.innerHTML), [StarterKit, ImageNode, TaskList, TaskItem, Table, TableRow, TableCell, TableHeader])
  for (const l of r.transcript || []) {
    doc.content.push(l.head != null ? { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: l.head || ' ' }] }
      : { type: 'paragraph', content: [{ type: 'text', text: `[${l.t}] ` }, { type: 'text', text: `${l.who}:`, marks: [{ type: 'bold' }] }, { type: 'text', text: ` ${l.text}` }] })
  }
  const pics = []
  const walk = (n) => { if (n.type === 'image') pics.push(n); for (const k of n.content || []) walk(k) }
  walk(doc)
  let lost = 0
  for (let i = 0; i < pics.length; i += 4) {
    await Promise.all(pics.slice(i, i + 4).map(async (n) => {
      const p = r.pictures?.[String(n.attrs?.src || '').replace(/^<|>$/g, '')]
      try {
        if (!p) throw new Error('not one of the meeting\'s pictures')
        Object.assign(n.attrs, await picture(apiUrl(`/meetings/${encodeURIComponent(id)}/captures/${encodeURIComponent(p.id)}${p.v ? `?v=${p.v}` : ''}`)))
      } catch { n.lost = true; lost++ }
    }))
  }
  const prune = (n) => { if (n.content) n.content = n.content.filter((k) => !k.lost).map(prune); return n }
  return { doc: prune(doc), lost }
}

// To this device, from the relay's page when this is in its frame (see above).
function download(data, name, type) {
  let w = window
  try { if (window.parent !== window && window.parent.document) w = window.parent } catch { /* not the relay's */ }
  const url = w.URL.createObjectURL(new w.Blob([data], { type }))
  const a = w.document.createElement('a')
  a.href = url
  a.download = name
  w.document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => w.URL.revokeObjectURL(url), 60_000)
}
// The iPhone app takes the file from the computer, then shows its share sheet: done, or why not.
function toIphone(url, name) {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let quiet
    const off = () => { clearTimeout(quiet); window.removeEventListener('bridge-save', on) }
    const wait = () => { clearTimeout(quiet); quiet = setTimeout(() => { off(); reject(new Error(t("The iPhone app didn't answer. Update it from the App Store and try again."))) }, 30_000) }
    const on = (e) => {
      const d = e.detail || {}
      if (d.id !== id) return
      if (d.error) { off(); reject(new Error(d.error)) } else if (d.done) { off(); resolve() } else wait()
    }
    window.addEventListener('bridge-save', on)
    wait()
    iosApp.post({ type: 'save', id, url: new URL(url, location.href).href, name })
  })
}

// Make it and keep it: { file } on the computer, or { name, phone } on this phone, with lost
// (pictures left out) and pictured (a PDF's paragraphs in letters its font hasn't, as pictures).
export async function exportMeeting(id, format) {
  const e = encodeURIComponent(id)
  const r = await api(`/meetings/${e}/export`)
  const { doc, lost } = await docOf(id, r)
  let data
  let pictured = 0
  if (format === 'docx') data = await (await import('../studio/docx.js')).docxOf(doc)
  else ({ data, pictured } = await (await import('../studio/docpdf.js')).pdfOf(doc, { title: r.title }))
  const name = `${r.name}.${format}`
  if (viaRelay && !iosApp && !androidApp) { download(data, name, TYPES[format]); return { name, phone: true, lost, pictured } }
  const res = await fetch(apiUrl(`/meetings/${e}/export?format=${format}`), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(out.error || `HTTP ${res.status}`), { saving: true })
  if (viaRelay && iosApp) { await toIphone(apiUrl(`/meetings/${e}/export/${format}`), name); return { name, phone: true, lost, pictured } }
  return { file: out.file, lost, pictured }
}

// Save as Word or PDF from a menu, saying what it's doing, then where it went (with Show in Finder
// when that's this computer) and anything left out; or why it couldn't. say({ text, error, act, busy }).
export async function exportAndSay(m, format, say) {
  const pdf = format === 'pdf'
  say({ text: pdf ? t('Making a PDF of {title}…', { title: m.title }) : t('Making a Word file of {title}…', { title: m.title }), busy: true })
  let r
  try { r = await exportMeeting(m.id, format) } catch (e) {
    say({ error: true, text: e.saving ? (pdf ? t("Couldn't save the PDF: {error}", { error: e.message }) : t("Couldn't save the Word file: {error}", { error: e.message }))
      : pdf ? t("Couldn't make the PDF: {error}", { error: e.message }) : t("Couldn't make the Word file: {error}", { error: e.message }) })
    return
  }
  const lost = r.lost === 1 ? t("A picture couldn't be read, so it isn't in it.") : r.lost ? t("{n} pictures couldn't be read, so they aren't in it.", { n: r.lost }) : ''
  const pictured = r.pictured ? t("Words the PDF's font has no letters for (Chinese, Hindi, emoji…) are in it as pictures of them; a Word file keeps them as text.") : ''
  const done = r.phone ? (iosApp ? t('{name} is ready to save or share.', { name: r.name }) : t('Downloading {name} to this device.', { name: r.name }))
    : androidApp && viaRelay ? t('Saved on your computer to {path}', { path: tilde(r.file) }) : t('Saved to {path}', { path: tilde(r.file) })
  const here = r.file && onThisComputer()
  // What was left out first, then where it is, beside Show in Finder.
  say({ text: [lost, pictured, done].filter(Boolean).join(' '), error: !!r.lost, act: here ? { label: revealLabel(), run: () => api(`/meetings/${encodeURIComponent(m.id)}/reveal`, { method: 'POST', body: { format } }).catch((e) => say({ error: true, text: e.message })) } : null })
}
