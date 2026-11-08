// Files' three ways to see a folder, as Finder has them: a list (name, date, size and kind, sorted
// by any of them), icons (with a picture of each picture and PDF, made only once it's on screen),
// and columns (each folder on the way beside the next, a file's preview at the end).
import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { viaRelay } from '../../api.js'
import { t, tx } from '../../i18n/index.js'
import { useFolder, sorted, kindName, iconOf, fmtSize, fmtWhen, rawUrl, isPicture, isPdf, nameOf } from './fsapi.js'

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
const COLS = [['name', tx('Name')], ['mtime', tx('Date Modified')], ['size', tx('Size')], ['kind', tx('Kind')]]
export function ListView({ entries, sel, onSel, onOpen, onMenu, sort, onSort, where = false, label, tap = false }) {
  const list = sorted(entries, sort)
  const head = (by, name) => {
    const on = sort.by === by
    return (
      <button key={by} type="button" role="columnheader" className={`fx-th fx-c-${by} ${on ? 'on' : ''}`} aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}
        onClick={() => onSort(on ? { by, desc: !sort.desc } : { by, desc: by === 'mtime' || by === 'size' })}>
        <span>{t(name)}</span>{on && <Icon name={sort.desc ? 'down' : 'up'} size={10} />}
      </button>
    )
  }
  return (
    <div className={`fx-list ${where ? 'with-where' : ''}`} role="grid" aria-label={label} aria-rowcount={list.length}>
      <div className="fx-tr fx-thead" role="row">
        {COLS.map(([by, name]) => head(by, name))}
        {where && <span className="fx-th fx-c-where" role="columnheader">{t('Where')}</span>}
      </div>
      {list.map((e) => (
        <div key={e.path} role="row" className={`fx-tr fx-row ${sel === e.path ? 'on' : ''} ${e.hidden ? 'hid' : ''}`} {...rowProps(e, { sel, onSel, onOpen, onMenu, tap })}>
          <span className="fx-td fx-c-name" role="gridcell">
            <Icon name={e.dir ? 'folder' : iconOf(e)} size={15} className={e.dir ? 'ico-dir' : 'ico-file'} />
            <span className="fx-name" title={e.name}>{e.name}</span><Marks e={e} />
          </span>
          <span className="fx-td fx-c-mtime muted" role="gridcell">{e.mtime ? fmtWhen(e.mtime) : '--'}</span>
          <span className="fx-td fx-c-size muted" role="gridcell">{e.dir ? '--' : fmtSize(e.size)}</span>
          <span className="fx-td fx-c-kind muted" role="gridcell">{kindName(e)}</span>
          {where && <span className="fx-td fx-c-where muted" role="gridcell" title={e.where}>{e.where || t('This folder')}</span>}
        </div>
      ))}
    </div>
  )
}

// ---------- Icons ----------
export function IconView({ entries, sel, onSel, onOpen, onMenu, sort, base, root, cloud, label, tap = false }) {
  const list = sorted(entries, sort)
  return (
    <div className="fx-icons" role="grid" aria-label={label}>
      {list.map((e) => (
        <div key={e.path} role="gridcell" className={`fx-tile ${sel === e.path ? 'on' : ''} ${e.hidden ? 'hid' : ''}`} {...rowProps(e, { sel, onSel, onOpen, onMenu, tap })} title={e.name}>
          <Thumb base={base} root={root} e={e} cloud={cloud} />
          <span className="fx-tile-name">{e.name}</span>
          <Marks e={e} />
        </div>
      ))}
    </div>
  )
}

// A picture of a picture or a PDF, made once it's on screen (or about to be). Never of a file on a
// cloud drive (reading one would download it), nor of a big picture through the link to another
// device. A PDF's picture is its first page, read in parts (a big PDF isn't read whole for it).
let pdfBusy = 0
const pdfWaiting = []
const pdfTurn = async () => { if (pdfBusy >= 2) await new Promise((r) => pdfWaiting.push(r)); pdfBusy++ }
const pdfDone = () => { pdfBusy--; pdfWaiting.shift()?.() }
export function Thumb({ base, root, e, cloud, big = false }) {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  const [bad, setBad] = useState(false)
  const far = viaRelay || base.startsWith('/m/')
  const pic = !e.dir && !e.pkg && !cloud && !e.offline && isPicture(e.name) && (e.size || 0) < (far ? 4e6 : 30e6)
  const pdf = !e.dir && !cloud && !e.offline && isPdf(e.name)
  const can = (pic || pdf) && !bad
  useEffect(() => {
    if (!can || seen || !ref.current) return
    if (typeof IntersectionObserver !== 'function') { setSeen(true); return }
    const io = new IntersectionObserver(([x]) => { if (x.isIntersecting) { setSeen(true); io.disconnect() } }, { rootMargin: '160px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [can, seen])
  const url = rawUrl(base, root, e.path, `&v=${Math.round(e.mtime || 0)}`)
  return (
    <span ref={ref} className={`fx-thumb ${big ? 'big' : ''} ${can && seen ? 'pic' : ''}`} aria-hidden="true">
      {can && seen && pic && <img src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBad(true)} />}
      {can && seen && pdf && <PdfPage url={url} onFail={() => setBad(true)} />}
      {!(can && seen) && <Icon name={e.drive ? 'drive' : e.dir ? 'folder' : iconOf(e)} size={big ? 56 : 40} className={e.dir ? 'ico-dir' : 'ico-file'} />}
    </span>
  )
}
function PdfPage({ url, onFail }) {
  const ref = useRef(null)
  useEffect(() => {
    let live = true
    let task = null
    ;(async () => {
      await pdfTurn()
      try {
        if (!live) return
        const { loadPdfjs, openPdfAt } = await import('../studio/pdf/pdfjs.js')
        const { lib } = await loadPdfjs()
        task = openPdfAt(lib, url)
        const doc = await task.promise
        const page = await doc.getPage(1)
        const v1 = page.getViewport({ scale: 1 })
        const scale = Math.min(240 / v1.width, 240 / v1.height) * (window.devicePixelRatio || 1)
        const vp = page.getViewport({ scale })
        const c = ref.current
        if (!live || !c) return
        c.width = Math.round(vp.width); c.height = Math.round(vp.height)
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
      } catch { if (live) onFail() } finally { task?.destroy?.(); task = null; pdfDone() }
    })()
    return () => { live = false; task?.destroy?.() }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className="fx-pdf" />
}

// ---------- Columns ----------
// The folders on the way from the root to this one, each a column, the one picked in each lit; a
// file picked shows what it is in a last column. A phone has one column: the list.
export function ColumnView({ base, root, path, rootLabel, hidden, ver, sort, sel, onGo, onSel, onOpen, onMenu, cloud, preview }) {
  const parts = path ? path.split('/') : []
  const dirs = ['', ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))]
  const box = useRef(null)
  // The newest column in view, as Finder scrolls to it.
  useEffect(() => { const el = box.current; if (el) el.scrollLeft = el.scrollWidth }, [path, sel])
  return (
    <div className="fx-columns" ref={box}>
      {dirs.map((d, i) => (
        <Column key={`${d}|${i}`} base={base} root={root} dir={d} name={i ? nameOf(d) : rootLabel} hidden={hidden} ver={ver} sort={sort}
          lit={i < dirs.length - 1 ? dirs[i + 1] : sel} last={i === dirs.length - 1}
          onPick={(e) => { if (e.dir) onGo(e.path); else if (i === dirs.length - 1) onSel(e.path); else { onGo(d, e.path) } }}
          onOpen={onOpen} onMenu={onMenu} onSel={onSel} />
      ))}
      {preview && <div className="fx-col fx-col-preview" aria-label={t('Preview')}>{preview}</div>}
    </div>
  )
}
function Column({ base, root, dir, name, hidden, ver, sort, lit, last, onPick, onOpen, onMenu }) {
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
          <Icon name={e.dir ? 'folder' : iconOf(e)} size={14} className={e.dir ? 'ico-dir' : 'ico-file'} />
          <span className="fx-name">{e.name}</span>
          <Marks e={e} />
          {e.dir && <Icon name="chevron" size={10} className="fx-crow-go" />}
        </div>
      ))}
    </div>
  )
}
