import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import Icon from './Icon.jsx'
import { FilesView, ChangesView, PreviewView } from '../lazy.jsx'
import { PaneHeader, usePersisted, useWidth } from './layout.jsx'
import { api, openInTerminal } from '../api.js'
import disposeTerm from '../disposeTerm.js'
import LiveShell from './LiveShell.jsx'

// A tab with plain shells (dev servers, editors, logs). One shell (a New terminal, say) is a
// terminal you type straight into. Several (a herdr tab split into panes) are laid out the way
// herdr lays them out, each a live mirror; pick one to type into it.
const enc = encodeURIComponent
const KEYS = [['esc', 'Esc'], ['tab', 'Tab'], ['up', '↑'], ['down', '↓'], ['left', '←'], ['right', '→'], ['enter', '⏎'], ['ctrl+c', '⌃C'], ['ctrl+d', '⌃D'], ['ctrl+l', '⌃L'], ['y', 'y'], ['n', 'n']]
const home = (p) => (p || '').replace(/^\/Users\/[^/]+/, '~')
const base = (p) => (p || '').split('/').filter(Boolean).pop() || '/'

function termTheme() {
  const c = getComputedStyle(document.documentElement)
  return { background: c.getPropertyValue('--term-bg').trim(), foreground: c.getPropertyValue('--term-fg').trim(), cursor: 'transparent' }
}

// How wide and tall a cell of this font really is, per pixel of font size. The layout is sized
// from these, so a guess that's a little small cuts off the last lines of a pane.
function charRatio(family) {
  const ctx = document.createElement('canvas').getContext('2d')
  ctx.font = `100px ${family}`
  return ctx.measureText('M'.repeat(50)).width / 50 / 100 || 0.6
}

function MiniTerm({ pane, selected, onSelect, onZoom, zoomed, fontSize, onLineHeight }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const last = useRef('')
  const cols = Math.max(20, pane.rect?.width || 100)
  const rows = Math.max(5, pane.rect?.height || 30)

  useEffect(() => {
    const term = new XTerm({ disableStdin: true, cols, rows, scrollback: 0, fontSize, fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace', theme: termTheme() })
    term.open(hostRef.current)
    termRef.current = term
    const mo = new MutationObserver(() => { term.options.theme = termTheme() })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { mo.disconnect(); disposeTerm(term); termRef.current = null; last.current = '' }
  }, [pane.paneId, cols, rows])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (term.options.fontSize !== fontSize) term.options.fontSize = fontSize
    // Tell the layout the real line height once xterm has drawn at this size.
    requestAnimationFrame(() => {
      const h = hostRef.current?.querySelector('.xterm-screen')?.getBoundingClientRect().height
      if (h && fontSize) onLineHeight?.(h / rows / fontSize)
    })
  }, [fontSize, pane.paneId, cols, rows]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const { ansi } = await api(`/agents/${enc(pane.paneId)}/screen?lines=${rows}`)
        if (!stop && termRef.current && ansi !== last.current) {
          last.current = ansi
          termRef.current.reset()
          termRef.current.write(ansi)
        }
      } catch { /* pane closed; the fleet update removes it */ }
      if (!stop) setTimeout(tick, document.hidden ? 5000 : selected ? 1000 : 2000)
    }
    tick()
    return () => { stop = true }
  }, [pane.paneId, rows, selected])

  return (
    <div className={`mini-term ${selected ? 'sel' : ''}`} onMouseDown={() => onSelect(pane.paneId)} onDoubleClick={() => onZoom(pane.paneId)}>
      <div className="mini-term-head">
        <Icon name="terminal" size={11} />
        <span className="mono" title={pane.cwd}>{pane.title && !/^(zsh|bash|fish|-?zsh)$/.test(pane.title) ? pane.title : base(pane.cwd)}</span>
        <span className="muted">{cols}×{rows}</span>
        <button className="mini-zoom" onClick={(e) => { e.stopPropagation(); onZoom(pane.paneId) }} title={zoomed ? 'Show all panes' : 'Zoom this pane'} aria-label={zoomed ? 'Show all panes' : 'Zoom pane'}>
          <Icon name={zoomed ? 'shrink' : 'maximize'} size={11} />
        </button>
      </div>
      <div className="mini-term-body"><div ref={hostRef} /></div>
    </div>
  )
}

export default function ShellTab({ tab, controls = {}, onOpenInHerdr }) {
  const panes = tab.panes.filter((p) => !p.agent)
  const [selId, setSelId] = useState(null)
  const [zoom, setZoom] = useState(null)
  const [view, setView] = usePersisted(`cc-shell-view-${tab.tabId}`, 'panes')
  // Another view (the file viewer's "Show the app") asking to switch.
  useEffect(() => {
    const on = (e) => { if (tab.panes.some((p) => p.paneId === e.detail?.paneId)) setView(e.detail.view) }
    window.addEventListener('cc-set-view', on)
    return () => window.removeEventListener('cc-set-view', on)
  })
  const [text, setText] = useState('')
  const [withEnter, setWithEnter] = usePersisted('cc-term-enter', true)
  const [keysOpen, setKeysOpen] = useState(false)
  const [flash, setFlash] = useState(null)
  const [layRef, layW] = useWidth()
  const [lh, setLh] = useState(1.25)
  const [cw] = useState(() => charRatio(getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace'))
  const sel = panes.find((p) => p.paneId === selId) || panes[0]
  const single = panes.length === 1
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 2500); return () => clearTimeout(t) }, [flash])
  useEffect(() => { if (zoom && !panes.some((p) => p.paneId === zoom)) setZoom(null) }, [panes, zoom])

  if (!sel) return null
  const area = tab.area || { width: 1, height: 1, x: 0, y: 0 }
  const shown = zoom ? panes.filter((p) => p.paneId === zoom) : panes
  // One font for the tab, as in herdr: the full width of the layout holds the tab's columns.
  // Height follows from it (measured, not guessed), and the body scrolls if the window is short.
  const CW = cw
  const LH = lh
  const zp = zoom && panes.find((p) => p.paneId === zoom)
  const spanCols = zp ? zp.rect?.width || 100 : area.width
  const fontSize = layW ? Math.max(7, Math.min(13, Math.floor(((layW - 20 * (zp ? 1 : 2)) / (spanCols * CW)) * 2) / 2)) : 9
  const bands = zp ? 1 : new Set(panes.map((p) => p.rect?.y)).size
  const layoutH = Math.ceil((zp ? zp.rect?.height || 30 : area.height) * fontSize * LH + bands * 56)
  const place = (p) => {
    if (zoom || !p.rect) return { left: 0, top: 0, width: '100%', height: '100%' }
    const pct = (v, total) => `${(v / total) * 100}%`
    return { left: pct(p.rect.x - area.x, area.width), top: pct(p.rect.y - area.y, area.height), width: pct(p.rect.width, area.width), height: pct(p.rect.height, area.height) }
  }

  const key = async (k) => {
    try { await api(`/panes/${enc(sel.paneId)}/keys`, { method: 'POST', body: { keys: [k] } }) } catch (e) { setFlash(e.message) }
  }
  const send = async () => {
    if (!text && !withEnter) return
    try { await api(`/panes/${enc(sel.paneId)}/text`, { method: 'POST', body: { text, enter: withEnter } }); setText('') } catch (e) { setFlash(e.message) }
  }
  const selName = sel.title && !/^(zsh|bash|fish|-?zsh)$/.test(sel.title) ? sel.title : base(sel.cwd)

  return (
    <section className={`pane console shell-tab ${controls.minimized ? 'is-min' : ''}`} aria-label={`${tab.label} tab`}>
      <PaneHeader icon="terminal" title={tab.label || 'shell'} subtitle={single ? `${tab.workspace} · ${home(sel.cwd)}` : `${tab.workspace} · ${panes.length} panes · ${home(sel.cwd)}`} {...controls}>
        <div className="seg" role="tablist">
          {[['panes', single ? 'terminal' : 'grid', single ? 'Terminal' : 'Panes'], ['files', 'folder', 'Files'], ['changes', 'branch', 'Changes'], ['preview', 'play', 'Preview']].map(([id, icon, label]) => (
            <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)} title={label}><Icon name={icon} size={14} /><span>{label}</span></button>
          ))}
        </div>
        <button className="win-btn" onClick={() => openInTerminal(`tab:${tab.tabId}`).catch((e) => window.alert(e.message))} title="Open in your terminal app" aria-label="Open in your terminal app"><Icon name="terminal" size={14} /></button>
        {onOpenInHerdr && <button className="win-btn" onClick={() => onOpenInHerdr(`tab:${tab.tabId}`)} title="Open in Herdr view" aria-label="Open in Herdr view"><Icon name="external" size={14} /></button>}
      </PaneHeader>
      <div className="console-body">
        {view === 'panes' && single && <div className="term-wrap"><LiveShell key={sel.paneId} paneId={sel.paneId} /></div>}
        {view === 'panes' && !single && (
          <div className="pane-layout" ref={layRef} style={{ height: layoutH }}>
            {shown.map((p) => (
              <div key={p.paneId} className="pane-slot" style={place(p)}>
                <MiniTerm pane={p} fontSize={fontSize} onLineHeight={(r) => setLh((v) => (Math.abs(v - r) > 0.01 && r > 0.9 && r < 2 ? r : v))} selected={p.paneId === sel.paneId} zoomed={!!zoom} onSelect={setSelId} onZoom={(id) => { setSelId(id); setZoom(zoom ? null : id) }} />
              </div>
            ))}
          </div>
        )}
        {view === 'files' && <FilesView key={sel.paneId} agent={{ paneId: sel.paneId, cwd: sel.cwd }} />}
        {view === 'changes' && <ChangesView key={sel.paneId} agent={{ paneId: sel.paneId, cwd: sel.cwd }} onOpenFile={() => setView('files')} />}
        {view === 'preview' && <PreviewView key={sel.paneId} agent={{ paneId: sel.paneId, cwd: sel.cwd }} />}
      </div>
      {view === 'panes' && !single && (
        <div className="composer-wrap">
          {keysOpen && <div className="keybar">{KEYS.map(([k, l]) => <button key={k} className="key" onClick={() => key(k)}>{l}</button>)}</div>}
          <div className="composer-stack">
            <div className="composer shell-input">
              <div className="shell-line">
                <span className="shell-target" title={sel.cwd}><Icon name="terminal" size={12} /> {selName}</span>
                <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send() } }}
                  placeholder={panes.length > 1 ? 'Type into the selected pane (click a pane to switch)…' : 'Type into this pane…'} autoCapitalize="off" autoCorrect="off" spellCheck="false" />
              </div>
              <div className="comp-tools">
                <button className={`comp-btn ${keysOpen ? 'on' : ''}`} onClick={() => setKeysOpen(!keysOpen)} aria-label="Toggle keys" title="Keys"><Icon name="keyboard" size={16} /></button>
                <button className={`comp-text-btn toggle ${withEnter ? 'on' : ''}`} onClick={() => setWithEnter(!withEnter)} title="Press Enter after the text">⏎ {withEnter ? 'runs it' : 'types only'}</button>
                <span className={`comp-hint ${flash ? 'status' : ''}`}>{flash || <span className="hide-touch">Double-click a pane to zoom</span>}</span>
                <button className="send" onClick={send} disabled={!text && !withEnter} aria-label="Send to pane" title="Send"><Icon name="send" size={15} /></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
