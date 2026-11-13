import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon, { StatusDot } from './Icon.jsx'
import { agentName, tildePath, InlineRename } from './Rail.jsx'
import { api } from '../api.js'
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
// A right-click on a tab (or Shift+F10, or the menu key, on the focused one) has what Chrome's tab
// menu has that fits here: a new agent in its space, open it beside the tab on screen; add it to a new
// group, or to one of yours (Add tab to group ›, with New group), or take it out of its group;
// Rename… (for the tabs the sidebar renames: an agent's or a terminal's, not a view, a cloud agent,
// another computer's or the Chief of Staff's), which edits its name in the tab itself, Enter to keep
// it and Esc to put it back; Pin tab; its color; then Close, Close other tabs and Close tabs to the
// right (those two leave pinned tabs, as Chrome does). Its color is a line under it, in one of
// Chrome's group colors (No color takes it off); a tab in a group with a chip colors its group, as in
// Chrome. The menu opens where the pointer is, turned to fit in the window near its right or bottom
// edge; ↑↓ go through it, ←→ along the colors, and Esc closes it with the focus back on the tab.
//
// Pinned tabs come first, their icon and dot alone (their name is on their card), with no × (the
// middle button or their menu closes one). They move among themselves; pinning takes a tab out of its
// group.
//
// Your own groups, as Chrome's, with Tab Groups on or off: a chip in the group's color, with its name,
// before its tabs, and a line in that color under them. Add tab to new group makes one and opens its
// editor by the chip: its name (focused; the chip shows it as it's typed) and its colors, then New
// agent in group (when its agents are all in one space, there, and it joins the group), Ungroup and
// Close group; Enter or a click elsewhere closes it. A right-click on the chip opens the same editor;
// a click folds the group, as a space's. A tab dropped between two of a group's tabs (or just after
// its chip, or on it) joins it, and one dragged out of it leaves it; with Ctrl+Shift+←/→ a tab at the
// group's edge leaves it first, and one beside a group goes into it. A group goes when its last tab
// closes. Groups and pins are kept with the window's tabs, as colors are (App.jsx), so a reload keeps
// them.
//
// Tab Groups (a beta feature): the tabs not in a group of yours kept together as the sidebar has them.
// Home and the other views first, then each space of this computer in the sidebar's order, then each
// of your other computers under its name, so what's from elsewhere is out of the way of what you're
// doing here; a group of yours comes after the space its first tab is in. Each space's group starts
// with a chip in its color (the one picked in its menu, else the space's, else one of a fixed few by
// its place in the sidebar; your other computers grey), and a line in that color runs under its tabs.
// A click on a chip folds the group to it, how many it holds and the most urgent dot among them (the
// tab on screen stays out); a right-click has the rest, its color too. With only one space's group
// there are no chips for spaces, nor for a space whose one tab is named as it is (the Chief of
// Staff's). Each tab's place in its group is yours, as before (drag, or Ctrl+Shift+←/→).

// How wide a tab is, as tabstrip.css has it: 224px at most; the others down to 72 with a few letters
// of their name (then down to 52 with fewer, then their icon alone), the one on screen 124 at least,
// for its name and its × both. A pinned tab is its icon, at its own width.
const TITLED = 72
const NAMED = 52
const ON = 124
const GAP = 2
const COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']
// The colors a tab's or a group's menu offers: Chrome's tab groups' own, in its order.
const PICK = ['grey', ...COLORS]
const NAMES = { grey: tx('Grey'), blue: tx('Blue'), red: tx('Red'), yellow: tx('Yellow'), green: tx('Green'), pink: tx('Pink'), purple: tx('Purple'), cyan: tx('Cyan'), orange: tx('Orange') }
// A color as the tab, its line, its chip and their swatches use it.
const paint = (c) => (c ? { '--gc': `var(--tg-${c})`, '--gc-on': `var(--tg-${c}-on, var(--tg-on))` } : null)
// Shift+F10, or the menu key: a right-click from the keyboard.
const menuKey = (e) => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')
const URGENT = { blocked: 0, working: 1, done: 2, idle: 3 }
const SAYS = { blocked: tx('Needs you'), working: tx('Working'), done: tx('Done'), idle: tx('Idle'), unknown: tx('Unknown') }
const worstOf = (ids, byId) => ids.map((id) => byId[id]?.status).filter((x) => x in URGENT).sort((x, y) => URGENT[x] - URGENT[y])[0] || 'unknown'
// A space's color: its own (a palette name, or 1 to 8), else by its place in the sidebar. One picked
// in its group's menu comes first (TabStrip's chosen).
const colorOf = (space, i, label) => {
  const own = space?.color
  if (COLORS.includes(own)) return own
  if (Number.isInteger(own) && own > 0) return COLORS[(own - 1) % COLORS.length]
  return COLORS[(i >= 0 ? i : [...String(label)].reduce((s, c) => s + c.charCodeAt(0), 0)) % COLORS.length]
}
// The tabs the sidebar renames (its ⋯ menu's Rename tab, herdr's tab): an agent's or a terminal's. Not
// a view, another computer's agent, a cloud agent, or the Chief of Staff, which is named so wherever
// it shows.
const renamable = (a) => !!a?.tabId && !a.view && !a.remote && !a.cloud && !a.chief
const without = (o, k) => { const n = { ...o }; delete n[k]; return n }
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

// colors: what was picked in the menus, { key: color }, a group by its key and a tab by its id
// (App.jsx keeps them with the window's tabs); onColor(key, color or null) picks one; onSide(id) opens
// a tab beside the one on screen, when the window has room to split. own: your groups, { key: { name,
// tabs } }; pinned: the pinned tabs' ids. onGroup(id, key, keep) puts a tab in a group (a new key
// makes one), at its end unless keep (it was dropped where it is), or out of its group (key null);
// onName(key, name), onUngroup(key), onPin(id, on).
export default function TabStrip({ ids, byId, active, side, focus, folded: foldedKeys, colors, own, pinned, grouping, spaces = [], onOpen, onClose, onMove, onFold, onColor, onGroup, onName, onUngroup, onPin, onSide, onNewAgent, children }) {
  const [drag, setDrag] = useState(null) // { id, over, after }: over a tab's id, or chip:<key>
  const [kept, setKept] = useState(null) // each tab's width, kept after a close with the pointer: { id: px }
  const [fit, setFit] = useState('roomy') // 'roomy' | 'tight' (the others narrower) | 'icons' (the others their icon)
  const [out, setOut] = useState({ left: 0, right: 0 }) // tabs out of sight on each side
  const [card, setCard] = useState(null) // the hover card: { id, rect }
  const [menu, setMenu] = useState(null) // a right-click menu, a tab's ({ id }) or a group's ({ key }): with { x, y, back }, back what it was opened on
  const [editing, setEditing] = useState(null) // a group just made: its editor opens by its chip once that shows
  const [renaming, setRenaming] = useState(null) // the tab whose name is being edited
  const [named, setNamed] = useState({}) // names just given, shown until the sidebar's have them: { id: name }
  const [note, setNote] = useState(null) // a rename that didn't work: { text, rect }
  const [search, setSearch] = useState(false)
  const scroller = useRef(null)
  const searchBtn = useRef(null)
  const cardTimer = useRef(0)
  const noteTimer = useRef(0)
  const warm = useRef(0) // until when a card shows at once (one was showing a moment ago)
  const refocus = useRef(null) // a tab to put the focus back on, if it's lost as the tab moves: { id, until }
  const renameKey = useRef(null)

  // ---------- groups ----------
  const open = ids.filter((id) => byId[id])
  const pins = open.filter((id) => pinned?.includes(id))
  const loose = open.filter((id) => !pins.includes(id))
  const chosen = (key) => (PICK.includes(colors?.[key]) ? colors[key] : null)
  // Your groups: a tab in one at most; each group in the strip's order of its tabs.
  const mineOf = {}
  for (const [key, g] of Object.entries(own || {})) for (const id of g.tabs || []) if (!mineOf[id] && loose.includes(id)) mineOf[id] = key
  const mine = [...loose.reduce((m, id) => {
    const key = mineOf[id]
    if (!key) return m
    if (!m.has(key)) m.set(key, { key, own: true, label: own[key].name || '', color: chosen(key) || 'grey', first: open.indexOf(id), ids: [] })
    m.get(key).ids.push(id)
    return m
  }, new Map()).values()]
  const groupOf = (id) => {
    const a = byId[id]
    if (a.view) return { key: 'views', at: -1 }
    if (a.remote) {
      const key = `dev:${a.remote.machine || 'here'}`
      return { key, at: 1e6, label: a.device || t('Another computer'), device: true, color: chosen(key) || 'grey' }
    }
    const i = spaces.findIndex((w) => w.id === a.workspaceId)
    const label = spaces[i]?.label || a.workspace || t('Space')
    const key = `ws:${a.workspaceId || ''}`
    return { key, at: i < 0 ? 1e5 : i, label, color: chosen(key) || colorOf(spaces[i], i, label), space: a.workspaceId }
  }
  // Without Tab Groups: the tabs in their order, each group of yours where its first tab is. With it:
  // by space (groupOf), each group of yours after the space of its first tab.
  const runs = []
  if (!grouping) {
    for (const id of loose) {
      const key = mineOf[id]
      if (key) { if (!runs.some((g) => g.key === key)) runs.push(mine.find((g) => g.key === key)) }
      else if (runs.at(-1)?.run) runs.at(-1).ids.push(id)
      else runs.push({ key: `run:${runs.length}`, run: true, ids: [id] })
    }
  }
  const groups = [
    pins.length > 0 && { key: 'pinned', pinned: true, ids: pins },
    ...(!grouping ? runs : [...loose.filter((id) => !mineOf[id]).reduce((m, id) => {
      const g = groupOf(id)
      if (!m.has(g.key)) m.set(g.key, { ...g, first: open.indexOf(id), ids: [] })
      m.get(g.key).ids.push(id)
      return m
    }, new Map()).values(), ...mine.map((g) => ({ ...g, at: groupOf(g.ids[0]).at + 0.5 }))].sort((x, y) => x.at - y.at || x.first - y.first)),
  ].filter(Boolean)
  // An agent's tab is named as the sidebar names it (its tab's name, not its terminal's title, which
  // on Windows can be the shell's own); a view, a terminal or another computer's agent by its title.
  const tabName = (a) => named[a.paneId] ?? (a.view || a.shellTab || a.remote ? a.title : agentName(a))
  const spaced = groups.filter((g) => !g.own && !g.pinned && !g.run)
  const multi = spaced.filter((g) => g.label).length > 1 || spaced.some((g) => g.device)
  const headed = (g) => g.own || (multi && !!g.label && (g.device || g.ids.length > 1 || String(tabName(byId[g.ids[0]]) || '').trim().toLowerCase() !== String(g.label).trim().toLowerCase()))
  const shown = groups.map((g) => {
    const head = headed(g)
    const isFolded = head && !!foldedKeys?.[g.key]
    return { ...g, head, folded: isFolded, shown: isFolded ? g.ids.filter((id) => id === active || id === side) : g.ids }
  })
  const order = shown.flatMap((g) => g.shown) // the tabs as the strip shows them
  const chipName = (g) => g.label || (g.own ? t('Unnamed group') : '')

  // ---------- how wide ----------
  // Measured after each change, and as the strip's width or a group's chip changes (a bigger text
  // size); not while widths are kept after a close, which would undo what keeping them is for.
  // Pinned tabs keep their own width, as chips do.
  const keptRef = useRef(kept)
  keptRef.current = kept
  const measure = () => {
    const el = scroller.current
    if (!el) return
    const all = [...el.querySelectorAll(':scope > .ws-tab')]
    if (!keptRef.current) {
      const tabs = all.filter((x) => !x.classList.contains('pinned'))
      const fixed = [...el.querySelectorAll(':scope > .ws-group')].reduce((s, c) => s + c.getBoundingClientRect().width + 8, 0) +
        all.filter((x) => x.classList.contains('pinned')).reduce((s, x) => s + x.getBoundingClientRect().width + GAP, 0)
      const room = el.clientWidth - fixed - GAP * Math.max(0, tabs.length - 1)
      const on = tabs.filter((x) => x.classList.contains('main') || x.classList.contains('side')).length
      const each = room / Math.max(1, tabs.length)
      const rest = each >= ON || on === tabs.length ? each : (room - on * ON) / (tabs.length - on)
      setFit(rest >= TITLED ? 'roomy' : rest >= NAMED ? 'tight' : 'icons')
    }
    const r = el.getBoundingClientRect()
    let left = 0, right = 0
    for (const x of all) {
      const b = x.getBoundingClientRect()
      if ((b.left + b.right) / 2 < r.left) left++
      else if ((b.left + b.right) / 2 > r.right) right++
    }
    setOut((o) => (o.left === left && o.right === right ? o : { left, right }))
  }
  const measureRef = useRef(measure)
  measureRef.current = measure
  const shape = `${order.join('|')}#${shown.map((g) => `${g.key}:${g.head}:${g.folded}:${g.label}`).join('|')}#${pins.join('|')}#${active}#${side}#${!!kept}#${renaming}`
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
  const tabEl = (id) => [...(scroller.current?.querySelectorAll(':scope > .ws-tab') || [])].find((x) => x.dataset.pane === id)
  useEffect(() => {
    const el = scroller.current
    const tab = el && tabEl(focus === 'side' && side ? side : active)
    if (!tab) return
    const l = tab.offsetLeft, r = l + tab.offsetWidth
    if (l < el.scrollLeft) el.scrollLeft = Math.max(0, l - 24)
    else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 24
  }, [active, side, focus, fit, order.length]) // eslint-disable-line react-hooks/exhaustive-deps
  // A tab moved from the keyboard (Ctrl+Shift+←/→, or its menu) keeps the focus: moved in the page,
  // it can lose it.
  useLayoutEffect(() => {
    const r = refocus.current
    if (!r) return
    refocus.current = null
    const el = tabEl(r.id)
    if (el && Date.now() < r.until && (!document.activeElement || document.activeElement === document.body)) el.focus({ preventScroll: true })
  })
  const keepFocus = (id) => { refocus.current = { id, until: Date.now() + 1000 } }

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

  // ---------- moving ----------
  // Dropped: where it lands says its group. Between two of a group's tabs, or before its first (just
  // after its chip), in it; beside one of its own group's (moved to its edge), still in it; anywhere
  // else, in none.
  const dropOn = (from, to, after) => {
    if (from === to) return
    const seq = order.filter((x) => x !== from)
    seq.splice(seq.indexOf(to) + (after ? 1 : 0), 0, from)
    const i = seq.indexOf(from)
    const l = mineOf[seq[i - 1]], r = mineOf[seq[i + 1]], m = mineOf[from] || null
    const into = l && l === r ? l : !after && r ? r : m && (l === m || r === m) ? m : null
    onMove(from, to, after)
    if (onGroup && into !== m) onGroup(from, into, true)
  }
  // Ctrl+Shift+←/→, as Chrome's Ctrl+Shift+PgUp/PgDn: one place along what the strip shows. At a
  // group's edge a tab leaves it first; beside a group, it goes in (past a folded one); pinned tabs
  // move among themselves; with Tab Groups, a tab stays in its space's group.
  const nudge = (id, dir) => {
    const g = groupFor[id]
    if (!g) return
    const next = g.shown[g.shown.indexOf(id) + dir]
    keepFocus(id)
    if (next) { onMove(id, next, dir > 0); return }
    if (g.own) { onGroup?.(id, null, true); return }
    const near = !g.pinned && shown[shown.indexOf(g) + dir]
    if (near?.own && !near.folded) { onMove(id, dir > 0 ? near.ids[0] : near.ids.at(-1), dir < 0); onGroup?.(id, near.key, true); return }
    if (grouping || !near || near.pinned) return
    if (near.own) onMove(id, dir > 0 ? near.ids.at(-1) : near.ids[0], dir > 0)
    else if (near.shown.length) onMove(id, dir > 0 ? near.shown[0] : near.shown.at(-1), dir > 0)
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
  useEffect(() => () => { clearTimeout(cardTimer.current); clearTimeout(noteTimer.current) }, [])
  useEffect(() => { if (card && !order.includes(card.id)) setCard(null) }, [shape]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- renaming ----------
  // As the sidebar does (Rail's rename): herdr's tab, by its id. The name shows at once, until the
  // sidebar's list has it; one that doesn't take says why, under the tab.
  const startRename = (id) => { hideCard(); setRenaming(id) }
  const say = (id, text) => {
    clearTimeout(noteTimer.current)
    setNote({ text, rect: tabEl(id)?.getBoundingClientRect() || null })
    noteTimer.current = setTimeout(() => setNote(null), 6000)
  }
  const rename = async (id, label) => {
    const keyed = renameKey.current
    renameKey.current = null
    setRenaming((r) => (r === id ? null : r))
    if (keyed) keepFocus(id)
    const a = byId[id]
    if (!label || !renamable(a)) return
    setNamed((n) => ({ ...n, [id]: label }))
    try {
      await api(`/tabs/${encodeURIComponent(a.tabId)}/rename`, { method: 'POST', body: { label } })
      setTimeout(() => setNamed((n) => (n[id] === label ? without(n, id) : n)), 4000)
    } catch (e) {
      setNamed((n) => without(n, id))
      say(id, t("Couldn't rename it: {error}", { error: e.message }))
    }
  }
  useEffect(() => {
    const done = Object.keys(named).filter((id) => !byId[id] || (byId[id].view || byId[id].shellTab || byId[id].remote ? byId[id].title : agentName(byId[id])) === named[id])
    if (done.length) setNamed((n) => done.reduce(without, n))
  })

  const groupFor = Object.fromEntries(shown.flatMap((g) => g.ids.map((id) => [id, g])))
  const cardA = card && byId[card.id]
  const cardWhere = cardA && whereOf(cardA)
  const groupStyle = (g) => (g.head ? paint(g.color) : null)
  // A tab's color: its group's when the group has a chip, else its own (if one was picked).
  const tintOf = (id) => (groupFor[id]?.head ? groupFor[id].color : chosen(id))
  const description = (a) => [tabName(a), pins.includes(a.paneId) ? t('Pinned tab') : null, whereOf(a)?.text, a.view ? null : t(SAYS[a.status] || SAYS.unknown)].filter(Boolean).join(', ')

  // ---------- the right-click menu ----------
  // Where the pointer is; from the keyboard, under what it's for. A group of yours: its editor, under
  // its chip, as Chrome's.
  const openMenu = (e, which) => {
    e.preventDefault()
    hideCard()
    const r = e.currentTarget.getBoundingClientRect()
    const keyed = e.type === 'keydown' || (!e.clientX && !e.clientY)
    const under = keyed || !!(which.key && own?.[which.key])
    setMenu({ ...which, x: under ? r.left : e.clientX, y: under ? r.bottom + (keyed ? 0 : 4) : e.clientY, under, back: e.currentTarget })
  }
  // A group just made: its editor, by its chip, once the chip is there.
  useLayoutEffect(() => {
    if (!editing) return
    const chip = [...(scroller.current?.querySelectorAll(':scope > .ws-group') || [])].find((x) => x.dataset.group === editing)
    if (!chip) return
    setEditing(null)
    chip.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    const r = chip.getBoundingClientRect()
    setMenu({ key: editing, x: r.left, y: r.bottom + 4, under: true, back: chip })
  })
  // A new group of yours with this tab, in a color no other chip has (as Chrome picks).
  const newGroup = (id) => {
    const key = `g:${Date.now().toString(36)}`
    const used = shown.filter((g) => g.head).map((g) => g.color)
    onGroup(id, key)
    onColor?.(key, COLORS.find((c) => !used.includes(c)) || COLORS[mine.length % COLORS.length])
    setEditing(key)
  }

  const groupHead = (g) => (
    <button key={`chip:${g.key}`} type="button" data-group={g.key} className={`ws-group ${g.folded ? 'folded' : ''} ${g.device ? 'device' : ''} ${g.own && !g.label ? 'unnamed' : ''} ${g.shown.length ? '' : 'alone'} ${drag?.over === `chip:${g.key}` ? 'drop-in' : ''}`} style={groupStyle(g)}
      onClick={() => onFold(g.key)} aria-expanded={!g.folded} aria-label={g.own && !g.label ? chipName(g) : undefined}
      onContextMenu={(e) => openMenu(e, { key: g.key })} onKeyDown={(e) => { if (menuKey(e)) openMenu(e, { key: g.key }) }}
      onDragOver={(e) => { if (!drag || !g.own || pins.includes(drag.id)) return; e.preventDefault(); if (drag.over !== `chip:${g.key}`) setDrag({ ...drag, over: `chip:${g.key}`, after: false }) }}
      onDrop={(e) => { e.preventDefault(); if (drag) { onMove(drag.id, g.ids[0], false); if (mineOf[drag.id] !== g.key) onGroup?.(drag.id, g.key, true) } setDrag(null) }}
      title={g.folded ? (g.ids.length === 1 ? t('{name}: 1 tab. Show it', { name: chipName(g) }) : t('{name}: {n} tabs. Show them', { name: chipName(g), n: g.ids.length })) : t('{name}: fold its tabs away', { name: chipName(g) })}>
      {g.device && <Icon name="laptop" size={11} />}
      {g.folded && <span className="ws-group-dot"><StatusDot status={worstOf(g.ids, byId)} size={6} /></span>}
      {g.label && <span className="ws-group-name">{g.label}</span>}
      {g.folded && <span className="ws-group-n">{g.ids.length}</span>}
    </button>
  )
  const firstCwd = (g) => g.ids.map((id) => byId[id]?.cwd).find(Boolean)
  // The row of colors: a group's (always one of them), or a tab's own, which can be none.
  const colorRow = (key, value, name, none = false) => onColor && { colors: { value, name, none, pick: (c) => onColor(key, c) } }
  const closeAll = (list) => { for (const id of list) onClose(id) }
  // A space's group (Tab Groups).
  const groupItems = (g) => [
    g.folded
      ? { icon: 'unfold-all', label: g.ids.length === 1 ? t('Show its tab') : t('Show its {n} tabs', { n: g.ids.length }), run: () => onFold(g.key) }
      : { icon: 'fold-all', label: t('Fold its tabs away'), run: () => onFold(g.key) },
    g.space && onNewAgent && { icon: 'plus', label: t('New agent in {name}', { name: g.label }), run: () => onNewAgent({ workspaceId: g.space, cwd: firstCwd(g) }) },
    '-',
    colorRow(g.key, g.color, g.label),
    '-',
    { icon: 'x', danger: true, label: g.ids.length === 1 ? t('Close its tab') : t('Close its {n} tabs', { n: g.ids.length }), run: () => closeAll(g.ids) },
  ]
  // One of yours, under its name in the editor: New agent in group when its agents (and terminals)
  // are all in one space, so there's a place to start one.
  const ownItems = (g) => {
    const ws = [...new Set(g.ids.map((id) => byId[id]).filter((a) => a && !a.view && !a.remote && !a.cloud && a.workspaceId).map((a) => a.workspaceId))]
    return [
      colorRow(g.key, g.color, chipName(g)),
      '-',
      ws.length === 1 && onNewAgent && { icon: 'plus', label: t('New agent in group'), run: () => onNewAgent({ workspaceId: ws[0], cwd: g.ids.map((id) => byId[id]).find((a) => a?.workspaceId === ws[0] && a.cwd)?.cwd, group: g.key }) },
      onUngroup && { icon: 'minus', label: t('Ungroup'), run: () => onUngroup(g.key) },
      { icon: 'x', danger: true, label: t('Close group'), run: () => closeAll(g.ids) },
    ]
  }
  // A tab's: what Chrome's tab menu has that fits here. Close other tabs and Close tabs to the right
  // count a folded group's tabs too, in the strip's order, and show the tab the menu is for; neither
  // closes a pinned tab.
  const tabItems = (id) => {
    const a = byId[id]
    const g = groupFor[id]
    const m = mineOf[id]
    const pin = pins.includes(id)
    const all = shown.flatMap((x) => x.ids)
    const right = all.slice(all.indexOf(id) + 1).filter((x) => !pins.includes(x))
    const others = all.filter((x) => x !== id && !pins.includes(x))
    const home = !a.view && !a.remote && a.workspaceId ? groupOf(id) : null
    const elsewhere = mine.filter((x) => x.key !== m)
    return [
      home && onNewAgent && { icon: 'plus', label: t('New agent in {name}', { name: home.label }), run: () => onNewAgent({ workspaceId: a.workspaceId, cwd: a.cwd }) },
      onSide && id !== active && id !== side && { icon: 'split', label: t('Open beside the current tab'), run: () => onSide(id) },
      '-',
      onGroup && (elsewhere.length
        ? { icon: 'layers', label: t('Add tab to group'), sub: [{ icon: 'plus', label: t('New group'), run: () => newGroup(id) }, '-', ...elsewhere.map((x) => ({ key: x.key, swatch: x.color, label: chipName(x), run: () => onGroup(id, x.key) }))] }
        : { icon: 'layers', label: t('Add tab to new group'), run: () => newGroup(id) }),
      onGroup && m && { icon: 'minus', label: t('Remove from group'), run: () => onGroup(id, null) },
      '-',
      renamable(a) && { icon: 'edit', label: t('Rename…'), run: () => startRename(id) },
      onPin && { icon: 'pin', label: pin ? t('Unpin tab') : t('Pin tab'), run: () => onPin(id, !pin) },
      '-',
      g?.head ? colorRow(g.key, g.color, chipName(g)) : colorRow(id, chosen(id), tabName(a), true),
      '-',
      { icon: 'x', label: t('Close'), run: () => close(id) },
      others.length > 0 && { label: t('Close other tabs'), run: () => { for (const x of others) onClose(x, id) } },
      right.length > 0 && { label: t('Close tabs to the right'), run: () => { for (const x of right) onClose(x, id) } },
    ]
  }
  const menuTab = menu?.id && order.includes(menu.id) ? menu.id : null
  const menuGroup = !menuTab && menu?.key ? shown.find((g) => g.key === menu.key && g.head) : null

  const tabFor = (g, id, n) => {
    const a = byId[id]
    const inMain = id === active
    const inSide = id === side
    const pin = !!g.pinned
    const name = tabName(a)
    const tint = tintOf(id)
    const isRen = renaming === id
    return (
      <div key={id} role="tab" data-pane={id} aria-selected={inMain || inSide} tabIndex={0} draggable={!isRen}
        className={`ws-tab ${inMain ? 'main' : ''} ${inSide ? 'side' : ''} ${pin ? 'pinned' : ''} ${isRen ? 'renaming' : ''} ${(inMain && focus === 'main') || (inSide && focus === 'side') ? 'focus' : ''} ${g.head ? 'grouped' : tint ? 'tinted' : ''} ${g.head && n === g.shown.length - 1 ? 'group-end' : ''} ${drag?.id === id ? 'dragging' : ''} ${drag?.over === id && drag.id !== id ? (drag.after ? 'drop-after' : 'drop-before') : ''}`}
        style={{ ...paint(tint), ...(kept?.[id] ? { flex: `0 0 ${kept[id]}px`, minWidth: 0, maxWidth: 'none' } : null) }}
        aria-description={description(a)} aria-describedby={card?.id === id ? 'ws-tab-card' : undefined}
        onMouseEnter={(e) => { if (!drag && !menu && !isRen) hover(id, e.currentTarget) }} onMouseLeave={() => { clearTimeout(cardTimer.current); cardTimer.current = setTimeout(hideCard, 80) }}
        onFocus={(e) => { if (e.target === e.currentTarget && e.currentTarget.matches(':focus-visible')) hover(id, e.currentTarget) }} onBlur={hideCard}
        onClick={() => onOpen(id)} onAuxClick={(e) => { if (e.button === 1) close(id, e) }} onContextMenu={(e) => openMenu(e, { id })}
        onDragStart={(e) => { hideCard(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-bridge-tab', id); setDrag({ id }) }}
        onDragOver={(e) => {
          // Pinned tabs among themselves, the others among the others.
          if (!drag || pins.includes(drag.id) !== pin) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          const after = e.clientX > r.left + r.width / 2
          if (drag.over !== id || drag.after !== after) setDrag({ ...drag, over: id, after })
        }}
        onDrop={(e) => { e.preventDefault(); if (drag) dropOn(drag.id, id, drag.after); setDrag(null) }}
        onDragEnd={() => setDrag(null)}
        onKeyDown={(e) => {
          if (e.target.tagName === 'INPUT') return
          if (e.key === 'Enter') onOpen(id)
          if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); nudge(id, e.key === 'ArrowLeft' ? -1 : 1) }
          if (menuKey(e)) openMenu(e, { id })
        }}>
        {a.view ? <Icon name={a.icon} size={12} className="muted" /> : a.chief ? <Icon name="helm" size={13} className="tab-ship" /> : a.shellTab ? <Icon name="terminal" size={12} className="muted" /> : <StatusDot status={a.status} size={7} />}
        {isRen
          ? <span className="ws-tab-name" onKeyDownCapture={(e) => { renameKey.current = e.key === 'Enter' || e.key === 'Escape' }} onClick={(e) => e.stopPropagation()}><InlineRename value={name} className="ws-tab-rename" onDone={(v) => rename(id, v)} /></span>
          : <span className="ws-tab-name">{name}</span>}
        {a.remote && a.device && !multi && !pin && <span className="ws-tab-where">{a.device}</span>}
        {a.chief && <StatusDot status={a.status} size={6} />}
        {!pin && <button className="ws-tab-x" aria-label={t('Close {name}', { name })} onClick={(e) => { e.stopPropagation(); close(id, e) }}><Icon name="x" size={11} /></button>}
        {tint && <span className="ws-tab-line" aria-hidden="true" />}
      </div>
    )
  }

  return (
    <div className="ws-tabs" role="tablist" aria-label={t('Open agents')} onMouseLeave={() => { setKept(null); hideCard() }}>
      <div className={`ws-tabs-scroll ${fit === 'roomy' ? '' : `tight ${fit}`} ${out.left ? 'more-left' : ''} ${out.right ? 'more-right' : ''}`} ref={scroller}
        onScroll={() => { hideCard(); measure() }} onPointerDown={hideCard}
        onWheel={(e) => { const el = scroller.current; if (el && el.scrollWidth > el.clientWidth && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY }}>
        {shown.flatMap((g) => [g.head && groupHead(g), ...g.shown.map((id, n) => tabFor(g, id, n))].filter(Boolean))}
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
              {tintOf(card.id) && <i className="tab-card-swatch" style={paint(tintOf(card.id))} />}
              {cardWhere.text}
            </div>
          )}
          <div className="hc-title"><b>{tabName(cardA)}</b></div>
          {!cardA.view && <div className="hc-meta"><span><StatusDot status={cardA.status} size={7} /> {t(SAYS[cardA.status] || SAYS.unknown)}</span>{cardA.kindLabel && <span>{cardA.kindLabel}</span>}</div>}
          {cardWhere?.path && <div className="hc-path"><Icon name="folder" size={11} /> <span>{cardWhere.path}</span></div>}
        </div>, document.body)}
      {note && createPortal(
        <div className="hover-card tab-card tab-note" role="alert" style={{ top: (note.rect?.bottom ?? 80) + 6, left: Math.max(8, Math.min(note.rect?.left ?? 8, window.innerWidth - 328)) }}>{note.text}</div>, document.body)}
      {(menuTab || menuGroup) && (
        <TabMenu key={menuTab || menuGroup.key} x={menu.x} y={menu.y} under={menu.under} back={menu.back} className={menuGroup ? `tab-group-menu ${menuGroup.own ? 'tab-group-editor' : ''}` : ''}
          onClose={(keyed) => { setMenu(null); if (keyed && menuTab) keepFocus(menuTab) }}
          label={menuTab ? tabName(byId[menuTab]) : chipName(menuGroup)} items={menuTab ? tabItems(menuTab) : menuGroup.own ? ownItems(menuGroup) : groupItems(menuGroup)}
          name={menuGroup?.own && onName ? { value: menuGroup.label, set: (v) => onName(menuGroup.key, v) } : null} />
      )}
      {search && (
        <TabSearch anchor={searchBtn.current} active={[active, side].filter(Boolean)} onClose={() => setSearch(false)} onOpen={onOpen} onCloseTab={(id) => close(id)}
          rows={shown.flatMap((g) => g.ids)} byId={byId} name={tabName} tint={(id) => paint(tintOf(id))} />
      )}
    </div>
  )
}

// Items with no separator first, last or two in a row (one whose items around it aren't offered).
const tidy = (items) => items.filter(Boolean).filter((it, i, a) => it !== '-' || (i > 0 && i < a.length - 1 && a[i - 1] !== '-'))
// Into a stop of the menu: an item, the editor's name, or the colors' row at the color it has (else
// the first).
const into = (s) => (s?.matches('.tab-menu-colors') ? s.querySelector('[aria-checked="true"]') || s.querySelector('button') : s)?.focus({ preventScroll: true })

// A tab's or a group's right-click menu (Rail's Menu, placed on the page itself: the strip scrolls
// sideways, which would cut a menu inside it off). At the pointer, or to its left or above it where
// the window's edge would cut it off; under: under what it's for (opened from the keyboard, or a
// group's editor by its chip), moved left as far as it must be to fit. As wide as what it says. ↑↓ go from one item to the next (the
// colors are one), ←→ along the colors, Home and End to the first and last; Esc or Tab closes it,
// and from the keyboard the focus goes back to what it was opened on. A color picked leaves it open,
// to see it and try another. An item with more (Add tab to group ›) opens its own menu beside it,
// under the pointer, or with → or Enter; ← or Esc goes back to the item.
// name: a group of yours, whose editor this is (a dialog, as Chrome's): its name above the menu,
// focused, saved as it's typed; Enter closes it, Tab goes round it as ↓ does, ←→ and Home and End
// move in the name.
function TabMenu({ x, y, under, label, items, back, className, name, onClose }) {
  const ref = useRef(null)
  const [at, setAt] = useState({ left: x, top: y })
  const [sub, setSub] = useState(null) // the item whose own menu is open: { label, keyed }
  const subRef = useRef(sub)
  subRef.current = sub
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const shut = (keyed) => { closeRef.current(keyed); if (keyed && back?.isConnected) back.focus({ preventScroll: true }) }
  const shutRef = useRef(shut)
  shutRef.current = shut
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect()
    setAt({
      left: x + r.width <= window.innerWidth - 8 ? x : Math.max(8, under ? window.innerWidth - 8 - r.width : x - r.width),
      top: y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y,
    })
  }, [x, y])
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) closeRef.current() }
    const key = (e) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (!subRef.current) { shutRef.current(true); return }
      setSub(null)
      ref.current?.querySelector('[aria-haspopup="menu"][aria-expanded="true"]')?.focus({ preventScroll: true })
    }
    const gone = () => closeRef.current()
    document.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('resize', gone)
    const field = ref.current?.querySelector('.tab-group-name')
    if (field) { field.focus({ preventScroll: true }); field.select() } else into(ref.current?.querySelector('.menu-item, .tab-menu-colors'))
    return () => { document.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); window.removeEventListener('resize', gone) }
  }, [])
  const onKey = (e) => {
    if (e.target.closest('.tab-submenu')) return // its own keys
    const stops = [...ref.current.querySelectorAll('.tab-group-name, .menu-item, .tab-menu-colors')].filter((s) => !s.closest('.tab-submenu'))
    const colors = [...ref.current.querySelectorAll('.tab-menu-color')]
    const now = document.activeElement
    const i = stops.findIndex((s) => s.contains(now))
    const j = colors.indexOf(now)
    const field = !!now?.matches('.tab-group-name')
    const step = (list, k, by) => list[k < 0 ? (by > 0 ? 0 : list.length - 1) : (k + by + list.length) % list.length]
    let to
    if (field && e.key === 'Enter') { e.preventDefault(); shut(true); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') to = step(stops, i, e.key === 'ArrowDown' ? 1 : -1)
    else if (e.key === 'Tab' && name) to = step(stops, i, e.shiftKey ? -1 : 1)
    else if (e.key === 'Tab') { e.preventDefault(); shut(true); return }
    else if (field) return // the name's own keys
    else if (e.key === 'Home' || e.key === 'End') to = stops[e.key === 'Home' ? 0 : stops.length - 1]
    else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && j >= 0) to = step(colors, j, e.key === 'ArrowRight' ? 1 : -1)
    else if (e.key === 'ArrowRight' && now?.dataset.sub) { e.preventDefault(); setSub({ label: now.dataset.sub, keyed: true }); return }
    else return
    e.preventDefault()
    if (sub) setSub(null)
    into(to)
  }
  const item = (it) => (
    <button key={it.key || it.label} type="button" role="menuitem" className={`menu-item ${it.danger ? 'danger' : ''}`} onClick={(e) => { shut(e.detail === 0); it.run() }}>
      {it.swatch ? <i className="tab-menu-dot" style={paint(it.swatch)} /> : it.icon ? <Icon name={it.icon} size={13} /> : <span className="tab-menu-gap" />} {it.label}
    </button>
  )
  const body = tidy(items).map((it, i) => (it === '-' ? <div key={i} className="menu-sep" role="separator" /> : it.colors ? <Colors key="colors" {...it.colors} /> : it.sub ? (
    <div key={it.label} role="none" className="tab-menu-has" onMouseEnter={() => { if (sub?.label !== it.label) setSub({ label: it.label }) }}>
      <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={sub?.label === it.label} data-sub={it.label} className="menu-item" onClick={(e) => setSub({ label: it.label, keyed: e.detail === 0 })}>
        <Icon name={it.icon} size={13} /> {it.label} <Icon name="chevron" size={11} className="tab-menu-more" />
      </button>
      {sub?.label === it.label && <Sub key={sub.keyed ? 'keyed' : 'pointed'} label={it.label} keyed={sub.keyed} item={item} items={tidy(it.sub)} onBack={(keyed) => { setSub(null); if (keyed) ref.current?.querySelector(`[data-sub]`)?.focus({ preventScroll: true }) }} onDone={shut} />}
    </div>
  ) : item(it)))
  const common = { ref, 'data-esc': true, style: at, onKeyDown: onKey, onContextMenu: (e) => e.preventDefault(), onMouseOver: (e) => { if (sub && !e.target.closest('.tab-menu-has')) setSub(null) } }
  return createPortal(name ? (
    <div className={`menu tab-menu ${className}`} role="dialog" aria-label={t('Edit group')} {...common}>
      <input className="tab-group-name" value={name.value} maxLength={80} placeholder={t('Name this group')} aria-label={t('Group name')} spellCheck={false} autoComplete="off" onChange={(e) => name.set(e.target.value)} />
      <div role="menu" aria-label={label}>{body}</div>
    </div>
  ) : (
    <div className={`menu tab-menu ${className}`} role="menu" aria-label={label} {...common}>{body}</div>
  ), document.body)
}

// An item's own menu (Add tab to group ›): beside the menu, at the item, or on its other side where
// the window's edge would cut it off. ↑↓ in it, ← back to the item, Tab closes both.
function Sub({ label, keyed, items, item, onBack, onDone }) {
  const ref = useRef(null)
  const [at, setAt] = useState({ left: -9999, top: 0 })
  useLayoutEffect(() => {
    const row = ref.current.parentElement.getBoundingClientRect()
    const m = ref.current.parentElement.closest('.tab-menu').getBoundingClientRect()
    const s = ref.current.getBoundingClientRect()
    setAt({ left: m.right - 2 + s.width > window.innerWidth - 8 ? Math.max(8, m.left + 2 - s.width) : m.right - 2, top: Math.max(8, Math.min(row.top - 5, window.innerHeight - 8 - s.height)) })
  }, [])
  useEffect(() => { if (keyed) ref.current?.querySelector('.menu-item')?.focus({ preventScroll: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const onKey = (e) => {
    const list = [...ref.current.querySelectorAll('.menu-item')]
    const i = list.indexOf(document.activeElement)
    let to
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') to = list[i < 0 ? 0 : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]
    else if (e.key === 'Home' || e.key === 'End') to = list[e.key === 'Home' ? 0 : list.length - 1]
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); onBack(true); return }
    else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onDone(true); return }
    else return
    e.preventDefault()
    e.stopPropagation()
    to?.focus({ preventScroll: true })
  }
  return (
    <div className="menu tab-submenu" role="menu" aria-label={label} ref={ref} style={at} onKeyDown={onKey}>
      {items.map((it, i) => (it === '-' ? <div key={i} className="menu-sep" role="separator" /> : item(it)))}
    </div>
  )
}

// The colors to pick from, the one it has ticked; none: No color first (a tab's own color).
function Colors({ value, name, none, pick }) {
  return (
    <div className="tab-menu-colors" role="group" aria-label={t('Color for {name}', { name })}>
      {none && <button type="button" role="menuitemradio" aria-checked={!value} className="tab-menu-color tab-menu-none" aria-label={t('No color')} title={t('No color')} onClick={() => pick(null)} />}
      {PICK.map((c) => (
        <button key={c} type="button" role="menuitemradio" aria-checked={value === c} data-color={c} className="tab-menu-color" style={paint(c)} aria-label={t(NAMES[c])} title={t(NAMES[c])} onClick={() => pick(c)}>
          {value === c && <Icon name="check" size={11} />}
        </button>
      ))}
    </div>
  )
}

// Search tabs: every open tab (those in a folded group too), to find by typing its name or where it
// is. ↑↓ to pick, Enter to open, Esc to close.
function TabSearch({ anchor, rows, byId, name, active, tint, onOpen, onCloseTab, onClose }) {
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
                {x.where && <small>{tint(x.id) && <i className="tab-card-swatch" style={tint(x.id)} />}{x.where.text}</small>}
              </span>
              {active.includes(x.id) && <span className="tab-search-on">{t('On screen')}</span>}
              <button type="button" className="tab-search-x" aria-label={t('Close {name}', { name: x.name })} onClick={(e) => { e.stopPropagation(); onCloseTab(x.id) }}><Icon name="x" size={11} /></button>
            </li>
          ))}
        </ul>
      ) : <p className="tab-search-none">{t('No open tab matches "{words}"', { words: q.trim() })}</p>}
    </div>, document.body)
}
