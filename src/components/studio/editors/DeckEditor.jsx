import { useEffect, useMemo, useRef, useState } from 'react'
import { Marp } from '@marp-team/marp-core'
import Icon from '../../Icon.jsx'
import { api, BASE } from '../../../api.js'
import { t } from '../../../i18n/index.js'
import { textOf, base64 } from '../files.js'
import { pptxOf, slidesOf, deckFromOutline } from '../pptx.js'
import { packFor, packNamed, withPack } from '../packs.jsx'
import { fontCss } from '../look.js'

// A deck. A Markdown deck (Marp's format, MIT: slides between lines of ---) is written on the left
// and drawn on the right as you type (or one of them alone, for room), presented full screen, and
// exported as a PowerPoint whose titles, bullets and notes are text you can edit there, beside the
// deck in its folder. A PowerPoint file is shown as its slides (LibreOffice's PDF where it's
// installed, else their text, saying so) and can become a Markdown deck to edit here; Ask an agent
// changes the PowerPoint itself. packs: the design packs; the deck uses the one its front matter
// names (pack: Board), else the default, and Look picks one (it writes that line). onStats: how
// many slides, for the status line.
const marp = new Marp({ html: false, inlineSVG: true, script: false, math: false })

export default function DeckEditor({ file, data, onDirty, onStats, handle, readOnly = false, packs = [], onOpen }) {
  if (file.ext === '.pptx') return <Pptx file={file} onOpen={onOpen} onStats={onStats} />
  return <MarkdownDeck file={file} text={textOf(data)} onDirty={onDirty} onStats={onStats} handle={handle} readOnly={readOnly} packs={packs} onOpen={onOpen} />
}
const slides = (n) => (n === 1 ? t('1 slide') : t('{n} slides', { n }))
// The slides are drawn on the app's own grey (light or dark), not one of their own.
const backdrop = () => { try { return getComputedStyle(document.documentElement).getPropertyValue('--pane-3').trim() || '#eceef2' } catch { return '#eceef2' } }

// The design pack over Marp's own theme (whose rules are more specific, hence !important).
const css = (pack) => (pack ? `section{${pack.colors?.background ? `background:${pack.colors.background}!important;` : ''}${pack.colors?.text ? `color:${pack.colors.text}!important;` : ''}${pack.fonts?.body ? `font-family:${fontCss(pack.fonts.body)}!important;` : ''}} section h1,section h2,section h3{${pack.colors?.accent ? `color:${pack.colors.accent}!important;` : ''}${pack.fonts?.heading ? `font-family:${fontCss(pack.fonts.heading)}!important;` : ''}}` : '')
function frame(html, style, one = null, bg = '#eceef2') {
  return `<!doctype html><meta charset="utf-8"><style>${style}
html,body{margin:0;background:${bg}}
.marpit{padding:16px 0}
.marpit>svg{display:block;width:calc(100% - 32px);max-width:960px;height:auto;margin:0 auto 16px;box-shadow:0 0 0 1px rgb(0 0 0/.06),0 2px 10px rgb(0 0 0/.12);border-radius:6px}
${one != null ? `.marpit{padding:0}.marpit>svg{display:none;width:100vw;height:100vh;max-width:none;margin:0;box-shadow:none;border-radius:0}.marpit>svg:nth-of-type(${one + 1}){display:block}html,body{background:#000}` : ''}
@page{size:1280px 720px;margin:0}@media print{html,body{background:#fff}.marpit{padding:0}.marpit>svg{width:1280px;height:720px;max-width:none;margin:0;box-shadow:none;border-radius:0;page-break-after:always}}
</style>${html}`
}

function MarkdownDeck({ file, text, onDirty, onStats, handle, readOnly, packs, onOpen }) {
  const [md, setMd] = useState(text)
  const [present, setPresent] = useState(null) // the slide shown full screen
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [show, setShow] = useState(() => (typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches ? 'slides' : 'both')) // both | md | slides; on a phone, the slides first
  const view = useRef(null)
  useEffect(() => { setMd(text) }, [text])
  const out = useMemo(() => { try { return marp.render(md) } catch (e) { return { html: `<p>${String(e.message)}</p>`, css: '', comments: [] } } }, [md])
  const named = packNamed(md)
  const pack = packFor(packs, { pack: named })
  const style = `${out.css}${css(pack)}`
  const look = (id) => { const p = packs.find((x) => x.id === id); setMd(withPack(md, p && !p.isDefault ? p.name : null)); onDirty(true) }
  const count = (out.html.match(/<svg data-marpit-svg/g) || []).length
  useEffect(() => { onStats?.({ text: slides(count) }) }, [count, onStats])
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
    } catch (e) { setMsg({ text: t("Couldn't make the PowerPoint: {error}", { error: e.message }), error: true }) } finally { setBusy(null) }
  }
  // Printed from the drawing of all the slides, so it's shown first when only the Markdown is.
  const print = () => { const was = show; if (was === 'md') setShow('both'); setTimeout(() => view.current?.contentWindow?.print(), was === 'md' ? 300 : 0) }
  const seg = (v, label, icon) => <button type="button" role="tab" aria-selected={show === v} className={show === v ? 'on' : ''} onClick={() => setShow(v)} title={label}><Icon name={icon} size={12} /> <span>{label}</span></button>
  const bg = backdrop()
  return (
    <div className="sd-deck">
      <div className="sd-toolbar" role="toolbar" aria-label={t('Deck')}>
        <div className="seg" role="tablist" aria-label={t('Show')}>{seg('both', t('Both'), 'split')}{seg('md', t('Markdown'), 'code')}{seg('slides', t('Slides'), 'screen')}</div>
        <span className="sd-grow" />
        {packs.length > 1 && !readOnly && (
          <label className="sd-look small" title={t('The design pack this deck is drawn in')}>{t('Look')}
            <select value={pack?.id || ''} onChange={(e) => look(e.target.value)}>
              {packs.map((p) => <option key={p.id} value={p.id}>{p.isDefault ? t('{name} (your default)', { name: p.name }) : p.name}</option>)}
            </select>
          </label>
        )}
        {named && !packs.some((p) => p.name.toLowerCase() === named.toLowerCase()) && <span className="muted small" title={t('This deck names a design pack you don\'t have, so it uses your default.')}>{t('No pack "{name}"', { name: named })}</span>}
        <button type="button" className="btn small" onClick={() => setPresent(0)} disabled={!count} title={t('Present it full screen, from the first slide (arrow keys to move, Esc to stop)')} aria-label={t('Present')}><Icon name="play" size={12} /> <span className="sd-btn-label">{t('Present')}</span></button>
        <button type="button" className="btn small" onClick={toPptx} disabled={!count || busy === 'pptx'} title={t('Make a PowerPoint of it, beside it in its folder')} aria-label={t('PowerPoint')}><Icon name="download" size={12} /> <span className="sd-btn-label">{busy === 'pptx' ? t('Making it…') : t('PowerPoint')}</span></button>
        <button type="button" className="btn small" onClick={print} disabled={!count} title={t('Print it, or save it as a PDF')} aria-label={t('PDF')}><Icon name="doc" size={12} /> <span className="sd-btn-label">{t('PDF')}</span></button>
      </div>
      {msg && <p className={`small sd-note${msg.error ? ' error-text' : ''}`} role={msg.error ? 'alert' : 'status'}>{msg.text} {msg.open && <button type="button" className="link-btn" onClick={() => onOpen?.({ root: file.root, path: msg.open })}>{t('Open it')}</button>}</p>}
      <div className={`sd-deck-cols show-${show}`}>
        {show !== 'slides' && <textarea className="sd-deck-md" value={md} readOnly={readOnly} spellCheck onChange={(e) => { setMd(e.target.value); onDirty(true) }} aria-label={t('The deck, in Markdown')} placeholder={t('# A title, then a line of --- between one slide and the next')} />}
        {show !== 'md' && <iframe ref={view} className="sd-deck-view" title={t('Slides')} sandbox="allow-modals" srcDoc={frame(out.html, style, null, bg)} />}
      </div>
      {present != null && (
        <div className="sd-present" role="dialog" aria-label={t('Presenting')}>
          <iframe title={t('Slide {n}', { n: present + 1 })} sandbox="" srcDoc={frame(out.html, style, present)} />
          <div className="sd-present-bar">
            <button type="button" className="win-btn" onClick={() => setPresent(Math.max(0, present - 1))} aria-label={t('Back')} title={t('Back (←)')} disabled={present === 0}><Icon name="chevron" size={16} className="flip" /></button>
            <span>{present + 1} / {count}</span>
            <button type="button" className="win-btn" onClick={() => setPresent(Math.min(count - 1, present + 1))} aria-label={t('Next')} title={t('Next (→)')} disabled={present >= count - 1}><Icon name="chevron" size={16} /></button>
            <button type="button" className="win-btn" onClick={() => setPresent(null)} aria-label={t('Stop presenting')} title={t('Stop presenting (Esc)')}><Icon name="x" size={16} /></button>
          </div>
          {out.comments?.[present]?.length > 0 && <p className="sd-present-notes">{out.comments[present].join(' ')}</p>}
        </div>
      )}
    </div>
  )
}

// A PowerPoint: LibreOffice's PDF of it where it's installed, else each slide's text and notes,
// saying so (the slides as they look need LibreOffice on the computer the file is on).
function Pptx({ file, onOpen, onStats }) {
  const [pdf, setPdf] = useState(null) // its address; false when there's none to be had
  const [outline, setOutline] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const root = encodeURIComponent(file.root), p = encodeURIComponent(file.path)
  useEffect(() => {
    let on = true
    api(`/agents/${root}/office/outline?path=${p}`).then((o) => on && setOutline(o), (e) => on && setErr(e.message))
    fetch(`${BASE}/api/agents/${root}/office/pdf?path=${p}`, { method: 'HEAD' }).then((r) => on && setPdf(r.ok ? `${BASE}/api/agents/${root}/office/pdf?path=${p}` : false), () => on && setPdf(false))
    return () => { on = false }
  }, [file.root, file.path]) // eslint-disable-line react-hooks/exhaustive-deps
  const n = outline?.sections?.length || 0
  useEffect(() => { if (outline) onStats?.({ text: slides(n) }) }, [outline, n, onStats])
  const asMarkdown = async () => {
    setBusy(true); setErr(null)
    try {
      const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
      const r = await api('/studio/new', { method: 'POST', body: { root: file.root, dir, name: file.name.replace(/\.pptx$/i, '.md'), text: deckFromOutline(outline, file.name) } })
      onOpen?.({ root: file.root, path: r.path })
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="sd-deck">
      <div className="sd-toolbar" role="toolbar" aria-label={t('Deck')}>
        {pdf === false && outline && <span className="muted small sd-tool-note" title={t('Studio draws a PowerPoint\'s slides with LibreOffice, on the computer the file is on.')}><Icon name="info" size={12} /> {t('Its slides\' text. Install LibreOffice to see them as they look.')}</span>}
        <span className="sd-grow" />
        {outline && <button type="button" className="btn small" onClick={asMarkdown} disabled={busy || !n} title={t('A Markdown deck with its slides\' text, beside it, to edit and present here')}><Icon name="edit" size={12} /> {busy ? t('Making it…') : t('Edit as a Markdown deck')}</button>}
      </div>
      {err && <p className="error-text small sd-note" role="alert">{t("Couldn't read its slides: {error}", { error: err })}</p>}
      {pdf ? <iframe className="sd-pdf" title={file.name} src={pdf} />
        : !outline && !err ? <div className="sd-empty sd-loading" role="status"><Icon name="refresh" size={16} className="spin" /><span className="muted">{t('Opening {name}…', { name: file.name })}</span></div>
          : outline && !n ? <div className="sd-empty"><Icon name="screen" size={20} /><b>{t('No slides in this file')}</b><span className="muted small">{t('Ask an agent to make some, or open it in PowerPoint.')}</span></div>
            : (
              <ol className="sd-outline">
                {(outline?.sections || []).map((s, i) => (
                  <li key={i} className="sd-slide-card">
                    <span className="sd-slide-n">{i + 1}</span>
                    {s.blocks[0] && <b>{s.blocks[0].text}</b>}
                    {s.blocks.slice(1, 8).map((b, j) => <p key={j}>{b.text}</p>)}
                    {s.blocks.length > 8 && <p className="muted small">{t('… and {n} more', { n: s.blocks.length - 8 })}</p>}
                    {s.notes?.length > 0 && <p className="muted small sd-slide-notes" title={t('Speaker notes')}>{s.notes.join(' ')}</p>}
                  </li>
                ))}
              </ol>
            )}
    </div>
  )
}
