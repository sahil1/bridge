// Files' talk with a computer (server/explorer.js and the agents' file routes): this window's
// computer at BASE, or another of yours through this one (/m/<id>), so one page can browse them all.
// And what a file is, in words: its kind, its size, when.
import { useEffect, useRef, useState } from 'react'
import { BASE, machineId } from '../../api.js'
import { locale, t, tx } from '../../i18n/index.js'

export const enc = encodeURIComponent

// Where a computer's requests go. null: the computer this window shows. 'host': the one this page
// comes from, while the window shows another. Anything else: another of your devices, by its id.
export const baseOf = (machine) => (!machine ? BASE : machine === 'host' ? '' : `/m/${machine}`)

// A GET's JSON, or an error saying why (its code: waiting, EPERM, notAsked, trial...).
export async function getJson(base, p, { signal } = {}) {
  const r = await fetch(`${base}/api${p}`, { signal, headers: { 'Content-Type': 'application/json' } })
  const data = await r.json().catch(() => null)
  if (!r.ok || !data) {
    const said = data?.error || (r.status === 404 ? t('That computer\'s Bridge AI doesn\'t have Files yet. Update it there.') : `HTTP ${r.status}`)
    throw Object.assign(new Error(said), { status: r.status, code: data?.code || (data?.trial ? 'trial' : null), data: data || {} })
  }
  return data
}
export async function postJson(base, p, body) {
  const r = await fetch(`${base}/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status, code: data.code || null })
  return data
}
export const rawUrl = (base, root, p, q = '') => `${base}/api/agents/${enc(root)}/raw?path=${enc(p)}${q}`

// A folder's listing, kept up to date while it's on screen. While macOS (or a slow drive) holds the
// read, it says so (waiting) and asks again every couple of seconds; a refusal stays until you act.
export function useFolder(base, root, path, { hidden = false, ver = 0, on = true } = {}) {
  const key = `${base}\n${root}\n${path}\n${hidden}`
  const [st, setSt] = useState({ key, loading: true })
  const was = useRef(key)
  useEffect(() => {
    if (!on || !root) return
    let live = true
    let timer = null
    const ctl = new AbortController()
    if (was.current !== key) { was.current = key; setSt({ key, loading: true }) }
    const since = Date.now()
    const load = async () => {
      try {
        const data = await getJson(base, `/files/list?root=${enc(root)}&path=${enc(path)}${hidden ? '&hidden=1' : ''}`, { signal: ctl.signal })
        if (!live) return
        setSt({ key, data })
        timer = setTimeout(() => { if (!document.hidden) load(); else timer = setTimeout(load, 20000) }, 20000)
      } catch (e) {
        if (!live || e.name === 'AbortError') return
        if (e.code === 'waiting') {
          setSt((s) => ({ ...s, key, loading: true, waiting: Date.now() - since, guard: e.data?.guard || s.guard }))
          timer = setTimeout(load, 1500)
          return
        }
        setSt((s) => ({ key, data: e.status === 404 || e.status === 403 ? null : s.data, error: e.message, code: e.code, status: e.status, guard: e.data?.guard }))
        // Anything but a refusal (a computer out of reach, say) is tried again within a minute.
        if (!['EPERM', 'EACCES', 'notAsked', 'keptOut', 'trial', 'gone', 'outside', 'file'].includes(e.code)) timer = setTimeout(load, 30000)
      }
    }
    load()
    return () => { live = false; ctl.abort(); clearTimeout(timer) }
  }, [key, ver, on]) // eslint-disable-line react-hooks/exhaustive-deps
  return st.key === key ? st : { key, loading: true }
}

// ---------- What a file is ----------
const EXT = (name) => (/\.([^.]+)$/.exec(name)?.[1] || '').toLowerCase()
const KINDS = {
  pdf: [tx('PDF document'), 'doc'], docx: [tx('Word document'), 'doc'], doc: [tx('Word document'), 'doc'], odt: [tx('OpenDocument text'), 'doc'], rtf: [tx('Rich text'), 'doc'], pages: [tx('Pages document'), 'doc'],
  xlsx: [tx('Excel spreadsheet'), 'grid'], xlsm: [tx('Excel spreadsheet'), 'grid'], xls: [tx('Excel spreadsheet'), 'grid'], ods: [tx('OpenDocument spreadsheet'), 'grid'], numbers: [tx('Numbers spreadsheet'), 'grid'], csv: [tx('CSV table'), 'grid'], tsv: [tx('TSV table'), 'grid'],
  pptx: [tx('PowerPoint presentation'), 'layers'], ppt: [tx('PowerPoint presentation'), 'layers'], odp: [tx('OpenDocument presentation'), 'layers'], key: [tx('Keynote presentation'), 'layers'],
  md: [tx('Markdown document'), 'doc'], markdown: [tx('Markdown document'), 'doc'], txt: [tx('Plain text'), 'doc'], log: [tx('Log'), 'doc'],
  html: [tx('Web page'), 'code'], htm: [tx('Web page'), 'code'], json: [tx('JSON'), 'braces'], xml: [tx('XML'), 'code'], yml: [tx('YAML'), 'code'], yaml: [tx('YAML'), 'code'],
  js: [tx('JavaScript'), 'code'], jsx: [tx('JavaScript'), 'code'], mjs: [tx('JavaScript'), 'code'], ts: [tx('TypeScript'), 'code'], tsx: [tx('TypeScript'), 'code'], py: [tx('Python'), 'code'], sh: [tx('Shell script'), 'terminal'], css: [tx('Stylesheet'), 'code'], go: [tx('Go'), 'code'], rs: [tx('Rust'), 'code'], java: [tx('Java'), 'code'], swift: [tx('Swift'), 'code'], c: [tx('C'), 'code'], cpp: [tx('C++'), 'code'], h: [tx('C header'), 'code'],
  png: [tx('PNG image'), 'image'], jpg: [tx('JPEG image'), 'image'], jpeg: [tx('JPEG image'), 'image'], gif: [tx('GIF image'), 'image'], webp: [tx('WebP image'), 'image'], heic: [tx('HEIC image'), 'image'], heif: [tx('HEIC image'), 'image'], svg: [tx('SVG image'), 'image'], tif: [tx('TIFF image'), 'image'], tiff: [tx('TIFF image'), 'image'], bmp: [tx('BMP image'), 'image'], avif: [tx('AVIF image'), 'image'], ico: [tx('Icon'), 'image'],
  mp4: [tx('Video'), 'video'], mov: [tx('Video'), 'video'], m4v: [tx('Video'), 'video'], webm: [tx('Video'), 'video'], mkv: [tx('Video'), 'video'], avi: [tx('Video'), 'video'],
  mp3: [tx('Audio'), 'volume'], m4a: [tx('Audio'), 'volume'], wav: [tx('Audio'), 'volume'], aac: [tx('Audio'), 'volume'], flac: [tx('Audio'), 'volume'], ogg: [tx('Audio'), 'volume'], aif: [tx('Audio'), 'volume'], aiff: [tx('Audio'), 'volume'],
  zip: [tx('ZIP archive'), 'archive'], gz: [tx('Compressed file'), 'archive'], tgz: [tx('Compressed file'), 'archive'], '7z': [tx('Compressed file'), 'archive'], rar: [tx('Compressed file'), 'archive'], dmg: [tx('Disk image'), 'archive'], iso: [tx('Disk image'), 'archive'],
  app: [tx('Application'), 'grid'], exe: [tx('Application'), 'grid'], msi: [tx('Installer'), 'grid'], pkg: [tx('Installer'), 'grid'], epub: [tx('Book'), 'book'],
}
export function kindOf(e) {
  if (e.drive) return [t('Drive'), 'drive']
  if (e.dir) return [t('Folder'), 'folder']
  const x = EXT(e.name)
  const k = KINDS[x]
  if (k) return [t(k[0]), k[1]]
  return [x ? t('{ext} file', { ext: x.toUpperCase() }) : t('Document'), 'file']
}
export const kindName = (e) => kindOf(e)[0]
export const iconOf = (e) => kindOf(e)[1]
export const isPicture = (name) => /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico)$/i.test(name)
export const isPdf = (name) => /\.pdf$/i.test(name)

export const fmtSize = (n) => (n == null ? '' : n >= 1e12 ? `${(n / 1e12).toFixed(1)} TB` : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : t('{n} bytes', { n }))
export function fmtWhen(ms, { long = false } = {}) {
  if (!ms) return ''
  const d = new Date(ms)
  const now = new Date()
  const time = d.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
  if (long) return d.toLocaleString(locale(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ms >= day) return t('Today at {time}', { time })
  if (ms >= day - 86400000) return t('Yesterday at {time}', { time })
  return d.toLocaleDateString(locale(), { year: 'numeric', month: 'short', day: 'numeric' }) + (d.getFullYear() === now.getFullYear() ? `, ${time}` : '')
}

// Sorted as you picked, folders first. by: name, mtime, size or kind.
export function sorted(list, { by = 'name', desc = false } = {}) {
  const name = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  const cmp = {
    name,
    mtime: (a, b) => (a.mtime || 0) - (b.mtime || 0) || name(a, b),
    size: (a, b) => (a.size ?? -1) - (b.size ?? -1) || name(a, b),
    kind: (a, b) => kindName(a).localeCompare(kindName(b)) || name(a, b),
  }[by] || name
  return [...list].sort((a, b) => (b.dir - a.dir) || (desc ? -cmp(a, b) : cmp(a, b)))
}

// The separator a computer's paths use, from one of its paths.
export const sepOf = (full) => (/^[A-Za-z]:\\/.test(full || '') || (String(full).includes('\\') && !String(full).includes('/')) ? '\\' : '/')
export const joinFull = (dir, rel) => { const s = sepOf(dir); return rel ? `${dir.replace(/[\\/]+$/, '')}${s}${rel.split('/').join(s)}` : dir }
export const parentOf = (p) => p.split('/').slice(0, -1).join('/')
export const nameOf = (p) => p.split('/').pop()

// Where you were, per window's computer: kept on this device.
export const WHERE_KEY = `cc-fx-where:${machineId || 'here'}`
