// Files an agent names in its chat (html/roadmap.html, the picture it made): which words are paths,
// where each file is (server/filelinks.js: as written, in its folder, where its conversation
// worked, or by a search below its folder), the pictures shown small under its reply, and in Files,
// what to say when a path isn't there: which one, when several end the same way, or where it looked.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import Lightbox from './Lightbox.jsx'
import { copyText } from '../copy.js'
import { api, BASE, machineId, viaRelay } from '../api.js'
import { locale, t } from '../i18n/index.js'

const enc = encodeURIComponent

// ---------- Which words are paths ----------
// Only things that are clearly paths: a file with an extension, or a folder path anchored at
// / ~/ ./ ../ ("owner/repo" style names stay plain text). A line number after it (app.js:12,
// #L12) is taken off.
const FILE_RE = /^(~\/|\/|\.{1,2}\/)?([\w@.+-]+\/)*[\w@+-][\w@.+-]*\.[A-Za-z][A-Za-z0-9]{0,7}$/
const DIR_RE = /^(~\/|\/|\.{1,2}\/)[\w@.+-]+(\/[\w@.+-]+)*\/?$/
const LINE = /(?::\d+(?::\d+)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$/i
export const lineless = (s) => String(s).replace(LINE, '')
export function looksLikePath(raw) {
  const s = lineless(raw)
  if (s.length > 240 || /\s/.test(s) || /^https?:/.test(s)) return false
  if (/^[\w-]+\.(com|org|io|ai|dev|net|app|co)(\/|$)/i.test(s)) return false // domains
  if (/^v?\d+(\.\d+)+$/.test(s)) return false // versions
  if (/^\/[\w-]+\/?$/.test(s)) return false // slash commands like /cos
  return FILE_RE.test(s) || DIR_RE.test(s)
}
// A Markdown link's target, when it's a file here ([the roadmap](html/roadmap.html)): null for a
// web or mail link.
export function hrefPath(href) {
  if (/^[a-z][a-z+.-]*:/i.test(href) && !/^file:\/\//i.test(href)) return null
  let s = href.replace(/^file:\/\//i, '')
  try { s = decodeURI(s) } catch { /* as written */ }
  return looksLikePath(s) ? s : null
}
// Paths in prose, outside `code`: with a folder in them (html/roadmap.html), or a picture, a page or
// a PDF by its name alone (review-qr.png). Not part of a web address.
export const BARE = /(^|[\s(])((?:~\/|\/|\.{1,2}\/)?(?:[\w@.+-]+\/)+[\w@+-][\w@.+-]*\.[A-Za-z][A-Za-z0-9]{0,7}|[\w@+-][\w@.+-]*\.(?:png|jpe?g|gif|webp|svg|pdf|html?|md))(?=$|[\s),.;:!?])/gi
// Every path a message names, once each, as written: in `code`, a Markdown link's target, or prose.
export function namedPaths(text) {
  const out = []
  const body = String(text || '').replace(/```[\s\S]*?(```|$)/g, ' ')
  for (const m of body.matchAll(/`([^`\n]+)`/g)) if (looksLikePath(m[1])) out.push(m[1])
  for (const m of body.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)) { const h = hrefPath(m[1]); if (h) out.push(h) }
  for (const m of body.replace(/`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)/g, ' ').matchAll(BARE)) if (looksLikePath(m[2])) out.push(m[2])
  return [...new Set(out)]
}

// ---------- Where it is ----------
// The path as Files names it, from what was written: no line number or ./ in front, and relative
// to the agent's folder when it's written from / inside it. A folder ends in /.
export function tabPath(raw, cwd = '') {
  let p = lineless(String(raw).trim().replace(/^file:\/\//i, ''))
  if (cwd && p.startsWith(`${cwd}/`)) p = p.slice(cwd.length + 1)
  return p.replace(/^(\.\/)+/, '') || p
}
// What was found for each path, kept for this page: a picture in Chat, a click on its name and the
// Files tab ask once between them. A path that wasn't found is asked about again after a few
// seconds (the agent may be about to make it).
const asked = new Map() // base + pane + path -> { at, p, none }
export function locateFile(pane, p) {
  const key = `${BASE}\n${pane}\n${p}`
  const was = asked.get(key)
  if (was && Date.now() - was.at < (was.none ? 5000 : 60000)) return was.p
  const x = { at: Date.now(), none: false }
  x.p = api(`/agents/${enc(pane)}/locate?path=${enc(p)}`).then((r) => { x.none = r.found?.length !== 1; return r }, (e) => {
    asked.delete(key)
    // Another computer's Bridge AI from before this: opened as written, as it was then.
    if (e.status === 404) return { path: p, found: [], old: true }
    throw e
  })
  asked.set(key, x)
  if (asked.size > 300) asked.delete(asked.keys().next().value)
  return x.p
}
// Waits up to `ms` for where it is: { found } when that's one file or folder, else null (the Files
// tab says the rest).
export async function quickFind(pane, p, ms = 400) {
  const r = await Promise.race([locateFile(pane, p).catch(() => null), new Promise((ok) => setTimeout(() => ok(null), ms))])
  return r?.found?.length === 1 ? r.found[0] : null
}

const nameOf = (p) => String(p).replace(/\/+$/, '').split('/').pop() || p
const dirOf = (p) => p.split('/').slice(0, -1).join('/')
const fmtSize = (n) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : t('{n} bytes', { n }))
const fmtWhen = (ms) => new Date(ms).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const count = (n) => n.toLocaleString(locale())

// In Files, in place of a file that isn't at the path asked for: looking for it, then the one
// found (opened at once), the ones to pick from, or where it looked and a search for its name.
// onPick(path, dir): open that one instead. onSearch(name): Files' Go to file, with its name in.
export function FindFile({ pane, path: p, folder, onPick, onSearch }) {
  const [st, setSt] = useState({ busy: true })
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let live = true
    setSt({ busy: true })
    locateFile(pane, p).then((r) => { if (live) setSt({ r }) }, (e) => { if (live) setSt({ error: e.message }) })
    return () => { live = false }
  }, [pane, p])
  const r = st.r
  const one = r?.found?.length === 1 ? r.found[0] : null
  useEffect(() => { if (one) onPick(one.path, one.dir) }, [one?.path]) // eslint-disable-line react-hooks/exhaustive-deps
  const name = nameOf(p)
  const copy = async () => { setCopied(await copyText(p)); setTimeout(() => setCopied(false), 1500) }
  if (st.busy || one) return <div className="viewer-empty find-file" role="status"><Icon name="search" size={22} /><p>{t('Looking for {path}…', { path: p })}</p></div>
  if (r?.found?.length > 1) {
    return (
      <div className="find-file pick" role="region" aria-label={t('Files named {name}', { name })}>
        <p className="ff-head"><Icon name="file" size={16} /> {t('{n} files end in {path}. Which one?', { n: r.found.length, path: p })}</p>
        <ul className="ff-list">
          {r.found.map((f) => (
            <li key={f.path}>
              <button type="button" className="ff-row" onClick={() => onPick(f.path, f.dir)} title={f.path}>
                <Icon name={f.dir ? 'folder' : 'file'} size={14} />
                <span className="ff-name">{nameOf(f.path)}</span>
                <span className="ff-dir">{dirOf(f.path) || folder}</span>
                <span className="ff-meta">{[!f.dir && fmtSize(f.size), f.mtime && fmtWhen(f.mtime)].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
        {r.looked?.partial && <p className="muted small">{t('The search stopped after {n} folders, so there may be more.', { n: count(r.looked.folders) })}</p>}
      </div>
    )
  }
  const lk = r?.looked
  return (
    <div className="viewer-empty find-file" role="alert">
      <Icon name="alert" size={22} />
      {r?.outside
        ? <>
            <p className="ff-title">{t('{path} is outside this agent\'s folder', { path: r.outside })}</p>
            <p className="muted small">{t('Files shows what\'s in {folder}, so it doesn\'t open that here.', { folder: lk?.root || folder })}</p>
          </>
        : <>
            <p className="ff-title">{t('Couldn\'t find {path}', { path: p })}</p>
            {st.error && <p className="muted small">{st.error}</p>}
            {lk && (
              <div className="ff-looked small">
                <span>{t('Where it looked:')}</span>
                <ul>
                  <li>{lk.root}</li>
                  {lk.used > 0 && <li>{lk.used === 1 ? t('The folder this conversation worked in') : t('The {n} folders this conversation worked in', { n: count(lk.used) })}</li>}
                  {lk.folders > 0 && <li>{lk.partial ? t('The first {n} folders below it (the search stops there)', { n: count(lk.folders) }) : lk.folders === 1 ? t('Below it') : t('{n} folders below it', { n: count(lk.folders) })}</li>}
                  {lk.skipped?.length > 0 && <li>{t('Not in {names}, which a search leaves alone unless the agent works there', { names: lk.skipped.join(', ') })}</li>}
                </ul>
              </div>
            )}
          </>}
      <div className="ff-acts">
        {!r?.outside && onSearch && <button type="button" className="btn small" onClick={() => onSearch(name)}><Icon name="search" size={12} /> {t('Search for {name}', { name })}</button>}
        <button type="button" className="btn small" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? t('Copied') : t('Copy path')}</button>
      </div>
    </div>
  )
}

// ---------- Pictures in a reply ----------
// Pictures (and a PDF's first page) a reply names, small under it: found as a click on the name
// finds them, once the reply is on screen, and only when that's one file. Not a big one through the
// link to another device or the phone, nor a PDF there (reading one is a lot to send for a picture).
const PIC = /\.(png|jpe?g|gif|webp|svg)$/i
const PDF = /\.pdf$/i
export function ReplyPictures({ text, pane, onOpen }) {
  const names = useMemo(() => namedPaths(text).map((n) => tabPath(n)).filter((n) => PIC.test(n) || PDF.test(n)).slice(0, 6), [text])
  const far = viaRelay || !!machineId
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  const [got, setGot] = useState([])
  const [bad, setBad] = useState(() => new Set())
  const [view, setView] = useState(null)
  const want = names.join('\n')
  useEffect(() => {
    if (!want || seen || !ref.current) return
    if (typeof IntersectionObserver !== 'function') { setSeen(true); return }
    const io = new IntersectionObserver(([x]) => { if (x.isIntersecting) { setSeen(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [want, seen])
  useEffect(() => {
    if (!seen || !want) return
    let live = true
    Promise.all(names.map((n) => locateFile(pane, n).then((r) => (r.found?.length === 1 && !r.found[0].dir ? { ...r.found[0], name: nameOf(n) } : null), () => null))).then((l) => {
      if (!live) return
      const shown = new Set()
      setGot(l.filter((f) => f && !shown.has(f.path) && shown.add(f.path)
        && (PDF.test(f.path) ? !far : (f.size || 0) < (far ? 4e6 : 30e6))))
    })
    return () => { live = false }
  }, [seen, want, pane]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!names.length) return null
  const list = got.filter((f) => !bad.has(f.path))
  const src = (f) => `${BASE}/api/agents/${enc(pane)}/raw?path=${enc(f.path)}&v=${Math.round(f.mtime || 0)}`
  const pics = list.filter((f) => PIC.test(f.path)).map((f) => ({ src: src(f), name: f.name, path: f.path }))
  const failed = (f) => setBad((b) => new Set(b).add(f.path))
  return (
    <div className="reply-pics" ref={ref}>
      {list.map((f) => (PDF.test(f.path)
        ? <button key={f.path} type="button" className="reply-pic pdf" onClick={() => onOpen(f.path)} title={t('{name}: open it in Files', { name: f.path })} aria-label={t('{name}: open it in Files', { name: f.name })}><PdfFirstPage url={src(f)} onFail={() => failed(f)} /></button>
        : <button key={f.path} type="button" className="reply-pic" onClick={() => setView(pics.findIndex((x) => x.path === f.path))} title={t('{name} (click to view)', { name: f.path })}>
            <img src={src(f)} alt={f.name} loading="lazy" decoding="async" draggable={false} onError={() => failed(f)} />
          </button>))}
      {view != null && pics[view] && <Lightbox pics={pics} at={view} onAt={setView} onClose={() => setView(null)} onOpen={(x) => { setView(null); onOpen(x.path) }} openLabel={t('Open in Files')} />}
    </div>
  )
}

// A PDF's first page, read in parts (the file route answers Range), two at a time.
let pdfBusy = 0
const pdfWaiting = []
function PdfFirstPage({ url, onFail }) {
  const ref = useRef(null)
  useEffect(() => {
    let live = true
    let task = null
    ;(async () => {
      if (pdfBusy >= 2) await new Promise((r) => pdfWaiting.push(r))
      pdfBusy++
      try {
        if (!live) return
        const { loadPdfjs, openPdfAt } = await import('./studio/pdf/pdfjs.js')
        const { lib } = await loadPdfjs()
        task = openPdfAt(lib, url)
        const page = await (await task.promise).getPage(1)
        const v1 = page.getViewport({ scale: 1 })
        const vp = page.getViewport({ scale: Math.min(200 / v1.width, 140 / v1.height) * (window.devicePixelRatio || 1) })
        const c = ref.current
        if (!live || !c) return
        c.width = Math.round(vp.width); c.height = Math.round(vp.height)
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
      } catch { if (live) onFail() } finally { task?.destroy?.(); task = null; pdfBusy--; pdfWaiting.shift()?.() }
    })()
    return () => { live = false; task?.destroy?.() }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="reply-pdf" />
}
