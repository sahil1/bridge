import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import { store } from '../layout.jsx'
import { t } from '../../i18n/index.js'
import './settings.css'

// Settings, in two parts: what most people change first, then Advanced, folded away at the end of
// each section. A section marks what's advanced with <Advanced>, wherever it is in the section
// (Voice's dictation, Devices' notifications), and AdvancedFrame gathers it all, by `order`, into
// one Advanced at the end: closed until it's opened, then kept open or closed for that section on
// this device. A section with nothing advanced has none. Outside Settings, <Advanced> shows in place.
// ⌘K and links reach a setting in it all the same (reveal, below; search.js).
const KEY = 'cc-settings-advanced'
const Parts = createContext(undefined)

export function AdvancedFrame({ section, children }) {
  const [box, setBox] = useState(null)
  const [open, setOpen] = useState(() => store.get(KEY, {})?.[section] === true)
  const [what, setWhat] = useState(null) // what's in it, by its headings; null: nothing
  const parts = useMemo(() => ({ box }), [box])
  // What's in it, by its headings, said beside Advanced while it's closed; with nothing in it (a part
  // with nothing to show here), no Advanced.
  useEffect(() => {
    if (!box) return undefined
    const read = () => setWhat(box.querySelector('.st-adv-part > *') ? [...new Set([...box.querySelectorAll('h4, .st-line-label')].map((h) => h.textContent.trim()).filter(Boolean))].join(', ') : null)
    read()
    const mo = new MutationObserver(read)
    mo.observe(box, { childList: true, subtree: true, characterData: true })
    return () => mo.disconnect()
  }, [box])
  // Kept as you leave it, with a click (or Enter) on Advanced; opened to show a setting found from
  // ⌘K or a link, it isn't.
  const keep = (e) => store.set(KEY, { ...store.get(KEY, {}), [section]: !e.currentTarget.parentElement.open })
  return (
    <Parts.Provider value={parts}>
      {children}
      <details className="st-adv" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} hidden={what == null} data-section={section}>
        <summary onClick={keep}><Icon name="chevron" size={13} /><span>{t('Advanced')}</span>{!open && what && <span className="st-adv-what">{what}</span>}</summary>
        <div className="st-adv-parts" ref={setBox} />
      </details>
    </Parts.Provider>
  )
}

export function Advanced({ order = 50, children }) {
  const parts = useContext(Parts)
  const [el] = useState(() => document.createElement('div'))
  useLayoutEffect(() => {
    if (!parts?.box) return undefined
    el.className = 'st-adv-part'
    el.dataset.order = order
    const after = [...parts.box.children].find((c) => Number(c.dataset.order) > order)
    parts.box.insertBefore(el, after || null)
    return () => el.remove()
  }, [parts, order, el])
  if (parts === undefined) return children
  return parts.box ? createPortal(children, el) : null
}

// Shows one setting (its data-setting, search.js) in the Settings window: once its section has
// loaded it, the Advanced it's in opened, scrolled to the top of the panel and marked for a moment,
// and kept there while the rest of the section comes, until you scroll, tap or type there. near:
// what to show instead when it isn't there a moment after that has come (dictation's extras while
// dictation is off). False if neither came.
// Kept as each change is made, before anything else can see the page (the browser keeps what's at
// the top in place, which on a slow computer is what's still coming: Set up's list, Permissions), so
// what comes above it never moves it, not even for a moment for a click; room coming below takes it
// up to the top, where it was meant to be. Kept until you act (20 seconds at most), not just a
// moment: on a busy computer the rest can take seconds.
let keeping = null
export function reveal(id, near = null) {
  return new Promise((done) => {
    const started = Date.now()
    let nearSince = 0
    const find = (x) => x && document.querySelector(`.modal.settings [data-setting~="${CSS.escape(x)}"]`)
    const look = () => {
      let el = find(id)
      if (!el && find(near)) {
        nearSince = nearSince || Date.now()
        if (Date.now() - nearSince > 1500) el = find(near)
      }
      if (!el) { if (Date.now() - started < 8000) setTimeout(look, 100); else done(false); return }
      for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true
      const box = el.closest('.st-scroll')
      keeping?.()
      el.scrollIntoView({ block: 'start' })
      el.classList.remove('st-found')
      void el.offsetWidth
      el.classList.add('st-found')
      setTimeout(() => el.classList.remove('st-found'), 2400)
      if (box) {
        const keep = () => {
          if (!el.isConnected || !box.isConnected) return stop()
          el.scrollIntoView({ block: 'start' })
        }
        // Each change to the page, as it's made; a size that changes without one (a font, a picture), a frame later.
        const mo = new MutationObserver(keep)
        mo.observe(box, { childList: true, subtree: true, attributes: true, characterData: true })
        const ro = window.ResizeObserver ? new ResizeObserver(keep) : null
        for (const c of box.children) ro?.observe(c)
        // You acting there: scrolling (a scroll bar too, which a press on starts), a tap or a key.
        const evs = ['wheel', 'touchstart', 'pointerdown', 'keydown']
        const stop = () => {
          mo.disconnect()
          ro?.disconnect()
          clearTimeout(timer)
          for (const ev of evs) box.removeEventListener(ev, stop)
          if (keeping === stop) keeping = null
        }
        const timer = setTimeout(stop, 20000)
        for (const ev of evs) box.addEventListener(ev, stop)
        keeping = stop
      }
      done(true)
    }
    look()
  })
}

// One setting as a row: its name, at most one short line under it, and the control beside them
// (under them on a phone). title: the rest, on hover. setting: its id for ⌘K and links (search.js).
export function Line({ label, hint, title, setting, className = '', children }) {
  return (
    <div className={`st-line ${className}`} data-setting={setting}>
      <div className="st-line-text" title={title}><span className="st-line-label">{label}</span>{hint && <span className="muted small">{hint}</span>}</div>
      <div className="st-line-ctl">{children}</div>
    </div>
  )
}
