import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { StatusDot } from './Icon.jsx'
import { openSettings } from './SignIn.jsx'

// A short walk through the real UI for someone new: the page dims, the part being explained stays
// lit, and a card beside it says what it is. Shown once per device after setup (the phone layout
// has its own steps) and again from Settings › About & updates or ⌘K. Each step points at an
// element marked data-tour="..."; a step whose element isn't on screen is skipped.

// What the status dots mean, drawn with the dots themselves.
const legend = (
  <span className="tour-legend">
    {[['working', 'Working'], ['done', 'Finished'], ['blocked', 'Needs you']].map(([s, label]) => (
      <span key={s}><span aria-hidden="true"><StatusDot status={s} size={9} /></span>{label}</span>
    ))}
  </span>
)

const CHIEF = { at: 'chief', title: 'Your chief of staff', body: 'Tell it what you need in plain words. It hands the work to the right agent, starts a new one when nothing fits, and tells you when it\'s done.' }

// at: the data-tour name to point at. last: always shown (mid-screen if its element isn't there),
// with the first-action button. link: a second button that ends the tour and opens that part of
// Settings.
const STEPS = {
  desktop: [
    { at: 'agents', title: 'Your agents', body: <>Everything you run, grouped in spaces, with its folder and git branch. The dot shows what each one is doing: {legend}</> },
    CHIEF,
    { at: 'views', title: 'Chat or terminal', body: 'Chat is the conversation. Terminal is the agent\'s real screen, live, and you can type in it.' },
    { at: 'composer', title: 'Talk to it', body: 'Type here to send a message: @ adds a file, / runs a command. When an agent asks you something, its question shows up just above as a card you can click.' },
    { at: 'changes', title: 'Review and ship', body: 'Changes shows what the agent edited. Comment on any line to send it feedback, then commit, push and open a pull request from here.' },
    { at: 'usage', title: 'Usage at a glance', body: 'How much of your plan is left: this 5-hour window and this week. Click it for the details, or to switch accounts if you have more than one.' },
    { at: 'settings', title: 'On your phone too, free', body: 'In Settings › Devices, follow the steps and scan the QR code with your phone. Everything between your phone and this computer is end-to-end encrypted, and you get a ping when an agent needs you or finishes.', link: { label: 'Set up phone', section: 'phone' } },
    { at: 'new-agent', title: 'Your turn', body: 'Pick a folder and the agent to work in it, or start a chat with any model. Agents in the same project can each get their own copy, so they don\'t get in each other\'s way.', last: true },
  ],
  // The simple layout: what you need on day one.
  simple: [
    CHIEF,
    { at: 'composer', title: 'Talk to it', body: 'Type here and press Enter. When it asks you something, the question shows up just above as a card you can click.' },
    { at: 'agents', title: 'Your agents', body: <>Everything you run is listed here. The dot shows what each one is doing: {legend}</> },
    { at: 'new-agent', title: 'Your turn', body: 'Start an agent in a project folder, or a chat with any model. Settings › General › Layout shows every panel when you want more.', last: true },
  ],
  phone: [
    { at: 'agents', title: 'Your agents', body: <>Every agent you run and what it's doing: {legend} The badge counts the ones waiting on you.</> },
    CHIEF,
    { at: 'views', title: 'Chat or terminal', body: 'Switch between the conversation, the agent\'s live terminal, its files and its changes.' },
    { at: 'settings', title: 'Get notified', body: 'In Settings › Devices, turn on notifications to hear when an agent needs you or finishes.' },
    { at: 'search', title: 'Your turn', body: 'Search finds any agent, file or command. It\'s also where you start a new agent.', last: true },
  ],
}

// Ask the app to show the tour again.
export const startTour = () => window.dispatchEvent(new CustomEvent('bridge-tour'))

// The first element marked for a step that's actually laid out (not hidden, not zero size).
function find(at) {
  for (const el of document.querySelectorAll(`[data-tour="${at}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}
const showing = (s) => s.last || !!find(s.at)

// Scroll a list (the sidebar, say) just enough to show the element, if it's scrolled out of view.
function reveal(el) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    if (!/auto|scroll/.test(getComputedStyle(p).overflowY)) continue
    const r = el.getBoundingClientRect()
    const b = p.getBoundingClientRect()
    if (r.top < b.top || r.bottom > b.bottom) el.scrollIntoView({ block: 'nearest' })
    return
  }
}

// Where the card goes: beside the lit area where it fits (beside tall things like the sidebar,
// above or below the rest), always inside the safe area of the screen.
function place(hole, card, safe) {
  const m = 12
  const gap = 12
  const S = { top: safe.top + m, left: safe.left + m, right: safe.right - m, bottom: safe.bottom - m }
  const { width: w, height: h } = card
  const x = (v) => Math.max(S.left, Math.min(v, S.right - w))
  const y = (v) => Math.max(S.top, Math.min(v, S.bottom - h))
  if (!hole) return { top: Math.round(y((S.top + S.bottom - h) / 2)), left: Math.round(x((S.left + S.right - w) / 2)) }
  const cx = (hole.left + hole.right) / 2
  const cy = (hole.top + hole.bottom) / 2
  const below = { top: y(hole.bottom + gap), left: x(cx - w / 2), fits: hole.bottom + gap + h <= S.bottom }
  const above = { top: y(hole.top - gap - h), left: x(cx - w / 2), fits: hole.top - gap - h >= S.top }
  const right = { top: y(cy - h / 2), left: x(hole.right + gap), fits: hole.right + gap + w <= S.right }
  const left = { top: y(cy - h / 2), left: x(hole.left - gap - w), fits: hole.left - gap - w >= S.left }
  const tall = hole.bottom - hole.top > (S.bottom - S.top) / 2
  const p = (tall ? [right, left, below, above] : [below, above, right, left]).find((o) => o.fits)
    || { top: y(S.bottom - h), left: x(cx - w / 2) } // too big to sit beside: over its lower edge
  return { top: Math.round(p.top), left: Math.round(p.left) }
}

export default function Tour({ phone, simple, actionLabel, onAction, onClose }) {
  const steps = STEPS[phone ? 'phone' : simple ? 'simple' : 'desktop']
  const [at, setAt] = useState(() => steps.findIndex(showing))
  const [live, setLive] = useState({ avail: [], hole: null })
  const [pos, setPos] = useState(null)
  const cardRef = useRef(null)
  const safeRef = useRef(null)
  const primaryRef = useRef(null)
  const titleId = useId()
  const bodyId = useId()
  const step = steps[at]
  const last = !!step.last

  const next = useCallback(() => {
    const j = steps.findIndex((s, i) => i > at && showing(s))
    if (j >= 0) setAt(j)
  }, [steps, at])
  const prev = useCallback(() => {
    const j = steps.findLastIndex((s, i) => i < at && showing(s))
    if (j >= 0) setAt(j)
  }, [steps, at])

  // Follow the step's element: panes resize and agents come and go while the tour is open, so the
  // lit area and the step dots are re-read a few times a second (and before the first paint).
  useLayoutEffect(() => {
    reveal(find(step.at))
    let seen = ''
    const read = () => {
      const avail = steps.map((s, i) => (showing(s) ? i : -1)).filter((i) => i >= 0)
      const r = find(step.at)?.getBoundingClientRect()
      const vw = document.documentElement.clientWidth
      const vh = window.innerHeight
      const pad = 4
      let hole = r && {
        top: Math.round(Math.max(r.top - pad, 2)), left: Math.round(Math.max(r.left - pad, 2)),
        right: Math.round(Math.min(r.right + pad, vw - 2)), bottom: Math.round(Math.min(r.bottom + pad, vh - 2)),
      }
      if (hole && (hole.right <= hole.left || hole.bottom <= hole.top)) hole = null
      const key = JSON.stringify([avail, hole, vw, vh])
      if (key !== seen) { seen = key; setLive({ avail, hole }) }
    }
    read()
    const t = setInterval(read, 150)
    window.addEventListener('resize', read)
    return () => { clearInterval(t); window.removeEventListener('resize', read) }
  }, [steps, step])

  // The card is laid out unseen first, so it can be measured and then placed.
  useLayoutEffect(() => {
    const card = cardRef.current?.getBoundingClientRect()
    const safe = safeRef.current?.getBoundingClientRect()
    if (!card || !safe) return
    const p = place(live.hole, card, safe)
    setPos((o) => (o && o.top === p.top && o.left === p.left ? o : p))
  }, [live, at])

  // Focus goes into the card, and back where it was afterwards.
  useEffect(() => {
    const back = document.activeElement
    primaryRef.current?.focus({ preventScroll: true })
    return () => { if (back?.isConnected) back.focus?.({ preventScroll: true }) }
  }, [])
  useEffect(() => { if (!cardRef.current?.contains(document.activeElement)) primaryRef.current?.focus({ preventScroll: true }) }, [at])

  // Esc closes, arrows step through, Tab stays inside the card.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); next() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); prev() }
      else if (e.key === 'Tab') {
        const items = [...(cardRef.current?.querySelectorAll('button:not(:disabled)') || [])]
        if (!items.length) return
        const i = items.indexOf(document.activeElement)
        e.preventDefault(); e.stopPropagation()
        items[e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length].focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, next, prev])

  const h = live.hole
  const k = Math.max(0, live.avail.indexOf(at))
  return createPortal(
    // A click on the dimmed page does nothing, and doesn't take focus out of the card.
    <div className={`tour ${phone ? 'phone' : ''}`} onMouseDown={(e) => { if (!cardRef.current?.contains(e.target)) e.preventDefault() }}>
      <div className="tour-safe" ref={safeRef} aria-hidden="true" />
      <div className={`tour-hole ${h ? '' : 'none'}`} aria-hidden="true"
        style={h ? { top: h.top, left: h.left, width: h.right - h.left, height: h.bottom - h.top } : undefined} />
      <div className="tour-card" ref={cardRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}
        style={pos ? { top: pos.top, left: pos.left } : { opacity: 0 }}>
        <button type="button" className="ghost-btn tour-skip" onClick={onClose}>{last ? 'Close' : 'Skip'}</button>
        <div className="tour-text" aria-live="polite">
          <h3 id={titleId}>{step.title}</h3>
          <p id={bodyId}>{step.body}</p>
        </div>
        <footer className="tour-foot">
          {live.avail.length > 1 && (
            <span className="tour-dots" role="img" aria-label={`Step ${k + 1} of ${live.avail.length}`}>
              {live.avail.map((i) => <span key={i} className={i === at ? 'on' : ''} />)}
            </span>
          )}
          {live.avail.some((i) => i < at) && <button type="button" className="btn small" onClick={prev}>Back</button>}
          {step.link && <button type="button" className="btn small" onClick={() => { onClose(); openSettings(step.link.section) }}>{step.link.label}</button>}
          <button type="button" ref={primaryRef} className="btn small primary" onClick={last ? onAction : next}>{last ? actionLabel : 'Next'}</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
