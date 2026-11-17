import { useEffect, useRef, useState } from 'react'

// Picking in one of Studio's lists as a folder's files are picked (Explorer.jsx): a click picks one
// and nothing else changes, a double-click, Enter or ⌘↓ opens it, Space shows it in Quick Look, the
// arrow keys, Home and End go through the list, and Esc lets go. Its rows (studio/HomeFiles.jsx) go
// up and down; cards in rows (across: the whiteboards, whiteboard/Whiteboard.jsx) go one at a time
// with ← and →, and a row at a time with ↑ and ↓. keyOf(item): its key; open(item): false when it
// can't be opened, and Quick Look shows it then. keys: where Explorer.jsx hands its keys while the
// list is shown (fn(event, hit)); focus: back to it after Quick Look. tap: a phone's, where a tap
// opens one. on: false while a list of its own stands in for this one.
//   itemProps(item): on each row or card (its buttons, links and boxes are their own); boxProps: on
// what holds them (a click on nothing there lets go); look: Quick Look's props while it's open on the
// one picked (at, count, onStep, onClose, onOpen), else null.
export function usePick(items, { keyOf, open, tap = false, keys = null, focus = null, across = false, on = true }) {
  const [sel, setSel] = useState(null) // the one picked (keyOf)
  const [ql, setQl] = useState(false) // Quick Look on it
  const picked = (on && sel && items.find((f) => keyOf(f) === sel)) || null
  const go = (f) => { if (open(f) === false) { setSel(keyOf(f)); setQl(true) } }
  const box = useRef(null)
  // Cards in a row: as many as sit level with the first.
  const perRow = () => {
    const tops = [...(box.current?.querySelectorAll('[data-key]') || [])].map((x) => x.getBoundingClientRect().top)
    return Math.max(1, tops.filter((y) => Math.abs(y - tops[0]) < 2).length)
  }
  // n on (a row of cards, with rows): from the last row down, or the first up, it stays put; from the
  // row before a shorter last row, to that row's last card, as Finder's icons go.
  const step = (n, rows = false) => {
    if (!items.length) return
    const at = picked ? items.indexOf(picked) : -1
    if (at < 0) { setSel(keyOf(items[n > 0 ? 0 : items.length - 1])); return }
    const per = rows ? perRow() : 1
    const last = items.length - 1
    const to = at + n * per
    if (to < 0 || (to > last && Math.floor(at / per) === Math.floor(last / per))) return
    setSel(keyOf(items[Math.min(last, to)]))
  }
  // The one picked kept in view (after the arrow keys).
  useEffect(() => { if (sel) box.current?.querySelector(`[data-key="${CSS.escape(sel)}"]`)?.scrollIntoView?.({ block: 'nearest' }) }, [sel])
  // The keys, as a folder's (hit(fn): taken).
  const onKey = (e, hit) => {
    const mod = e.metaKey || e.ctrlKey
    const k = e.key
    if (mod && k === 'ArrowDown') return picked && hit(() => go(picked))
    if (mod || e.altKey) return undefined
    if (k === ' ') return picked && hit(() => setQl((v) => !v))
    if (k === 'Enter') return picked && hit(() => go(picked))
    if (k === 'Escape' && sel) return hit(() => setSel(null))
    if (k === 'ArrowDown' || k === 'ArrowUp') return hit(() => step(k === 'ArrowDown' ? 1 : -1, across))
    if (across && (k === 'ArrowRight' || k === 'ArrowLeft')) return hit(() => step(k === 'ArrowRight' ? 1 : -1))
    if ((k === 'Home' || k === 'End') && items.length) return hit(() => setSel(keyOf(items[k === 'Home' ? 0 : items.length - 1])))
    return undefined
  }
  useEffect(() => {
    if (!keys || !on) return undefined
    keys.current = onKey
    return () => { if (keys.current === onKey) keys.current = null }
  })
  // A row or card: picked on a click, opened on a double-click; on a phone, opened on a tap.
  const itemProps = (f) => {
    const key = keyOf(f)
    const mine = (ev) => !ev.target.closest('button, a, input')
    return {
      'data-key': key, 'aria-selected': sel === key,
      ...(tap ? { onClick: (ev) => { if (mine(ev)) go(f) } }
        : { onMouseDown: (ev) => { if (ev.button === 0 && mine(ev)) setSel(key) }, onDoubleClick: (ev) => { if (mine(ev)) go(f) } }),
    }
  }
  const boxProps = { ref: box, onMouseDown: (ev) => { if (!tap && !ev.target.closest('[data-key]')) setSel(null) } }
  const look = ql && picked ? {
    at: items.indexOf(picked), count: items.length, onStep: step,
    onClose: () => { setQl(false); focus?.() },
    onOpen: () => { setQl(false); go(picked) },
  } : null
  return { sel, setSel, picked, itemProps, boxProps, look }
}
