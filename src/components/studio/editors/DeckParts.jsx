import { memo, useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../../Icon.jsx'
import { api } from '../../../api.js'
import { t, tx } from '../../../i18n/index.js'
import { base64 } from '../files.js'
import { W, H, LAYOUTS, LOOKS, colorsOf, fontStack } from '../deck.js'

// The deck editor's parts: a slide drawn at a size, the menus and galleries of its toolbar,
// presenting, and writing slides with AI.

// The size of an element, kept up to date: [a ref to put on it, { w, h }]. The element can come
// and go (a view switched away and back), and is watched again when it's back.
export function useSize() {
  const [el, setEl] = useState(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!el || typeof ResizeObserver !== 'function') return undefined
    const o = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    o.observe(el)
    return () => o.disconnect()
  }, [el])
  return [setEl, el ? size : { w: 0, h: 0 }]
}

// One slide as Marp drew it (its <svg>), at width w, or as wide as its box when there's no w. The
// deck's styles are on the page once.
export const Slide = memo(function Slide({ svg, w = 0, className = '' }) {
  const [ref, size] = useSize()
  const width = w || size.w
  const k = width / W
  return (
    <div ref={ref} className={`sd-slide ${className}`} style={w ? { width: w, height: Math.round(H * k) } : { width: '100%', aspectRatio: '16 / 9' }}>
      {width > 0 && <div className="sd-slide-in" style={{ transform: `scale(${k})` }} dangerouslySetInnerHTML={{ __html: `<div class="marpit">${svg || ''}</div>` }} />}
    </div>
  )
})

// A menu under a button: a click outside or Escape closes it. items: { label, icon, run, keys,
// danger, on } or '-'.
export function Menu({ label, items, onClose, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    ref.current?.querySelector('button')?.focus({ preventScroll: true })
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true) }
  }, [onClose])
  const move = (e) => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
    e.preventDefault()
    const bs = [...ref.current.querySelectorAll('button:not(:disabled)')]
    const i = bs.indexOf(document.activeElement)
    bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]?.focus()
  }
  return (
    <div className={`menu left sd-tool-menu ${className}`} ref={ref} role="menu" aria-label={label} onKeyDown={move}>
      {items.filter(Boolean).map((it, i) => (it === '-' ? <div key={i} className="menu-sep" /> : (
        <button type="button" key={it.label} role="menuitem" className={`menu-item${it.danger ? ' danger' : ''}${it.on ? ' on' : ''}`} disabled={it.disabled} onClick={() => { onClose(); it.run() }}>
          <Icon name={it.icon || 'dot'} size={13} /> <span className="sd-menu-label">{it.label}</span>{it.keys && <kbd className="sd-kbd">{it.keys}</kbd>}
        </button>
      )))}
    </div>
  )
}

export const LAYOUT_LABEL = { title: tx('Title'), content: tx('Title and text'), section: tx('Section'), cols: tx('Two columns'), stats: tx('Big numbers'), image: tx('Text and picture'), picture: tx('Full picture'), quote: tx('Quote'), blank: tx('Blank') }
// A picture to show where one goes, in the layouts' previews.
const GREY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAF0lEQVR4nGOYtWzHjkMXGHYcunDtzlMAPIsJJIqhFtYAAAAASUVORK5CYII='
// Each layout with words in it, to preview it in the deck's look.
export const sampleOf = (id) => ({
  title: `<!-- _class: title -->\n\n# ${t('A title')}\n\n## ${t('A subtitle')}`,
  content: `# ${t('A title')}\n\n- ${t('A point')}\n- ${t('Another point')}\n- ${t('A third')}`,
  section: `<!-- _class: section -->\n\n# ${t('A section')}`,
  cols: `<!-- _class: cols -->\n\n# ${t('A title')}\n\n### ${t('One side')}\n\n- ${t('A point')}\n- ${t('A point')}\n\n### ${t('The other')}\n\n- ${t('A point')}\n- ${t('A point')}`,
  stats: `<!-- _class: stats -->\n\n# ${t('A title')}\n\n- **42%** ${t('A point')}\n- **3×** ${t('A point')}\n- **12** ${t('A point')}`,
  image: `<!-- _class: image -->\n\n# ${t('A title')}\n\n- ${t('A point')}\n- ${t('Another point')}\n\n![bg right:42%](${GREY})`,
  picture: `<!-- _class: picture -->\n\n# ${t('A title')}\n\n![bg](${GREY})`,
  quote: `<!-- _class: quote -->\n\n> ${t('Something someone said.')}\n\n${t('Who said it')}`,
  blank: '<!-- _class: blank -->',
}[id])

// The layouts, each drawn in the deck's look. previews: id -> svg. on: the slide's own.
export function LayoutGallery({ label, previews, on, onPick, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    ref.current?.querySelector('button.on, button')?.focus({ preventScroll: true })
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true) }
  }, [onClose])
  return (
    <div className="menu left sd-gallery" ref={ref} role="menu" aria-label={label}>
      <b className="sd-gallery-head">{label}</b>
      <div className="sd-gallery-grid">
        {LAYOUTS.map((id) => (
          <button type="button" key={id} role="menuitemradio" aria-checked={on === id} className={on === id ? 'on' : ''} onClick={() => { onClose(); onPick(id) }} title={t(LAYOUT_LABEL[id])}>
            <Slide svg={previews[id]} w={124} />
            <span>{t(LAYOUT_LABEL[id])}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// A look as a little title slide: its colours, its fonts, its logo.
function LookCard({ look }) {
  const c = colorsOf(look)
  return (
    <span className="sd-look-card" style={{ background: c.bg, color: c.fg }} aria-hidden="true">
      <i style={{ background: c.accent }} />
      <b style={{ fontFamily: fontStack(look.fonts?.heading) }}>Aa</b>
      <span style={{ fontFamily: fontStack(look.fonts?.body), color: c.muted }}>{t('Words')}</span>
      <em style={{ background: c.tint }} />
      {look.logo && <img src={look.logo} alt="" />}
    </span>
  )
}
// Themes: your design packs, then Studio's own looks, then (for a PowerPoint) the file's own.
// current: the look the deck is in now ({ id }). onPick(look).
export function ThemeGallery({ packs, own, current, onPick, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    ref.current?.querySelector('button.on, button')?.focus({ preventScroll: true })
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true) }
  }, [onClose])
  const item = (look, name, key) => (
    <button type="button" key={key} role="menuitemradio" aria-checked={current === key} className={current === key ? 'on' : ''} onClick={() => { onClose(); onPick(look) }} title={name}>
      <LookCard look={look} /><span>{name}</span>
    </button>
  )
  return (
    <div className="menu left sd-gallery sd-themes" ref={ref} role="menu" aria-label={t('Theme')}>
      {own && <><b className="sd-gallery-head">{t('This file\'s own')}</b><div className="sd-gallery-grid">{item(own, t('Its theme'), 'own')}</div></>}
      {packs.length > 0 && <><b className="sd-gallery-head">{t('Your design packs')}</b><div className="sd-gallery-grid">{packs.map((p) => item(p, p.isDefault ? t('{name} (your default)', { name: p.name }) : p.name, `pack:${p.id}`))}</div></>}
      <b className="sd-gallery-head">{t('Studio themes')}</b>
      <div className="sd-gallery-grid">{LOOKS.map((l) => item(l, t(l.name), `look:${l.id}`))}</div>
      <p className="sd-gallery-foot muted small">{t('Your own colours, fonts and logo: a design pack, made on Studio\'s home.')}</p>
    </div>
  )
}
// Studio's own looks' names, for the translation packs.
export const LOOK_NAMES = [tx('Paper'), tx('Ember'), tx('Forest'), tx('Cream'), tx('Graphite'), tx('Midnight')]

// ---------- Presenting ----------
// Full screen (where the browser can), a slide at a time: arrows, space and page keys move, B goes
// black, Esc stops. The presenter's view: this slide, the next, its notes and the time.
export function Present({ slides, notes, start = 0, presenter: p0 = false, onClose, onAt }) {
  const [at, setAt] = useState(Math.max(0, Math.min(slides.length - 1, start)))
  const [presenter, setPresenter] = useState(p0)
  const [black, setBlack] = useState(false)
  const [bar, setBar] = useState(true)
  const [t0, setT0] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const ref = useRef(null)
  const [stage, size] = useSize()
  const n = slides.length
  const go = useCallback((d) => { setBlack(false); setAt((x) => Math.max(0, Math.min(n - 1, x + d))) }, [n])
  useEffect(() => { onAt?.(at) }, [at, onAt])
  useEffect(() => {
    const el = ref.current
    let entered = false
    // Full screen where the browser lets a page have it (not an iPhone's); the window's size else.
    if (el?.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().then(() => { entered = true }, () => {})
    const change = () => { if (entered && !document.fullscreenElement) onClose() }
    document.addEventListener('fullscreenchange', change)
    return () => { document.removeEventListener('fullscreenchange', change); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(e.key)) { e.preventDefault(); go(1) }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(e.key)) { e.preventDefault(); go(-1) }
      else if (e.key === 'Home') setAt(0)
      else if (e.key === 'End') setAt(n - 1)
      else if (e.key === 'b' || e.key === '.') setBlack((x) => !x)
      else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [go, n, onClose])
  // The controls go after a moment without the mouse moving.
  useEffect(() => {
    let id = setTimeout(() => setBar(false), 2600)
    const moved = () => { setBar(true); clearTimeout(id); id = setTimeout(() => setBar(false), 2600) }
    window.addEventListener('mousemove', moved)
    return () => { clearTimeout(id); window.removeEventListener('mousemove', moved) }
  }, [])
  useEffect(() => { if (!presenter) return undefined; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [presenter])
  // A tap on the right of the slide goes on, on the left goes back; a swipe too.
  const touch = useRef(null)
  const tap = (e) => { if (e.target.closest('button')) return; const r = e.currentTarget.getBoundingClientRect(); go(e.clientX < r.left + r.width / 3 ? -1 : 1) }
  const swipeStart = (e) => { touch.current = e.touches[0]?.clientX ?? null }
  const swipeEnd = (e) => { const x = e.changedTouches[0]?.clientX; if (touch.current != null && x != null && Math.abs(x - touch.current) > 50) go(x < touch.current ? 1 : -1); touch.current = null }
  const mmss = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
  const fit = (w, h) => Math.max(40, Math.floor(Math.min(w, (h * W) / H)))
  const note = notes[at] || ''
  return (
    <div className={`sd-present${presenter ? ' presenter' : ''}${bar ? ' bar' : ''}`} ref={ref} role="dialog" aria-label={t('Presenting')}>
      <div className="sd-present-stage" ref={stage} onClick={presenter ? undefined : tap} onTouchStart={swipeStart} onTouchEnd={swipeEnd}>
        {black ? <div className="sd-present-black" /> : size.w > 0 && <Slide svg={slides[at]} w={fit(presenter ? size.w * 0.64 : size.w, size.h - (presenter ? 0 : 0))} />}
        {presenter && (
          <aside className="sd-presenter">
            <div className="sd-presenter-time"><b>{mmss(now - t0)}</b><button type="button" className="ghost-btn" onClick={() => { setT0(Date.now()); setNow(Date.now()) }}>{t('Restart the clock')}</button><span className="muted">{new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
            <small className="muted">{at + 1 < n ? t('Next') : t('The last slide')}</small>
            {at + 1 < n && <Slide svg={slides[at + 1]} w={Math.min(320, Math.floor(size.w * 0.3))} />}
            <small className="muted">{t('Speaker notes')}</small>
            <p className="sd-presenter-notes">{note || <span className="muted">{t('No notes on this slide.')}</span>}</p>
          </aside>
        )}
      </div>
      <div className="sd-present-bar">
        <button type="button" className="win-btn" onClick={() => go(-1)} aria-label={t('Back')} title={t('Back (←)')} disabled={at === 0}><Icon name="chevron" size={16} className="flip" /></button>
        <span className="sd-present-n">{t('{n} of {count}', { n: at + 1, count: n })}</span>
        <button type="button" className="win-btn" onClick={() => go(1)} aria-label={t('Next')} title={t('Next (→)')} disabled={at >= n - 1}><Icon name="chevron" size={16} /></button>
        <span className="sd-present-sep" />
        <button type="button" className={`win-btn${presenter ? ' on' : ''}`} onClick={() => setPresenter((x) => !x)} aria-pressed={presenter} aria-label={t('Presenter view')} title={t('Presenter view: the next slide, notes and a clock')}><Icon name="panel-right" size={15} /></button>
        <button type="button" className={`win-btn${black ? ' on' : ''}`} onClick={() => setBlack((x) => !x)} aria-pressed={black} aria-label={t('Black screen')} title={t('Black screen (B)')}><Icon name="moon" size={15} /></button>
        <button type="button" className="win-btn" onClick={onClose} aria-label={t('Stop presenting')} title={t('Stop presenting (Esc)')}><Icon name="x" size={16} /></button>
      </div>
      {!presenter && note && bar && <p className="sd-present-notes">{note}</p>}
    </div>
  )
}

// ---------- Writing with AI ----------
// Make a deck (from what it's about, or a document), rewrite this slide, or add a slide after it,
// with the model meeting notes use unless another is picked. What it writes is drawn first, to keep
// or not. getSlides(): the deck's slides as Markdown. draw(texts): the slides drawn in the deck's
// look. onKeep({ mode, slides, at, how }).
const MODES = [['deck', tx('Whole deck')], ['slide', tx('This slide')], ['add', tx('New slide')]]
const QUICK = { slide: [tx('Shorter'), tx('Clearer'), tx('As big numbers'), tx('Add speaker notes')], add: [tx('A summary of the deck'), tx('Next steps'), tx('Questions to ask')], deck: [] }
const DOCS = new Set(['doc', 'pdf', 'page', 'sheet'])
export function AiPanel({ file, getSlides, at, mode, setMode, draw, onKeep, onClose }) {
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState('')
  const [from, setFrom] = useState('') // root\npath of a recent document
  const [upload, setUpload] = useState(null) // { name, data }
  const [docs, setDocs] = useState([])
  const [models, setModels] = useState(null)
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(null) // { at, abort }
  const [now, setNow] = useState(0)
  const [result, setResult] = useState(null) // { mode, slides, svgs, model, at }
  const [err, setErr] = useState(null)
  const box = useRef(null)
  useEffect(() => { api('/studio/recent').then((r) => setDocs((r.files || []).filter((f) => DOCS.has(f.kind) && !(f.root === file.root && f.path === file.path)).slice(0, 12)), () => setDocs([])) }, [file.root, file.path])
  useEffect(() => { api('/studio/models').then((r) => { setModels(r.models || []); setModel((m) => m || r.pick || '') }, () => setModels([])) }, [])
  useEffect(() => { box.current?.focus() }, [mode])
  useEffect(() => { if (!busy) return undefined; const id = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(id) }, [busy])
  const pickFile = (f) => {
    if (!f) return
    if (f.size > 25 * 1024 * 1024) { setErr(t('A smaller document, please (25 MB at most).')); return }
    const r = new FileReader()
    r.onload = () => { setUpload({ name: f.name, data: base64(r.result) }); setFrom('') }
    r.readAsArrayBuffer(f)
  }
  const go = async (e, again = false) => {
    e?.preventDefault()
    if (busy) return
    const want = again && result ? result.prompt : prompt
    if (mode === 'deck' && !want.trim() && !from && !upload) { setErr(t('Say what the deck is about, or pick a document to make it from.')); return }
    const abort = new AbortController()
    setBusy({ at: Date.now(), abort }); setNow(Date.now()); setErr(null); setResult(null)
    try {
      const [root, path] = from ? from.split('\n') : []
      const r = await api('/studio/deck/ai', { method: 'POST', signal: abort.signal, body: { root: file.root, path: file.path, mode, prompt: want, slides: getSlides(), at, count: count || null, model: model || null, ...(from ? { from: { root, path } } : {}), ...(upload ? { upload } : {}) } })
      setResult({ mode, slides: r.slides, svgs: draw(r.slides), model: r.model, at, prompt: want })
    } catch (x) {
      if (x.name !== 'AbortError') setErr({ text: x.message, noModel: x.code === 'noModel' })
    } finally { setBusy(null) }
  }
  const keep = (how) => { onKeep({ mode: result.mode, slides: result.slides, at: result.at, how }); setResult(null); setPrompt('') }
  const modelName = (id) => models?.find((m) => m.id === id)?.label || id
  const quick = QUICK[mode] || []
  return (
    <aside className="sd-ai" aria-label={t('Write with AI')}>
      <div className="sd-ai-head">
        <b><Icon name="sparkle" size={14} /> {t('Write with AI')}</b>
        <span className="sd-grow" />
        <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={13} /></button>
      </div>
      <div className="seg sd-ai-modes" role="tablist" aria-label={t('What to write')}>
        {MODES.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? 'on' : ''} onClick={() => { setMode(id); setResult(null); setErr(null) }}>{t(label)}</button>)}
      </div>
      {!result && (
        <form className="sd-ai-form" onSubmit={go}>
          <p className="muted small">{mode === 'deck' ? t('What it\'s about and who it\'s for. It replaces this deck\'s slides, or goes after this slide: you choose once it\'s written.') : mode === 'slide' ? t('How slide {n} should change.', { n: at + 1 }) : t('What goes on a new slide after slide {n}.', { n: at + 1 })}</p>
          <textarea ref={box} value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={mode === 'deck' ? 5 : 3} placeholder={mode === 'deck' ? t('A 10-minute pitch of our new pricing to the sales team: why, what changes, what they say to customers') : mode === 'slide' ? t('Shorter, with the numbers first') : t('The three risks, and what we do about each')} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go(e) }} aria-label={t('What to write')} />
          {quick.length > 0 && <div className="sd-ai-chips">{quick.map((q) => <button key={q} type="button" className="sd-chip" onClick={() => setPrompt((x) => (x.trim() ? `${x.trim()}. ${t(q)}` : t(q)))}>{t(q)}</button>)}</div>}
          {mode === 'deck' && (
            <>
              <label className="sd-ai-field"><span className="muted small">{t('From a document')}</span>
                <select value={upload ? '\u0000' : from} onChange={(e) => { setFrom(e.target.value === '\u0000' ? from : e.target.value); if (e.target.value !== '\u0000') setUpload(null) }}>
                  <option value="">{t('None: only what I say')}</option>
                  {docs.map((d) => <option key={`${d.root}\n${d.path}`} value={`${d.root}\n${d.path}`}>{d.name}</option>)}
                  {upload && <option value={'\u0000'}>{upload.name}</option>}
                </select>
              </label>
              <label className="sd-ai-attach link-btn"><Icon name="paperclip" size={12} /> {t('Or one from this device')}<input type="file" accept=".docx,.pdf,.md,.txt,.html,.pptx,.xlsx,.csv" hidden onChange={(e) => pickFile(e.target.files?.[0])} /></label>
              <label className="sd-ai-field"><span className="muted small">{t('How many slides')}</span>
                <select value={count} onChange={(e) => setCount(e.target.value)}>
                  <option value="">{t('As many as it needs')}</option>
                  {[5, 8, 10, 12, 15].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </>
          )}
          {models && models.length > 1 && (
            <label className="sd-ai-field"><span className="muted small">{t('Model')}</span>
              <select value={model} onChange={(e) => setModel(e.target.value)}>{models.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.provider}</option>)}</select>
            </label>
          )}
          {err && (
            <p className="error-text small" role="alert">{err.text || err}{err.noModel && <> <button type="button" className="link-btn" onClick={() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))}>{t('Model Providers')}</button></>}</p>
          )}
          {models && !models.length && !err && <p className="muted small">{t('No model to write with yet: sign in to an agent (Claude Code, Codex…) or add a key in Settings › Model Providers. Ask an agent, at the top, changes the file itself.')}</p>}
          {busy ? (
            <div className="sd-ai-busy" role="status">
              <Icon name="refresh" size={14} className="spin" />
              <span>{mode === 'deck' ? t('Writing the deck…') : t('Writing the slide…')} <span className="muted">{t('{n} s', { n: Math.max(0, Math.round((now - busy.at) / 1000)) })}{model ? ` · ${modelName(model)}` : ''}</span></span>
              <button type="button" className="ghost-btn" onClick={() => busy.abort.abort()}>{t('Stop')}</button>
            </div>
          ) : (
            <button type="submit" className="btn small primary sd-ai-go"><Icon name="sparkle" size={12} /> {mode === 'deck' ? t('Write the deck') : mode === 'slide' ? t('Rewrite it') : t('Write it')}</button>
          )}
        </form>
      )}
      {result && (
        <div className="sd-ai-result" role="region" aria-label={t('What it wrote')}>
          <p className="small"><b>{result.slides.length === 1 ? t('1 slide, not in the deck yet') : t('{n} slides, not in the deck yet', { n: result.slides.length })}</b> <span className="muted">{t('by {model}', { model: modelName(result.model) })}</span></p>
          <ol className="sd-ai-slides">{result.svgs.map((svg, i) => <li key={i}><span className="sd-thumb-n">{i + 1}</span><Slide svg={svg} w={result.svgs.length > 2 ? 136 : 280} /></li>)}</ol>
          <div className="sd-ai-acts">
            {result.mode === 'deck' ? (
              <>
                <button type="button" className="btn small primary" onClick={() => keep('replace')}><Icon name="check" size={12} /> {t('Use these slides')}</button>
                <button type="button" className="btn small" onClick={() => keep('after')}>{t('Add them after slide {n}', { n: result.at + 1 })}</button>
              </>
            ) : <button type="button" className="btn small primary" onClick={() => keep(result.mode === 'add' ? 'after' : 'replace')}><Icon name="check" size={12} /> {result.mode === 'add' ? t('Add it') : t('Keep it')}</button>}
            <button type="button" className="ghost-btn" onClick={(e) => go(e, true)}><Icon name="refresh" size={12} /> {t('Try again')}</button>
            <button type="button" className="ghost-btn" onClick={() => setResult(null)}>{t('Discard')}</button>
          </div>
          <p className="muted small">{result.mode === 'slide' ? t('Kept, it takes the place of slide {n}. Undo puts it back.', { n: result.at + 1 }) : t('Undo takes it back out.')}</p>
        </div>
      )}
    </aside>
  )
}
