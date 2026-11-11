import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { useNav, back, forward, go, places, KEYS } from '../backForward.js'
import { t } from '../i18n/index.js'
import './backforward.css'

// ‹ and › at the start of the top bar, after the sidebar's button, as Safari's and Finder's are
// (src/backForward.js): each greyed while there's nowhere to go that way. Held a moment, or
// right-clicked, each lists the places that way, nearest first, as Chrome's do; one picked is shown.
export default function BackForward() {
  const s = useNav()
  const [menu, setMenu] = useState(null) // { dir, x, y }
  const held = useRef({ timer: 0, opened: false })
  useEffect(() => () => clearTimeout(held.current.timer), [])
  if (!s.on) return null
  const list = (dir, el) => { const r = el.getBoundingClientRect(); setMenu({ dir, x: r.left, y: r.bottom }) }
  const btn = (dir) => (
    <button type="button" className="win-btn nav-btn" data-dir={dir} disabled={!s[dir]}
      aria-label={dir === 'back' ? t('Back') : t('Forward')} aria-expanded={menu?.dir === dir ? true : undefined}
      title={dir === 'back' ? t('Back ({key}). Hold or right-click to see where you\'ve been', { key: KEYS.back }) : t('Forward ({key}). Hold or right-click to see where you went next', { key: KEYS.forward })}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const el = e.currentTarget
        clearTimeout(held.current.timer)
        held.current.opened = false
        held.current.timer = setTimeout(() => { held.current.opened = true; list(dir, el) }, 450)
      }}
      onPointerUp={() => clearTimeout(held.current.timer)}
      onPointerLeave={() => clearTimeout(held.current.timer)}
      onClick={() => {
        // A hold opened the list: letting go there isn't a click.
        if (held.current.opened) { held.current.opened = false; return }
        if (dir === 'back') back(); else forward()
      }}
      onContextMenu={(e) => { e.preventDefault(); clearTimeout(held.current.timer); list(dir, e.currentTarget) }}>
      <Icon name={dir === 'back' ? 'back' : 'chevron'} size={16} />
    </button>
  )
  return (
    <>
      <span className="nav-arrows">{btn('back')}{btn('forward')}</span>
      {menu && <Places {...menu} onClose={() => setMenu(null)} />}
    </>
  )
}

// The places one way, under its button (on the page itself, as the tab groups' menu is).
function Places({ dir, x, y, onClose }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [items] = useState(() => places(dir))
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) closeRef.current() }
    const key = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const all = [...(ref.current?.querySelectorAll('button') || [])]
      const i = all.indexOf(document.activeElement)
      all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus()
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    ref.current?.querySelector('button')?.focus()
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true) }
  }, [])
  // Nothing that way (every tab there closed since): said, rather than an empty menu.
  return createPortal(
    <div className="menu nav-menu" ref={ref} role="menu" data-esc aria-label={dir === 'back' ? t('Where you\'ve been') : t('Where you went next')} style={{ top: y + 4, left: Math.max(8, Math.min(x, window.innerWidth - 300)) }}>
      {items.length ? items.map((it) => (
        <button key={it.i} type="button" role="menuitem" className="menu-item" onClick={() => { onClose(); go(it.i) }}>
          <Icon name={it.icon || 'dot'} size={13} /> <span className="nav-label">{it.label || t('Untitled')}</span>
        </button>
      )) : <p className="muted small nav-none">{t('Nowhere to go: those tabs are closed.')}</p>}
    </div>, document.body)
}
