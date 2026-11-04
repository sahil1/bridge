import { useEffect, useMemo, useRef, useState } from 'react'
import { Marp } from '@marp-team/marp-core'
import Icon from '../../Icon.jsx'
import { api, BASE } from '../../../api.js'
import { t } from '../../../i18n/index.js'
import { textOf, base64 } from '../files.js'
import { pptxOf, slidesOf, deckFromOutline } from '../pptx.js'

// A deck. A Markdown deck (Marp's format, MIT: slides between lines of ---) is written on the left
// and drawn on the right as you type, presented full screen, and exported as a PowerPoint whose
// titles, bullets and notes are text you can edit there, beside the deck in its folder. A
// PowerPoint file is shown as its slides (LibreOffice's PDF where it's installed, else their text)
// and can become a Markdown deck to edit here; Ask an agent changes the PowerPoint itself.
// pack: the design pack the deck uses (colours, fonts), if any.
const marp = new Marp({ html: false, inlineSVG: true, script: false, math: false })

export default function DeckEditor({ file, data, onDirty, handle, readOnly = false, pack = null, onOpen }) {
  if (file.ext === '.pptx') return <Pptx file={file} onOpen={onOpen} />
  return <MarkdownDeck file={file} text={textOf(data)} onDirty={onDirty} handle={handle} readOnly={readOnly} pack={pack} onOpen={onOpen} />
}

// The design pack over Marp's own theme (whose rules are more specific, hence !important).
const css = (pack) => (pack ? `section{${pack.colors?.background ? `background:${pack.colors.background}!important;` : ''}${pack.colors?.text ? `color:${pack.colors.text}!important;` : ''}${pack.fonts?.body ? `font-family:'${pack.fonts.body}',sans-serif!important;` : ''}} section h1,section h2,section h3{${pack.colors?.accent ? `color:${pack.colors.accent}!important;` : ''}${pack.fonts?.heading ? `font-family:'${pack.fonts.heading}',sans-serif!important;` : ''}}` : '')
function frame(html, style, one = null) {
  return `<!doctype html><meta charset="utf-8"><style>${style}
html,body{margin:0;background:#8a8f99}
.marpit{padding:14px 0}
.marpit>svg{display:block;width:calc(100% - 28px);height:auto;margin:0 auto 14px;box-shadow:0 2px 10px rgb(0 0 0/.25);border-radius:4px}
${one != null ? `.marpit{padding:0}.marpit>svg{display:none;width:100vw;height:100vh;margin:0;box-shadow:none;border-radius:0}.marpit>svg:nth-of-type(${one + 1}){display:block}html,body{background:#000}` : ''}
@page{size:1280px 720px;margin:0}@media print{html,body{background:#fff}.marpit{padding:0}.marpit>svg{width:1280px;height:720px;margin:0;box-shadow:none;border-radius:0;page-break-after:always}}
</style>${html}`
}

function MarkdownDeck({ file, text, onDirty, handle, readOnly, pack, onOpen }) {
  const [md, setMd] = useState(text)
  const [present, setPresent] = useState(null) // the slide shown full screen
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const view = useRef(null)
  useEffect(() => { setMd(text) }, [text])
  const out = useMemo(() => { try { return marp.render(md) } catch (e) { return { html: `<p>${String(e.message)}</p>`, css: '', comments: [] } } }, [md])
  const style = `${out.css}${css(pack)}`
  const count = (out.html.match(/<svg data-marpit-svg/g) || []).length
  handle.current = {
    save: async () => md,
    selection: () => { const el = document.activeElement; return el?.tagName === 'TEXTAREA' && el.selectionEnd > el.selectionStart ? { text: md.slice(el.selectionStart, el.selectionEnd), where: t('slide {n}', { n: md.slice(0, el.selectionStart).split(/^---\s*$/m).length - (md.startsWith('---') ? 2 : 0) }) } : null },
  }
  useEffect(() => {
    if (present == null) return
    const key = (e) => {
      if (e.key === 'Escape') setPresent(null)
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) setPresent((n) => Math.min(count - 1, n + 1))
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) setPresent((n) => Math.max(0, n - 1))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [present, count])
  // The PowerPoint, beside the deck: a new file each time (deck.pptx, then deck 2.pptx).
  const toPptx = async () => {
    setBusy('pptx'); setMsg(null)
    try {
      const bytes = await pptxOf(slidesOf(md, out.comments), pack)
      const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
      const name = `${file.name.replace(/(\.deck)?\.(md|markdown)$/i, '')}.pptx`
      const r = await api('/studio/new', { method: 'POST', body: { root: file.root, dir, name, data: base64(bytes) } })
      setMsg({ text: t('Saved as {name}, beside the deck.', { name: r.name }), open: r.path })
    } catch (e) { setMsg({ text: e.message, error: true }) } finally { setBusy(null) }
  }
  const print = () => view.current?.contentWindow?.print()
  return (
    <div className="sd-deck">
      <div className="sd-toolbar" role="toolbar" aria-label={t('Deck')}>
        <span className="muted small">{count === 1 ? t('1 slide') : t('{n} slides', { n: count })}</span>
        <span className="sd-grow" />
        <button type="button" className="btn small" onClick={() => setPresent(0)} disabled={!count}><Icon name="play" size={12} /> {t('Present')}</button>
        <button type="button" className="btn small" onClick={toPptx} disabled={!count || busy === 'pptx'}><Icon name="download" size={12} /> {busy === 'pptx' ? t('Making it…') : t('PowerPoint')}</button>
        <button type="button" className="btn small" onClick={print} disabled={!count}><Icon name="doc" size={12} /> {t('PDF')}</button>
      </div>
      {msg && <p className={`small sd-note${msg.error ? ' error-text' : ''}`} role="status">{msg.text} {msg.open && <button type="button" className="link-btn" onClick={() => onOpen?.({ root: file.root, path: msg.open })}>{t('Open it')}</button>}</p>}
      <div className="sd-deck-cols">
        <textarea className="sd-deck-md" value={md} readOnly={readOnly} spellCheck onChange={(e) => { setMd(e.target.value); onDirty(true) }} aria-label={t('The deck, in Markdown')} />
        <iframe ref={view} className="sd-deck-view" title={t('Slides')} sandbox="allow-modals" srcDoc={frame(out.html, style)} />
      </div>
      {present != null && (
        <div className="sd-present" role="dialog" aria-label={t('Presenting')}>
          <iframe title={t('Slide {n}', { n: present + 1 })} sandbox="" srcDoc={frame(out.html, style, present)} />
          <div className="sd-present-bar">
            <button type="button" className="win-btn" onClick={() => setPresent(Math.max(0, present - 1))} aria-label={t('Back')}><Icon name="chevron" size={16} className="flip" /></button>
            <span>{present + 1} / {count}</span>
            <button type="button" className="win-btn" onClick={() => setPresent(Math.min(count - 1, present + 1))} aria-label={t('Next')}><Icon name="chevron" size={16} /></button>
            <button type="button" className="win-btn" onClick={() => setPresent(null)} aria-label={t('Stop presenting')}><Icon name="x" size={16} /></button>
          </div>
          {out.comments?.[present]?.length > 0 && <p className="sd-present-notes">{out.comments[present].join(' ')}</p>}
        </div>
      )}
    </div>
  )
}

// A PowerPoint: LibreOffice's PDF of it where it's installed, else each slide's text and notes.
function Pptx({ file, onOpen }) {
  const [pdf, setPdf] = useState(null)
  const [outline, setOutline] = useState(null)
  const [err, setErr] = useState(null)
  const root = encodeURIComponent(file.root), p = encodeURIComponent(file.path)
  useEffect(() => {
    let on = true
    api(`/agents/${root}/office/outline?path=${p}`).then((o) => on && setOutline(o), (e) => on && setErr(e.message))
    fetch(`${BASE}/api/agents/${root}/office/pdf?path=${p}`, { method: 'HEAD' }).then((r) => on && r.ok && setPdf(`${BASE}/api/agents/${root}/office/pdf?path=${p}`), () => {})
    return () => { on = false }
  }, [file.root, file.path]) // eslint-disable-line react-hooks/exhaustive-deps
  const asMarkdown = async () => {
    const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
    const r = await api('/studio/new', { method: 'POST', body: { root: file.root, dir, name: file.name.replace(/\.pptx$/i, '.md'), text: deckFromOutline(outline, file.name) } })
    onOpen?.({ root: file.root, path: r.path })
  }
  return (
    <div className="sd-deck">
      <div className="sd-toolbar">
        <span className="muted small">{outline ? t('{n} slides', { n: outline.sections.length }) : ''}</span>
        <span className="sd-grow" />
        {outline && <button type="button" className="btn small" onClick={asMarkdown} title={t('A Markdown deck with its slides\' text, beside it, to edit and present here')}><Icon name="edit" size={12} /> {t('Edit as a Markdown deck')}</button>}
      </div>
      {err && <p className="error-text small">{err}</p>}
      {pdf ? <iframe className="sd-pdf" title={file.name} src={pdf} /> : (
        <div className="sd-outline">
          {(outline?.sections || []).map((s, i) => (
            <div key={i} className="sd-slide-card">
              <b>{t('Slide {n}', { n: i + 1 })}</b>
              {s.blocks.map((b, j) => <p key={j}>{b.text}</p>)}
              {s.notes?.length > 0 && <p className="muted small">{s.notes.join(' ')}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
