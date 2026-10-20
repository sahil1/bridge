import { useCallback, useEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from './components/Icon.jsx'
import { useAppearance } from './appearance.js'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Rail from './components/Rail.jsx'
import Board from './components/Board.jsx'
import Dock from './components/Dock.jsx'
import Console, { MateEmpty } from './components/Console.jsx'
import { Settings, Onboarding, HerdrView, Terminals, ShellTab, preloadViews } from './lazy.jsx'
import { openLink } from './pwa.js'
import NewAgent from './components/NewAgent.jsx'
import History from './components/History.jsx'
import UpdateChip from './components/UpdateChip.jsx'
import { CHANNEL, nameOf, popOut, tell } from './components/Solo.jsx'
import Palette from './components/Palette.jsx'
import { NextMeetingChip } from './components/Agenda.jsx'
import { TodayTabs, TodayBody, openToday } from './components/Dock.jsx'
import { Handle, usePersisted, useMedia, useHotkey, useWidth, useShared, store } from './components/layout.jsx'
import { api, useFleet, usePoll } from './api.js'

const MIN_PANE = 420
const MIN_WORK = 620
const LAYOUT = { railW: 232, railOpen: true, dockW: 380, dockMin: false, boardH: 280, boardMin: false, sideW: 560, max: null }
const WS = { tabs: [], active: null, side: null, split: false, group: 'main' }

function useRuntimeTheme() {
  useEffect(() => {
    api('/runtime-theme').then((t) => {
      const root = document.documentElement.style
      if (t.red) root.setProperty('--needs', t.red)
      if (t.teal) root.setProperty('--done', t.teal)
      if (t.yellow) root.setProperty('--working', t.yellow)
    }).catch(() => {})
  }, [])
}

function useLaunchMate(onOpen) {
  const [state, setState] = useState({ launching: false, error: null })
  const launch = async () => {
    setState({ launching: true, error: null })
    try { onOpen((await api('/chief/launch', { method: 'POST' })).paneId); setState({ launching: false, error: null }) } catch (e) { setState({ launching: false, error: e.message }) }
  }
  return { ...state, launch }
}

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id) }, [])
  return <span className="clock">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
}

const NAMES = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', grok: 'Grok' }

// Top bar chips: default provider's session + week, and current weather.
function ProviderChip({ quota, primary, onClick }) {
  const p = quota?.providers?.find((x) => x.provider === primary)
  if (!p) return null
  const sess = p.windows.find((w) => w.kind === 'session') || p.windows[0]
  const week = p.windows.find((w) => w.kind === 'weekly')
  const lv = (v) => (v == null ? 'unknown' : v < 10 ? 'critical' : v < 30 ? 'warning' : 'good')
  return (
    <button className="top-chip usage-chip" onClick={onClick} title={`${NAMES[primary] || primary} usage${sess ? ` · ${sess.percentRemaining}% left this ${sess.kind === 'session' ? '5-hour window' : sess.label}` : ''}${week ? ` · ${week.percentRemaining}% left this week` : ''} · click for details`}>
      <span className={`mini-ring r-${lv(sess?.percentRemaining)}`} style={{ '--p': sess?.percentRemaining ?? 0 }} />
      <b className="usage-name">{NAMES[primary] || primary}</b>
      {p.usable ? (
        <>
          {sess && <span>{sess.percentRemaining}%<small> {sess.kind === 'session' ? '5h' : sess.label}</small></span>}
          {week && <span className="chip-sep">{week.percentRemaining}%<small> wk</small></span>}
        </>
      ) : <span className="muted">sign in</span>}
    </button>
  )
}

const WX_ICON = (code) => (code <= 1 ? 'sun' : code >= 51 ? 'rain' : 'cloud')
function WeatherChip({ onClick }) {
  const { data } = usePoll('/weather', 15 * 60 * 1000)
  const [unit, setUnit] = useShared('cc-unit', 'f')
  if (!data) return null
  const c = unit === 'c'
  const t = Math.round(c ? (data.current.temp - 32) * 5 / 9 : data.current.temp)
  return (
    <span className="top-chip wx-chip">
      <button className="wx-open" onClick={onClick} title={`${data.location}: ${data.current.summary}`}>
        <Icon name={WX_ICON(data.current.code)} size={15} /> <span className="muted hide-sm">{data.location}</span>
      </button>
      <button className="wx-temp-btn" onClick={() => setUnit(c ? 'f' : 'c')} title={`Switch to °${c ? 'F' : 'C'}`} aria-label={`Temperature ${t} degrees ${c ? 'Celsius' : 'Fahrenheit'}; switch to ${c ? 'Fahrenheit' : 'Celsius'}`}>
        <b>{t}°</b><span className="unit-flip"><span className={!c ? 'on' : ''}>F</span><span className={c ? 'on' : ''}>C</span></span>
      </button>
    </span>
  )
}

export default function App() {
  const { fleet, live } = useFleet()
  const wide = useMedia('(min-width: 900px)')
  const [savedView, setView] = usePersisted('cc-view', 'command')
  // The live herdr view exists only when herdr is the runtime (see server/runtime).
  const confPoll = usePoll('/config', 10 * 60 * 1000)
  const conf = confPoll.data
  // Onboarding stays up from the first sign that setup is needed until you close it, so its last
  // screen (how Bridge AI works) isn't swept away the moment setup is saved.
  const [onboarding, setOnboarding] = useState(false)
  useEffect(() => { if (conf && !conf.setupDone) setOnboarding(true) }, [conf])
  useEffect(() => { preloadViews() }, [])
  const liveView = !!conf?.runtime?.liveView
  const view = liveView ? savedView : 'command'
  const [look, saveLook] = useAppearance()
  const theme = look.mode
  const setTheme = (mode) => saveLook({ mode })
  const [settings, setSettings] = useState(null) // null = closed, else the section to show
  const [L, setL] = usePersisted('cc-layout', LAYOUT)
  const [W, setW] = usePersisted('cc-ws', WS)
  const [primary] = useShared('cc-primary', 'claude')
  const [todayTab, setTodayTab] = useShared('cc-today-tab', 'overview')
  const [mtab, setMtab] = usePersisted('cc-mtab', 'mate')
  const [mobileAgent, setMobileAgent] = useState(null)
  const [palette, setPalette] = useState(false)
  const [newAgent, setNewAgent] = useState(null) // null = closed, {} = open with defaults
  const [history, setHistory] = useState(false) // search every conversation, closed agents
  const [cmdRef, cmdW] = useWidth()
  const [rowRef, rowW] = useWidth()
  const quota = usePoll('/quota', 5 * 60 * 1000)
  const update = usePoll('/updates', 6 * 60 * 60 * 1000)
  const prevStatus = useRef({})
  useRuntimeTheme()

  const set = (patch) => setL((l) => ({ ...l, ...patch }))
  const agents = fleet?.agents || []
  // Editor tabs hold agents (by pane id) and shell-only herdr tabs (as "tab:<id>").
  const shellTabs = (fleet?.tabs || []).filter((t) => t.panes.some((p) => !p.agent))
    .map((t) => ({ ...t, shellTab: true, paneId: `tab:${t.tabId}`, title: t.label || 'shell', cwd: t.panes.find((p) => !p.agent)?.cwd || '' }))
  const byId = Object.fromEntries([...shellTabs, ...agents].map((a) => [a.paneId, a]))
  const mate = agents.find((a) => a.chief)
  const needsYou = agents.filter((a) => a.status === 'blocked')

  // The chief of staff is the first tab that loads, not a fixture: it's added only when no tabs are open.
  useEffect(() => {
    if (!fleet) return
    setW((w) => {
      const tabs = w.tabs.filter((id) => byId[id])
      if (!tabs.length && mate) return { ...w, tabs: [mate.paneId], active: mate.paneId, side: null, split: false }
      const active = byId[w.active] ? w.active : tabs[0] || null
      const side = byId[w.side] ? w.side : null
      return tabs.length === w.tabs.length && active === w.active && side === w.side ? w : { ...w, tabs, active, side }
    })
  }, [fleet]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.title = needsYou.length ? `(${needsYou.length}) Bridge AI` : 'Bridge AI'
    for (const a of agents) {
      const before = prevStatus.current[a.paneId]
      // In the Mac app, Bridge itself posts these (so they work while the window is hidden).
      if (before && before !== a.status && (a.status === 'blocked' || a.status === 'done') && document.hidden && !window.bridgeApp &&
        'Notification' in window && Notification.permission === 'granted') {
        const n = new Notification(a.status === 'blocked' ? 'Agent needs you' : 'Agent finished', { body: a.title || a.workspace, tag: a.paneId })
        n.onclick = () => { window.focus(); openAgentRef.current?.(a.paneId); n.close() }
      }
      prevStatus.current[a.paneId] = a.status
    }
  }, [fleet]) // eslint-disable-line react-hooks/exhaustive-deps

  const openAgent = useCallback((paneId, { toSide = false } = {}) => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
    setView('command')
    if (!wide) {
      const a = byId[paneId]
      if (a?.chief) { setMtab('mate'); setMobileAgent(null) } else { setMtab('agents'); setMobileAgent(paneId) }
      return
    }
    setW((w) => {
      const tabs = w.tabs.includes(paneId) ? w.tabs : [...w.tabs, paneId]
      if (toSide || (w.split && w.group === 'side')) return { ...w, tabs, side: paneId, split: true, group: 'side' }
      if (w.split && w.side === paneId) return { ...w, tabs, group: 'side' }
      return { ...w, tabs, active: paneId, group: 'main' }
    })
    setL((l) => (l.max ? { ...l, max: null } : l))
  }, [wide, fleet]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clicking a notification (browser or the Mac app) opens the agent it was about.
  const openAgentRef = useRef(null)
  const fleetRef = useRef(null)
  fleetRef.current = fleet
  openAgentRef.current = openAgent
  useEffect(() => {
    // "chief" (the home-screen shortcut) means whichever agent is the chief of staff.
    const on = (e) => {
      let id = e.detail?.paneId
      if (id === 'chief') {
        id = fleetRef.current?.agents?.find((a) => a.chief)?.paneId
        // No chief running: show where to start one (the phone's Chief tab; on a wide screen the
        // main area already offers it).
        if (!id) { setMtab('mate'); return }
      }
      if (id) openAgentRef.current?.(id)
    }
    window.addEventListener('bridge-open-agent', on)
    return () => window.removeEventListener('bridge-open-agent', on)
  }, [])
  // Agents open in a window of their own: their tab here says so, with Show and Bring back.
  const [popped, setPopped] = useState(() => new Set())
  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (e) => {
      const { type, paneId } = e.data || {}
      if (!paneId) return
      if (type === 'open') setPopped((s) => new Set(s).add(paneId))
      if (type === 'closed' || type === 'back') setPopped((s) => { const n = new Set(s); n.delete(paneId); return n })
      if (type === 'back') window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } }))
    }
    ch.postMessage({ type: 'ping' }) // windows already open (after a reload) say so
    return () => ch.close()
  }, [])
  const showPopped = (id) => { if (window.bridgeApp?.focusPopout) window.bridgeApp.focusPopout(id); else tell({ type: 'focus', paneId: id }) }
  const bringBack = (id) => { tell({ type: 'close', paneId: id }); setPopped((s) => { const n = new Set(s); n.delete(id); return n }) }
  const showCardRef = useRef(null)
  useEffect(() => {
    const on = (e) => { if (e.detail?.id) showCardRef.current?.(e.detail.id) }
    window.addEventListener('bridge-open-card', on)
    return () => window.removeEventListener('bridge-open-card', on)
  }, [])
  // Opened from a notification link (?agent=... or ?card=...): go there once agents have loaded.
  const linked = useRef(false)
  useEffect(() => { if (fleet && !linked.current) { linked.current = true; openLink() } }, [fleet])

  const closeTab = (id) => setW((w) => {
    const tabs = w.tabs.filter((t) => t !== id)
    const next = (cur) => (cur === id ? tabs.find((t) => t !== w.active && t !== w.side) || null : cur)
    let active = next(w.active)
    let side = next(w.side)
    if (!active && side) { active = side; side = null }
    return { ...w, tabs, active, side, split: w.split && !!side }
  })

  const toggleSplit = () => setW((w) => {
    if (w.split) return { ...w, split: false, side: null, group: 'main' }
    const side = w.tabs.find((t) => t !== w.active) || null
    return { ...w, split: true, side, group: 'side' }
  })

  const openInHerdr = !liveView && wide ? undefined : async (id) => {
    const url = id.startsWith('tab:') ? `/tabs/${encodeURIComponent(id.slice(4))}/focus` : `/agents/${encodeURIComponent(id)}/focus`
    try { await api(url, { method: 'POST' }) } catch { /* still switch */ }
    if (!wide) { setMtab('herdr'); return }
    setView('herdr')
  }

  const showCard = (id) => {
    store.set(`cc-card-${id}`, true)
    setView('command')
    setTodayTab('overview')
    if (!wide) setMtab('today')
    else set({ dockMin: false, max: L.max === 'dock' ? 'dock' : null })
    setTimeout(() => document.getElementById(`card-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80)
  }
  showCardRef.current = showCard

  // Open a Today tab full size (desktop) or in the phone's Today tab.
  const showToday = (tab, detail) => {
    setView('command')
    setTodayTab(tab)
    if (!wide) setMtab('today')
    else set({ dockMin: false, max: 'dock' })
    if (detail) setTimeout(() => openToday(tab, detail), 60)
  }

  // Open an agent (or shell tab) straight into its Files view, optionally at a file.
  const openFiles = (id, filePath) => {
    if (id.startsWith('tab:')) store.set(`cc-shell-view-${id.slice(4)}`, 'files')
    else {
      try { const v = JSON.parse(localStorage.getItem('cc-agent-views') || '{}'); localStorage.setItem('cc-agent-views', JSON.stringify({ ...v, [id]: 'files' })) } catch { /* private mode */ }
    }
    openAgent(id)
    setTimeout(() => window.dispatchEvent(new CustomEvent('cc-set-view', { detail: { paneId: id, view: 'files', path: filePath } })), 60)
  }
  // A compare launch opens the second agent beside the first.
  const onLaunched = (out) => { setNewAgent(null); if (out?.paneId) setTimeout(() => { openAgent(out.paneId); if (out.alsoPaneId) openAgent(out.alsoPaneId, { toSide: true }) }, 1200) }
  const queuedFor = (id) => fleet?.queue?.[id] || []

  const mateLaunch = useLaunchMate(openAgent)
  useHotkey(useCallback((e) => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k', []), () => setPalette((p) => !p))
  useHotkey(useCallback((e) => (e.metaKey || e.ctrlKey) && e.key === ',', []), () => setSettings((v) => (v ? null : 'general')))
  useHotkey(useCallback((e) => (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f', []), () => setHistory((v) => !v))
  useHotkey(useCallback((e) => e.altKey && (e.code === 'Digit1' || e.code === 'Digit2'), []), (e) => setView(e.code === 'Digit1' ? 'command' : 'herdr'))
  useHotkey(useCallback((e) => e.key === 'Escape' && !e.target.closest?.('.xterm, textarea, input, .quick-open'), []), () => set({ max: null }))

  const nextTheme = { system: 'dark', dark: 'light', light: 'system' }[theme]
  const paletteActions = [
    { id: 'a:new', label: 'New agent…', icon: 'plus', keywords: 'launch start claude codex gemini copilot opencode project', run: () => setNewAgent({ mode: 'project' }) },
    { id: 'a:history', label: 'Search history and closed agents…', icon: 'clock', keywords: 'search find transcript conversation closed archived resume old past', run: () => setHistory(true) },
    { id: 'a:chat', label: 'New chat…', icon: 'chat', keywords: 'plain vanilla talk ask claude codex gemini assistant', run: () => setNewAgent({ mode: 'chat' }) },
    { id: 'a:settings', label: 'Settings…', icon: 'settings', hint: '⌘,', keywords: 'preferences name default agent model location runtime', run: () => setSettings('general') },
    { id: 'a:providers', label: 'Model providers', icon: 'layers', keywords: 'api key openai anthropic gemini openrouter bedrock vertex ollama lm studio', run: () => setSettings('providers') },
    { id: 'a:mcp', label: 'MCP servers', icon: 'tool', keywords: 'tools mcp github playwright', run: () => setSettings('mcp') },
    { id: 'a:config', label: 'Edit config file', icon: 'braces', keywords: 'json config.json settings', run: () => setSettings('config') },
    { id: 'a:mate', label: 'Go to chief of staff', icon: 'helm', keywords: 'chief staff dispatch route', run: () => (mate ? openAgent(mate.paneId) : mateLaunch.launch()) },
    wide && liveView && { id: 'a:view', label: view === 'herdr' ? 'Switch to Bridge view' : 'Switch to Herdr view', icon: 'layers', hint: view === 'herdr' ? 'Alt 1' : 'Alt 2', run: () => setView(view === 'herdr' ? 'command' : 'herdr') },
    wide && { id: 'a:rail', label: L.railOpen ? 'Collapse sidebar' : 'Expand sidebar', icon: 'panel-left', run: () => set({ railOpen: !L.railOpen }) },
    { id: 'a:appearance', label: 'Appearance…', icon: 'palette', keywords: 'theme color colour dark light mode font text size density compact sidebar slack', run: () => setSettings('appearance') },
    { id: 'a:theme', label: `Color mode: switch to ${nextTheme}`, icon: theme === 'dark' ? 'sun' : 'moon', keywords: 'dark light mode', run: () => setTheme(nextTheme) },
    { id: 'a:ideas', label: 'Add an idea', icon: 'bulb', keywords: 'backlog todo', run: () => { showCard('bulb'); setTimeout(() => document.querySelector('.idea-add input')?.focus(), 250) } },
    { id: 'a:cal', label: 'Open calendar', icon: 'calendar', keywords: 'week month year schedule meetings', run: () => showToday('calendar') },
    { id: 'a:mail', label: 'Open mail', icon: 'mail', keywords: 'inbox email outlook needs you', run: () => showToday('mail') },
    { id: 'a:triage', label: 'Triage my inbox with an agent', icon: 'sparkle', keywords: 'mail email', run: async () => { try { const o = await api('/mail/triage', { method: 'POST' }); if (o.paneId) setTimeout(() => openAgent(o.paneId), 1200) } catch { showToday('mail') } } },
    { id: 'a:markets', label: 'Markets & news', icon: 'trend', keywords: 'fed rates treasury mortgage stocks headlines tech', run: () => showToday('markets') },
    { id: 'a:routines', label: 'Show routines', icon: 'repeat', run: () => showCard('repeat') },
    { id: 'a:usage', label: 'Show usage', icon: 'gauge', keywords: 'quota tokens cost', run: () => showCard('gauge') },
    { id: 'a:stats', label: 'Usage stats and history', icon: 'gauge', keywords: 'stats heatmap tokens cost models projects', run: () => openToday('usage') },
  ].filter(Boolean)
  const overlays = (
    <>
      {palette && <Palette fleet={fleet} activeId={wide ? W.active : mobileAgent} onClose={() => setPalette(false)} onOpen={openAgent} onOpenFile={openFiles} actions={paletteActions} />}
      {settings && <Settings section={settings} onClose={() => setSettings(null)} onOpenAgent={openAgent} />}
      {onboarding && <Onboarding onDone={(pane) => { setOnboarding(false); confPoll.refresh(); if (pane) setTimeout(() => openAgent(pane), 800) }} />}
      {newAgent && <NewAgent fleet={fleet} initial={newAgent} onClose={() => setNewAgent(null)} onLaunched={onLaunched} />}
      {history && <History onClose={() => setHistory(false)} onOpen={(id, fresh) => (fresh ? setTimeout(() => openAgent(id), 1200) : openAgent(id))} />}
    </>
  )

  const topbar = (
    <header className="topbar">
      <div className="top-left">
      <img className="mark" src="/mark.svg" alt="Bridge AI" width="24" height="24" />
      {wide && liveView && (
        <nav className="view-tabs" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === 'command'} className={view === 'command' ? 'on' : ''} onClick={() => setView('command')} title="Alt+1">
            <Icon name="helm" size={14} /> Bridge
          </button>
          <button role="tab" aria-selected={view === 'herdr'} className={view === 'herdr' ? 'on' : ''} onClick={() => setView('herdr')} title="Alt+2">
            <Icon name="layers" size={14} /> Herdr
          </button>
        </nav>
      )}
      </div>
      <button className="search-btn" onClick={() => setPalette(true)} aria-label="Search and commands" title="Search and commands (⌘K)">
        <Icon name="search" size={15} /> <span className="hide-sm">Search agents, files and commands</span> <kbd className="hide-touch">⌘K</kbd>
      </button>
      <div className="top-right">
        {needsYou.length > 0 && (
          <button className="needs-chip" onClick={() => openAgent(needsYou[0].paneId)}>
            <StatusDot status="blocked" size={8} /> {needsYou.length}<span className="needs-word"> need{needsYou.length === 1 ? 's' : ''} you</span>
          </button>
        )}
        <NextMeetingChip onClick={() => showCard('calendar')} />
        <ProviderChip quota={quota.data} primary={primary} onClick={() => showCard('gauge')} />
        {update.data?.available && <UpdateChip u={update.data} onDetails={() => setSettings('about')} />}
        <WeatherChip onClick={() => showCard('sun')} />
        <Clock />
        <button className="win-btn" onClick={() => setSettings('general')} aria-label="Settings" title="Settings (⌘,)">
          <Icon name="settings" size={15} />
        </button>
      </div>
    </header>
  )

  // ---------- Phone ----------
  if (!wide) {
    const mAgent = byId[mobileAgent]
    const tabs = [['mate', 'helm', 'Chief'], ['agents', 'grid', 'Agents'], ['herdr', 'terminal', 'Terminals'], ['today', 'today', 'Today']]
    return (
      <div className="app narrow">
        {topbar}
        <main className="m-body">
          {mtab === 'mate' && (mate ? <Console agent={mate} variant="mobile" queued={queuedFor(mate.paneId)} /> : <MateEmpty onLaunch={mateLaunch.launch} {...mateLaunch} />)}
          {mtab === 'agents' && (mAgent
            ? <Console agent={mAgent} variant="mobile" onBack={() => setMobileAgent(null)} queued={queuedFor(mAgent.paneId)} />
            : <Board fleet={fleet} compact onOpen={openAgent} />)}
          {mtab === 'herdr' && <Terminals onChat={(id) => openAgent(id)} />}
          {mtab === 'today' && (
            <div className="m-today">
              <TodayTabs tab={todayTab} setTab={setTodayTab} compact />
              <div className={`m-today-body tab-${todayTab}`}><TodayBody onOpenAgent={openAgent} tab={todayTab} setTab={setTodayTab} stackClass="m-stack" /></div>
            </div>
          )}
        </main>
        <nav className="tabbar" aria-label="Sections">
          {tabs.map(([id, icon, label]) => (
            <button key={id} className={mtab === id ? 'on' : ''} onClick={() => { setMtab(id); if (id === 'agents' && mtab === 'agents') setMobileAgent(null) }} aria-current={mtab === id}>
              <span className="tab-icon">
                <Icon name={icon} size={20} />
                {id === 'agents' && needsYou.length > 0 && <span className="badge">{needsYou.length}</span>}
              </span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
        {overlays}
      </div>
    )
  }

  // ---------- Desktop ----------
  const railPx = L.railOpen ? L.railW : 52
  // Until you drag it, the Today panel widens with big screens (24% of the window, 380 to 520px).
  const dockW = L.dockW === LAYOUT.dockW && cmdW > 0 ? Math.round(Math.min(520, Math.max(LAYOUT.dockW, cmdW * 0.24))) : L.dockW
  const autoDock = cmdW > 0 && !L.dockMin && cmdW - railPx - dockW - 30 < MIN_WORK
  const dockMin = L.dockMin || autoDock
  const autoRail = cmdW > 0 && L.railOpen && cmdW - L.railW - (dockMin ? 58 : dockW) - 30 < MIN_WORK
  const railOpen = L.railOpen && !autoRail
  const canSplit = !rowW || rowW >= MIN_PANE * 2 + 10
  const split = W.split && !!byId[W.side] && W.side !== W.active && canSplit
  const sideW = Math.max(MIN_PANE, Math.min(L.sideW, rowW ? rowW - MIN_PANE - 10 : L.sideW))

  const paneFor = (id, group) => {
    const a = byId[id]
    if (!a) {
      return (
        <section className="pane empty-pane">
          {mate || W.tabs.length ? <div className="viewer-empty"><Icon name="grid" size={24} /><p>Open an agent from the sidebar or the board.</p></div>
            : <MateEmpty onLaunch={mateLaunch.launch} {...mateLaunch} />}
        </section>
      )
    }
    const controls = { maximized: L.max === group, onMaximize: () => set({ max: L.max === group ? null : group }) }
    return (
      <div className={`group ${split && W.group === group ? 'focused' : ''}`} onMouseDown={() => split && W.group !== group && setW((w) => ({ ...w, group }))}>
        {a.shellTab
          ? <ShellTab key={a.paneId} tab={a} onOpenInHerdr={openInHerdr} controls={controls} />
          : popped.has(a.paneId)
            ? (
              <section className="pane popped-pane">
                <div className="viewer-empty">
                  <Icon name="popout" size={26} />
                  <p><b>{nameOf(a)}</b> is open in its own window.</p>
                  <div className="popped-acts">
                    <button className="btn small" onClick={() => showPopped(a.paneId)}>Show window</button>
                    <button className="btn small primary" onClick={() => bringBack(a.paneId)}>Bring back here</button>
                  </div>
                </div>
              </section>
            )
            : <ErrorBoundary name="This agent's view" resetKey={a.paneId}><Console agent={a} variant={a.chief ? 'mate' : 'focus'} onOpenInHerdr={openInHerdr} onPopOut={() => popOut(a)} controls={controls} queued={queuedFor(a.paneId)} /></ErrorBoundary>}
      </div>
    )
  }

  // Drag a tab to reorder; Ctrl+Shift+←/→ moves the focused tab. The order is saved with the layout.
  const [tabDrag, setTabDrag] = useState(null) // { id, over, after }
  const moveTab = (id, target, after) => setW((w) => {
    if (id === target) return w
    const rest = w.tabs.filter((t) => t !== id)
    const i = rest.indexOf(target)
    if (i < 0) return w
    rest.splice(after ? i + 1 : i, 0, id)
    return { ...w, tabs: rest }
  })
  const nudgeTab = (id, dir) => setW((w) => {
    const tabs = [...w.tabs]
    const i = tabs.indexOf(id), j = i + dir
    if (i < 0 || j < 0 || j >= tabs.length) return w
    ;[tabs[i], tabs[j]] = [tabs[j], tabs[i]]
    return { ...w, tabs }
  })

  const tabStrip = (
    <div className="ws-tabs" role="tablist" aria-label="Open agents">
      <div className="ws-tabs-scroll">
        {W.tabs.filter((id) => byId[id]).map((id) => {
          const a = byId[id]
          const inMain = id === W.active
          const inSide = split && id === W.side
          return (
            <div key={id} role="tab" aria-selected={inMain || inSide} tabIndex={0} draggable
              className={`ws-tab ${inMain ? 'main' : ''} ${inSide ? 'side' : ''} ${(inMain && W.group === 'main') || (inSide && W.group === 'side') ? 'focus' : ''} ${tabDrag?.id === id ? 'dragging' : ''} ${tabDrag?.over === id && tabDrag.id !== id ? (tabDrag.after ? 'drop-after' : 'drop-before') : ''}`}
              onClick={() => openAgent(id)} onAuxClick={(e) => { if (e.button === 1) closeTab(id) }}
              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-bridge-tab', id); setTabDrag({ id }) }}
              onDragOver={(e) => {
                if (!tabDrag) return
                e.preventDefault()
                const r = e.currentTarget.getBoundingClientRect()
                const after = e.clientX > r.left + r.width / 2
                if (tabDrag.over !== id || tabDrag.after !== after) setTabDrag({ ...tabDrag, over: id, after })
              }}
              onDrop={(e) => { e.preventDefault(); if (tabDrag) moveTab(tabDrag.id, id, tabDrag.after); setTabDrag(null) }}
              onDragEnd={() => setTabDrag(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') openAgent(id)
                if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); nudgeTab(id, e.key === 'ArrowLeft' ? -1 : 1) }
              }} title={a.shellTab ? `${a.workspace} › ${a.label}` : `${a.title}\n${a.cwd}`}>
              {a.chief ? <Icon name="helm" size={13} className="tab-ship" /> : a.shellTab ? <Icon name="terminal" size={12} className="muted" /> : <StatusDot status={a.status} size={7} />}
              <span className="ws-tab-name">{a.chief ? 'Chief of staff' : a.title || a.tab}</span>
              {a.chief && <StatusDot status={a.status} size={6} />}
              <button className="ws-tab-x" aria-label={`Close ${a.title}`} onClick={(e) => { e.stopPropagation(); closeTab(id) }}><Icon name="x" size={11} /></button>
            </div>
          )
        })}
      </div>
      <div className="ws-tab-tools">
        {!mate && <button className="ghost-btn" onClick={mateLaunch.launch} disabled={mateLaunch.launching}><Icon name="helm" size={12} /> {mateLaunch.launching ? 'Launching…' : 'Start chief of staff'}</button>}
        <button className={`win-btn ${split ? 'on' : ''}`} onClick={toggleSplit} disabled={!canSplit || W.tabs.length < 2}
          title={!canSplit ? 'Not enough room to split' : W.tabs.length < 2 ? 'Open a second agent to split' : split ? 'Unsplit' : 'Split side by side'} aria-label="Split">
          <Icon name="split" size={15} />
        </button>
      </div>
    </div>
  )

  const boardEl = (
    <Board fleet={fleet} selected={W.active} onOpen={openAgent} onOpenInHerdr={openInHerdr}
      minimized={L.boardMin && L.max !== 'board'} maximized={L.max === 'board'}
      onMinimize={() => set({ boardMin: !L.boardMin, max: null })} onMaximize={() => set({ max: L.max === 'board' ? null : 'board', boardMin: false })} />
  )
  const dockEl = (
    <Dock minimized={L.dockMin && L.max !== 'dock'} maximized={L.max === 'dock'} onOpenAgent={openAgent}
      onMinimize={() => set({ dockMin: !L.dockMin, max: null })} onMaximize={() => set({ max: L.max === 'dock' ? null : 'dock', dockMin: false })} />
  )
  const maxEl = { main: paneFor(W.active, 'main'), side: split && paneFor(W.side, 'side'), board: boardEl, dock: dockEl }[L.max]

  return (
    <div className="app wide">
      {topbar}
      <div className="views">
        <main className="cmd" hidden={view !== 'command'} ref={cmdRef}>
          <div className="slot rail-slot" style={{ width: railOpen ? L.railW : 52 }}>
            <Rail fleet={fleet} live={live} collapsed={!railOpen} onToggle={() => set({ railOpen: !L.railOpen })}
              selected={W.active} onOpen={openAgent} onOpenInHerdr={openInHerdr} onOpenFiles={openFiles} onNewAgent={(init) => setNewAgent(init || {})} onHistory={() => setHistory(true)} />
          </div>
          {railOpen && <Handle axis="x" size={L.railW} min={180} max={380} onSize={(v) => set({ railW: v })} onToggle={() => set({ railOpen: false })} label="Resize sidebar" />}

          {maxEl ? (
            <div className="work maxed">{maxEl}</div>
          ) : (
            <>
              <div className="work">
                {tabStrip}
                <div className="top-row" ref={rowRef}>
                  <div className="slot grow">{paneFor(W.active, 'main')}</div>
                  {split && (
                    <>
                      <Handle axis="x" size={sideW} min={MIN_PANE} max={Math.max(MIN_PANE, rowW - MIN_PANE - 10)} invert onSize={(v) => set({ sideW: v })} label="Resize split" />
                      <div className="slot" style={{ width: sideW }}>{paneFor(W.side, 'side')}</div>
                    </>
                  )}
                </div>
                {!L.boardMin && <Handle axis="y" size={L.boardH} min={150} max={900} invert onSize={(v) => set({ boardH: v })} onToggle={() => set({ boardMin: true })} label="Resize agents board" />}
                <div className={`slot board-slot ${L.boardMin ? 'min' : ''}`} style={L.boardMin ? undefined : { height: L.boardH }}>{boardEl}</div>
              </div>
              {!dockMin && <Handle axis="x" size={dockW} min={320} max={720} invert onSize={(v) => set({ dockW: v === LAYOUT.dockW ? v + 1 : v })} onToggle={() => set({ dockMin: true })} label="Resize Today panel" />}
              <div className="slot dock-slot" style={dockMin ? undefined : { width: dockW }}>{dockMin && !L.dockMin
                ? <Dock minimized onOpenAgent={openAgent} onMinimize={() => set({ dockMin: false, max: 'dock' })} />
                : dockEl}</div>
            </>
          )}
        </main>
        {liveView && <HerdrView active={view === 'herdr'} onViewHotkey={setView} />}
      </div>
      {overlays}
    </div>
  )
}
