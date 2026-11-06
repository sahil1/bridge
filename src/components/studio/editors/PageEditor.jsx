import { useEffect, useState } from 'react'
import Icon from '../../Icon.jsx'
import { t } from '../../../i18n/index.js'
import { textOf, rawUrl } from '../files.js'

// A page (HTML, the kind of thing Claude makes as an artifact: a dashboard, a prototype, a report),
// its code beside it drawn as it'd be, live as you type. The page runs in a sandbox with its own
// opaque origin: its scripts run, but it can't reach Bridge AI or your files. Code or Page alone,
// for room (on a phone, the page first). onStats: its lines, for the status line.
const phone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches
export default function PageEditor({ file, data, onDirty, onStats, handle, readOnly = false }) {
  const [html, setHtml] = useState(textOf(data))
  const [show, setShow] = useState(() => (phone() ? 'page' : 'both')) // both | code | page
  const [shown, setShown] = useState(html) // what's drawn: the code a moment after typing stops
  useEffect(() => { setHtml(textOf(data)); setShown(textOf(data)) }, [data])
  useEffect(() => { const id = setTimeout(() => setShown(html), 400); return () => clearTimeout(id) }, [html])
  const lines = html.split('\n').length
  useEffect(() => { onStats?.({ text: lines === 1 ? t('1 line') : t('{n} lines', { n: lines }) }) }, [lines, onStats])
  handle.current = {
    save: async () => html,
    selection: () => { const el = document.activeElement; return el?.tagName === 'TEXTAREA' && el.selectionEnd > el.selectionStart ? { text: html.slice(el.selectionStart, el.selectionEnd) } : null },
  }
  const seg = (v, label, icon) => <button type="button" role="tab" aria-selected={show === v} className={show === v ? 'on' : ''} onClick={() => setShow(v)} title={label}><Icon name={icon} size={12} /> <span>{label}</span></button>
  return (
    <div className="sd-page-ed">
      <div className="sd-toolbar" role="toolbar" aria-label={t('Page')}>
        <div className="seg" role="tablist" aria-label={t('Show')}>{seg('both', t('Both'), 'split')}{seg('code', t('Code'), 'code')}{seg('page', t('Page'), 'screen')}</div>
        <span className="sd-grow" />
        <a className="btn small" href={rawUrl(file)} target="_blank" rel="noreferrer" title={t('Open the saved page in a tab of its own')} aria-label={t('Open on its own')}><Icon name="external" size={12} /> <span className="sd-btn-label">{t('Open on its own')}</span></a>
      </div>
      <div className={`sd-page-cols show-${show}`}>
        {show !== 'page' && <textarea className="sd-code" value={html} readOnly={readOnly} spellCheck={false} onChange={(e) => { setHtml(e.target.value); onDirty(true) }} aria-label={t('The page, in HTML')} placeholder={'<!doctype html>'} />}
        {show !== 'code' && <iframe className="sd-page-view" title={file.name} sandbox="allow-scripts allow-forms allow-modals allow-popups" srcDoc={shown} />}
      </div>
    </div>
  )
}

// A PDF: the browser's own viewer, which reads, searches and prints it. A browser that shows a PDF
// only on its own (a phone's, mostly) is told so, with the PDF a tap away, rather than a blank box.
export function PdfView({ file }) {
  const inline = typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false
  return (
    <div className="sd-deck">
      {inline && (
        <div className="sd-toolbar" role="toolbar" aria-label={t('PDF')}>
          <span className="sd-grow" />
          <a className="btn small" href={rawUrl(file)} target="_blank" rel="noreferrer" title={t('Open it in a tab of its own, in the browser\'s viewer')} aria-label={t('Open on its own')}><Icon name="external" size={12} /> <span className="sd-btn-label">{t('Open on its own')}</span></a>
        </div>
      )}
      {inline ? <iframe className="sd-pdf" title={file.name} src={rawUrl(file)} /> : (
        <div className="sd-empty">
          <Icon name="file" size={22} />
          <b>{t('This browser shows a PDF on its own, not inside a page')}</b>
          <span className="muted small">{t('Open it in a tab of its own to read it, or download it.')}</span>
          <span className="sd-empty-acts">
            <a className="btn small primary" href={rawUrl(file)} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> {t('Open it')}</a>
            <a className="btn small" href={rawUrl(file)} download={file.name}><Icon name="download" size={12} /> {t('Download')}</a>
          </span>
        </div>
      )}
    </div>
  )
}
