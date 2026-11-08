import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { t } from '../i18n/index.js'
import './aiassist.css'

// AI Assist: the one way into the help a model gives, the same everywhere. A button with the magic
// wand at the right end of a surface's header or toolbar (only More, close and the window's own
// buttons come after it), and a menu of what it does there, each a plain verb: "Draft a reply",
// "Prepare for this meeting", "Sign this", "Look over this folder". One that opens a panel has a
// tick while the panel is open, and picked again closes it. Where help has to stay inline (on a
// slide, by words picked, in a right-click menu) it's the wand and its verb, without the button.
// Its panels start with AssistHead, so each says it's AI Assist and what it's doing. Handing work
// to a coding agent (Ask an agent) isn't AI Assist, and never has the wand.
//   items      [{ label, hint, keys, on, disabled, title, run }], 'sep' or { note }; or a function
//              that gives them, asked as the menu opens (so they're what's true then)
//   on         a panel of AI Assist's is open here
//   compact    the wand alone (a narrow bar), its name on hover and to a screen reader
//   className  the surface's own button look ('btn small', 'win-btn', 'sd-tool')
//   labelClass what hides the name where the surface hides its buttons' names
export default function AiAssist({ items, on = false, compact = false, disabled = false, className = 'btn small', labelClass = '', size = 13, title }) {
  const btn = useRef(null)
  const [open, setOpen] = useState(null) // the items, while the menu is open
  const close = useCallback((refocus) => { setOpen(null); if (refocus) btn.current?.focus({ preventScroll: true }) }, [])
  const toggle = () => setOpen((o) => (o ? null : (typeof items === 'function' ? items() : items) || []))
  return (
    <>
      <button ref={btn} type="button" className={`${className} ai-assist${on ? ' on' : ''}${compact ? ' compact' : ''}`} onClick={toggle} disabled={disabled}
        aria-haspopup="menu" aria-expanded={!!open} aria-label={t('AI Assist')} title={title || t('AI Assist')}>
        <Icon name="wand" size={size} />{!compact && <span className={`ai-assist-label ${labelClass}`}>{t('AI Assist')}</span>}
      </button>
      {open && <AssistMenu anchor={btn} items={open} onClose={close} />}
    </>
  )
}

function AssistMenu({ anchor, items, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  // Under the button, its right edge on the button's, kept on the screen.
  useLayoutEffect(() => {
    const b = anchor.current?.getBoundingClientRect()
    const m = ref.current?.getBoundingClientRect()
    if (!b || !m) return
    const left = Math.max(8, Math.min(b.right - m.width, window.innerWidth - m.width - 8))
    const below = b.bottom + 4
    const top = below + m.height > window.innerHeight - 8 && b.top - m.height - 4 > 8 ? b.top - m.height - 4 : Math.max(8, Math.min(below, window.innerHeight - m.height - 8))
    setPos({ left, top })
  }, [anchor])
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target) && !anchor.current?.contains(e.target)) onClose(false) }
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true) } else if (e.key === 'Tab') onClose(false) }
    const away = () => onClose(false)
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', away)
    window.addEventListener('resize', away)
    ref.current?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true })
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', away); window.removeEventListener('resize', away) }
  }, [anchor, onClose])
  const move = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const bs = [...ref.current.querySelectorAll('button:not(:disabled)')]
    const i = bs.indexOf(document.activeElement)
    bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]?.focus()
  }
  const shown = items.filter(Boolean)
  return createPortal(
    <div ref={ref} className="ai-menu" role="menu" aria-label={t('AI Assist')} data-esc onKeyDown={move} style={pos || { left: -9999, top: 0 }}>
      <div className="ai-menu-head" aria-hidden="true"><Icon name="wand" size={12} /> {t('AI Assist')}</div>
      {shown.map((it, i) => (it === 'sep' ? <div key={i} className="ai-menu-sep" role="separator" />
        : it.note ? <p key={i} className="ai-menu-note">{it.note}</p>
          : (
            <button key={i} type="button" role={it.on != null ? 'menuitemcheckbox' : 'menuitem'} aria-checked={it.on != null ? !!it.on : undefined} className={`ai-item${it.on ? ' on' : ''}`} disabled={!!it.disabled} title={it.title}
              onClick={() => { if (it.disabled) return; onClose(false); it.run() }}>
              <span className="ai-item-text"><span className="ai-item-label">{it.label}</span>{it.hint && <small>{it.hint}</small>}</span>
              {it.keys && <kbd>{it.keys}</kbd>}
              {it.on && <Icon name="check" size={13} className="ai-item-tick" />}
            </button>
          )))}
      {!shown.some((it) => it.label) && !shown.some((it) => it.note) && <p className="ai-menu-note">{t('Nothing for AI Assist to do here yet.')}</p>}
    </div>,
    document.body,
  )
}

// The top of an AI Assist panel: the wand, AI Assist, what it's doing here (and where), then the
// panel's own buttons and its close.
//   what      what it's doing ("Draft a reply"), or where (a folder's name); optional
//   children  the panel's own buttons, before its close
export function AssistHead({ what, whatTitle, children, onClose, closeLabel, className = '' }) {
  return (
    <div className={`ai-head ${className}`}>
      <Icon name="wand" size={14} className="ai-head-wand" />
      <span className="ai-head-titles">
        <b>{t('AI Assist')}</b>
        {what && <span className="ai-head-what" title={whatTitle || (typeof what === 'string' ? what : undefined)}>{what}</span>}
      </span>
      {children}
      {onClose && <button type="button" className="win-btn ai-head-close" onClick={onClose} aria-label={closeLabel || t('Close AI Assist')} title={t('Close')}><Icon name="x" size={13} /></button>}
    </div>
  )
}
