import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import Icon, { StatusDot } from './Icon.jsx'
import { usePersisted } from './layout.jsx'
import { api, usePoll } from '../api.js'
import disposeTerm from '../disposeTerm.js'

// Phone terminal view. Reads and types into herdr panes through the CLI only,
// so it never attaches a herdr client and never resizes your session.
const enc = encodeURIComponent
const ONE_DARK = { background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', black: '#3f4451', red: '#e05561', green: '#8cc265', yellow: '#d18f52', blue: '#4aa5f0', magenta: '#c162de', cyan: '#42b3c2', white: '#d7dae0', brightBlack: '#4f5666', brightRed: '#ff616e', brightGreen: '#a5e075', brightYellow: '#f0a45d', brightBlue: '#4dc4ff', brightMagenta: '#de73ff', brightCyan: '#4cd1e0', brightWhite: '#e6e6e6' }
const KEYS = [['Esc', 'esc'], ['Tab', 'tab'], ['⇧Tab', 'shift+tab'], ['↑', 'up'], ['↓', 'down'], ['←', 'left'], ['→', 'right'], ['⏎', 'enter'], ['⌃C', 'ctrl+c'], ['1', '1'], ['2', '2'], ['3', '3'], ['y', 'y'], ['n', 'n']]

function PaneScreen({ pane, onBack, onChat }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const last = useRef('')
  const [mode, setMode] = usePersisted('cc-term-mode', 'read')
  const [text, setText] = useState('')
  const [withEnter, setWithEnter] = usePersisted('cc-term-enter', true)
  const [flash, setFlash] = useState(null)
  const cols = pane.cols || 120
  const rows = pane.rows || 40

  useEffect(() => {
    const term = new XTerm({ disableStdin: true, cols, rows, scrollback: 0, fontFamily: '"JetBrains Mono", Menlo, monospace', fontSize: 10, theme: ONE_DARK, cursorBlink: false })
    term.open(hostRef.current)
    termRef.current = term
    return () => { disposeTerm(term); termRef.current = null; last.current = '' }
  }, [pane.paneId, cols, rows])

  // Fit = shrink the font so the full width fits the phone; Readable = 10px and scroll sideways.
  useEffect(() => {
    const term = termRef.current
    if (!term || !hostRef.current) return
    const w = hostRef.current.parentElement.clientWidth - 8
    term.options.fontSize = mode === 'fit' ? Math.max(4, Math.min(12, Math.floor((w / cols) / 0.6))) : 10
  }, [mode, cols, pane.paneId])

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
      } catch { /* pane closed */ }
      if (!stop) setTimeout(tick, document.hidden ? 4000 : 1000)
    }
    tick()
    return () => { stop = true }
  }, [pane.paneId, rows])

  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 2500); return () => clearTimeout(t) }, [flash])

  const key = async (k) => {
    try { await api(`/panes/${enc(pane.paneId)}/keys`, { method: 'POST', body: { keys: [k] } }); navigator.vibrate?.(8) } catch (e) { setFlash(e.message) }
  }
  const send = async () => {
    if (!text && !withEnter) return
    try { await api(`/panes/${enc(pane.paneId)}/text`, { method: 'POST', body: { text, enter: withEnter } }); setText('') } catch (e) { setFlash(e.message) }
  }

  return (
    <section className="pane-screen">
      <header className="ps-head">
        <button className="win-btn" onClick={onBack} aria-label="Back to terminals"><Icon name="chevron" size={16} className="flip" /></button>
        <div className="ps-title">
          <b>{pane.agent ? pane.title || pane.tab : pane.tab || pane.title || 'shell'}</b>
          <span className="muted small">{pane.workspace} · {cols}×{rows}</span>
        </div>
        <div className="seg small-seg">
          <button className={mode === 'fit' ? 'on' : ''} onClick={() => setMode('fit')}>Fit</button>
          <button className={mode === 'read' ? 'on' : ''} onClick={() => setMode('read')}>Readable</button>
        </div>
        {pane.agent && <button className="win-btn" onClick={() => onChat(pane.paneId)} aria-label="Open chat" title="Chat"><Icon name="chat" size={15} /></button>}
      </header>
      <div className="ps-body"><div ref={hostRef} className="ps-term" /></div>
      <div className="ps-keys">{KEYS.map(([l, k]) => <button key={k} className="key" onClick={() => key(k)}>{l}</button>)}</div>
      {flash && <div className="comp-note">{flash}</div>}
      <div className="ps-input">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send() } }}
          placeholder="Type into this pane…" autoCapitalize="off" autoCorrect="off" spellCheck="false" />
        <button className={`ps-enter ${withEnter ? 'on' : ''}`} onClick={() => setWithEnter(!withEnter)} title="Press Enter after sending">⏎</button>
        <button className="send" onClick={send} aria-label="Send to pane"><Icon name="send" size={15} /></button>
      </div>
    </section>
  )
}

export default function Terminals({ onChat }) {
  const { data, error } = usePoll('/panes', 4000)
  const [openId, setOpenId] = useState(null)
  const panes = data?.panes || []
  const open = panes.find((p) => p.paneId === openId)
  if (open) return <PaneScreen pane={open} onBack={() => setOpenId(null)} onChat={onChat} />
  const groups = []
  for (const p of panes) {
    let g = groups.find((x) => x.id === p.workspaceId)
    if (!g) groups.push(g = { id: p.workspaceId, label: p.workspace, number: p.number, panes: [] })
    g.panes.push(p)
  }
  return (
    <div className="m-stack terms">
      <p className="muted small term-note">Every agent's terminal, live. Looking here doesn't change anything on your computer.</p>
      {error && <p className="error-text">{error}</p>}
      {!data && !error && <div className="skeleton-rows"><div /><div /><div /></div>}
      {groups.map((g) => (
        <section key={g.id} className="term-group">
          <div className="group-label">{g.number} · {g.label}</div>
          {g.panes.map((p) => (
            <button key={p.paneId} className="term-row" onClick={() => setOpenId(p.paneId)}>
              {p.agent ? <StatusDot status={p.status || 'unknown'} /> : <Icon name="terminal" size={14} className="muted" />}
              <span className="term-main">
                <b>{p.agent ? p.title || p.tab : p.tab && !/^\d+$/.test(p.tab) ? p.tab : p.title || 'shell'}</b>
                <span className="muted small mono">{p.agent || 'shell'} · {(p.cwd || '').replace(/^\/Users\/[^/]+/, '~')}</span>
              </span>
              <Icon name="chevron" size={13} className="muted" />
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}
