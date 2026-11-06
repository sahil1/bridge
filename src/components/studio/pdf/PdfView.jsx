import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../../Icon.jsx'
import { usePersisted } from '../../layout.jsx'
import { useTrial } from '../../../trials.js'
import { t, tx } from '../../../i18n/index.js'
import { rawUrl } from '../files.js'
import { withKeys } from '../keys.js'
import { loadPdfjs, openPdf } from './pdfjs.js'
import Marks from './Marks.jsx'
import { useSignSetup } from './Signatures.jsx'
import './pdf.css'

// A PDF, drawn by pdf.js at the screen's own sharpness: its pages in a column, their thumbnails
// beside them, zoom (to the width, the whole page, a percentage; ⌘ and the wheel, or a pinch), find
// in its text with every match marked, the page you're on and a way to any other, and its text
// to select and copy (or to Ask an agent about). Links in it open in a tab of their own. Read
// only: Studio doesn't change a PDF. With Signature Assist on (a beta feature), Sign explains it
// and signs a copy (SignAssist.jsx).
const SignAssist = lazy(() => import('./SignAssist.jsx'))
const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches
const ZOOMS = [['page-width', tx('Fit width')], ['page-fit', tx('Whole page')], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%'], ['3', '300%'], ['4', '400%']]

export default function PdfView({ file, data, onStats, handle, onOpen }) {
  const signOn = useTrial('signature-assist')
  const scroller = useRef(null)
  const inner = useRef(null)
  const pdf = useRef(null) // { lib, V, doc, viewer, bus }
  const [state, setState] = useState({ phase: 'loading' }) // loading | password | ready | error
  const [pages, setPages] = useState(0)
  const [page, setPage] = useState(1)
  const [pageText, setPageText] = useState('1')
  const [zoom, setZoom] = useState({ scale: 1, preset: 'auto' })
  const [phone, setPhone] = useState(narrow)
  // The thumbnails: beside the pages while there's room (as you left them), over them on a phone
  // only when asked.
  const [thumbsWide, setThumbsWide] = usePersisted('cc-pdf-thumbs', true)
  const [thumbsPhone, setThumbsPhone] = useState(false)
  const thumbs = phone ? thumbsPhone : thumbsWide
  const setThumbs = phone ? setThumbsPhone : setThumbsWide
  const [findOpen, setFindOpen] = useState(() => !narrow())
  const [q, setQ] = useState('')
  const [hits, setHits] = useState({ current: 0, total: 0, state: null })
  const findBox = useRef(null)
  const [signing, setSigning] = useState(false)
  const [layout, setLayout] = useState(0) // bumped when pages move: zoom, resize, a new page drawn
  const [marks, setMarks] = useState([])
  const [picked, setPicked] = useState(null)
  const [dateText, setDateText] = useState('')
  const passwordRef = useRef(null)
  const setup = useSignSetup(signing)

  useEffect(() => {
    const m = matchMedia('(max-width: 700px)')
    const on = () => setPhone(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])

  // ---------- Opening it ----------
  useEffect(() => {
    let gone = false
    let task = null
    const ac = new AbortController()
    ;(async () => {
      const { lib, viewer: V } = await loadPdfjs()
      if (gone) return
      task = openPdf(lib, data, { onPassword: (retry, wrong) => { if (!gone) { passwordRef.current = retry; setState({ phase: 'password', wrong }) } } })
      const doc = await task.promise
      if (gone) return
      const bus = new V.EventBus()
      const link = new V.PDFLinkService({ eventBus: bus, externalLinkTarget: V.LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' })
      const finder = new V.PDFFindController({ eventBus: bus, linkService: link })
      const viewer = new V.PDFViewer({
        container: scroller.current, viewer: inner.current, eventBus: bus, linkService: link, findController: finder,
        l10n: new V.GenericL10n(), textLayerMode: 1, annotationMode: lib.AnnotationMode.ENABLE, annotationEditorMode: lib.AnnotationEditorType.DISABLE,
        maxCanvasPixels: narrow() ? 2 ** 24 : 2 ** 25,
      })
      link.setViewer(viewer)
      bus.on('pagesinit', () => { viewer.currentScaleValue = narrow() ? 'page-width' : 'auto'; setLayout((x) => x + 1) })
      bus.on('pagechanging', (e) => { setPage(e.pageNumber); setPageText(String(e.pageNumber)) })
      bus.on('scalechanging', (e) => { setZoom({ scale: e.scale, preset: e.presetValue || null }); setLayout((x) => x + 1) })
      bus.on('pagerendered', () => setLayout((x) => x + 1))
      bus.on('updatefindmatchescount', (e) => setHits((h) => ({ ...h, ...e.matchesCount })))
      bus.on('updatefindcontrolstate', (e) => setHits({ ...e.matchesCount, state: e.state }))
      viewer.setDocument(doc)
      link.setDocument(doc)
      pdf.current = { lib, V, doc, viewer, bus }
      setPages(doc.numPages)
      setState({ phase: 'ready' })
      // A pinch on a touch screen, and ⌘ (Ctrl) with the wheel or a trackpad's pinch, zoom where
      // the fingers or the pointer are.
      const el = scroller.current
      new lib.TouchManager({
        container: el, signal: ac.signal,
        isPinchingDisabled: () => false,
        onPinching: (origin, before, after) => viewer.updateScale({ drawingDelay: 300, scaleFactor: after / before, origin }),
        onPinchEnd: () => setLayout((x) => x + 1),
      })
      el.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return
        e.preventDefault()
        const d = Math.max(-25, Math.min(25, e.deltaY))
        viewer.updateScale({ drawingDelay: 250, scaleFactor: Math.exp(-d / 100), origin: [e.clientX, e.clientY] })
      }, { passive: false, signal: ac.signal })
    })().catch((e) => {
      if (gone) return
      const bad = e?.name === 'InvalidPDFException' || /Invalid PDF/i.test(e?.message || '')
      setState({ phase: 'error', error: bad ? t('This file isn\'t a PDF, or it\'s damaged.') : e?.message || String(e) })
    })
    return () => {
      gone = true
      ac.abort()
      const p = pdf.current
      pdf.current = null
      try { p?.viewer.setDocument(null) } catch { /* gone already */ }
      task?.destroy() // its document and worker with it
    }
  }, [data])

  // The width it fits to follows the pane.
  useEffect(() => {
    const el = scroller.current
    if (!el) return undefined
    const ro = new ResizeObserver(() => {
      const v = pdf.current?.viewer
      if (v && ['auto', 'page-width', 'page-fit'].includes(v.currentScaleValue)) v.currentScaleValue = v.currentScaleValue
      setLayout((x) => x + 1)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => { onStats?.({ text: pages === 1 ? t('1 page') : t('{n} pages', { n: pages }) }) }, [pages, onStats])

  // What you selected, for Ask an agent, with the page it's on.
  handle.current = {
    save: null,
    selection: () => {
      const s = window.getSelection?.()
      const text = String(s || '').trim()
      const at = s?.anchorNode?.parentElement?.closest?.('.page')
      if (!text || !at || !scroller.current?.contains(at)) return null
      return { text, where: t('on page {n}', { n: at.dataset.pageNumber }) }
    },
  }

  // ---------- Moving about ----------
  const go = useCallback((n) => {
    const v = pdf.current?.viewer
    if (!v) return
    const to = Math.max(1, Math.min(v.pagesCount, Math.round(Number(n)) || 1))
    v.currentPageNumber = to
    setPageText(String(to))
  }, [])
  // A box on a page brought into view, a little room above it.
  const show = useCallback((m) => {
    const v = pdf.current?.viewer
    if (!v || !m) return
    v.scrollPageIntoView({ pageNumber: m.page, destArray: [null, { name: 'XYZ' }, null, m.y + m.h + 90, null], allowNegativeOffset: true })
  }, [])
  // Approved, and on to the next place still waiting, as a guided signing does.
  const approve = useCallback((id) => {
    setMarks((ms) => {
      const next = ms.map((x) => (x.id === id ? { ...x, approved: true } : x))
      const at = next.findIndex((x) => x.id === id)
      const after = [...next.slice(at + 1), ...next.slice(0, at)].find((x) => !x.approved)
      if (after) setTimeout(() => { setPicked(after.id); show(after) }, 0)
      return next
    })
  }, [show])
  const setScale = (value) => { const v = pdf.current?.viewer; if (v) v.currentScaleValue = value }
  const step = (dir) => pdf.current?.viewer.updateScale({ steps: dir })

  // ---------- Find ----------
  const find = useCallback((query, { again = false, back = false } = {}) => {
    pdf.current?.bus.dispatch('find', { source: null, type: again ? 'again' : '', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: back, matchDiacritics: false })
  }, [])
  useEffect(() => {
    if (state.phase !== 'ready') return undefined
    if (!q.trim()) { pdf.current?.bus.dispatch('findbarclose', { source: null }); setHits({ current: 0, total: 0, state: null }); return undefined }
    const id = setTimeout(() => find(q), 200)
    return () => clearTimeout(id)
  }, [q, find, state.phase])
  const openFind = useCallback((text) => {
    setFindOpen(true)
    if (text) setQ(text)
    setTimeout(() => { findBox.current?.focus(); findBox.current?.select() }, 0)
  }, [])
  const closeFind = () => { setQ(''); if (phone) setFindOpen(false) }
  // ⌘F and ⌘G here (src/find.js sends them to whatever is marked data-find).
  const root = useRef(null)
  useEffect(() => {
    const el = root.current
    if (!el) return undefined
    const onFind = (e) => openFind(e.detail?.text || '')
    const onStep = (e) => { if (q.trim()) find(q, { again: true, back: e.detail?.dir < 0 }) }
    el.addEventListener('bridge-find', onFind)
    el.addEventListener('bridge-find-step', onStep)
    return () => { el.removeEventListener('bridge-find', onFind); el.removeEventListener('bridge-find-step', onStep) }
  }, [openFind, find, q])
  // A passage the explanation points to: its page, and the words marked there.
  const point = useCallback((n, quote) => {
    if (n) go(n)
    if (quote) { openFind(); setQ(quote.slice(0, 80)) }
  }, [go, openFind])

  const unlock = (e) => {
    e.preventDefault()
    const pw = new FormData(e.currentTarget).get('pw')
    setState({ phase: 'loading' })
    passwordRef.current?.(String(pw || ''))
  }

  const found = !q.trim() ? '' : hits.total ? t('{current} of {total}', { current: hits.current || 1, total: hits.total }) : q.trim() && hits.state === 1 ? t('Not found') : ''
  const zoomValue = ZOOMS.some(([v]) => v === zoom.preset) ? zoom.preset : ZOOMS.some(([v]) => Number(v) === Math.round(zoom.scale * 100) / 100) ? String(Math.round(zoom.scale * 100) / 100) : 'custom'
  const ready = state.phase === 'ready'
  const findRow = (
    <div className="sd-pdf-find" role="search">
      <Icon name="search" size={13} />
      <input ref={findBox} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find in the PDF')} aria-label={t('Find in the PDF')}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); find(q, { again: true, back: e.shiftKey }) } if (e.key === 'Escape') closeFind() }} disabled={!ready} />
      <span className="sd-pdf-hits muted small" aria-live="polite">{found}</span>
      <button type="button" className="sd-tool" onClick={() => find(q, { again: true, back: true })} disabled={!hits.total} title={withKeys(t('Previous match'), 'shift', 'mod', 'g')} aria-label={t('Previous match')}><Icon name="up" size={13} /></button>
      <button type="button" className="sd-tool" onClick={() => find(q, { again: true })} disabled={!hits.total} title={withKeys(t('Next match'), 'mod', 'g')} aria-label={t('Next match')}><Icon name="down" size={13} /></button>
      {phone && <button type="button" className="sd-tool" onClick={closeFind} title={t('Close')} aria-label={t('Close find')}><Icon name="x" size={13} /></button>}
    </div>
  )
  return (
    <div className={`sd-pdf${signing ? ' signing' : ''}${thumbs && !phone ? ' with-thumbs' : ''}${thumbs && phone ? ' thumbs-over' : ''}`} ref={root} data-find="" {...(q ? { 'data-find-open': '' } : {})}>
      <div className="sd-toolbar sd-pdf-bar" role="toolbar" aria-label={t('PDF')}>
        <button type="button" className={`sd-tool${thumbs ? ' on' : ''}`} onClick={() => setThumbs(!thumbs)} aria-pressed={!!thumbs} title={t('Pages: a thumbnail of each')} aria-label={t('Pages')} disabled={!ready}><Icon name="panel-left" size={14} /></button>
        <span className="sd-group sd-pdf-nav">
          <button type="button" className="sd-tool" onClick={() => go(page - 1)} disabled={!ready || page <= 1} title={t('Previous page')} aria-label={t('Previous page')}><Icon name="chevron" size={14} className="flip" /></button>
          <input className="sd-pdf-page" inputMode="numeric" value={pageText} onChange={(e) => setPageText(e.target.value.replace(/\D/g, '').slice(0, 5))} onBlur={() => go(pageText)} onKeyDown={(e) => { if (e.key === 'Enter') go(pageText) }} aria-label={t('Page number')} title={t('Go to a page')} disabled={!ready} />
          <span className="muted small sd-pdf-of">{t('of {n}', { n: pages || '–' })}</span>
          <button type="button" className="sd-tool" onClick={() => go(page + 1)} disabled={!ready || page >= pages} title={t('Next page')} aria-label={t('Next page')}><Icon name="chevron" size={14} /></button>
        </span>
        <span className="sd-group sd-pdf-zoom">
          <button type="button" className="sd-tool" onClick={() => step(-1)} disabled={!ready} title={t('Zoom out')} aria-label={t('Zoom out')}><Icon name="minus" size={14} /></button>
          {!phone && (
            <select className="sd-style sd-pdf-zoomsel" value={zoomValue} onChange={(e) => setScale(e.target.value)} disabled={!ready} aria-label={t('Zoom')} title={t('Zoom')}>
              {zoomValue === 'custom' && <option value="custom">{Math.round(zoom.scale * 100)}%</option>}
              {ZOOMS.map(([v, l]) => <option key={v} value={v}>{/%$/.test(l) ? l : t(l)}</option>)}
            </select>
          )}
          <button type="button" className="sd-tool" onClick={() => step(1)} disabled={!ready} title={t('Zoom in')} aria-label={t('Zoom in')}><Icon name="plus" size={14} /></button>
        </span>
        {!phone && findRow}
        {phone && <button type="button" className={`sd-tool${findOpen ? ' on' : ''}`} onClick={() => (findOpen ? closeFind() : openFind())} aria-pressed={findOpen} title={t('Find in the PDF')} aria-label={t('Find in the PDF')} disabled={!ready}><Icon name="search" size={14} /></button>}
        <span className="sd-grow" />
        {signOn && <button type="button" className={`btn small sd-pdf-sign${signing ? ' on' : ''}`} onClick={() => setSigning(!signing)} aria-pressed={signing} disabled={!ready} title={t('Signature Assist: what you\'re signing, then your signature where it goes, in a signed copy')}><Icon name="signature" size={13} /> <span className="sd-btn-label">{t('Sign')}</span></button>}
        {!phone && <a className="btn small" href={rawUrl(file)} target="_blank" rel="noreferrer" title={t('Open it in a tab of its own, in the browser\'s viewer')} aria-label={t('Open on its own')}><Icon name="external" size={12} /> <span className="sd-btn-label">{t('Open on its own')}</span></a>}
      </div>
      {phone && findOpen && <div className="sd-toolbar sd-pdf-findbar">{findRow}</div>}
      <div className="sd-pdf-body">
        {thumbs && ready && <Thumbs pdf={pdf.current} pages={pages} page={page} onGo={(n) => { go(n); if (phone) setThumbs(false) }} />}
        <div className="sd-pdf-main">
          <div className="sd-pdf-scroll" ref={scroller} tabIndex={-1} onPointerDown={(e) => { if (picked && !e.target.closest?.('.sd-mark')) setPicked(null) }}>
            <div className="pdfViewer" ref={inner} />
            {signing && ready && <Marks pdf={pdf.current} layout={layout} marks={marks} setMarks={setMarks} picked={picked} setPicked={setPicked} onApprove={approve} dateText={dateText} sig={setup.data} />}
          </div>
          {state.phase === 'loading' && <div className="sd-empty sd-loading sd-pdf-cover" role="status"><Icon name="refresh" size={16} className="spin" /><span className="muted">{t('Opening {name}…', { name: file.name })}</span></div>}
          {state.phase === 'error' && (
            <div className="sd-empty sd-pdf-cover" role="alert">
              <Icon name="alert" size={20} />
              <b>{t("Couldn't show this PDF")}</b>
              <span className="muted small">{state.error}</span>
              <span className="sd-empty-acts"><a className="btn small" href={rawUrl(file)} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> {t('Open it on its own')}</a><a className="btn small" href={rawUrl(file)} download={file.name}><Icon name="download" size={12} /> {t('Download')}</a></span>
            </div>
          )}
          {state.phase === 'password' && (
            <form className="sd-empty sd-pdf-cover sd-pdf-pw" onSubmit={unlock}>
              <Icon name="unlock" size={20} />
              <b>{t('This PDF has a password')}</b>
              <span className="muted small">{state.wrong ? t('That password isn\'t right. Try again.') : t('Type it to open the PDF. It isn\'t kept.')}</span>
              <span className="sd-pdf-pw-row"><input name="pw" type="password" autoFocus aria-label={t('Password')} autoComplete="off" /><button type="submit" className="btn small primary">{t('Open')}</button></span>
            </form>
          )}
        </div>
        {signing && ready && (
          <Suspense fallback={<aside className="sd-sign"><p className="muted small sd-loading">{t('Opening…')}</p></aside>}>
            <SignAssist file={file} pdf={pdf.current} setup={setup} marks={marks} setMarks={setMarks} picked={picked} setPicked={setPicked} onApprove={approve} dateText={dateText} setDateText={setDateText}
              onShow={show} onPoint={point} onOpen={onOpen} onClose={() => { setSigning(false); setPicked(null) }} />
          </Suspense>
        )}
      </div>
    </div>
  )
}

// A thumbnail of each page, drawn when it scrolls into view; the one you're on marked.
function Thumbs({ pdf, pages, page, onGo }) {
  const list = useRef(null)
  const drawn = useRef(new Set())
  const nums = useMemo(() => Array.from({ length: pages }, (_, i) => i + 1), [pages])
  useEffect(() => {
    const el = list.current
    if (!el || !pdf) return undefined
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue
        const n = Number(en.target.dataset.n)
        if (drawn.current.has(n)) continue
        drawn.current.add(n)
        const canvas = en.target.querySelector('canvas')
        pdf.doc.getPage(n).then((pg) => {
          const vp = pg.getViewport({ scale: 1 })
          const dpr = window.devicePixelRatio || 1
          const scale = (96 * dpr) / vp.width
          const v = pg.getViewport({ scale })
          canvas.width = Math.round(v.width)
          canvas.height = Math.round(v.height)
          return pg.render({ canvas, viewport: v }).promise
        }).catch(() => drawn.current.delete(n))
      }
    }, { root: el, rootMargin: '200px 0px' })
    for (const b of el.querySelectorAll('[data-n]')) io.observe(b)
    return () => io.disconnect()
  }, [pdf, pages])
  useEffect(() => { list.current?.querySelector(`[data-n="${page}"]`)?.scrollIntoView({ block: 'nearest' }) }, [page])
  // Each the page's own shape, before it's drawn too.
  const [shapes, setShapes] = useState({})
  useEffect(() => {
    let on = true
    if (!pdf) return undefined
    Promise.all(nums.slice(0, 400).map((n) => pdf.doc.getPage(n).then((p) => { const v = p.getViewport({ scale: 1 }); return [n, v.height / v.width] }))).then((r) => on && setShapes(Object.fromEntries(r))).catch(() => {})
    return () => { on = false }
  }, [pdf, nums])
  return (
    <nav className="sd-pdf-thumbs" ref={list} aria-label={t('Pages')}>
      {nums.map((n) => (
        <button key={n} type="button" data-n={n} className={n === page ? 'on' : ''} onClick={() => onGo(n)} aria-current={n === page ? 'page' : undefined} aria-label={t('Page {n}', { n })}>
          <span className="sd-pdf-thumb" style={{ aspectRatio: `1 / ${shapes[n] || 1.294}` }}><canvas /></span>
          <small>{n}</small>
        </button>
      ))}
    </nav>
  )
}
