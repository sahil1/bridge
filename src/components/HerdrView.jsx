import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import Icon from './Icon.jsx'
import { usePersisted } from './layout.jsx'
import disposeTerm from '../disposeTerm.js'

// One Dark, matching herdr's theme and Ghostty's default.
const ONE_DARK = {
  background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', cursorAccent: '#282c34', selectionBackground: '#3e4452',
  black: '#3f4451', red: '#e05561', green: '#8cc265', yellow: '#d18f52', blue: '#4aa5f0', magenta: '#c162de', cyan: '#42b3c2', white: '#d7dae0',
  brightBlack: '#4f5666', brightRed: '#ff616e', brightGreen: '#a5e075', brightYellow: '#f0a45d', brightBlue: '#4dc4ff', brightMagenta: '#de73ff', brightCyan: '#4cd1e0', brightWhite: '#e6e6e6',
}

const TOUCH_KEYS = [
  ['⌃b', '\x02'], ['Esc', '\x1b'], ['Tab', '\t'], ['⇧Tab', '\x1b[Z'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'], ['⏎', '\r'], ['⌃c', '\x03'],
]

export default function HerdrView({ active, onViewHotkey }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const fitRef = useRef(null)
  const wsRef = useRef(null)
  const [status, setStatus] = useState('idle')
  const [session, setSession] = useState(null)
  const [fontSize, setFontSize] = usePersisted('cc-herdr-font', window.innerWidth < 700 ? 10 : 13)
  const [started, setStarted] = useState(false)
  const touch = window.matchMedia('(pointer: coarse)').matches

  // Attach only while this view is on screen: herdr sizes the session to its clients,
  // so an idle hidden client would keep influencing your layout.
  const [visible, setVisible] = useState(!document.hidden)
  useEffect(() => {
    const on = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  useEffect(() => {
    if (active && visible) { setStarted(true); return }
    const t = setTimeout(() => setStarted(false), 4000) // brief grace for quick view flips
    return () => clearTimeout(t)
  }, [active, visible])

  // Create the terminal once, on first show; keep it alive across view switches.
  useEffect(() => {
    if (!started) return
    const term = new XTerm({
      fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      fontSize,
      lineHeight: 1.0,
      allowProposedApi: true,
      cursorBlink: false,
      scrollback: 0,
      macOptionIsMeta: true,
      theme: ONE_DARK,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.open(hostRef.current)
    // Alt+1 / Alt+2 switch views even while the terminal has focus.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.altKey && (e.code === 'Digit1' || e.code === 'Digit2')) { onViewHotkey?.(e.code === 'Digit1' ? 'command' : 'herdr'); return false }
      return true
    })
    termRef.current = term
    fitRef.current = fit
    fit.fit()

    const send = (data) => { if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify({ type: 'input', data })) }
    term.onData(send)
    term.onResize(({ cols, rows }) => { if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows })) })

    let retry
    let closed = false
    const connect = () => {
      setStatus('connecting')
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/api/tty?cols=${term.cols}&rows=${term.rows}`)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws
      ws.onmessage = (ev) => {
        const d = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)
        if (d.startsWith('{"type":')) {
          try {
            const m = JSON.parse(d)
            if (m.type === 'ready') { setSession(m.session); setStatus('live'); term.focus(); return }
            if (m.type === 'error') { setStatus(m.message); return }
            if (m.type === 'exit') { setStatus('detached'); return }
          } catch { /* terminal output that happens to look like JSON */ }
        }
        term.write(d)
      }
      ws.onclose = (ev) => {
        if (closed) return
        if (ev.code === 4001) { setStatus('Screen too narrow for herdr; use Terminals'); return }
        setStatus((s) => (s === 'live' || s === 'connecting' ? 'reconnecting' : s))
        retry = setTimeout(connect, 2500)
      }
    }
    connect()

    const ro = new ResizeObserver(() => { try { fit.fit() } catch { /* hidden */ } })
    ro.observe(hostRef.current)
    return () => { closed = true; clearTimeout(retry); ro.disconnect(); wsRef.current?.close(); disposeTerm(term); termRef.current = null; setStatus('idle') }
  }, [started]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fontSize
    try { fitRef.current.fit() } catch { /* hidden */ }
  }, [fontSize])

  useEffect(() => {
    if (!active || !termRef.current) return
    requestAnimationFrame(() => { try { fitRef.current.fit() } catch { /* hidden */ } termRef.current.focus() })
  }, [active])

  const reconnect = () => wsRef.current?.close()
  const sendRaw = (data) => {
    if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify({ type: 'input', data }))
    termRef.current?.focus()
  }

  return (
    <section className="herdr-view" hidden={!active} aria-label="Herdr">
      <div className="herdr-bar">
        <span className={`conn conn-${status === 'live' ? 'live' : status === 'connecting' || status === 'reconnecting' ? 'wait' : 'off'}`}>
          <span className="conn-dot" />{status === 'live' ? `herdr · ${session}` : status}
        </span>
        <span className="herdr-hint">Your herdr, live. Same keys: prefix <kbd>ctrl</kbd>+<kbd>b</kbd>. <kbd>alt</kbd>+<kbd>1</kbd> back to Command.</span>
        <div className="herdr-tools">
          <button className="win-btn" onClick={() => setFontSize(Math.max(8, fontSize - 1))} aria-label="Smaller text" title="Smaller text"><Icon name="minus" size={14} /></button>
          <span className="font-size">{fontSize}</span>
          <button className="win-btn" onClick={() => setFontSize(Math.min(22, fontSize + 1))} aria-label="Larger text" title="Larger text"><Icon name="plus" size={14} /></button>
          <button className="win-btn" onClick={reconnect} aria-label="Reconnect" title="Reconnect"><Icon name="refresh" size={14} /></button>
        </div>
      </div>
      <div className="herdr-term" ref={hostRef} onClick={() => termRef.current?.focus()} />
      {touch && (
        <div className="herdr-keys">
          {TOUCH_KEYS.map(([label, seq]) => <button key={label} className="key" onClick={() => sendRaw(seq)}>{label}</button>)}
        </div>
      )}
    </section>
  )
}
