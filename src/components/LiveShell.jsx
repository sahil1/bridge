import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import Terminal from './Terminal.jsx'
import { openSocket, usePoll } from '../api.js'
import disposeTerm from '../disposeTerm.js'
import altArrows from '../altArrows.js'

// A plain terminal you type into, like a terminal app: brew upgrade, a dev server, anything you'd
// run yourself, on whichever machine the window shows. With the built-in runtime it's attached to
// the shell (server/attach.js): keys go straight in, output streams out, and the shell takes this
// view's size, so full-screen programs work too. With herdr, the screen mirror agents use.
export default function LiveShell({ paneId }) {
  const conf = usePoll('/config', 10 * 60 * 1000).data
  if (!conf) return null
  return conf.runtime?.attach ? <Attached paneId={paneId} /> : <Terminal paneId={paneId} active shell />
}

const theme = () => {
  const c = getComputedStyle(document.documentElement)
  return { background: c.getPropertyValue('--term-bg').trim(), foreground: c.getPropertyValue('--term-fg').trim(), cursor: c.getPropertyValue('--term-fg').trim(), selectionBackground: c.getPropertyValue('--accent-soft').trim() || 'rgba(80,130,240,.3)' }
}
const termFont = () => {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--term-font')) || 13
  return window.innerWidth < 700 ? n - 2 : n
}

function Attached({ paneId }) {
  const hostRef = useRef(null)
  const [state, setState] = useState('connecting') // connecting | live | ended | lost
  const [error, setError] = useState(null)

  useEffect(() => {
    const css = getComputedStyle(document.documentElement)
    const term = new XTerm({
      scrollback: 10000, // what the built-in runtime keeps (server/runtime/screen.js)
      fontSize: termFont(),
      fontFamily: css.getPropertyValue('--font-mono').trim() || 'monospace',
      theme: theme(),
      cursorBlink: true,
      macOptionIsMeta: true,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    try { fit.fit() } catch { /* not laid out yet */ }
    // ⌘ shortcuts stay the app's (⌘K, ⌘C, ⌘V still copy and paste).
    term.attachCustomKeyEventHandler((e) => !(e.type === 'keydown' && e.metaKey) && !altArrows(term, e))

    let ws = null
    let stop = false
    let retry = null
    const connect = () => {
      clearTimeout(retry)
      // Its history too, so you can scroll back to before you opened it.
      ws = openSocket(`/api/panes/${encodeURIComponent(paneId)}/attach?cols=${term.cols}&rows=${term.rows}&history=1`)
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => { term.reset(); setState('live'); setError(null) } // a reconnect paints it all again
      ws.onmessage = (e) => {
        const d = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data)
        if (d.startsWith('{"type":')) {
          try {
            const j = JSON.parse(d)
            if (j.type === 'exit') { setState('ended'); return }
            if (j.type === 'error') { setError(j.message); setState('ended'); return }
          } catch { /* output that only looks like it */ }
        }
        term.write(d)
      }
      ws.onclose = () => {
        if (stop) return
        setState((s) => (s === 'ended' ? s : 'lost'))
        // The server restarting, or the connection dropping: pick it up again.
        retry = setTimeout(() => { if (!stop) connect() }, 2000)
      }
    }
    connect()
    const send = (msg) => { if (ws?.readyState === 1) ws.send(msg) }
    const typed = term.onData((d) => send(JSON.stringify({ type: 'input', data: d })))
    // Dictation types here like a paste, without Enter (dictation/controller.js).
    const host = hostRef.current
    const onType = (e) => term.paste(String(e.detail || ''))
    host.addEventListener('bridge-type', onType)
    const sized = term.onResize(({ cols, rows }) => send(JSON.stringify({ type: 'resize', cols, rows })))
    const ro = new ResizeObserver(() => { try { fit.fit() } catch { /* hidden */ } })
    ro.observe(hostRef.current)
    const mo = new MutationObserver(() => {
      term.options.theme = theme()
      if (term.options.fontSize !== termFont()) { term.options.fontSize = termFont(); try { fit.fit() } catch { /* hidden */ } }
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-chrome', 'data-text', 'style'] })
    setTimeout(() => term.focus(), 60)
    return () => {
      stop = true
      clearTimeout(retry)
      typed.dispose(); sized.dispose(); ro.disconnect(); mo.disconnect()
      host.removeEventListener('bridge-type', onType)
      try { ws?.close() } catch { /* closed */ }
      disposeTerm(term)
    }
  }, [paneId])

  return (
    <div className="live-term live-shell">
      <div className="terminal-host" ref={hostRef} />
      <div className="term-hint">
        {error ? <span className="error-text">{error}</span>
          : state === 'ended' ? <span>This terminal has ended. Close its tab, or open a new one.</span>
          : state === 'lost' ? <span>Reconnecting…</span>
          : state === 'connecting' ? <span>Connecting…</span>
          : <span>Type here as you would in any terminal. ⌘C and ⌘V copy and paste.</span>}
      </div>
    </div>
  )
}
