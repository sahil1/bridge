// Files, a beta feature: a page of its own for every file on your computers, as Finder or Explorer
// shows them (server/explorer.js). A sidebar of your folders, drives and other computers; a folder as
// a list, icons or columns, with the way you came (back and forward) and a path to click along; a
// search in it and below it; Get Info; Quick Look with Space and the arrow keys; a double-click opens
// a document in Studio and anything else in its own app, or shows it. Only to look for now: nothing
// is renamed, moved or deleted from here. On a phone, one column at a time: the sidebar, then a
// folder, then a file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { PaneHeader, Handle, usePersisted, useWidth } from '../layout.jsx'
import { api, machineId, onThisComputer } from '../../api.js'
import { useMachines } from '../Machines.jsx'
import { useTrial } from '../../trials.js'
import { t, tx } from '../../i18n/index.js'
import { Menu, OPENABLE } from '../FileExtras.jsx'
import PermissionFix from '../PermissionFix.jsx'
import { STUDIO_OPENS } from '../Files.jsx'
import Sidebar, { named } from './Sidebar.jsx'
import { ListView, IconView, ColumnView, Thumb } from './views.jsx'
import QuickLook from './QuickLook.jsx'
import Info from './Info.jsx'
import Assist, { folderAssist } from './Assist.jsx'
import AiAssist from '../AiAssist.jsx'
import { baseOf, getJson, postJson, useFolder, sorted, enc, joinFull, parentOf, nameOf, kindName, fmtSize, fmtWhen, WHERE_KEY } from './fsapi.js'
import { sayPlace, takePlace, onPlaceShow, useNav, keyDir } from '../../backForward.js'
import './explorer.css'

const HOME = { machine: null, root: 'home', path: '' }
const VIEWS = [['list', 'list', tx('As list')], ['icons', 'grid', tx('As icons')], ['columns', 'columns', tx('As columns')]]
const ASKED_ABOUT = ['Desktop', 'Documents', 'Downloads']
const SOON = () => t('Read-only for now: renaming, moving and deleting are coming.')
const readWhere = () => { try { const w = JSON.parse(localStorage.getItem(WHERE_KEY)); return w?.root ? { machine: w.machine || null, root: String(w.root), path: String(w.path || '') } : HOME } catch { return HOME } }
const keepWhere = (w) => { try { localStorage.setItem(WHERE_KEY, JSON.stringify({ machine: w.machine, root: w.root, path: w.path })) } catch { /* not kept */ } }
// A folder Back or Forward goes to (src/backForward.js), as kept.
const placeWhere = (w) => (w?.root ? { machine: w.machine || null, root: String(w.root), path: String(w.path || '') } : null)
const typingIn = (el) => !!el?.closest?.('input, textarea, select, [contenteditable="true"], .fx-ql, .fx-info, .fx-assist')

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

export default function Explorer() {
  const studioOn = useTrial('studio')
  // Where it was, or the folder Back or Forward opens it at.
  const [loc, setLocState] = useState(() => placeWhere(takePlace('view:files')) || readWhere())
  const setLoc = (w) => { setLocState(w); keepWhere(w) }
  const [hist, setHist] = useState({ back: [], fwd: [] })
  const appNav = useNav()
  const [view, setView] = usePersisted('cc-fx-view', 'list')
  const [sort, setSort] = usePersisted('cc-fx-sort', { by: 'name', desc: false })
  const [hidden, setHidden] = usePersisted('cc-fx-hidden', false)
  const [sideW, setSideW] = usePersisted('cc-fx-side-w', 210)
  const [assist, setAssist] = usePersisted('cc-fx-assist', false) // AI Assist's Look over this folder
  const [assistAt, setAssistAt] = useState(null) // { id, n }: the section it opened at
  const showAssist = (at) => { setAssist(at !== false); setAssistAt(at ? { id: at, n: Date.now() } : null) }
  const [sel, setSel] = useState(null)
  const [ql, setQl] = useState(false)
  const [info, setInfo] = useState(null) // the entry Get Info is on
  const [menu, setMenu] = useState(null) // { x, y, entry }
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

  // The computers: this window's, and your others (another of yours shows its files through the link).
  const devs = useMachines(30000).data
  const computers = useMemo(() => {
    const here = machineId ? devs?.machines?.find((m) => m.id === machineId) : devs?.here
    const others = (devs?.machines || []).filter((m) => m.state === 'linked' && m.id !== machineId).map((m) => ({ id: m.id, name: m.name, online: m.online, os: m.os }))
    if (machineId && devs?.here) others.unshift({ id: 'host', name: devs.here.name, online: true, os: devs.here.os })
    return { here: { id: null, name: here?.name || t('This computer'), os: here?.os }, others }
  }, [devs])
  const machine = loc.machine && computers.others.some((c) => c.id === loc.machine) ? loc.machine : loc.machine && !devs ? loc.machine : null
  const computer = machine ? computers.others.find((c) => c.id === machine) : computers.here
  const base = baseOf(machine)
  const side = useSide(base)
  const os = side.data?.os || (computer?.os === 'windows' ? 'windows' : computer?.os === 'linux' ? 'linux' : 'mac')
  // Show in Finder, Open in its app and macOS's question are for the computer you're at.
  const here = !machine && onThisComputer()
  const searching = !!q.trim()
  const folder = useFolder(base, loc.root, loc.path, { hidden, ver })
  const [found, stopSearch] = useSearch(base, loc.root, loc.path, searching ? q : '', hidden)
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
  // Back and Forward (src/backForward.js): each folder is a place of Files', gone to again as any is.
  useEffect(() => onPlaceShow('view:files', (w) => { if (placeWhere(w)) go(placeWhere(w)) }), [go])
  // The folder it's in, with this one picked (as Finder does).
  const up = () => { if (loc.path) go({ ...loc, path: parentOf(loc.path) }, { select: loc.path }) }
  const toComputer = (id) => { go({ machine: id, root: 'home', path: '' }); setSel(null) }
  // A path in this root, shown where it is: its folder opened, it picked (Assist, a Markdown link).
  const showPath = (p) => { const clean = String(p || '').replace(/^\/+|\/+$/g, ''); if (clean) go({ ...loc, path: parentOf(clean) }, { select: clean }) }

  // ---------- what's on screen ----------
  const entries = searching ? found?.results || [] : folder.data?.entries || []
  const list = useMemo(() => sorted(entries, sort), [entries, sort])
  const current = list.find((e) => e.path === sel) || null
  const cloud = !!folder.data?.cloud
  const rootLabel = loc.root === 'home' ? 'Home' : side.data?.drives?.find((d) => d.root === loc.root)?.label || side.data?.projects?.find((p) => p.root === loc.root && !p.path)?.label || t('Folder')
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
  const studioOpens = (e) => studioOn && !machine && !e.dir && STUDIO_OPENS.test(e.name)
  const appOpens = (e) => here && !e.dir && OPENABLE.test(e.name)
  const openLabel = (e) => (!e ? null : e.dir ? t('Open') : studioOpens(e) ? t('Open in Studio') : appOpens(e) ? t('Open in its app') : null)
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
  // A double-click (or Enter): a folder opens here, a document in Studio, anything else in its own
  // app on this computer, or in Quick Look where that can't be.
  const openEntry = (e) => {
    if (!e) return
    if (e.dir) return go({ ...loc, path: e.path, hint: e.guard ? { guard: e.guard, asked: e.asked } : null })
    setSel(e.path)
    if (studioOpens(e)) { window.dispatchEvent(new CustomEvent('bridge-open-studio', { detail: { root: loc.root, path: e.path } })); return }
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
      'sep',
      { label: t('Copy path'), icon: 'copy', run: () => copy(fullOf(e)) },
      isFolderHere && { label: hidden ? t('Hide hidden files') : t('Show hidden files'), icon: hidden ? 'eye-off' : 'eye', hint: '⌘⇧.', run: () => setHidden(!hidden) },
      'sep',
      isFolderHere && { label: t('New Folder (coming)'), icon: 'folder', disabled: true, title: SOON(), run: () => {} },
      !isFolderHere && { label: t('Rename (coming)'), icon: 'edit', disabled: true, title: SOON(), run: () => {} },
      !isFolderHere && { label: t('Move to… (coming)'), icon: 'send', disabled: true, title: SOON(), run: () => {} },
      !isFolderHere && { label: t('Move to Trash (coming)'), icon: 'trash', disabled: true, title: SOON(), run: () => {} },
    ].filter(Boolean)
  }

  // ---------- keys, as Finder's ----------
  const step = (n) => {
    if (!list.length) return
    let by = n
    // Icons: up and down a row at a time.
    if (view === 'icons' && Math.abs(n) === 10) {
      const tiles = mainRef.current?.querySelectorAll('.fx-tile') || []
      let per = 1
      while (per < tiles.length && tiles[per].offsetTop === tiles[0].offsetTop) per++
      by = Math.sign(n) * per
    } else if (Math.abs(n) === 10) by = Math.sign(n)
    const at = list.findIndex((e) => e.path === sel)
    const i = at < 0 ? (by > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, at + by))
    setSel(list[i].path)
  }
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
  // Keys go to the folder once you've clicked in it (or opened Files).
  useEffect(() => { if (!narrow) mainRef.current?.focus({ preventScroll: true }) }, [loc.root, loc.path, machine, narrow])

  // ---------- the folder, or what's keeping it ----------
  const guard = folder.guard || loc.hint?.guard || null
  const asking = !!guard && loc.hint?.asked !== true
  const folderName = parts.length ? parts.at(-1) : named(rootLabel)
  useEffect(() => { sayPlace('view:files', { machine: loc.machine || null, root: loc.root, path: loc.path }, folderName) }, [loc.machine, loc.root, loc.path, folderName])
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
    if (st.code === 'trial' && machine) {
      return (
        <div className="fx-state" role="alert" data-state="off">
          <Icon name="layers" size={22} />
          <b>{t('Files is off on {name}.', { name: computer?.name || '' })}</b>
          <p className="muted">{t('Turn it on there, in Settings › About & Updates › Beta Features, to see its files from here.')}</p>
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
  const label = t('Files in {name}', { name: folderName })
  const sel1 = (p) => { setSel(p); if (!narrow) mainRef.current?.focus({ preventScroll: true }) }
  const preview = view === 'columns' && current && !current.dir && (
    <div className="fx-preview">
      <Thumb base={base} root={loc.root} e={current} cloud={cloud} big />
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
          {list.length > 0 && <ListView entries={list} sel={sel} onSel={sel1} onOpen={openEntry} onMenu={onMenu} sort={sort} onSort={setSort} where label={label} tap={narrow} />}
        </>
      )
    }
    if (view === 'columns' && !narrow) {
      // What's keeping this folder (macOS asking, a slow drive, a refusal) is said above its columns.
      const held = folder.error || (folder.loading && ((guard && asking) || folder.waiting))
      return (
        <>
          {held && problem(folder)}
          <ColumnView base={base} root={loc.root} path={loc.path} rootLabel={named(rootLabel)} hidden={hidden} ver={ver} sort={sort} sel={sel} cloud={cloud}
            onGo={(p, select) => go({ ...loc, path: p }, { select: select || null })} onSel={sel1} onOpen={openEntry} onMenu={onMenu} preview={preview} />
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
          ? <IconView entries={list} sel={sel} onSel={sel1} onOpen={openEntry} onMenu={onMenu} sort={sort} base={base} root={loc.root} cloud={cloud} label={label} tap={narrow} />
          : <ListView entries={list} sel={sel} onSel={sel1} onOpen={openEntry} onMenu={onMenu} sort={sort} onSort={setSort} label={label} tap={narrow} />}
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
  const sideEl = <Sidebar side={side.data} error={side.error && (side.code === 'trial' && machine ? t('Files is off on {name}.', { name: computer?.name || '' }) : side.error)} computers={computers} machine={machine} loc={{ ...loc, machine }} onGo={(w) => go({ machine, ...w })} onComputer={toComputer} />
  const showSide = !narrow || screen === 'side'
  const showMain = !narrow || screen === 'folder'
  return (
    <div className={`fx ${narrow ? 'narrow' : ''}`} ref={boxRef} data-view={view}>
      <PaneHeader icon="folder" title={t('Files')} subtitle={machine ? t('On {name}', { name: computer?.name || '' }) : t('On this computer')} />
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
                  <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={narrow ? t('Search') : t('Search {name}', { name: folderName })} aria-label={t('Search in this folder and below it')}
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setQ(''); mainRef.current?.focus() } }} />
                  {q && <button type="button" className="fx-search-x" onClick={() => setQ('')} aria-label={t('Clear the search')}><Icon name="x" size={11} /></button>}
                </label>
                <div className="seg small-seg fx-views" role="group" aria-label={t('View')}>
                  {VIEWS.filter(([v]) => !narrow || v !== 'columns').map(([v, icon, name]) => (
                    <button key={v} type="button" className={shownView === v ? 'on' : ''} onClick={() => setView(v)} aria-pressed={shownView === v} aria-label={t(name)} title={t(name)}><Icon name={icon} size={13} /></button>
                  ))}
                </div>
                <button type="button" className={`win-btn ${hidden ? 'on' : ''}`} onClick={() => setHidden(!hidden)} aria-pressed={hidden} aria-label={hidden ? t('Hide hidden files') : t('Show hidden files')} title={`${hidden ? t('Hide hidden files') : t('Show hidden files')} (⌘⇧.)`}><Icon name={hidden ? 'eye' : 'eye-off'} size={13} /></button>
                <button type="button" className="win-btn" onClick={() => setInfo(current || folderEntry)} aria-label={t('Get Info')} title={t('Get Info (⌘I)')}><Icon name="info" size={13} /></button>
                <AiAssist className="btn small fx-assist-btn" compact={narrow} on={!!assist} items={() => folderAssist(!!assist, showAssist)} />
              </div>
            </div>
            <div className="fx-panes">
              <div className={`fx-body ${view === 'columns' && !narrow && !searching ? 'cols' : ''}`} ref={mainRef} tabIndex={0}
                onContextMenu={(e) => { if (e.target.closest('.fx-row, .fx-tile, .fx-crow')) return; e.preventDefault(); onMenu(folderEntry, e) }}
                onMouseDown={(e) => { if (!e.target.closest('.fx-row, .fx-tile, .fx-crow, button, input, a')) setSel(null) }}>
                {narrow && assist ? <div className="fx-assist" data-root={loc.root} data-rel={loc.path || ''}><Assist root={loc.root} rel={loc.path} machine={machine} at={assistAt} onOpen={(p) => { setAssist(false); showPath(p) }} onClose={() => setAssist(false)} /></div> : body()}
              </div>
              {info && <Info base={base} root={loc.root} entry={info} cloud={cloud} onClose={() => { setInfo(null); mainRef.current?.focus() }} onOpen={() => { const e = info; setInfo(null); openEntry(e) }}
                openLabel={info.path === loc.path ? null : openLabel(info)} onReveal={here ? () => reveal(info) : null} revealLabel={revealLabel} onCopy={copy} />}
              {assist && !narrow && <div className="fa-dock fx-assist" data-root={loc.root} data-rel={loc.path || ''}><Assist root={loc.root} rel={loc.path} machine={machine} at={assistAt} onOpen={showPath} onClose={() => setAssist(false)} /></div>}
            </div>
            <footer className="fx-foot muted small" role="status">{status}</footer>
          </section>
        )}
      </div>
      {ql && current && (
        <QuickLook base={base} root={loc.root} entry={current} at={list.indexOf(current)} count={list.length} cloud={cloud}
          onClose={() => { setQl(false); mainRef.current?.focus({ preventScroll: true }) }} onStep={(n) => step(n)} onInfo={() => setInfo(current)}
          openLabel={openLabel(current)} onOpen={() => { setQl(false); openEntry(current) }} onOpenPath={showPath} />
      )}
      {menu && <Menu x={menu.x} y={menu.y} items={menuFor(menu.entry)} heading={menu.entry.name} onClose={() => setMenu(null)} className="fx-menu" />}
      {toast && <div className="fx-toast" role="status">{toast}</div>}
    </div>
  )
}
