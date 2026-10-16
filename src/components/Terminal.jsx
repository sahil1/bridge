import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import Icon from './Icon.jsx'
import { api } from '../api.js'
import disposeTerm from '../disposeTerm.js'

// Live mirror of a herdr pane you can type into. herdr has no output stream per pane, so the
// screen is re-read (fast while you type) and drawn at the pane's own width, so lines wrap the
// same as in herdr. Keystrokes go to the pane in order. Scrolling up holds the view until you
// jump back down. Clicking a numbered option in a menu picks it.
const SCROLLBACK_LINES = 1500

// Turn what xterm.js emits for a keystroke or paste into herdr input steps.
export function toSteps(data, typed = data.length === 1) {
  const steps = []
  const text = (t) => { const last = steps.at(-1); if (last?.text != null) last.text += t; else steps.push({ text: t }) }
  const key = (k) => { const last = steps.at(-1); if (last?.keys) last.keys.push(k); else steps.push({ keys: [k] }) }
  const SEQ = { '[A': 'up', '[B': 'down', '[C': 'right', '[D': 'left', OA: 'up', OB: 'down', OC: 'right', OD: 'left', '[Z': 'shift+tab', '[H': 'ctrl+a', OH: 'ctrl+a', '[F': 'ctrl+e', OF: 'ctrl+e', '[1;5D': 'ctrl+left', '[1;5C': 'ctrl+right', '[1;2A': 'shift+up', '[1;2B': 'shift+down' }
  // A paste arrives as one chunk; keep it as text so newlines don't submit line by line.
  if (data.length > 1 && !data.startsWith('\x1b') && /[\r\n]/.test(data.slice(0, -1))) { text(data.replace(/\r\n?/g, '\n')); return steps }
  for (let i = 0; i < data.length; i++) {
    const c = data[i]
    if (c === '\x1b') {
      const rest = data.slice(i + 1)
      const m = /^(\[[0-9;]*[A-Za-z~]|O[A-Z])/.exec(rest)
      if (m) { if (SEQ[m[1]]) key(SEQ[m[1]]); i += m[1].length; continue }
      if (rest[0] && /[a-z0-9]/i.test(rest[0])) { key(`alt+${rest[0].toLowerCase()}`); i += 1; continue }
      if (rest[0] === '\r') { key('alt+enter'); i += 1; continue }
      key('esc')
      continue
    }
    if (c === '\r' || c === '\n') key('enter')
    else if (c === '\x7f' || c === '\b') key('backspace')
    else if (c === '\t') key('tab')
    else if (c.charCodeAt(0) < 27) key(`ctrl+${String.fromCharCode(c.charCodeAt(0) + 96)}`)
    // A single typed character goes as a key press, so menu shortcuts (1, 2, y, s) work.
    else if (typed) key(c === ' ' ? 'space' : c)
    else text(c)
  }
  return steps
}

function charRatio(family) {
  const ctx = document.createElement('canvas').getContext('2d')
  ctx.font = `100px ${family}`
  return ctx.measureText('M'.repeat(50)).width / 50 / 100 || 0.6
}

const OPTION = /^\s*(?:[❯›>]\s*)?(\d)\.\s+\S/
const RULE = /^\s*─{3,}/

// The screen is a copy drawn here, so xterm's cursor would sit wherever the drawing stopped (the
// end of the status bar). Put it where typing goes instead: the end of what's typed in the
// agent's input box (Claude: "❯" between two rules; Codex: "›" near the bottom), at the start
// when the box only shows a dimmed placeholder. No input box on screen: no cursor.
function placeCursor(term) {
  const b = term.buffer.active
  const text = (y) => b.getLine(y)?.translateToString(true) || ''
  for (let y = b.length - 1; y >= Math.max(0, b.length - 40); y--) {
    if (!/^[❯›](\s|$)/.test(text(y))) continue
    const claude = RULE.test(text(y - 1))
    if (!claude && !(text(y).startsWith('›') && b.length - y <= 8)) continue
    let end = y
    if (claude) while (end + 1 < b.length && !RULE.test(text(end + 1)) && end - y < 30) end++
    const cell = b.getLine(y)?.getCell(2)
    const placeholder = end === y && cell && (cell.isDim() || cell.isItalic())
    const col = placeholder ? 2 : Math.max(2, text(end).replace(/\s+$/, '').length)
    const row = end - b.baseY + 1
    if (row < 1 || row > term.rows) break
    term.write(`\x1b[?25h\x1b[${row};${col + 1}H`)
    return
  }
  term.write('\x1b[?25l')
}

// Text size from Appearance (one step smaller on a phone).
const termFont = () => {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--term-font')) || 13
  return window.innerWidth < 700 ? n - 2 : n
}

export default function Terminal({ paneId, active, focusKey, onChat }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const lastRef = useRef('')
  const colsRef = useRef(null)
  const fastUntil = useRef(0)
  const kick = useRef(null)
  const pendingRef = useRef(null)
  const [focused, setFocused] = useState(false)
  const [held, setHeld] = useState(false)
  const [error, setError] = useState(null)
  const [noHistory, setNoHistory] = useState(false)

  // Size the font so the pane's real column count fills the width: the room inside the padding,
  // less xterm's own scrollbar. The first guess comes from the font's shape; then the drawn width
  // is measured and the size trimmed, since xterm rounds each cell to whole device pixels.
  const layout = () => {
    const term = termRef.current
    const host = hostRef.current
    if (!term || !host || !host.clientWidth) return
    const cols = colsRef.current
    if (cols) {
      const cs = getComputedStyle(host)
      const vp = term.element?.querySelector('.xterm-viewport')
      const bar = vp ? Math.max(0, vp.offsetWidth - vp.clientWidth) : 0
      const room = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - bar - 2
      const fit = (size) => {
        size = Math.max(10, Math.min(14, Math.floor(size * 10) / 10))
        if (Math.abs(term.options.fontSize - size) > 0.05) term.options.fontSize = size
      }
      fit(room / (cols * charRatio(term.options.fontFamily)))
      const dims = fitRef.current.proposeDimensions()
      const rows = Math.max(5, (dims?.rows || 30) - 1)
      if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows)
      requestAnimationFrame(() => {
        const drawn = term.element?.querySelector('.xterm-screen')?.getBoundingClientRect().width
        if (drawn && drawn > room + 0.5) {
          fit(term.options.fontSize * (room / drawn) - 0.05)
          const r = Math.max(5, (fitRef.current.proposeDimensions()?.rows || 30) - 1)
          if (term.rows !== r) term.resize(cols, r)
        }
        host.classList.toggle('wide', term.options.fontSize <= 10 && (term.element?.querySelector('.xterm-screen')?.getBoundingClientRect().width || 0) > room + 0.5)
      })
    } else {
      try { fitRef.current.fit() } catch { /* detached */ }
    }
  }

  useEffect(() => {
    const css = getComputedStyle(document.documentElement)
    const theme = () => {
      const c = getComputedStyle(document.documentElement)
      return { background: c.getPropertyValue('--term-bg').trim(), foreground: c.getPropertyValue('--term-fg').trim(), cursor: c.getPropertyValue('--term-fg').trim(), selectionBackground: c.getPropertyValue('--accent-soft').trim() || 'rgba(80,130,240,.3)' }
    }
    const term = new XTerm({
      convertEol: false,
      scrollback: SCROLLBACK_LINES + 200,
      fontSize: termFont(),
      fontFamily: css.getPropertyValue('--font-mono').trim() || 'monospace',
      theme: theme(),
      cursorStyle: 'bar',
      cursorBlink: true,
      cursorInactiveStyle: 'none',
      macOptionIsMeta: true,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    termRef.current = term
    fitRef.current = fit
    layout()

    // Keys: let ⌘ shortcuts reach the app (⌘K, ⌘C, ⌘V); Shift+Enter is a newline in agents.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.metaKey) return false
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); send([{ keys: ['shift+enter'] }]); return false }
      return true
    })
    // Keystrokes arrive one per event; a paste arrives as one long chunk.
    let chunks = []
    let timer = null
    const flush = () => {
      timer = null
      const steps = []
      for (const d of chunks) for (const st of toSteps(d)) {
        const last = steps.at(-1)
        if (st.keys && last?.keys) last.keys.push(...st.keys)
        else if (st.text != null && last?.text != null) last.text += st.text
        else steps.push(st)
      }
      chunks = []
      if (steps.length) send(steps)
    }
    const sub = term.onData((d) => { chunks.push(d); if (!timer) timer = setTimeout(flush, 18) })
    const onScroll = term.onScroll(() => {
      const b = term.buffer.active
      if (b.viewportY >= b.baseY - 1) { setHeld(false); if (pendingRef.current != null) paint(pendingRef.current) }
    })
    const ta = term.textarea
    const onFocus = () => setFocused(true)
    const onBlur = () => setFocused(false)
    ta?.addEventListener('focus', onFocus)
    ta?.addEventListener('blur', onBlur)

    const ro = new ResizeObserver(() => layout())
    ro.observe(hostRef.current)
    const applyTheme = () => {
      term.options.theme = theme()
      if (term.options.fontSize !== termFont()) { term.options.fontSize = termFont(); layout() }
    }
    const mo = new MutationObserver(applyTheme)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-chrome', 'data-text', 'style'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', applyTheme)
    return () => {
      sub.dispose(); onScroll.dispose(); ro.disconnect(); mo.disconnect(); mq.removeEventListener('change', applyTheme)
      ta?.removeEventListener('focus', onFocus); ta?.removeEventListener('blur', onBlur)
      disposeTerm(term); termRef.current = null; lastRef.current = ''
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (steps) => {
    if (!steps.length) return
    fastUntil.current = Date.now() + 2500
    try { await api(`/panes/${encodeURIComponent(paneId)}/input`, { method: 'POST', body: { steps } }); setError(null) } catch (e) { setError(e.message) }
    kick.current?.()
  }

  const paint = (ansi) => {
    const term = termRef.current
    if (!term) return
    pendingRef.current = null
    lastRef.current = ansi
    term.reset()
    // The agent's screen is often taller than what it drew (a short prompt at the top of a tall
    // terminal); drop the blank rows below, so the view doesn't scroll down to empty space.
    // eslint-disable-next-line no-control-regex
    term.write(ansi.replace(/(?:\r?\n(?:\x1b\[[0-9;?]*[A-Za-z]|[ \t])*)+$/, ''), () => { term.scrollToBottom(); placeCursor(term) })
  }

  // Asked to take the keyboard (e.g. after a slash command opened a picker in the agent).
  useEffect(() => { if (focusKey && active) setTimeout(() => termRef.current?.focus(), 80) }, [focusKey, active])

  useEffect(() => {
    lastRef.current = ''
    pendingRef.current = null
    setHeld(false)
    termRef.current?.reset()
  }, [paneId])

  useEffect(() => {
    if (!active || !paneId) return
    let stop = false
    let t = null
    const tick = async () => {
      clearTimeout(t)
      try {
        const { ansi, cols } = await api(`/agents/${encodeURIComponent(paneId)}/screen?lines=${SCROLLBACK_LINES}`)
        if (cols && cols !== colsRef.current) { colsRef.current = cols; layout(); lastRef.current = '' }
        const term = termRef.current
        if (!stop && term && ansi !== lastRef.current) {
          const b = term.buffer.active
          const atBottom = b.viewportY >= b.baseY - 1
          // Reading back through history: hold still and offer a jump to the latest.
          if (!atBottom && lastRef.current) { pendingRef.current = ansi; setHeld(true) } else paint(ansi)
        }
      } catch { /* pane gone; the fleet view will update */ }
      if (!stop) t = setTimeout(tick, document.hidden ? 4000 : Date.now() < fastUntil.current ? 150 : 1000)
    }
    kick.current = () => { clearTimeout(t); t = setTimeout(tick, 60) }
    tick()
    return () => { stop = true; clearTimeout(t); kick.current = null }
  }, [paneId, active]) // eslint-disable-line react-hooks/exhaustive-deps

  // Click a numbered menu option ("❯ 1. Yes") to choose it.
  const onClick = (e) => {
    const term = termRef.current
    if (!term || term.hasSelection()) return
    const rect = term.element.querySelector('.xterm-screen')?.getBoundingClientRect()
    if (!rect) return
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * term.rows)
    const b = term.buffer.active
    const y = b.viewportY + row
    const line = b.getLine(y)?.translateToString(true) || ''
    const m = OPTION.exec(line)
    if (!m || y < b.length - 40) return
    // Only when a menu is on screen: a highlighted option nearby.
    let menu = false
    for (let i = Math.max(0, y - 12); i < Math.min(b.length, y + 12); i++) if (/^\s*❯\s*\d\./.test(b.getLine(i)?.translateToString(true) || '')) menu = true
    if (menu) send([{ keys: [m[1]] }])
  }

  return (
    <div className={`live-term ${focused ? 'focused' : ''}`}>
      <div className="terminal-host" ref={hostRef} onClick={onClick}
        onWheel={(e) => { const b = termRef.current?.buffer.active; if (e.deltaY < 0 && b && b.baseY === 0) setNoHistory(true) }} />
      {held && (
        <button className="term-jump" onClick={() => { termRef.current?.scrollToBottom(); if (pendingRef.current != null) paint(pendingRef.current); setHeld(false) }}>
          <Icon name="chevron" size={11} className="rot90" /> New output · jump to latest
        </button>
      )}
      <div className="term-hint">
        {noHistory ? <><span>This agent runs Claude's full-screen view, which keeps its history inside Claude, so there is nothing to scroll here.</span>{onChat && <button className="link" onClick={onChat}>Read it in Chat</button>}<button className="link" onClick={() => setNoHistory(false)}>Dismiss</button></>
          : error ? <span className="error-text">{error}</span>
          : focused ? <><span className="live-dot" /> Typing into the terminal. Esc and arrows go to the agent. Click a numbered option to pick it.</>
            : <>Click the terminal to type. Scroll up to read history.</>}
      </div>
    </div>
  )
}
