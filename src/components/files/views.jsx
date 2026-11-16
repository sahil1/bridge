// Files' three ways to see a folder, as Finder has them: a list (name, date, size and kind, sorted
// by any of them), icons (as big or small as you like, with a picture of each picture and PDF and the
// first page of a document or slide of a deck, made only once it's on screen), and columns (each
// folder on the way beside the next, a file's preview at the end). The list and icons in groups by
// kind when asked (Group by Kind), each under its kind's name.
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { viaRelay } from '../../api.js'
import { t, tx } from '../../i18n/index.js'
import { useFolder, sorted, kindName, fmtSize, fmtWhen, rawUrl, isPicture, isPdf, nameOf } from './fsapi.js'
import { EntryIcon } from './art.jsx'
import { peek, canPeek } from './peek.js'

const noGlyph = () => null

// What a row says beside its name: a folder macOS asks about, a cloud drive's stand-in, a link.
function Marks({ e }) {
  return (
    <>
      {e.offline && <span className="fx-mark" title={t('In the cloud: it downloads when it\'s opened')}><Icon name="cloud" size={11} /></span>}
      {e.link && <span className="fx-mark" title={t('A link to somewhere else')}><Icon name="link" size={11} /></span>}
      {e.guard && !e.asked && <span className="fx-mark" title={t('macOS asks before Bridge AI opens this the first time')}><Icon name="unlock" size={11} /></span>}
    </>
  )
}
// tap: a phone's, where a tap opens it (there's no double-click), and a long press is the menu.
const rowProps = (e, { sel, onSel, onOpen, onMenu, tap }) => ({
  'data-path': e.path, 'data-name': e.name, 'aria-selected': sel === e.path,
  ...(tap ? { onClick: () => onOpen(e) } : { onMouseDown: (ev) => { if (ev.button === 0) onSel(e.path) }, onDoubleClick: () => onOpen(e) }),
  onContextMenu: (ev) => { ev.preventDefault(); ev.stopPropagation(); onSel(e.path); onMenu(e, ev) },
})

// ---------- List ----------
// Date Created is a column while the list is sorted by it (as Finder's columns you add).
const COLS = [['name', tx('Name')], ['mtime', tx('Date Modified')], ['btime', tx('Date Created')], ['size', tx('Size')], ['kind', tx('Kind')]]
// entries: in the order shown; groups: the same in groups by kind ([{ kind, entries }]), or null.
// glyphOf(e): the mark on a folder's icon (art.jsx).
export function ListView({ entries, groups = null, sel, onSel, onOpen, onMenu, sort, onSort, where = false, label, tap = false, glyphOf = noGlyph }) {
  const created = sort.by === 'btime'
  const cols = COLS.filter(([by]) => by !== 'btime' || created)
  const head = (by, name) => {
    const on = sort.by === by
    return (
      <button key={by} type="button" role="columnheader" className={`fx-th fx-c-${by} ${on ? 'on' : ''}`} aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}
        onClick={() => onSort(on ? { by, desc: !sort.desc } : { by, desc: by === 'mtime' || by === 'btime' || by === 'size' })}>
        <span>{t(name)}</span>{on && <Icon name={sort.desc ? 'down' : 'up'} size={10} />}
      </button>
    )
  }
  const row = (e) => (
    <div key={e.path} role="row" className={`fx-tr fx-row ${sel === e.path ? 'on' : ''} ${e.hidden ? 'hid' : ''}`} {...rowProps(e, { sel, onSel, onOpen, onMenu, tap })}>
      <span className="fx-td fx-c-name" role="gridcell">
        <EntryIcon e={e} glyph={glyphOf(e)} size={18} />
        <span className="fx-name" title={e.name}>{e.name}</span><Marks e={e} />
      </span>
      <span className="fx-td fx-c-mtime muted" role="gridcell">{e.mtime ? fmtWhen(e.mtime) : '--'}</span>
      {created && <span className="fx-td fx-c-btime muted" role="gridcell">{e.btime ? fmtWhen(e.btime) : '--'}</span>}
      <span className="fx-td fx-c-size muted" role="gridcell">{e.dir ? '--' : fmtSize(e.size)}</span>
      <span className="fx-td fx-c-kind muted" role="gridcell">{kindName(e)}</span>
      {where && <span className="fx-td fx-c-where muted" role="gridcell" title={e.where}>{e.where || t('This folder')}</span>}
    </div>
  )
  return (
    <div className={`fx-list ${where ? 'with-where' : ''} ${created ? 'with-btime' : ''}`} role="grid" aria-label={label} aria-rowcount={1 + entries.length + (groups?.length || 0)}>
      <div className="fx-tr fx-thead" role="row">
        {cols.map(([by, name]) => head(by, name))}
        {where && <span className="fx-th fx-c-where" role="columnheader">{t('Where')}</span>}
      </div>
      {groups ? groups.map((g) => (
        <div key={g.kind} role="rowgroup" className="fx-rowgroup" aria-label={g.kind}>
          <div role="row" className="fx-tr fx-group"><span role="rowheader" className="fx-group-h">{g.kind}<span className="fx-group-n">{g.entries.length}</span></span></div>
          {g.entries.map(row)}
        </div>
      )) : entries.map(row)}
    </div>
  )
}

// ---------- Icons ----------
// size: the icons' size in pixels (Finder's slider, 32 to 256).
export function IconView({ entries, groups = null, sel, onSel, onOpen, onMenu, base, root, cloud, label, tap = false, size = 64, glyphOf = noGlyph }) {
  const tile = (e) => (
    <div key={e.path} role="option" className={`fx-tile ${sel === e.path ? 'on' : ''} ${e.hidden ? 'hid' : ''}`} {...rowProps(e, { sel, onSel, onOpen, onMenu, tap })} title={e.name}>
      <Thumb base={base} root={root} e={e} cloud={cloud} size={size} glyph={glyphOf(e)} />
      <span className="fx-tile-name">{e.name}</span>
      <Marks e={e} />
    </div>
  )
  return (
    <div className={`fx-icons ${groups ? 'grouped' : ''}`} role="listbox" aria-label={label} style={{ '--fx-icon': `${size}px` }}>
      {groups ? groups.map((g) => (
        <div key={g.kind} role="group" className="fx-icon-group" aria-label={g.kind}>
          <div className="fx-group-h" aria-hidden="true">{g.kind}<span className="fx-group-n">{g.entries.length}</span></div>
          <div className="fx-icon-grid">{g.entries.map(tile)}</div>
        </div>
      )) : <div className="fx-icon-grid">{entries.map(tile)}</div>}
    </div>
  )
}

// A picture of a picture, a PDF or a document, made once it's on screen (or about to be). Never of a
// file on a cloud drive (reading one would download it), nor of a big picture through the link to
// another device. A PDF's picture is its first page, read in parts (a big PDF isn't read whole for
// it); a Word or PowerPoint file's is the picture of itself Office keeps in it, else its first page
// or slide in words, and a Markdown or text file's its first lines (peek.js, read in parts too).
// Otherwise its icon (art.jsx): a folder with its mark (glyph), a page of its kind.
let busy = 0
const waiting = []
const turn = async () => { if (busy >= 2) await new Promise((r) => waiting.push(r)); busy++ }
const done = () => { busy--; waiting.shift()?.() }
export function Thumb({ base, root, e, cloud, size = 64, big = false, glyph = null }) {
  const px = big ? 128 : size
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  const [bad, setBad] = useState(false)
  const [inside, setInside] = useState(null) // what peek.js found: { pic } | { page } | { slide }
  const far = viaRelay || base.startsWith('/m/')
  const away = e.dir || cloud || e.offline
  const pic = !away && !e.pkg && isPicture(e.name) && (e.size || 0) < (far ? 4e6 : 30e6)
  const pdf = !away && isPdf(e.name)
  const doc = !away && !e.pkg && canPeek(e.name)
  const can = (pic || pdf || doc) && !bad
  useEffect(() => {
    if (!can || seen || !ref.current) return
    if (typeof IntersectionObserver !== 'function') { setSeen(true); return }
    const io = new IntersectionObserver(([x]) => { if (x.isIntersecting) { setSeen(true); io.disconnect() } }, { rootMargin: '160px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [can, seen])
  const url = rawUrl(base, root, e.path, `&v=${Math.round(e.mtime || 0)}`)
  useEffect(() => {
    if (!doc || !seen) return
    let live = true
    const ctl = new AbortController()
    turn().then(() => peek(url, e.name, { signal: ctl.signal }))
      .then((v) => { if (live) { if (v) setInside(v); else setBad(true) } }, () => { if (live) setBad(true) })
      .finally(done)
    return () => { live = false; ctl.abort() }
  }, [doc, seen, url]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = can && seen && (pic || pdf || !!inside)
  return (
    <span ref={ref} className={`fx-thumb ${big ? 'big' : ''} ${shown ? 'pic' : ''}`} style={{ '--fx-icon': `${px}px` }} aria-hidden="true">
      {shown && pic && <img src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBad(true)} />}
      {shown && pdf && <PdfPage url={url} onFail={() => setBad(true)} />}
      {shown && inside?.pic && <img src={inside.pic} alt="" decoding="async" draggable={false} onError={() => setBad(true)} />}
      {shown && inside?.page && <span className="fx-sketch fx-sk-page"><span className="fx-sk-in">{inside.page.map((l, i) => <span key={i} className={l.head ? 'h' : ''}>{l.text || ' '}</span>)}</span></span>}
      {shown && inside?.slide && <span className="fx-sketch fx-sk-slide"><span className="fx-sk-in"><b>{inside.slide.title}</b>{inside.slide.lines.map((l, i) => <span key={i}>{l}</span>)}</span></span>}
      {!shown && <EntryIcon e={e} glyph={glyph} size={px} />}
    </span>
  )
}
function PdfPage({ url, onFail }) {
  const ref = useRef(null)
  useEffect(() => {
    let live = true
    let task = null
    ;(async () => {
      await turn()
      try {
        if (!live) return
        const { loadPdfjs, openPdfAt } = await import('../studio/pdf/pdfjs.js')
        const { lib } = await loadPdfjs()
        task = openPdfAt(lib, url)
        const doc = await task.promise
        const page = await doc.getPage(1)
        const v1 = page.getViewport({ scale: 1 })
        // As sharp as the biggest icon.
        const scale = Math.min(256 / v1.width, 256 / v1.height) * (window.devicePixelRatio || 1)
        const vp = page.getViewport({ scale })
        const c = ref.current
        if (!live || !c) return
        c.width = Math.round(vp.width); c.height = Math.round(vp.height)
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
      } catch { if (live) onFail() } finally { task?.destroy?.(); task = null; done() }
    })()
    return () => { live = false; task?.destroy?.() }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="fx-pdf" />
}

// ---------- Columns ----------
// The folders on the way from the root to this one, each a column, the one picked in each lit; a
// file picked shows what it is in a last column. A phone has one column: the list. sortOf(dir): how
// each folder is sorted (its own View Options).
export function ColumnView({ base, root, path, rootLabel, hidden, ver, sortOf, sel, onGo, onSel, onOpen, onMenu, cloud, preview, glyphOf = noGlyph }) {
  const parts = path ? path.split('/') : []
  const dirs = ['', ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))]
  const box = useRef(null)
  // The newest column in view, as Finder scrolls to it.
  useEffect(() => { const el = box.current; if (el) el.scrollLeft = el.scrollWidth }, [path, sel])
  return (
    <div className="fx-columns" ref={box}>
      {dirs.map((d, i) => (
        <Column key={`${d}|${i}`} base={base} root={root} dir={d} name={i ? nameOf(d) : rootLabel} hidden={hidden} ver={ver} sort={sortOf(d)} glyphOf={glyphOf}
          lit={i < dirs.length - 1 ? dirs[i + 1] : sel} last={i === dirs.length - 1}
          onPick={(e) => { if (e.dir) onGo(e.path); else if (i === dirs.length - 1) onSel(e.path); else { onGo(d, e.path) } }}
          onOpen={onOpen} onMenu={onMenu} onSel={onSel} />
      ))}
      {preview && <div className="fx-col fx-col-preview" aria-label={t('Preview')}>{preview}</div>}
    </div>
  )
}
function Column({ base, root, dir, name, hidden, ver, sort, lit, last, onPick, onOpen, onMenu, glyphOf }) {
  const f = useFolder(base, root, dir, { hidden, ver })
  const list = sorted(f.data?.entries || [], sort)
  return (
    <div className={`fx-col ${last ? 'last' : ''}`} role="listbox" aria-label={name}>
      {f.loading && !f.data && <p className="muted small fx-col-note">{f.waiting ? t('Waiting for this folder…') : t('Opening…')}</p>}
      {f.error && <p className="error-text small fx-col-note">{f.error}</p>}
      {f.data && !list.length && <p className="muted small fx-col-note">{t('Nothing here')}</p>}
      {list.map((e) => (
        <div key={e.path} role="option" aria-selected={lit === e.path} className={`fx-crow ${lit === e.path ? 'on' : ''} ${lit === e.path && !last ? 'path' : ''} ${e.hidden ? 'hid' : ''}`}
          data-path={e.path} data-name={e.name}
          onMouseDown={(ev) => { if (ev.button === 0) onPick(e) }} onDoubleClick={() => onOpen(e)}
          onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); onPick(e); onMenu(e, ev) }}>
          <EntryIcon e={e} glyph={glyphOf(e)} size={16} />
          <span className="fx-name">{e.name}</span>
          <Marks e={e} />
          {e.dir && <Icon name="chevron" size={10} className="fx-crow-go" />}
        </div>
      ))}
    </div>
  )
}
