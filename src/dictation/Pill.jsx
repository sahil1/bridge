import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { t } from '../i18n/index.js'

// The pill dictation shows while it listens, from another app (Hud.jsx, the desktop app's window
// under the menu bar) and inside Bridge AI (Dictation.jsx, at the bottom of the window): the level
// as a line of bars moving right to left, how long, where the words go, ✕ (Esc) and ✓. Then
// "Transcribing…", then what became of the words for a moment, and it's gone. Where there's more
// to show (the words to send or copy, why they weren't pasted, the speech model to download), it
// grows into a card, and back. The meeting card's look: its red dot, its rounding, its hairline
// ring and small shadow, in light and dark.

// A box that eases to the size of what's in it (Morph), so the pill grows into the card and back
// instead of jumping: what's in it lays out at its own size, anchored to the top (or the bottom)
// and the middle, and the box follows. onSize({ w, h }): the most room it takes while it eases
// (the dictation window fits itself to that).
export function Morph({ className = '', anchor = 'top', onSize, children, ...rest }) {
  const outer = useRef(null)
  const inner = useRef(null)
  const [size, setSize] = useState(null)
  const report = useRef(onSize)
  report.current = onSize
  useLayoutEffect(() => {
    const a = inner.current, b = outer.current
    if (!a || !b) return
    const fit = () => {
      const w = a.offsetWidth, h = a.offsetHeight
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }))
      report.current?.({ w: Math.max(w, b.offsetWidth), h: Math.max(h, b.offsetHeight) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(a)
    ro.observe(b)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={outer} className={`dp ${anchor === 'bottom' ? 'dp-up' : ''} ${className}`} style={size ? { width: size.w, height: size.h } : undefined} {...rest}>
      <div ref={inner} className="dp-in">{children}</div>
    </div>
  )
}

// How loud, the last couple of seconds: each bar a moment, the newest on the right. Busy (turning it
// into text): the bars rock gently in a wave instead.
export function Wave({ levels = [], busy = false }) {
  return (
    <span className={`dp-wave${busy ? ' busy' : ''}`} aria-hidden="true">
      {levels.map((v, i) => <i key={i} style={busy ? { '--i': i } : { transform: `scaleY(${Math.max(0.14, Math.min(1, Math.sqrt(v) * 1.6))})` }} />)}
    </span>
  )
}

export function Clock({ since }) {
  const [, tick] = useState(0)
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(id) }, [])
  const secs = Math.max(0, Math.floor((Date.now() - since) / 1000))
  return <span className="dp-time">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
}

// Listening: the dot, the bars, the time, where it goes (to: a label or a picker), ✕ and ✓.
// hint: what the key does now, said to screen readers and on hover.
export function Listening({ s, to, hint, onCancel, onStop }) {
  return (
    <div className="dp-row dp-listening" role="status" aria-label={hint} title={hint}>
      <span className="rec-dot" aria-hidden="true" />
      <Wave levels={s.levels} />
      <Clock since={s.since} />
      {to}
      <span className="dp-acts">
        <button type="button" className="dp-x" onClick={onCancel} aria-label={t('Cancel')} title={t('Cancel (Esc)')}><Icon name="x" size={13} /></button>
        <button type="button" className="dp-ok" onClick={onStop} disabled={s.phase !== 'listening'} aria-label={t('Stop and transcribe')} title={t('Stop and transcribe')}><Icon name="check" size={13} /></button>
      </span>
    </div>
  )
}

// Turning it into text (or pasting it): the bars rocking gently, and what it's doing.
export function Working({ s, text }) {
  return (
    <div className="dp-row dp-working" role="status">
      <Wave levels={s.levels} busy />
      <span className="dp-what">{text || t('Transcribing…')}</span>
    </div>
  )
}

// What became of the words, for a moment.
export function Done({ text, warn = false }) {
  return (
    <div className={`dp-row dp-done${warn ? ' warn' : ''}`} role="status">
      <span className="dp-tick" aria-hidden="true"><Icon name={warn ? 'info' : 'check'} size={12} /></span>
      <span className="dp-what">{text}</span>
    </div>
  )
}
