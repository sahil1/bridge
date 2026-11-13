import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import Icon from './Icon.jsx'
import { api } from '../api.js'
import disposeTerm from '../disposeTerm.js'
import gpu from '../termGpu.js'
import altArrows from '../altArrows.js'
import FindBar from './FindBar.jsx'
import termFinder from '../termFind.js'
import touchScroll from '../termTouch.js'
import { t } from '../i18n/index.js'

// Live mirror of a herdr pane you can type into. herdr has no output stream per pane, so the
// screen is re-read (fast while you type) and drawn at the pane's own width, so lines wrap the
// same as in herdr. Keystrokes go to the pane in order. Scrolling up holds the view until you
// jump back down. Clicking a numbered option in a menu picks it.
// The last 1,500 lines while you watch. Scrolling up, everything the runtime keeps (herdr's own
// scrollback, the built-in runtime's 10,000 lines; at most 20,000) is read in before you reach the
// top of those, so the scroll carries on through without stopping, on the line you were reading.
// Drawing that many lines takes a moment on a slower computer, so it's drawn at the first pause in
// your scrolling, or once you're near the top, never in the middle of a scroll.
// An agent showing a full-screen view that takes the mouse (Claude Code's fullscreen one) keeps its
// history itself: there the wheel and a swipe go to it, as in a terminal app, and it scrolls.
const LIVE_LINES = 1500
const MAX_LINES = 20000
const NEAR_TOP = 1000 // lines from the top of what's read in: read the rest in now
const PAUSE = 150 // ms without scrolling: a pause, to draw what was read in

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

// A plain shell has no input box: typing goes at the end of its last line (the prompt).
function shellCursor(term) {
  const b = term.buffer.active
  for (let y = b.length - 1; y >= Math.max(0, b.length - term.rows); y--) {
    const text = b.getLine(y)?.translateToString(true) || ''
    if (!text.trim()) continue
    const row = y - b.baseY + 1
    if (row >= 1 && row <= term.rows) { term.write(`\x1b[?25h\x1b[${row};${Math.min(term.cols, text.length + 1)}H`); return }
    break
  }
  term.write('\x1b[?25l')
}

// n rows of a buffer from row y, as plain text.
function rowsText(b, y, n) {
  const out = []
  for (let i = y; i < y + n; i++) out.push(b.getLine(i)?.translateToString(true) ?? '')
  return out.join('\n')
}

// Where the rows kept from before ({ at, len, text }) are in the buffer now that it goes further
// back: as far down as the lines read in above them, or nearby when the agent printed more below
// meanwhile (or the runtime dropped its oldest lines), the nearest place they match.
function findRows(b, keep) {
  const want = keep.at + b.length - keep.len
  const n = keep.text.split('\n').length
  const first = keep.text.split('\n')[0]
  for (let d = 0; d <= 4000; d++) {
    for (const y of d ? [want + d, want - d] : [want]) {
      if (y >= 0 && y + n <= b.length && (b.getLine(y)?.translateToString(true) ?? '') === first && rowsText(b, y, n) === keep.text) return y
    }
  }
  return Math.max(0, Math.min(want, b.length - 1))
}

// Text size from Appearance (one step smaller on a phone).
const termFont = () => {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--term-font')) || 13
  return window.innerWidth < 700 ? n - 2 : n
}

// shell: a plain shell rather than an agent (no input box to find, no agent's history to explain).
export default function Terminal({ paneId, active, focusKey, onChat, shell = false }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const lastRef = useRef('')
  const colsRef = useRef(null)
  const fastUntil = useRef(0)
  const kick = useRef(null)
  const pendingRef = useRef(null)
  const growRef = useRef(null) // { want, ansi, live }: reading further back; ansi once it's in, not yet drawn
  const scrolledAt = useRef(0) // when you last scrolled
  const pauseRef = useRef(null) // the timer that draws it at a pause
  const allRef = useRef(false) // what's drawn is all the runtime keeps: nothing more above
  const modesRef = useRef(null) // { alt, mouse } as the built-in runtime says (herdr: unknown)
  const heldRef = useRef(false)
  const paintingRef = useRef(false) // a paint is writing: the scrolling it causes isn't yours
  // The xterm and its key handlers are made once, but the same panel is reused when you switch
  // agents: keystrokes must go to the agent on screen now, not the one the panel first showed.
  const paneRef = useRef(paneId)
  paneRef.current = paneId
  const [focused, setFocused] = useState(false)
  const [held, setHeldState] = useState(false)
  const setHeld = (v) => { heldRef.current = v; setHeldState(v) }
  const [more, setMore] = useState(null) // 'loading' | 'all': reading earlier output, or that's all there is
  const [error, setError] = useState(null)
  const [noHistory, setNoHistory] = useState(false)
  const wrapRef = useRef(null)
  const [finder] = useState(termFinder) // Find (⌘F), in the whole buffer

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
      // xterm's scrollbar lies over the right edge of the terminal (its own, not the browser's).
      const bar = term.element?.querySelector('.xterm-scrollable-element > .scrollbar.vertical')?.offsetWidth || 0
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
      scrollback: MAX_LINES + 200,
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
    gpu(term)
    finder.attach(term)
    termRef.current = term
    fitRef.current = fit
    layout()

    // Keys: let ⌘ shortcuts reach the app (⌘K, ⌘C, ⌘V); Shift+Enter is a newline in agents.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.metaKey) return false
      if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); send([{ keys: ['shift+enter'] }]); return false }
      return !altArrows(term, e)
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
    // Dictation types here like a paste, without Enter (dictation/controller.js).
    const host = hostRef.current
    const onType = (e) => term.paste(String(e.detail || ''))
    host.addEventListener('bridge-type', onType)
    // You scrolled (the wheel, the scrollbar, the keyboard or a finger): back at the bottom, the
    // latest again; nearing the top of what's read in, the rest is read in now, so you never wait
    // at the top; at the very top of all of it, that's said.
    const scrolled = () => {
      if (paintingRef.current) return
      scrolledAt.current = Date.now()
      const b = term.buffer.active
      if (b.viewportY >= b.baseY - 1) {
        setHeld(false)
        setMore(null)
        growRef.current = null
        clearTimeout(pauseRef.current)
        if (pendingRef.current != null) paint(pendingRef.current)
        return
      }
      // Further back is in: drawn near the top, or once you pause.
      if (growRef.current?.ansi != null) {
        clearTimeout(pauseRef.current)
        if (b.viewportY <= term.rows * 2) drawHistory()
        else pauseRef.current = setTimeout(drawHistory, PAUSE)
        return
      }
      if (b.viewportY <= NEAR_TOP && !allRef.current && !growRef.current) {
        growRef.current = { want: MAX_LINES }
        setMore('loading')
        kick.current?.()
        return
      }
      if (!growRef.current) setMore(b.viewportY === 0 && allRef.current && !modesRef.current?.alt ? 'all' : null)
    }
    const onScroll = term.onScroll(scrolled)
    // One line's height as drawn now.
    const lineHeight = () => (term.element?.querySelector('.xterm-screen')?.getBoundingClientRect().height || 0) / term.rows
    // A full-screen app that takes the mouse (Claude Code's fullscreen view) keeps its history
    // itself and scrolls it as the wheel turns, as it would in a terminal app: the wheel goes to it
    // (each line of the wheel's turn one report, sent together every 50 ms). One that doesn't:
    // there's nothing here to scroll, and that's said.
    let wheelQ = 0
    let wheelRest = 0
    let wheelT = null
    const wheelTo = (n) => {
      wheelQ += n
      if (wheelT) return
      wheelT = setTimeout(() => {
        wheelT = null
        const q = Math.max(-60, Math.min(60, wheelQ))
        wheelQ = 0
        if (q) send([{ keys: Array(Math.abs(q)).fill(q < 0 ? 'wheelup' : 'wheeldown') }])
      }, 50)
    }
    const toApp = () => !!(modesRef.current?.alt && modesRef.current.mouse)
    const onWheel = (e) => {
      if (toApp()) {
        e.preventDefault()
        e.stopPropagation() // not xterm's own scrolling of what's drawn here
        const h = lineHeight() || 16
        wheelRest += e.deltaMode === 1 ? e.deltaY : e.deltaMode === 2 ? e.deltaY * term.rows : e.deltaY / h
        const n = Math.trunc(wheelRest)
        if (n) { wheelRest -= n; wheelTo(Math.max(-5, Math.min(5, n))) }
        return
      }
      const b = term.buffer.active
      // herdr doesn't say: no scrollback at all means a full-screen view.
      const alt = modesRef.current ? modesRef.current.alt : b.baseY === 0
      if (!shell && e.deltaY < 0 && alt && b.viewportY === 0) setNoHistory(true)
    }
    host.addEventListener('wheel', onWheel, { capture: true, passive: false })
    // A finger scrolls it too (xterm.js 6 doesn't), or the app's own history, as the wheel does
    // (a report for every three lines the finger moves, as the app scrolls three at a time).
    let fingerRest = 0
    const untouch = touchScroll(host, {
      lineHeight,
      scroll: (n) => {
        if (!toApp()) { term.scrollLines(n); return }
        fingerRest += n
        const r = Math.trunc(fingerRest / 3)
        if (r) { fingerRest -= r * 3; wheelTo(r) }
      },
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
      host.removeEventListener('bridge-type', onType)
      host.removeEventListener('wheel', onWheel, { capture: true })
      untouch(); clearTimeout(wheelT); clearTimeout(pauseRef.current)
      ta?.removeEventListener('focus', onFocus); ta?.removeEventListener('blur', onBlur)
      finder.detach()
      disposeTerm(term); termRef.current = null; lastRef.current = ''
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (steps) => {
    if (!steps.length || !paneRef.current) return
    fastUntil.current = Date.now() + 2500
    try { await api(`/panes/${encodeURIComponent(paneRef.current)}/input`, { method: 'POST', body: { steps } }); setError(null) } catch (e) { setError(e.message) }
    kick.current?.()
  }

  // history: what's read in goes further back, while you're reading: stay on the lines you're
  // reading, found again in it (what the agent printed meanwhile goes in below them).
  const paint = (ansi, { history = false } = {}) => {
    const term = termRef.current
    if (!term) return
    pendingRef.current = null
    paintingRef.current = true
    // Find's current match, found again once it's drawn (the lines read further back go in above),
    // and the lines you're reading: both taken just before the new lines go in, in the same turn,
    // so a page you scrolled meanwhile counts.
    let mark = null
    let keep = null
    term.write('', () => {
      mark = finder.mark()
      const b = term.buffer.active
      keep = history && b.viewportY < b.baseY - 1 ? { at: b.viewportY, len: b.length, text: rowsText(b, b.viewportY, Math.min(term.rows, 12)) } : null
    })
    // The agent's screen is often taller than what it drew (a short prompt at the top of a tall
    // terminal); drop the blank rows below, so the view doesn't scroll down to empty space.
    // Claude also pads the space between its output and its input box with empty rows; on a view
    // shorter than the pane that pushed everything but the input box off screen, so it looked
    // stuck. Shorten each long run to two rows.
    // eslint-disable-next-line no-control-regex
    const blank = /^(?:\x1b\[[0-9;?]*[A-Za-z]|[ \t\r])*$/
    // Rows end in CRLF (herdr, the built-in runtime); a bare LF would leave each row where the last ended.
    const raw = ansi.split('\n')
    const lines = raw.map((l) => l.replace(/\r$/, '')).filter((l, i, all) => !(blank.test(l) && i > 0 && blank.test(all[i - 1]) && blank.test(all[i + 1] ?? '')))
    // The reset goes in with the lines (ESC c, as term.reset() does), so no frame shows the
    // terminal empty or half drawn: what's on screen changes once, when it's all in.
    // eslint-disable-next-line no-control-regex
    term.write(`\x1bc${lines.join('\r\n').replace(/(?:\r?\n(?:\x1b\[[0-9;?]*[A-Za-z]|[ \t])*)+$/, '')}`, () => {
      let moved = 0
      if (keep) {
        const at = findRows(term.buffer.active, keep)
        term.scrollToLine(at)
        moved = at - keep.at
      } else term.scrollToBottom()
      finder.restore(mark, moved)
      // All the runtime keeps is in when a read further back came in, or a light read wasn't full.
      allRef.current = history || raw.length < LIVE_LINES
      ;(shell ? shellCursor : placeCursor)(term)
      paintingRef.current = false
    })
  }

  // What was read further back, drawn now, the view where you were reading, the latest below it.
  const drawHistory = () => {
    const g = growRef.current
    clearTimeout(pauseRef.current)
    if (!termRef.current || g?.ansi == null) return
    growRef.current = null
    lastRef.current = g.live
    setHeld(false)
    setMore(null)
    paint(g.ansi, { history: true })
  }

  // Asked to take the keyboard (e.g. after a slash command opened a picker in the agent).
  useEffect(() => { if (focusKey && active) setTimeout(() => termRef.current?.focus(), 80) }, [focusKey, active])

  useEffect(() => {
    lastRef.current = ''
    pendingRef.current = null
    growRef.current = null
    clearTimeout(pauseRef.current)
    allRef.current = false
    modesRef.current = null
    setHeld(false)
    setMore(null)
    termRef.current?.reset()
  }, [paneId])

  useEffect(() => {
    if (!active || !paneId) return
    let stop = false
    let t = null
    // One read at a time: asked for another while one is out (a keystroke, reading further back),
    // it goes as soon as that one is in.
    let reading = false
    let again = false
    const tick = async () => {
      clearTimeout(t)
      if (reading) { again = true; return }
      reading = true
      let atBottom = true
      try {
        // The last lines (light, read often), or everything kept when you've scrolled near the top.
        const grow = growRef.current?.ansi == null ? growRef.current : null
        const r = await api(`/agents/${encodeURIComponent(paneId)}/screen?lines=${grow ? grow.want : LIVE_LINES}`)
        const { ansi, cols } = r
        modesRef.current = typeof r.alt === 'boolean' ? { alt: r.alt, mouse: !!r.mouse } : null
        if (cols && cols !== colsRef.current) { colsRef.current = cols; layout(); lastRef.current = '' }
        const term = termRef.current
        if (!stop && term) {
          const b = term.buffer.active
          atBottom = b.viewportY >= b.baseY - 1
          // What the light read would have been: its last lines.
          const live = grow ? ansi.split('\n').slice(-LIVE_LINES).join('\n') : ansi
          if (grow && growRef.current === grow) {
            // Further back, as asked: drawn now, or at the first pause while you're scrolling.
            grow.ansi = ansi
            grow.live = live
            if (Date.now() - scrolledAt.current < PAUSE && b.viewportY > term.rows * 2) pauseRef.current = setTimeout(drawHistory, PAUSE)
            else drawHistory()
          } else if (live !== lastRef.current) {
            // Reading back through history: hold still and offer a jump to the latest.
            if (!atBottom && lastRef.current) { pendingRef.current = live; setHeld(true) } else paint(live)
            lastRef.current = live
          }
        }
      } catch { /* pane gone; the fleet view will update */ }
      reading = false
      if (stop) return
      if (again) { again = false; t = setTimeout(tick, 0); return }
      // Reading back through history: less often (what's new waits for you below).
      t = setTimeout(tick, document.hidden ? 4000 : Date.now() < fastUntil.current ? 150 : heldRef.current || !atBottom ? 3000 : 1000)
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
    <div className={`live-term ${focused ? 'focused' : ''}`} data-find="terminal" ref={wrapRef}>
      <FindBar host={wrapRef} finder={finder} label={t('Find in this terminal')} />
      <div className="terminal-host" ref={hostRef} onClick={onClick} />
      {held && (
        <button className="term-jump" onClick={() => { termRef.current?.scrollToBottom(); if (pendingRef.current != null) paint(pendingRef.current); setHeld(false) }}>
          <Icon name="chevron" size={11} className="rot90" /> {t('New output · jump to latest')}
        </button>
      )}
      <div className="term-hint">
        {noHistory ? <><span>{t('This agent runs Claude\'s full-screen view, which keeps its history inside Claude, so there is nothing to scroll here.')}</span>{onChat && <button className="link" onClick={onChat}>{t('Read it in Chat')}</button>}<button className="link" onClick={() => setNoHistory(false)}>{t('Dismiss')}</button></>
          : error ? <span className="error-text">{error}</span>
          : more === 'loading' ? <span>{t('Loading earlier output…')}</span>
          : more === 'all' ? <span>{t('That\'s as far back as this terminal keeps.')}</span>
          : focused ? <><span className="live-dot" /> {shell ? t('Typing into the terminal.') : t('Typing into the terminal. Esc and arrows go to the agent. Click a numbered option to pick it.')}</>
            : <>{t('Click the terminal to type. Scroll up to read history.')}</>}
      </div>
    </div>
  )
}
