// Studio's home (Studio.jsx StudioHome): every file on your computers, as Finder or Explorer shows
// them (server/explorer.js). A sidebar of Studio's own lists (shelves: Recent, its kinds, design
// packs, your signature), then your folders, drives and other computers; a folder as a list, icons or
// columns, with the way you came (back and forward) and a path to click along; a search in it and
// below it; Get Info; View Options (how it's arranged, grouped by kind, its icons' and names' size,
// kept for each folder); Quick Look with Space and the arrow keys; a click picks, and a double-click
// opens a document in Studio's editor and anything else in its own app, or shows it. Only to look
// for now: nothing is renamed, moved or deleted from here. On a phone, one column at a time: the
// sidebar, then a folder or a list, then a file (a tap opens it).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { Handle, usePersisted, useWidth } from '../layout.jsx'
import { api, machineId, onThisComputer } from '../../api.js'
import { useMachines } from '../Machines.jsx'
import { t, tx } from '../../i18n/index.js'
import { Menu, OPENABLE } from '../FileExtras.jsx'
import PermissionFix from '../PermissionFix.jsx'
import { STUDIO_OPENS } from '../Files.jsx'
import Sidebar, { named } from './Sidebar.jsx'
import { ListView, IconView, ColumnView, Thumb } from './views.jsx'
import ViewOptions, { useLook, lookKey, IconSize, ICON_SIZE } from './ViewOptions.jsx'
import QuickLook from './QuickLook.jsx'
import Info from './Info.jsx'
import Assist, { folderAssist } from './Assist.jsx'
import AiAssist from '../AiAssist.jsx'
import { ShareDialog } from '../Share.jsx'
import { useTrial } from '../../trials.js'
import { baseOf, getJson, postJson, useFolder, sorted, grouped, enc, joinFull, parentOf, nameOf, kindName, fmtSize, fmtWhen, WHERE_KEY, SHELF } from './fsapi.js'
import { sayPlace, takePlace, onPlaceShow, useNav, keyDir } from '../../backForward.js'
import './explorer.css'

const HOME = { machine: null, root: 'home', path: '' }
const VIEWS = [['list', 'list', tx('As list')], ['icons', 'grid', tx('As icons')], ['columns', 'columns', tx('As columns')]]
const ASKED_ABOUT = ['Desktop', 'Documents', 'Downloads']
// The view's place for Back and Forward (src/backForward.js), and what an old link to Folders lands on.
const PLACE = 'view:studio'
// A shelf is where one of Studio's lists is, rather than a folder: always this computer's.
const shelfOf = (w) => (String(w?.root || '').startsWith(SHELF) ? w.root.slice(SHELF.length) : null)
const placeWhere = (w) => (!w?.root ? null : shelfOf(w) ? { machine: null, root: String(w.root), path: '' } : { machine: w.machine || null, root: String(w.root), path: String(w.path || '') })
const readWhere = (first) => { try { return placeWhere(JSON.parse(localStorage.getItem(WHERE_KEY))) || first } catch { return first } }
const keepWhere = (w) => { try { localStorage.setItem(WHERE_KEY, JSON.stringify({ machine: w.machine, root: w.root, path: w.path })) } catch { /* not kept */ } }
const typingIn = (el) => !!el?.closest?.('input, textarea, select, [contenteditable="true"], .fx-ql, .fx-info, .fx-assist, .fx-vo')
// The mark on a folder's icon (art.jsx): the usual folders in a home folder by their names (Finder
// marks them whatever the sidebar lists), and the sidebar's own for the rest (a project, a cloud
// drive).
const HOME_MARKS = { Desktop: 'screen', Documents: 'doc', Downloads: 'download', Pictures: 'image', Music: 'volume', Movies: 'video', Videos: 'video', Applications: 'grid', Public: 'users' }
const SIDE_MARKS = new Set(['screen', 'doc', 'download', 'grid', 'image', 'volume', 'video', 'cloud', 'code', 'home'])

// The sidebar's list, for the computer shown, looked at again now and then.
function useSide(base) {
  const [st, setSt] = useState({ base })
  useEffect(() => {
    let live = true
    let timer = null
    setSt({ base })
    const load = () => getJson(base, '/files/sidebar')
      .then((data) => { if (live) setSt({ base, data }) }, (e) => { if (live) setSt((s) => ({ ...s, base, error: e.message, code: e.code })) })
      .finally(() => { if (live) timer = setTimeout(load, 60000) })
    load()
    return () => { live = false; clearTimeout(timer) }
  }, [base])
  return st.base === base ? st : { base }
}

// A search in a folder and below it: asked a moment after you stop typing, and the one before it
// stopped (the server stops looking too) when you type on, leave, or press Stop.
function useSearch(base, root, path, q, hidden) {
  const [st, setSt] = useState(null)
  const ctl = useRef(null)
  useEffect(() => {
    ctl.current?.abort()
    const needle = q.trim()
    if (!needle) { setSt(null); return }
    const c = new AbortController()
    ctl.current = c
    setSt((s) => ({ ...(s || {}), busy: true, q: needle, results: s?.results || [] }))
    const timer = setTimeout(() => {
      getJson(base, `/files/search?root=${enc(root)}&path=${enc(path)}&q=${enc(needle)}${hidden ? '&hidden=1' : ''}`, { signal: c.signal })
        .then((d) => setSt({ ...d, busy: false }), (e) => { if (e.name !== 'AbortError') setSt({ q: needle, results: [], error: e.message, busy: false }) })
    }, 280)
    return () => { clearTimeout(timer); c.abort() }
  }, [base, root, path, q, hidden])
  const stop = () => { ctl.current?.abort(); setSt((s) => s && { ...s, busy: false, stopped: true }) }
  return [st, stop]
}

// head: the page's header (Studio's). shelves: Studio's lists, { rows: [{ id, icon, label, n,
// hint }], first, render(id, { q, tap, keys, focus }) } (keys: a ref for the list's own key handler,
// fn(event, hit)). onOpenDoc({ root, path }): a document opened, in Studio's
// editor. above(at): what goes over the folder or list (New's form), for where it is ({ machine,
// root, path, shelf }).
export default function Explorer({ head = null, className = '', shelves = null, onOpenDoc = null, above = null }) {
  // Where it was, or the folder Back or Forward opens it at; at first, the first of the shelves.
  const first = shelves ? { machine: null, root: `${SHELF}${shelves.first || shelves.rows[0].id}`, path: '' } : HOME
  const [loc, setLocState] = useState(() => placeWhere(takePlace(PLACE)) || readWhere(first))
  const setLoc = (w) => { setLocState(w); keepWhere(w) }
  const [hist, setHist] = useState({ back: [], fwd: [] })
  const appNav = useNav()
  const [view, setView] = usePersisted('cc-fx-view', 'list')
  const [hidden, setHidden] = usePersisted('cc-fx-hidden', false)
  const [sideW, setSideW] = usePersisted('cc-fx-side-w', 210)
  const [assist, setAssist] = usePersisted('cc-fx-assist', false) // AI Assist's Look over this folder
  const [assistAt, setAssistAt] = useState(null) // { id, n }: the section it opened at
  const showAssist = (at) => { setAssist(at !== false); setAssistAt(at ? { id: at, n: Date.now() } : null) }
  const [sel, setSel] = useState(null)
  const [ql, setQl] = useState(false)
  const [info, setInfo] = useState(null) // the entry Get Info is on
  const [sharing, setSharing] = useState(null) // what a Share Link is being made for (Share.jsx)
  const shareOn = useTrial('share-links')
  const [menu, setMenu] = useState(null) // { x, y, entry }
  const [opts, setOpts] = useState(false) // View Options open
  const [q, setQ] = useState('')
  const [ver, setVer] = useState(0)
  const [toast, setToast] = useState(null)
  const [boxRef, boxW] = useWidth()
  const narrow = boxW > 0 && boxW < 640
  // A phone shows one thing at a time: the sidebar, or the folder.
  const [screen, setScreen] = useState('folder')
  const say = (text) => { setToast(text); setTimeout(() => setToast((x) => (x === text ? null : x)), 2600) }
  const mainRef = useRef(null)
  const searchRef = useRef(null)
  // The keys for one of Studio's lists, while one is shown (its own picking, opening and Quick Look).
  const shelfKeys = useRef(null)
  // View Options closed: by Esc or its close button, the keys back to the folder.
  const closeOpts = useCallback((back) => { setOpts(false); if (back === true) mainRef.current?.focus({ preventScroll: true }) }, [])

  // The computers: this window's, and your others (another of yours shows its files through the link).
  const devs = useMachines(30000).data
  const computers = useMemo(() => {
    const here = machineId ? devs?.machines?.find((m) => m.id === machineId) : devs?.here
    const others = (devs?.machines || []).filter((m) => m.state === 'linked' && m.id !== machineId).map((m) => ({ id: m.id, name: m.name, online: m.online, os: m.os }))
    if (machineId && devs?.here) others.unshift({ id: 'host', name: devs.here.name, online: true, os: devs.here.os })
    return { here: { id: null, name: here?.name || t('This computer'), os: here?.os }, others }
  }, [devs])
  // One of Studio's lists, when that's what's shown (one that isn't offered here any more: the first).
  const asked = shelves ? shelfOf(loc) : null
  const shelf = !asked ? null : shelves.rows.some((s) => s.id === asked) ? asked : shelves.rows[0].id
  const shelfRow = shelf ? shelves.rows.find((s) => s.id === shelf) : null
  const machine = shelf ? null : loc.machine && computers.others.some((c) => c.id === loc.machine) ? loc.machine : loc.machine && !devs ? loc.machine : null
  const computer = machine ? computers.others.find((c) => c.id === machine) : computers.here
  const base = baseOf(machine)
  const side = useSide(base)
  // How this folder shows (View Options): its own, or the defaults.
  const look = useLook(lookKey(machine, loc.root, loc.path))
  const sort = look.sort
  const setSort = (s) => look.set({ sort: s })
  const os = side.data?.os || (computer?.os === 'windows' ? 'windows' : computer?.os === 'linux' ? 'linux' : 'mac')
  // Show in Finder, Open in its app and macOS's question are for the computer you're at.
  const here = !machine && onThisComputer()
  const searching = !!q.trim()
  const folder = useFolder(base, loc.root, loc.path, { hidden, ver, on: !shelf })
  const [found, stopSearch] = useSearch(base, loc.root, loc.path, searching && !shelf ? q : '', hidden)
  const top = folder.data?.top || found?.top || null

  // ---------- going places ----------
  const locRef = useRef(loc)
  locRef.current = loc
  const go = useCallback((next, { select = null } = {}) => {
    const was = locRef.current
    const to = { machine: next.machine !== undefined ? next.machine : was.machine, root: next.root ?? was.root, path: next.path ?? '', hint: next.hint || null }
    if (to.machine !== was.machine || to.root !== was.root || to.path !== was.path) {
      setHist((h) => ({ back: [...h.back, was].slice(-60), fwd: [] }))
      setLoc(to)
    }
    setSel(select); setQl(false); setQ(''); setScreen('folder')
  }, [])
  const back = () => {
    const prev = hist.back.at(-1)
    if (!prev) return
    setHist((h) => ({ back: h.back.slice(0, -1), fwd: [loc, ...h.fwd].slice(0, 60) }))
    setLoc(prev); setSel(loc.machine === prev.machine && loc.root === prev.root && parentOf(loc.path) === prev.path ? loc.path : null); setQl(false); setQ('')
  }
  const forward = () => {
    const next = hist.fwd[0]
    if (!next) return
    setHist((h) => ({ back: [...h.back, loc].slice(-60), fwd: h.fwd.slice(1) }))
    setLoc(next); setSel(null); setQl(false); setQ('')
  }
  // Back and Forward (src/backForward.js): each folder and list is a place of Studio's, gone to again
  // as any is.
  useEffect(() => onPlaceShow(PLACE, (w) => { if (placeWhere(w)) go(placeWhere(w)) }), [go])
  const toShelf = useCallback((id) => go({ machine: null, root: `${SHELF}${id}`, path: '' }), [go])
  // One of the lists or a folder asked for from outside while it's open (Whiteboards, from ⌘K or a
  // link to them; a link to Folders).
  useEffect(() => {
    const on = (e) => { if (e.detail?.group) toShelf(e.detail.group); else if (placeWhere(e.detail?.where)) go(placeWhere(e.detail.where)) }
    window.addEventListener('bridge-studio-show', on)
    return () => window.removeEventListener('bridge-studio-show', on)
  }, [toShelf, go])
  // The folder it's in, with this one picked (as Finder does).
  const up = () => { if (loc.path) go({ ...loc, path: parentOf(loc.path) }, { select: loc.path }) }
  const toComputer = (id) => { go({ machine: id, root: 'home', path: '' }); setSel(null) }
  // A path in this root, shown where it is: its folder opened, it picked (Assist, a Markdown link).
  const showPath = (p) => { const clean = String(p || '').replace(/^\/+|\/+$/g, ''); if (clean) go({ ...loc, path: parentOf(clean) }, { select: clean }) }

  // ---------- what's on screen ----------
  const entries = searching ? found?.results || [] : folder.data?.entries || []
  // In the order shown: in groups by kind (Group by Kind), or sorted as picked.
  const groups = useMemo(() => (look.group ? grouped(entries, sort) : null), [entries, sort, look.group])
  const list = useMemo(() => (groups ? groups.flatMap((g) => g.entries) : sorted(entries, sort)), [groups, entries, sort])
  const current = list.find((e) => e.path === sel) || null
  const cloud = !!folder.data?.cloud
  // Whether the computer says when this folder's files were made (Arrange By Date Created): a disk
  // that doesn't keep it gives none.
  const created = (folder.data?.entries || []).some((e) => e.btime) ? true : folder.data?.entries?.length ? false : null
  // The mark on each folder's icon: Desktop, Documents and the rest in a home folder, and what the
  // sidebar marks (a project, a cloud drive), wherever they are.
  const marks = useMemo(() => {
    const d = side.data
    const m = new Map()
    for (const it of d ? [...d.favorites, ...d.clouds, ...d.projects] : []) if (SIDE_MARKS.has(it.icon)) m.set(`${it.root}\n${it.path || ''}`, it.icon)
    return m
  }, [side.data])
  const glyphOf = useCallback((e) => {
    if (!e.dir) return null
    // The top of a home folder: this computer's home, or another of your computers.
    if (!e.path) return loc.root === 'home' ? (machine ? 'laptop' : 'home') : null
    return marks.get(`${loc.root}\n${e.path}`) || (loc.root === 'home' && !e.path.includes('/') && HOME_MARKS[e.name]) || (e.guard === 'iCloud Drive' || e.cloud ? 'cloud' : null)
  }, [marks, loc.root, machine])
  const rootLabel = shelfRow ? shelfRow.label : loc.root === 'home' ? 'Home' : side.data?.drives?.find((d) => d.root === loc.root)?.label || side.data?.projects?.find((p) => p.root === loc.root && !p.path)?.label || t('Folder')
  const parts = loc.path ? loc.path.split('/') : []
  const folderEntry = { name: parts.at(-1) || named(rootLabel), path: loc.path, dir: true, ...(loc.path ? {} : { drive: loc.root !== 'home' }) }
  // The one picked kept in view (after the arrow keys, a sort, a refresh).
  useEffect(() => {
    if (!sel || !mainRef.current) return
    const el = mainRef.current.querySelector(`[data-path="${CSS.escape(sel)}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [sel, view])

  // ---------- doing things ----------
  const revealLabel = os === 'mac' ? t('Show in Finder') : os === 'windows' ? t('Show in Explorer') : t('Show in file manager')
  const studioOpens = (e) => !machine && !e.dir && STUDIO_OPENS.test(e.name)
  const appOpens = (e) => here && !e.dir && OPENABLE.test(e.name)
  const openLabel = (e) => (!e ? null : e.dir || studioOpens(e) ? t('Open') : appOpens(e) ? t('Open in its app') : null)
  const openInApp = async (e) => {
    try { await postJson(base, `/agents/${enc(loc.root)}/fileop`, { op: 'open', path: e.path }); say(t('Opened {name} in its app', { name: e.name })) } catch (x) { say(x.message) }
  }
  const reveal = async (e) => {
    try { await postJson(base, `/agents/${enc(loc.root)}/fileop`, { op: 'reveal', path: e.path }) } catch (x) { say(x.message) }
  }
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); say(t('Path copied')) } catch { say(t('Couldn\'t copy it here: {path}', { path: text })) }
  }
  const fullOf = (e) => (top ? joinFull(top, e.path) : e.path)
  // A double-click (or Enter): a folder opens here, a document in Studio's editor, anything else in
  // its own app on this computer, or in Quick Look where that can't be.
  const openEntry = (e) => {
    if (!e) return
    if (e.dir) return go({ ...loc, path: e.path, hint: e.guard ? { guard: e.guard, asked: e.asked } : null })
    setSel(e.path)
    if (studioOpens(e)) {
      if (onOpenDoc) onOpenDoc({ root: loc.root, path: e.path })
      else window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root: loc.root, path: e.path } }))
      return
    }
    if (appOpens(e)) { openInApp(e); return }
    setQl(true)
  }
  const onMenu = (e, ev) => setMenu({ x: ev.clientX, y: ev.clientY, entry: e })
  const menuFor = (e) => {
    const isFolderHere = e.path === loc.path
    return [
      !isFolderHere && { label: openLabel(e) || t('Quick Look'), icon: e.dir ? 'folder-open' : 'eye', run: () => openEntry(e) },
      !isFolderHere && !e.dir && openLabel(e) && { label: t('Quick Look'), icon: 'eye', hint: t('Space'), run: () => { setSel(e.path); setQl(true) } },
      { label: t('Get Info'), icon: 'info', hint: '⌘I', run: () => setInfo(e) },
      !e.dir && studioOpens(e) && appOpens(e) && { label: t('Open in its app'), icon: 'external', run: () => openInApp(e) },
      here && { label: revealLabel, icon: 'folder-open', run: () => reveal(e) },
      // A Share Link (Share.jsx): a document Studio opens as a Studio document (its latest, as a page);
      // anything else as it is. On this computer's files (another's are shared from that one), while
      // Share Links (a beta feature) is on.
      !machine && shareOn && { label: t('Share Link…'), icon: 'link', run: () => setSharing({ kind: e.dir ? 'folder' : studioOpens(e) && !/\.(html?|pdf)$/i.test(e.name) ? 'doc' : 'file', root: loc.root, path: e.path, name: e.name }) },
      'sep',
      { label: t('Copy path'), icon: 'copy', run: () => copy(fullOf(e)) },
      isFolderHere && { label: hidden ? t('Hide hidden files') : t('Show hidden files'), icon: hidden ? 'eye-off' : 'eye', hint: '⌘⇧.', run: () => setHidden(!hidden) },
    ].filter(Boolean)
  }

  // ---------- keys, as Finder's ----------
  const step = (n) => {
    if (!list.length) return
    const at = list.findIndex((e) => e.path === sel)
    // Icons: up and down to the icon in the row above or below that's nearest across (rows differ in
    // length between groups).
    if (view === 'icons' && Math.abs(n) === 10 && at >= 0) {
      const tiles = [...(mainRef.current?.querySelectorAll('.fx-tile') || [])]
      const me = tiles.find((x) => x.dataset.path === sel)?.getBoundingClientRect()
      if (!me) return
      const boxes = tiles.map((x) => ({ path: x.dataset.path, r: x.getBoundingClientRect() })).filter((x) => (n > 0 ? x.r.top > me.top + 4 : x.r.top < me.top - 4))
      if (!boxes.length) return
      const top = n > 0 ? Math.min(...boxes.map((x) => x.r.top)) : Math.max(...boxes.map((x) => x.r.top))
      const mid = me.left + me.width / 2
      const near = boxes.filter((x) => Math.abs(x.r.top - top) < 4).sort((a, b) => Math.abs(a.r.left + a.r.width / 2 - mid) - Math.abs(b.r.left + b.r.width / 2 - mid))[0]
      setSel(near.path)
      return
    }
    const by = Math.abs(n) === 10 ? Math.sign(n) : n
    const i = at < 0 ? (by > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, at + by))
    setSel(list[i].path)
  }
  // The icons a size bigger or smaller (⌘+, ⌘−), or the usual size (⌘0).
  const sizeIcons = (d) => look.set({ icon: d ? Math.round(look.icon / ICON_SIZE.step) * ICON_SIZE.step + d * ICON_SIZE.step : ICON_SIZE.usual })
  const onKey = (e) => {
    if (typingIn(e.target)) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key
    // On a button or a link, Space and Enter press it, as anywhere.
    if ((k === ' ' || k === 'Enter') && e.target.closest?.('button, a')) return
    const hit = (fn) => { e.preventDefault(); e.stopPropagation(); fn() }
    // While the app has Back and Forward, their keys are its (src/backForward.js): each folder is a place.
    if (appNav.on && keyDir(e)) return
    if ((mod && k === '[') || (e.altKey && k === 'ArrowLeft')) return hit(back)
    if ((mod && k === ']') || (e.altKey && k === 'ArrowRight')) return hit(forward)
    // One of Studio's lists picks, opens and shows its own files (HomeFiles.jsx); a page of its own
    // (Design Packs), none: the arrow keys scroll it, as on any page.
    if (shelf) return shelfKeys.current?.(e, hit)
    if (mod && k.toLowerCase() === 'j' && !e.shiftKey) return hit(() => setOpts((v) => !v))
    // Icons, bigger and smaller, as Finder's ⌘+ and ⌘− (and the app's zoom everywhere else).
    if (mod && !e.altKey && shownView === 'icons' && !searching) {
      if (k === '+' || k === '=' || e.code === 'NumpadAdd') return hit(() => sizeIcons(1))
      if (k === '-' || k === '_' || e.code === 'NumpadSubtract') return hit(() => sizeIcons(-1))
      if (k === '0' || e.code === 'Numpad0') return hit(() => sizeIcons(0))
    }
    if (mod && k === 'ArrowUp') return hit(up)
    if (mod && k === 'ArrowDown') return current && hit(() => openEntry(current))
    if (mod && e.shiftKey && e.code === 'Period') return hit(() => setHidden(!hidden))
    if (mod && k.toLowerCase() === 'i') return hit(() => setInfo(current || folderEntry))
    if (mod && k.toLowerCase() === 'f') return hit(() => searchRef.current?.focus())
    if (mod || e.altKey) return
    if (k === ' ') return current && hit(() => setQl((v) => !v))
    if (k === 'Enter') return current && hit(() => openEntry(current))
    if (k === 'Escape' && sel) return hit(() => setSel(null))
    if (k === 'ArrowDown') return hit(() => step(view === 'icons' ? 10 : 1))
    if (k === 'ArrowUp') return hit(() => step(view === 'icons' ? -10 : -1))
    if (k === 'ArrowRight') return hit(() => (view === 'icons' ? step(1) : view === 'columns' && current?.dir ? openEntry(current) : null))
    if (k === 'ArrowLeft') return hit(() => (view === 'icons' ? step(-1) : view === 'columns' ? up() : null))
  }
  // Keys go to the folder once you've clicked in it (or opened Studio).
  useEffect(() => { if (!narrow) mainRef.current?.focus({ preventScroll: true }) }, [loc.root, loc.path, machine, narrow])

  // ---------- the folder, or what's keeping it ----------
  const guard = folder.guard || loc.hint?.guard || null
  const asking = !!guard && loc.hint?.asked !== true
  const folderName = parts.length ? parts.at(-1) : named(rootLabel)
  useEffect(() => { sayPlace(PLACE, { machine: loc.machine || null, root: loc.root, path: loc.path }, folderName) }, [loc.machine, loc.root, loc.path, folderName])
  const retry = () => setVer((v) => v + 1)
  const problem = (st) => {
    const g = st.guard || guard
    const where = g === 'volume' ? t('this drive') : g === 'iCloud Drive' ? t('iCloud Drive') : g ? t('your {folder} folder', { folder: t(g) }) : folderName
    if (st.loading) {
      if (g && asking && (here || st.waiting)) {
        return (
          <div className="fx-state fx-asking" role="status" data-state="asking">
            <Icon name="unlock" size={22} />
            <b>{t('macOS is asking whether Bridge AI may open {where}', { where })}</b>
            <p>{t('macOS asks the first time an app opens your Desktop, Documents or Downloads folder, iCloud Drive, or a drive you plug in. Choose Allow in its window (it can be behind this one).')}</p>
            <p className="muted small">{t('Bridge AI reads this folder only to show it to you here, and only now that you\'ve opened it.')}</p>
          </div>
        )
      }
      if (st.waiting) {
        return (
          <div className="fx-state" role="status" data-state="waiting">
            <Icon name="clock" size={22} />
            <b>{t('{name} is taking a while to answer', { name: folderName })}</b>
            <p className="muted">{t('A cloud or network drive can be slow. Bridge AI keeps waiting, and everything else carries on meanwhile.')}</p>
            <button type="button" className="btn small" onClick={back} disabled={!hist.back.length}><Icon name="back" size={12} /> {t('Go back')}</button>
          </div>
        )
      }
      return <div className="fx-state-load"><div className="skeleton-rows"><div /><div /><div /><div /></div></div>
    }
    if (!st.error) return null
    if (st.code === 'EPERM') {
      if (!machine && g && ASKED_ABOUT.includes(g)) {
        return (
          <div className="fx-state" role="alert" data-state="refused">
            <PermissionFix pane="files" folder={g} onCheck={retry} quiet initial="denied">
              <p><b>{t('macOS didn\'t let Bridge AI into {where}.', { where })}</b></p>
              <p className="small">{t('To allow it, turn on {folder} for Bridge AI in System Settings › Privacy & Security › Files and Folders.', { folder: t(g) })}</p>
            </PermissionFix>
          </div>
        )
      }
      return (
        <div className="fx-state" role="alert" data-state="refused">
          <Icon name="blocked" size={22} />
          <b>{machine ? t('macOS on {name} didn\'t let Bridge AI into {where}.', { name: computer?.name || '', where }) : t('macOS didn\'t let Bridge AI into {where}.', { where })}</b>
          <p>{machine ? t('To allow it, on {name} open System Settings › Privacy & Security › Files and Folders and turn it on for Bridge AI.', { name: computer?.name || '' })
            : t('To allow it, open System Settings › Privacy & Security › Files and Folders and turn it on for Bridge AI.')}</p>
          {here && os === 'mac' && <button type="button" className="btn small" onClick={() => api('/fix/settings', { method: 'POST', body: { pane: 'files' } }).catch((x) => say(x.message))}><Icon name="settings" size={12} /> {t('Open System Settings')}</button>}
          <button type="button" className="ghost-btn" onClick={retry}><Icon name="refresh" size={12} /> {t('Try again')}</button>
        </div>
      )
    }
    // Another computer on a Bridge AI from before Folders was part of it, with the beta it was off.
    if (st.code === 'trial' && machine) {
      return (
        <div className="fx-state" role="alert" data-state="off">
          <Icon name="layers" size={22} />
          <b>{t('{name} has an older Bridge AI.', { name: computer?.name || '' })}</b>
          <p className="muted">{t('Update it there to see its folders from here, or turn on Files in its Settings › About & Updates › Beta Features.')}</p>
        </div>
      )
    }
    return (
      <div className="fx-state" role="alert" data-state={st.code || 'error'}>
        <Icon name={st.code === 'notAsked' ? 'unlock' : 'alert'} size={22} />
        <b>{st.error}</b>
        {st.code === 'gone' && <button type="button" className="btn small" onClick={() => go({ root: 'home', path: '' })}><Icon name="home" size={12} /> {t('Go to Home')}</button>}
        {!['gone', 'keptOut', 'notAsked', 'outside', 'EACCES'].includes(st.code) && <button type="button" className="ghost-btn" onClick={retry}><Icon name="refresh" size={12} /> {t('Try again')}</button>}
      </div>
    )
  }

  // ---------- the parts ----------
  const label = shelf ? folderName : t('Files in {name}', { name: folderName })
  // What goes over it (New's form, a new file's name and folder): on a phone, the folder's screen
  // comes forward to show it.
  const over = above ? above({ machine, root: loc.root, path: loc.path, shelf, name: folderName }) : null
  useEffect(() => { if (over) setScreen('folder') }, [!!over]) // eslint-disable-line react-hooks/exhaustive-deps
  const sel1 = (p) => { setSel(p); if (!narrow) mainRef.current?.focus({ preventScroll: true }) }
  const preview = view === 'columns' && current && !current.dir && (
    <div className="fx-preview">
      <Thumb base={base} root={loc.root} e={current} cloud={cloud} big glyph={glyphOf(current)} />
      <b>{current.name}</b>
      <span className="muted small">{[kindName(current), fmtSize(current.size)].filter(Boolean).join(' · ')}</span>
      {current.mtime && <span className="muted small">{t('Modified {when}', { when: fmtWhen(current.mtime) })}</span>}
      <div className="fx-preview-acts">
        <button type="button" className="btn small" onClick={() => setQl(true)}><Icon name="eye" size={12} /> {t('Quick Look')}</button>
        {openLabel(current) && <button type="button" className="btn small" onClick={() => openEntry(current)}>{openLabel(current)}</button>}
      </div>
    </div>
  )
  const body = () => {
    // One of Studio's lists: its own page, searched by the bar's search.
    // On a computer, it picks on a click and opens on a double-click, its keys in shelfKeys (and the
    // keys back here once Quick Look closes); on a phone, a tap opens.
    if (shelf) return <div className="sd-shelf" data-shelf={shelf}>{shelves.render(shelf, { q, tap: narrow, keys: shelfKeys, focus: () => mainRef.current?.focus({ preventScroll: true }) })}</div>
    if (searching) {
      return (
        <>
          <div className="fx-search-note small" role="status">
            {found?.busy ? <><Icon name="search" size={12} /> {t('Looking in {name} and below it…', { name: folderName })} <button type="button" className="link-btn" onClick={stopSearch}>{t('Stop')}</button></>
              : found?.error ? <span className="error-text">{found.error}</span>
                : found && <>{found.results.length === 1 ? t('1 found in {name} and below it', { name: folderName }) : t('{n} found in {name} and below it', { n: found.results.length, name: folderName })}
                  {(found.partial || found.stopped) && ` ${t('(it stopped part way: narrow it down to find more)')}`}
                  {found.skipped?.length > 0 && <span className="muted"> {t('Not looked in: {names}.', { names: found.skipped.join(', ') })}</span>}</>}
          </div>
          {list.length > 0 && <ListView entries={list} groups={groups} sel={sel} onSel={sel1} onOpen={openEntry} onMenu={onMenu} sort={sort} onSort={setSort} where label={label} tap={narrow} glyphOf={glyphOf} />}
        </>
      )
    }
    if (view === 'columns' && !narrow) {
      // What's keeping this folder (macOS asking, a slow drive, a refusal) is said above its columns.
      const held = folder.error || (folder.loading && ((guard && asking) || folder.waiting))
      return (
        <>
          {held && problem(folder)}
          <ColumnView base={base} root={loc.root} path={loc.path} rootLabel={named(rootLabel)} hidden={hidden} ver={ver} sortOf={(d) => look.sortAt(lookKey(machine, loc.root, d))} sel={sel} cloud={cloud}
            onGo={(p, select) => go({ ...loc, path: p }, { select: select || null })} onSel={sel1} onOpen={openEntry} onMenu={onMenu} preview={preview} glyphOf={glyphOf} />
        </>
      )
    }
    const st = problem(folder)
    if (!folder.data) return st
    if (!list.length) return <div className="fx-state fx-empty"><Icon name="folder-open" size={22} /><p className="muted">{hidden ? t('This folder is empty.') : t('Nothing here, or only hidden files.')}</p></div>
    return (
      <>
        {folder.error && st}
        {view === 'icons'
          ? <IconView entries={list} groups={groups} sel={sel} onSel={sel1} onOpen={openEntry} onMenu={onMenu} base={base} root={loc.root} cloud={cloud} label={label} tap={narrow} size={look.icon} glyphOf={glyphOf} />
          : <ListView entries={list} groups={groups} sel={sel} onSel={sel1} onOpen={openEntry} onMenu={onMenu} sort={sort} onSort={setSort} label={label} tap={narrow} glyphOf={glyphOf} />}
      </>
    )
  }
  const count = searching ? null : folder.data ? folder.data.total : null
  const status = [
    count != null && (count === 1 ? t('1 item') : t('{n} items', { n: count })),
    folder.data?.more > 0 && t('the first {n} shown', { n: folder.data.total - folder.data.more }),
    current && t('{name} picked', { name: current.name }),
    hidden && t('hidden files shown'),
    cloud && t('on a cloud drive: files download when opened'),
  ].filter(Boolean).join(' · ')

  // A phone has no room for columns: the list instead.
  const shownView = narrow && view === 'columns' ? 'list' : view
  const sideEl = <Sidebar side={side.data} error={side.error && (side.code === 'trial' && machine ? t('{name} has an older Bridge AI.', { name: computer?.name || '' }) : side.error)} computers={computers} machine={machine} loc={{ ...loc, machine }} onGo={(w) => go({ machine, ...w })} onComputer={toComputer}
    shelves={shelves?.rows} shelf={shelf} onShelf={toShelf} />
  const showSide = !narrow || screen === 'side'
  const showMain = !narrow || screen === 'folder'
  return (
    <div className={`fx ${className} ${narrow ? 'narrow' : ''}`} ref={boxRef} data-view={view} data-shelf={shelf || undefined}>
      {head}
      <div className="fx-wrap">
        {showSide && <div className="fx-side-box" style={narrow ? undefined : { width: sideW }}>{sideEl}</div>}
        {!narrow && <Handle axis="x" size={sideW} min={150} max={360} onSize={setSideW} label={t('Resize the sidebar')} />}
        {showMain && (
          <section className="fx-main" aria-label={label} onKeyDown={onKey}>
            <div className="fx-bar">
              {narrow && <button type="button" className="win-btn" onClick={() => (loc.path ? up() : setScreen('side'))} aria-label={loc.path ? t('Up to the folder it\'s in') : t('All locations')}><Icon name="back" size={15} /></button>}
              {!narrow && <>
                <button type="button" className="win-btn" onClick={back} disabled={!hist.back.length} aria-label={t('Back')} title={t('Back (⌘[)')}><Icon name="chevron" size={13} className="flip" /></button>
                <button type="button" className="win-btn" onClick={forward} disabled={!hist.fwd.length} aria-label={t('Forward')} title={t('Forward (⌘])')}><Icon name="chevron" size={13} /></button>
              </>}
              {narrow && <h3 className="fx-path-title" title={loc.path || named(rootLabel)}>{machine && <span className="fx-crumb-pc"><Icon name="laptop" size={12} /> {computer?.name}</span>}{folderName}</h3>}
              <nav className="fx-path" aria-label={t('Path')} hidden={narrow}>
                {machine && <span className="fx-crumb fx-crumb-pc"><Icon name="laptop" size={12} /> {computer?.name}</span>}
                <button type="button" className="fx-crumb" onClick={() => go({ ...loc, path: '' })} aria-current={!parts.length ? 'location' : undefined}>{named(rootLabel)}</button>
                {parts.map((p, i) => (
                  <span key={i} className="fx-crumb-wrap">
                    <Icon name="chevron" size={10} />
                    <button type="button" className="fx-crumb" onClick={() => go({ ...loc, path: parts.slice(0, i + 1).join('/') })} aria-current={i === parts.length - 1 ? 'location' : undefined}>{p}</button>
                  </span>
                ))}
              </nav>
              <div className="fx-tools">
                <label className="fx-search">
                  <Icon name="search" size={12} />
                  <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={shelf ? t('Find a file') : narrow ? t('Search') : t('Search {name}', { name: folderName })}
                    aria-label={shelf ? t('Find a file by its name, in all your files') : t('Search in this folder and below it')}
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQ(''); mainRef.current?.focus() } }} />
                  {q && <button type="button" className="fx-search-x" onClick={() => setQ('')} aria-label={t('Clear the search')}><Icon name="x" size={11} /></button>}
                </label>
                {/* How a folder shows, and what's in it: not for one of Studio's lists. */}
                {!shelf && <>
                  <div className="seg small-seg fx-views" role="group" aria-label={t('View')}>
                    {VIEWS.filter(([v]) => !narrow || v !== 'columns').map(([v, icon, name]) => (
                      <button key={v} type="button" className={shownView === v ? 'on' : ''} onClick={() => setView(v)} aria-pressed={shownView === v} aria-label={t(name)} title={t(name)}><Icon name={icon} size={13} /></button>
                    ))}
                  </div>
                  {/* Icons' size, while it shows icons (and in View Options, on a phone too). */}
                  {shownView === 'icons' && !searching && !narrow && <IconSize look={look} className="fx-bar-size" />}
                  <button type="button" className={`win-btn fx-vo-btn ${opts ? 'on' : ''}`} onClick={() => setOpts((v) => !v)} aria-expanded={opts} aria-haspopup="dialog"
                    aria-label={t('View Options')} title={t('View Options: arrange, group, icon and text size (⌘J)')}><Icon name="sort" size={13} /></button>
                  <button type="button" className={`win-btn ${hidden ? 'on' : ''}`} onClick={() => setHidden(!hidden)} aria-pressed={hidden} aria-label={hidden ? t('Hide hidden files') : t('Show hidden files')} title={`${hidden ? t('Hide hidden files') : t('Show hidden files')} (⌘⇧.)`}><Icon name={hidden ? 'eye' : 'eye-off'} size={13} /></button>
                  <button type="button" className="win-btn" onClick={() => setInfo(current || folderEntry)} aria-label={t('Get Info')} title={t('Get Info (⌘I)')}><Icon name="info" size={13} /></button>
                  <AiAssist className="btn small fx-assist-btn" compact={narrow} on={!!assist} items={() => folderAssist(!!assist, showAssist)} />
                </>}
              </div>
              {opts && !shelf && <ViewOptions look={look} name={folderName} icons={shownView === 'icons'} created={created} onClose={closeOpts} />}
            </div>
            <div className="fx-panes">
              <div className={`fx-body ${view === 'columns' && !narrow && !searching && !shelf ? 'cols' : ''}`} ref={mainRef} tabIndex={0} style={{ '--fx-text': `${look.text}px` }}
                onContextMenu={(e) => { if (shelf || e.target.closest('.fx-row, .fx-tile, .fx-crow')) return; e.preventDefault(); onMenu(folderEntry, e) }}
                onMouseDown={(e) => { if (!e.target.closest('.fx-row, .fx-tile, .fx-crow, button, input, a')) setSel(null) }}>
                {over}
                {narrow && assist && !shelf ? <div className="fx-assist" data-root={loc.root} data-rel={loc.path || ''}><Assist root={loc.root} rel={loc.path} machine={machine} at={assistAt} onOpen={(p) => { setAssist(false); showPath(p) }} onClose={() => setAssist(false)} /></div> : body()}
              </div>
              {info && !shelf && <Info base={base} root={loc.root} entry={info} cloud={cloud} glyph={glyphOf(info)} onClose={() => { setInfo(null); mainRef.current?.focus() }} onOpen={() => { const e = info; setInfo(null); openEntry(e) }}
                openLabel={info.path === loc.path ? null : openLabel(info)} onReveal={here ? () => reveal(info) : null} revealLabel={revealLabel} onCopy={copy} />}
              {assist && !narrow && !shelf && <div className="fa-dock fx-assist" data-root={loc.root} data-rel={loc.path || ''}><Assist root={loc.root} rel={loc.path} machine={machine} at={assistAt} onOpen={showPath} onClose={() => setAssist(false)} /></div>}
            </div>
            {!shelf && <footer className="fx-foot muted small" role="status">{status}</footer>}
          </section>
        )}
      </div>
      {ql && current && (
        <QuickLook base={base} root={loc.root} entry={current} at={list.indexOf(current)} count={list.length} cloud={cloud} glyph={glyphOf(current)}
          onClose={() => { setQl(false); mainRef.current?.focus({ preventScroll: true }) }} onStep={(n) => step(n)} onInfo={() => setInfo(current)}
          openLabel={openLabel(current)} onOpen={() => { setQl(false); openEntry(current) }} onOpenPath={showPath} />
      )}
      {menu && <Menu x={menu.x} y={menu.y} items={menuFor(menu.entry)} heading={menu.entry.name} onClose={() => setMenu(null)} className="fx-menu" />}
      {sharing && <ShareDialog what={sharing} onClose={() => setSharing(null)} />}
      {toast && <div className="fx-toast" role="status">{toast}</div>}
    </div>
  )
}
