import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon, { StatusDot } from './Icon.jsx'
import { agentName, tildePath } from './Rail.jsx'
import { t, tx } from '../i18n/index.js'
import './tabstrip.css'

// The tabs above the agents, as Chrome's are. Every tab stays on screen: they share the strip's
// width, each as wide as the others (224px at most), and narrow evenly as more open, down to where a
// few letters of each name still show; past that the tab on screen keeps its name and its × while the
// others are their icon alone, and only past that does a tab go out of sight, with Search tabs (the
// ⌄ at the end, saying how many) listing every one, to find by typing. A tab closed with the pointer
// leaves the others as wide as they were until the pointer leaves the strip, so the next × comes under
// it. A moment's hover shows a card with the tab's whole name and where it is. Drag a tab to reorder;
// Ctrl+Shift+←/→ moves the focused one.
//
// Tab Groups (a beta feature): the tabs kept together as the sidebar has them. Home and the other
// views first, then each space of this computer in the sidebar's order, then each of your other
// computers under its name, so what's from elsewhere is out of the way of what you're doing here. Each
// group starts with a chip in its color (the space's, else one of a fixed few by its place in the
// sidebar; your other computers grey), and a line in that color runs under its tabs. A click on the
// chip folds the group to it, how many it holds and the most urgent dot among them (the tab on screen
// stays out); a right-click has the rest. With only one group there are no chips, nor for a space
// whose one tab is named as it is (the Chief of Staff's). Each tab's place in its group is yours, as
// before (drag, or Ctrl+Shift+←/→).

// How wide a tab is, as tabstrip.css has it: 224px at most; the others down to 72 with a few letters
// of their name (then down to 52 with fewer, then their icon alone), the one on screen 124 at least,
// for its name and its × both.
const TITLED = 72
const NAMED = 52
const ON = 124
const GAP = 2
const COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']
const URGENT = { blocked: 0, working: 1, done: 2, idle: 3 }
const SAYS = { blocked: tx('Needs you'), working: tx('Working'), done: tx('Done'), idle: tx('Idle'), unknown: tx('Unknown') }
const worstOf = (ids, byId) => ids.map((id) => byId[id]?.status).filter((x) => x in URGENT).sort((x, y) => URGENT[x] - URGENT[y])[0] || 'unknown'
// A space's color: its own (a palette name, or 1 to 8), else by its place in the sidebar.
const colorOf = (space, i, label) => {
  const own = space?.color
  if (COLORS.includes(own)) return own
  if (Number.isInteger(own) && own > 0) return COLORS[(own - 1) % COLORS.length]
  return COLORS[(i >= 0 ? i : [...String(label)].reduce((s, c) => s + c.charCodeAt(0), 0)) % COLORS.length]
}
const STUDIO = 'view:studio:'
// What a tab's card says about where it is: its space (and its tab, for a terminal), the computer
// it's on, or for a view, what kind it is (a Studio file with its folder).
function whereOf(a) {
  if (a.remote) return { text: t('On {name}', { name: a.device || t('another computer') }) }
  if (a.view) {
    const id = a.paneId
    if (id.startsWith(STUDIO)) {
      const path = decodeURIComponent(id.slice(STUDIO.length).split(':')[1] || '')
      return { text: t('Studio'), path: path.split('/').slice(0, -1).join('/') || null }
    }
    if (id.startsWith('view:whiteboard:')) return { text: t('Whiteboard') }
    if (id.startsWith('view:meeting:')) return { text: t('Meeting') }
    return null
  }
  return { text: a.shellTab ? `${a.workspace} › ${a.label}` : a.workspace || t('Space'), path: a.cwd ? tildePath(a.cwd) : null }
}

export default function TabStrip({ ids, byId, active, side, focus, folded: foldedKeys, grouping, spaces = [], onOpen, onClose, onMove, onNudge, onFold, onNewAgent, children }) {
  const [drag, setDrag] = useState(null) // { id, over, after }
  const [kept, setKept] = useState(null) // each tab's width, kept after a close with the pointer: { id: px }
  const [fit, setFit] = useState('roomy') // 'roomy' | 'tight' (the others narrower) | 'icons' (the others their icon)
  const [out, setOut] = useState({ left: 0, right: 0 }) // tabs out of sight on each side
  const [card, setCard] = useState(null) // the hover card: { id, rect }
  const [menu, setMenu] = useState(null) // a group's right-click menu: { key, x, y }
  const [search, setSearch] = useState(false)
  const scroller = useRef(null)
  const searchBtn = useRef(null)
  const cardTimer = useRef(0)
  const warm = useRef(0) // until when a card shows at once (one was showing a moment ago)

  // ---------- groups ----------
  const open = ids.filter((id) => byId[id])
  const groupOf = (id) => {
    const a = byId[id]
    if (a.view) return { key: 'views', at: -1 }
    if (a.remote) return { key: `dev:${a.remote.machine || 'here'}`, at: 1e6, label: a.device || t('Another computer'), device: true, color: 'grey' }
    const i = spaces.findIndex((w) => w.id === a.workspaceId)
    const label = spaces[i]?.label || a.workspace || t('Space')
    return { key: `ws:${a.workspaceId || ''}`, at: i < 0 ? 1e5 : i, label, color: colorOf(spaces[i], i, label), space: a.workspaceId }
  }
  const groups = !grouping ? [{ key: 'all', ids: open }] : [...open.reduce((m, id, n) => {
    const g = groupOf(id)
    if (!m.has(g.key)) m.set(g.key, { ...g, first: n, ids: [] })
    m.get(g.key).ids.push(id)
    return m
  }, new Map()).values()].sort((x, y) => x.at - y.at || x.first - y.first)
  // An agent's tab is named as the sidebar names it (its tab's name, not its terminal's title, which
  // on Windows can be the shell's own); a view, a terminal or another computer's agent by its title.
  const tabName = (a) => (a.view || a.shellTab || a.remote ? a.title : agentName(a))
  const named = groups.filter((g) => g.label).length > 1 || groups.some((g) => g.device)
  const headed = (g) => named && !!g.label && (g.device || g.ids.length > 1 || String(tabName(byId[g.ids[0]]) || '').trim().toLowerCase() !== String(g.label).trim().toLowerCase())
  const shown = groups.map((g) => {
    const head = headed(g)
    const isFolded = head && !!foldedKeys?.[g.key]
    return { ...g, head, folded: isFolded, shown: isFolded ? g.ids.filter((id) => id === active || id === side) : g.ids }
  })
  const order = shown.flatMap((g) => g.shown) // the tabs as the strip shows them

  // ---------- how wide ----------
  // Measured after each change, and as the strip's width or a group's chip changes (a bigger text
  // size); not while widths are kept after a close, which would undo what keeping them is for.
  const keptRef = useRef(kept)
  keptRef.current = kept
  const measure = () => {
    const el = scroller.current
    if (!el) return
    const tabs = [...el.querySelectorAll(':scope > .ws-tab')]
    if (!keptRef.current) {
      const chips = [...el.querySelectorAll(':scope > .ws-group')].reduce((s, c) => s + c.getBoundingClientRect().width + 8, 0)
      const room = el.clientWidth - chips - GAP * Math.max(0, tabs.length - 1)
      const on = tabs.filter((x) => x.classList.contains('main') || x.classList.contains('side')).length
      const each = room / Math.max(1, tabs.length)
      const rest = each >= ON || on === tabs.length ? each : (room - on * ON) / (tabs.length - on)
      setFit(rest >= TITLED ? 'roomy' : rest >= NAMED ? 'tight' : 'icons')
    }
    const r = el.getBoundingClientRect()
    let left = 0, right = 0
    for (const x of tabs) {
      const b = x.getBoundingClientRect()
      if ((b.left + b.right) / 2 < r.left) left++
      else if ((b.left + b.right) / 2 > r.right) right++
    }
    setOut((o) => (o.left === left && o.right === right ? o : { left, right }))
  }
  const measureRef = useRef(measure)
  measureRef.current = measure
  const shape = `${order.join('|')}#${shown.map((g) => `${g.key}:${g.head}:${g.folded}:${g.label}`).join('|')}#${active}#${side}#${!!kept}`
  const sizes = useRef(null)
  useLayoutEffect(() => {
    measure()
    const el = scroller.current
    if (!el || typeof ResizeObserver !== 'function') return
    sizes.current ||= new ResizeObserver(() => measureRef.current())
    sizes.current.disconnect()
    for (const x of [el, ...el.querySelectorAll(':scope > .ws-group')]) sizes.current.observe(x)
  }, [shape, fit]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => sizes.current?.disconnect(), [])
  // The tab on screen in view, whenever it changes.
  useEffect(() => {
    const el = scroller.current
    const tab = el && [...el.querySelectorAll(':scope > .ws-tab')].find((x) => x.dataset.pane === (focus === 'side' && side ? side : active))
    if (!tab) return
    const l = tab.offsetLeft, r = l + tab.offsetWidth
    if (l < el.scrollLeft) el.scrollLeft = Math.max(0, l - 24)
    else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 24
  }, [active, side, focus, fit, order.length])

  // ---------- closing ----------
  // With the pointer (a click on its ×, or the middle button): every tab keeps its width until the
  // pointer leaves the strip. The tab shown in its place is the one after it, else the one before.
  const close = (id, e) => {
    if (e && (e.detail > 0 || e.button === 1) && scroller.current) {
      setKept(Object.fromEntries([...scroller.current.querySelectorAll(':scope > .ws-tab')].map((x) => [x.dataset.pane, x.getBoundingClientRect().width])))
    }
    hideCard()
    const i = order.indexOf(id)
    const free = (x) => x !== id && x !== active && x !== side
    onClose(id, order.slice(i + 1).find(free) || order.slice(0, Math.max(0, i)).reverse().find(free) || null)
  }

  // ---------- the hover card ----------
  const hideCard = () => {
    clearTimeout(cardTimer.current)
    setCard((c) => { if (c) warm.current = Date.now() + 400; return null })
  }
  const hover = (id, el) => {
    clearTimeout(cardTimer.current)
    const show = () => { if (el.isConnected) setCard({ id, rect: el.getBoundingClientRect() }) }
    if (card || Date.now() < warm.current) show()
    else cardTimer.current = setTimeout(show, 550)
  }
  useEffect(() => () => clearTimeout(cardTimer.current), [])
  useEffect(() => { if (card && !order.includes(card.id)) setCard(null) }, [shape]) // eslint-disable-line react-hooks/exhaustive-deps

  const groupFor = Object.fromEntries(shown.flatMap((g) => g.ids.map((id) => [id, g])))
  const cardA = card && byId[card.id]
  const cardWhere = cardA && whereOf(cardA)
  const groupStyle = (g) => (g.head ? { '--gc': `var(--tg-${g.color})`, '--gc-on': `var(--tg-${g.color}-on, var(--tg-on))` } : null)
  const description = (a) => [tabName(a), whereOf(a)?.text, a.view ? null : t(SAYS[a.status] || SAYS.unknown)].filter(Boolean).join(', ')

  const groupHead = (g) => (
    <button type="button" className={`ws-group ${g.folded ? 'folded' : ''} ${g.device ? 'device' : ''} ${g.shown.length ? '' : 'alone'}`} style={groupStyle(g)}
      onClick={() => onFold(g.key)} aria-expanded={!g.folded}
      onContextMenu={(e) => { e.preventDefault(); hideCard(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ key: g.key, x: e.clientX || r.left, y: e.clientY || r.bottom }) }}
      title={g.folded ? (g.ids.length === 1 ? t('{name}: 1 tab. Show it', { name: g.label }) : t('{name}: {n} tabs. Show them', { name: g.label, n: g.ids.length })) : t('{name}: fold its tabs away', { name: g.label })}>
      {g.device && <Icon name="laptop" size={11} />}
      {g.folded && <span className="ws-group-dot"><StatusDot status={worstOf(g.ids, byId)} size={6} /></span>}
      <span className="ws-group-name">{g.label}</span>
      {g.folded && <span className="ws-group-n">{g.ids.length}</span>}
    </button>
  )
  const menuGroup = menu && shown.find((g) => g.key === menu.key)
  const firstCwd = (g) => g.ids.map((id) => byId[id]?.cwd).find(Boolean)

  return (
    <div className="ws-tabs" role="tablist" aria-label={t('Open agents')} onMouseLeave={() => { setKept(null); hideCard() }}>
      <div className={`ws-tabs-scroll ${fit === 'roomy' ? '' : `tight ${fit}`} ${out.left ? 'more-left' : ''} ${out.right ? 'more-right' : ''}`} ref={scroller}
        onScroll={() => { hideCard(); measure() }} onPointerDown={hideCard}
        onWheel={(e) => { const el = scroller.current; if (el && el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY }}>
        {shown.map((g) => (
          <Fragment key={g.key}>
            {g.head && groupHead(g)}
            {g.shown.map((id, n) => {
              const a = byId[id]
              const inMain = id === active
              const inSide = id === side
              const name = tabName(a)
              return (
                <div key={id} role="tab" data-pane={id} aria-selected={inMain || inSide} tabIndex={0} draggable
                  className={`ws-tab ${inMain ? 'main' : ''} ${inSide ? 'side' : ''} ${(inMain && focus === 'main') || (inSide && focus === 'side') ? 'focus' : ''} ${g.head ? 'grouped' : ''} ${g.head && n === g.shown.length - 1 ? 'group-end' : ''} ${drag?.id === id ? 'dragging' : ''} ${drag?.over === id && drag.id !== id ? (drag.after ? 'drop-after' : 'drop-before') : ''}`}
                  style={{ ...groupStyle(g), ...(kept?.[id] ? { flex: `0 0 ${kept[id]}px`, minWidth: 0, maxWidth: 'none' } : null) }}
                  aria-description={description(a)} aria-describedby={card?.id === id ? 'ws-tab-card' : undefined}
                  onMouseEnter={(e) => { if (!drag) hover(id, e.currentTarget) }} onMouseLeave={() => { clearTimeout(cardTimer.current); cardTimer.current = setTimeout(hideCard, 80) }}
                  onFocus={(e) => { if (e.target === e.currentTarget && e.currentTarget.matches(':focus-visible')) hover(id, e.currentTarget) }} onBlur={hideCard}
                  onClick={() => onOpen(id)} onAuxClick={(e) => { if (e.button === 1) close(id, e) }}
                  onDragStart={(e) => { hideCard(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-bridge-tab', id); setDrag({ id }) }}
                  onDragOver={(e) => {
                    if (!drag) return
                    e.preventDefault()
                    const r = e.currentTarget.getBoundingClientRect()
                    const after = e.clientX > r.left + r.width / 2
                    if (drag.over !== id || drag.after !== after) setDrag({ ...drag, over: id, after })
                  }}
                  onDrop={(e) => { e.preventDefault(); if (drag) onMove(drag.id, id, drag.after); setDrag(null) }}
                  onDragEnd={() => setDrag(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onOpen(id)
                    if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); onNudge(id, e.key === 'ArrowLeft' ? -1 : 1) }
                  }}>
                  {a.view ? <Icon name={a.icon} size={12} className="muted" /> : a.chief ? <Icon name="helm" size={13} className="tab-ship" /> : a.shellTab ? <Icon name="terminal" size={12} className="muted" /> : <StatusDot status={a.status} size={7} />}
                  <span className="ws-tab-name">{name}</span>
                  {a.remote && a.device && !named && <span className="ws-tab-where">{a.device}</span>}
                  {a.chief && <StatusDot status={a.status} size={6} />}
                  <button className="ws-tab-x" aria-label={t('Close {name}', { name })} onClick={(e) => { e.stopPropagation(); close(id, e) }}><Icon name="x" size={11} /></button>
                  {g.head && <span className="ws-tab-line" aria-hidden="true" />}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
      <div className="ws-tab-tools">
        <button type="button" ref={searchBtn} className={`win-btn tab-search-btn ${out.left + out.right ? 'more' : ''} ${search ? 'on' : ''}`} onClick={() => { hideCard(); setSearch((s) => !s) }}
          aria-haspopup="dialog" aria-expanded={search} aria-label={out.left + out.right ? t('Search tabs: {n} out of sight', { n: out.left + out.right }) : t('Search tabs')}
          title={out.left + out.right ? (out.left + out.right === 1 ? t('1 tab is out of sight. Search tabs') : t('{n} tabs are out of sight. Search tabs', { n: out.left + out.right })) : t('Search tabs')}>
          {out.left + out.right > 0 && <b>{out.left + out.right}</b>}
          <Icon name="down" size={14} />
        </button>
        {children}
      </div>
      {cardA && createPortal(
        <div className="hover-card tab-card" id="ws-tab-card" role="tooltip"
          style={{ top: card.rect.bottom + 6, left: Math.max(8, Math.min(card.rect.left, window.innerWidth - 328)) }}>
          {cardWhere && (
            <div className="hc-crumb">
              {groupFor[card.id]?.head && <i className="tab-card-swatch" style={groupStyle(groupFor[card.id])} />}
              {cardWhere.text}
            </div>
          )}
          <div className="hc-title"><b>{tabName(cardA)}</b></div>
          {!cardA.view && <div className="hc-meta"><span><StatusDot status={cardA.status} size={7} /> {t(SAYS[cardA.status] || SAYS.unknown)}</span>{cardA.kindLabel && <span>{cardA.kindLabel}</span>}</div>}
          {cardWhere?.path && <div className="hc-path"><Icon name="folder" size={11} /> <span>{cardWhere.path}</span></div>}
        </div>, document.body)}
      {menuGroup && (
        <GroupMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          menuGroup.folded
            ? { icon: 'unfold-all', label: menuGroup.ids.length === 1 ? t('Show its tab') : t('Show its {n} tabs', { n: menuGroup.ids.length }), run: () => onFold(menuGroup.key) }
            : { icon: 'fold-all', label: t('Fold its tabs away'), run: () => onFold(menuGroup.key) },
          menuGroup.space && onNewAgent && { icon: 'plus', label: t('New agent in {name}', { name: menuGroup.label }), run: () => onNewAgent({ workspaceId: menuGroup.space, cwd: firstCwd(menuGroup) }) },
          '-',
          { icon: 'x', danger: true, label: menuGroup.ids.length === 1 ? t('Close its tab') : t('Close its {n} tabs', { n: menuGroup.ids.length }), run: () => { for (const id of menuGroup.ids) onClose(id) } },
        ]} />
      )}
      {search && (
        <TabSearch anchor={searchBtn.current} active={[active, side].filter(Boolean)} onClose={() => setSearch(false)} onOpen={onOpen} onCloseTab={(id) => close(id)}
          rows={shown.flatMap((g) => g.ids)} byId={byId} name={tabName} groupFor={groupFor} groupStyle={groupStyle} />
      )}
    </div>
  )
}

// A group's right-click menu, where the pointer is (Rail's Menu, placed on the page itself: the
// strip scrolls sideways, which would cut a menu inside it off).
function GroupMenu({ x, y, items, onClose }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) closeRef.current() }
    const key = (e) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    ref.current?.querySelector('button')?.focus()
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [])
  return createPortal(
    <div className="menu tab-group-menu" ref={ref} role="menu" style={{ top: Math.min(y + 4, window.innerHeight - 160), left: Math.min(x, window.innerWidth - 240) }}>
      {items.filter(Boolean).map((it, i) => (it === '-' ? <div key={i} className="menu-sep" /> : (
        <button key={it.label} type="button" role="menuitem" className={`menu-item ${it.danger ? 'danger' : ''}`} onClick={() => { onClose(); it.run() }}>
          <Icon name={it.icon} size={13} /> {it.label}
        </button>
      )))}
    </div>, document.body)
}

// Search tabs: every open tab (those in a folded group too), to find by typing its name or where it
// is. ↑↓ to pick, Enter to open, Esc to close.
function TabSearch({ anchor, rows, byId, name, active, groupFor, groupStyle, onOpen, onCloseTab, onClose }) {
  const [q, setQ] = useState('')
  const [at, setAt] = useState(0)
  const ref = useRef(null)
  const list = rows.filter((id) => byId[id]).map((id) => ({ id, a: byId[id], name: name(byId[id]), where: whereOf(byId[id]) }))
  const words = q.trim().toLowerCase()
  const found = !words ? list : list.filter((r) => `${r.name} ${r.where?.text || ''}`.toLowerCase().includes(words))
  const pick = Math.min(at, Math.max(0, found.length - 1))
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target) && !anchor?.contains(e.target)) onClose() }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [onClose, anchor])
  useEffect(() => { ref.current?.querySelector('.tab-search-row.at')?.scrollIntoView({ block: 'nearest' }) }, [pick])
  const go = (id) => { onClose(); onOpen(id) }
  const r = anchor?.getBoundingClientRect() || { bottom: 80, right: window.innerWidth - 12 }
  return createPortal(
    <div className="tab-search" ref={ref} role="dialog" aria-label={t('Search tabs')} style={{ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) }}>
      <label className="tab-search-q">
        <Icon name="search" size={14} />
        <input autoFocus value={q} placeholder={t('Search tabs')} aria-label={t('Search tabs')} role="combobox" aria-expanded="true" aria-controls="tab-search-list" aria-activedescendant={found[pick] ? `tab-search-${pick}` : undefined}
          onChange={(e) => { setQ(e.target.value); setAt(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setAt(Math.min(found.length - 1, pick + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(Math.max(0, pick - 1)) }
            else if (e.key === 'Enter' && found[pick]) { e.preventDefault(); go(found[pick].id) }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); anchor?.focus() }
          }} />
      </label>
      <div className="tab-search-head">{t('Open tabs')} <span>{list.length}</span></div>
      {found.length > 0 ? (
        <ul className="tab-search-list" id="tab-search-list" role="listbox" aria-label={t('Open tabs')}>
          {found.map((x, i) => (
            <li key={x.id} id={`tab-search-${i}`} role="option" aria-selected={i === pick} data-pane={x.id} className={`tab-search-row ${i === pick ? 'at' : ''}`} onMouseMove={() => { if (i !== pick) setAt(i) }} onClick={() => go(x.id)}>
              <span className="tab-search-icon">{x.a.view ? <Icon name={x.a.icon} size={13} /> : x.a.chief ? <Icon name="helm" size={13} className="tab-ship" /> : x.a.shellTab ? <Icon name="terminal" size={13} /> : <StatusDot status={x.a.status} size={8} />}</span>
              <span className="tab-search-text">
                <b>{x.name}</b>
                {x.where && <small>{groupFor[x.id]?.head && <i className="tab-card-swatch" style={groupStyle(groupFor[x.id])} />}{x.where.text}</small>}
              </span>
              {active.includes(x.id) && <span className="tab-search-on">{t('On screen')}</span>}
              <button type="button" className="tab-search-x" aria-label={t('Close {name}', { name: x.name })} onClick={(e) => { e.stopPropagation(); onCloseTab(x.id) }}><Icon name="x" size={11} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="tab-search-none">{t('No open tab matches "{words}"', { words: q.trim() })}</p>}
    </div>, document.body)
}
