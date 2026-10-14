import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Icon from './Icon.jsx'

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } },
}

// State that survives reloads (pane sizes, minimized flags, open sections).
export function usePersisted(key, initial) {
  const [v, setV] = useState(() => {
    const saved = store.get(key, null)
    const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
    return isObj(initial) && isObj(saved) ? { ...initial, ...saved } : saved ?? initial
  })
  useEffect(() => { store.set(key, v) }, [key, v])
  return [v, setV]
}

// Drag handle between two panes. `axis` x resizes widths, y resizes heights.
// `invert` when the sized pane sits after the handle (right or bottom).
export function Handle({ axis = 'x', size, min, max, invert = false, onSize, onToggle, label }) {
  const start = useRef(null)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = (e) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { pos: axis === 'x' ? e.clientX : e.clientY, size }
    setDragging(true)
  }
  const onPointerMove = (e) => {
    if (!start.current) return
    const delta = (axis === 'x' ? e.clientX : e.clientY) - start.current.pos
    const next = start.current.size + (invert ? -delta : delta)
    onSize(Math.round(Math.max(min, Math.min(max, next))))
  }
  const end = () => { start.current = null; setDragging(false) }
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 48 : 16
    const dec = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    const inc = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    if (e.key === dec || e.key === inc) {
      e.preventDefault()
      const dir = (e.key === inc ? 1 : -1) * (invert ? -1 : 1)
      onSize(Math.max(min, Math.min(max, size + dir * step)))
    }
    if (e.key === 'Enter' && onToggle) onToggle()
  }

  return (
    <div
      className={`handle handle-${axis} ${dragging ? 'dragging' : ''}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={size}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onToggle}
      onKeyDown={onKeyDown}
    >
      <span className="handle-grip" />
    </div>
  )
}

// Window chrome shared by every pane: title, extras, and min/max/close controls.
export function PaneHeader({ icon, title, subtitle, children, leading, minimized, maximized, onMinimize, onMaximize, onClose }) {
  return (
    <header className="pane-head" onDoubleClick={(e) => { if (e.target === e.currentTarget && onMaximize) onMaximize() }}>
      <div className="pane-title">
        {leading}
        {icon && !leading && <span className="pane-icon"><Icon name={icon} size={15} /></span>}
        <div className="pane-titles">
          <h2>{title}</h2>
          {subtitle && <span className="pane-sub">{subtitle}</span>}
        </div>
      </div>
      <div className="pane-extras">{children}</div>
      <div className="win-controls">
        {onMinimize && (
          <button className="win-btn" onClick={onMinimize} aria-label={minimized ? 'Restore pane' : 'Minimize pane'} title={minimized ? 'Restore' : 'Minimize'}>
            <Icon name={minimized ? 'expand-v' : 'minimize'} size={14} />
          </button>
        )}
        {onMaximize && (
          <button className="win-btn" onClick={onMaximize} aria-label={maximized ? 'Exit full size' : 'Full size'} title={maximized ? 'Exit full size (Esc)' : 'Full size'}>
            <Icon name={maximized ? 'shrink' : 'maximize'} size={14} />
          </button>
        )}
        {onClose && (
          <button className="win-btn" onClick={onClose} aria-label="Close pane" title="Close">
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
    </header>
  )
}

export function useMedia(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

export function useHotkey(match, fn) {
  const ref = useRef(fn)
  ref.current = fn
  const stable = useCallback((e) => { if (match(e)) { e.preventDefault(); ref.current(e) } }, [match])
  useEffect(() => {
    window.addEventListener('keydown', stable, true)
    return () => window.removeEventListener('keydown', stable, true)
  }, [stable])
}

// A persisted setting shared live across components (e.g. temperature unit).
const listeners = new Map()
export function useShared(key, initial) {
  const subscribe = useCallback((fn) => {
    if (!listeners.has(key)) listeners.set(key, new Set())
    listeners.get(key).add(fn)
    return () => listeners.get(key).delete(fn)
  }, [key])
  const value = useSyncExternalStore(subscribe, () => store.get(key, initial))
  const set = useCallback((v) => { store.set(key, v); listeners.get(key)?.forEach((fn) => fn()) }, [key])
  return [value, set]
}

// Live width of an element (0 until first measured).
export function useWidth() {
  const [w, setW] = useState(0)
  const ro = useRef(null)
  const ref = useCallback((el) => {
    ro.current?.disconnect()
    if (!el) return
    ro.current = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.current.observe(el)
  }, [])
  return [ref, w]
}
