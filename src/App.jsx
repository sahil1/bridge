import { useCallback, useEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from './components/Icon.jsx'
import { useAppearance } from './appearance.js'
import ErrorBoundary, { Quiet } from './components/ErrorBoundary.jsx'
import Rail from './components/Rail.jsx'
import Board from './components/Board.jsx'
import Dock from './components/Dock.jsx'
import Console, { MateEmpty, showChat } from './components/Console.jsx'
import { Settings, Onboarding, HerdrView, Terminals, ShellTab, MeetingsHome, MeetingPage, preloadViews } from './lazy.jsx'
import Home from './components/Home.jsx'
import { FirstRunAnswers } from './components/FirstRun.jsx'
import { MeetingsProvider, RecordingPill, CallPrompt, useMeetings } from './components/meetings/recording.jsx'
import { openLink } from './pwa.js'
import NewAgent from './components/NewAgent.jsx'
import AddAccount from './components/AddAccount.jsx'
import History from './components/History.jsx'
import UpdateChip from './components/UpdateChip.jsx'
import RestartChip from './components/RestartChip.jsx'
import RuntimeNotice from './components/RuntimeNotice.jsx'
import AccountMenu, { listed, setDefault, lapsed, asList, nameOf as accountName } from './components/AccountMenu.jsx'
import { CHANNEL, nameOf, popOut, tell } from './components/Solo.jsx'
import Palette from './components/Palette.jsx'
import Tour from './components/Tour.jsx'
import { NextMeetingChip } from './components/Agenda.jsx'
import { TodayTabs, TodayBody, openToday } from './components/Dock.jsx'
import { Handle, usePersisted, useMedia, useHotkey, useWidth, useShared, store } from './components/layout.jsx'
import { api, useFleet, usePoll, relayActivity, cloudOnly, refetch, viaRelay } from './api.js'
import CloudHome from './components/CloudHome.jsx'
import SessionSwitcher from './components/Sessions.jsx'
import { MachineMenu, AskBanner, useMachines, goMachine, isRemote, remoteOf } from './components/Machines.jsx'
import RemoteAgent from './components/RemoteAgent.jsx'
import Dictation from './dictation/Dictation.jsx'
import { t, tx, locale } from './i18n/index.js'

const MIN_PANE = 420
const TOUR_ON_START = false
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
    try { onOpen((await api('/chief/launch', { method: 'POST' })).paneId); setState({ launching: false, error: null }) } catch (e) { setState({ launching: false, error: e.message, code: e.code }) }
  }
  return { ...state, launch }
}

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id) }, [])
  return <span className="clock">{now.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}</span>
}

const NAMES = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', grok: 'Grok' }

// The phone apps' way back to their start screen, from the phone's Cloud agents (cloudOnly).
const toStart = !cloudOnly ? null : window.bridgeAndroid?.home ? () => window.bridgeAndroid.home()
  : window.bridgeNative?.post ? () => window.bridgeNative.post({ type: 'home' }) : null

// Top bar chips: default provider's session + week, and current weather. With its accounts listed
// it shows the one new agents start with (your default, or Auto's pick). For the agents that can have
// several (Claude Code, Codex) it opens the account menu: switch, Add another account, Usage details.
function ProviderChip({ quota, primary, onClick, onAddAccount }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const groups = quota?.accounts || []
  const menu = groups.length > 0
  const g = groups.find((x) => x.kind === primary)
  const act = asList(g) ? g.accounts.find((a) => a.active) : null
  const p = act || quota?.providers?.find((x) => x.provider === primary)
  const opens = menu
    ? { onClick: () => setOpen((o) => !o), 'aria-haspopup': 'menu', 'aria-expanded': open, onKeyDown: (e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } } }
    : { onClick }
  const caret = menu && <Icon name="down" size={11} className="usage-caret" />
  let chip
  if (quota?.off) {
    chip = (
      <button className="top-chip usage-chip" data-tour="usage" {...opens} title={menu ? t('Plan usage is off · click for accounts and usage') : t('Plan usage is off · click to see it or turn it on')}>
        <Icon name="gauge" size={13} /><span className="muted">{t('Usage')}</span>
        {act && <span className="usage-new">{t('New:')}</span>}
        {act && <b className="usage-acct">{accountName(act)}</b>}
        {caret}
      </button>
    )
  } else {
    if (!p) return null
    const sess = p.windows.find((w) => w.kind === 'session') || p.windows[0]
    const week = p.windows.find((w) => w.kind === 'weekly')
    const lv = (v) => (v == null ? 'unknown' : v < 10 ? 'critical' : v < 30 ? 'warning' : 'good')
    const name = act ? t('{agent} ({name}, where new agents start)', { agent: NAMES[primary] || primary, name: accountName(act) }) : NAMES[primary] || primary
    chip = (
      <button className="top-chip usage-chip" data-tour="usage" {...opens}
        title={`${t('{name} usage', { name })}${sess ? ` · ${sess.kind === 'session' ? t('{n}% left this 5-hour window', { n: sess.percentRemaining }) : t('{n}% left this {window}', { n: sess.percentRemaining, window: sess.label })}` : ''}${week ? ` · ${t('{n}% left this week', { n: week.percentRemaining })}` : ''} · ${menu ? t('click for accounts and usage') : t('click for details')}`}>
        <span className={`mini-ring r-${lv(sess?.percentRemaining)}`} style={{ '--p': sess?.percentRemaining ?? 0 }} />
        <b className="usage-name">{NAMES[primary] || primary}</b>
        {/* Where new agents start, not the account an agent in view is on (that's in its message box). */}
        {act && <span className="usage-new">{t('New:')}</span>}
        {act && <b className="usage-acct">{accountName(act)}</b>}
        {p.usable ? (
          <>
            {sess && <span>{sess.percentRemaining}%<small> {sess.kind === 'session' ? t('5h') : sess.label}</small></span>}
            {week && <span className="chip-sep">{week.percentRemaining}%<small> {t('wk')}</small></span>}
          </>
        ) : <span className="muted">{p.allow ? t('allow') : lapsed(p) || p.status === 'auth_required' || p.notSetUp || p.signedIn === false ? t('sign in') : p.status === 'pending' ? '…' : t('no data')}</span>}
        {caret}
      </button>
    )
  }
  if (!menu) return chip
  const shown = listed(groups, primary)
  return (
    <div className="acct-wrap" ref={wrap}>
      {chip}
      {open && <AccountMenu groups={shown.length ? shown : groups.slice(0, 1)} anchor={wrap} className="top" off={!!quota?.off} onClose={() => setOpen(false)} onPick={(kind, id) => setDefault(groups, kind, id)}
        onAdd={onAddAccount} extra={[{ icon: 'gauge', label: t('Usage details'), run: onClick }]} />}
    </div>
  )
}

const WX_ICON = (code) => (code <= 1 ? 'sun' : code >= 51 ? 'rain' : 'cloud')
function WeatherChip({ onClick }) {
  const { data } = usePoll('/weather', 15 * 60 * 1000)
  const [unit, setUnit] = useShared('cc-unit', 'f')
  if (!data) return null
  const c = unit === 'c'
  const temp = Math.round(c ? (data.current.temp - 32) * 5 / 9 : data.current.temp)
  return (
    <span className="top-chip wx-chip">
      <button className="wx-open" onClick={onClick} title={`${data.location}: ${data.current.summary}`}>
        <Icon name={WX_ICON(data.current.code)} size={15} /> <span className="muted hide-sm">{data.location}</span>
      </button>
      <button className="wx-temp-btn" onClick={() => setUnit(c ? 'f' : 'c')} title={t('Switch to °{unit}', { unit: c ? 'F' : 'C' })} aria-label={c ? t('Temperature {n} degrees Celsius; switch to Fahrenheit', { n: temp }) : t('Temperature {n} degrees Fahrenheit; switch to Celsius', { n: temp })}>
        <b>{temp}°</b><span className="unit-flip"><span className={!c ? 'on' : ''}>F</span><span className={c ? 'on' : ''}>C</span></span>
      </button>
    </span>
  )
}

// Views that open in tabs beside the agents: Home (start something new), Meetings, and a meeting.
const VIEWS = { 'view:new': { title: tx('New'), icon: 'plus' }, 'view:meetings': { title: tx('Meetings'), icon: 'mic' } }
const isView = (id) => typeof id === 'string' && id.startsWith('view:')

// The recording of a meeting lives above everything else, so it goes on while you move around.
export default function Root() {
  return <MeetingsProvider><App /></MeetingsProvider>
}

function App() {
  const { fleet, live } = useFleet()
  // The phone's Cloud agents keep the phone layout on any screen.
  const wide = useMedia('(min-width: 900px)') && !cloudOnly
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
  const simple = !!conf?.simple // the simple layout, which new installs start on
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
  const [mobileMeeting, setMobileMeeting] = useState(null) // the meeting open in the phone's Meetings tab
  const [mateId, setMateId] = useState(null) // the phone's Chief tab: which thread it shows
  const [palette, setPalette] = useState(false)
  const [newAgent, setNewAgent] = useState(null) // null = closed, {} = open with defaults
  const [history, setHistory] = useState(false) // search every conversation, closed agents
  const [addAcct, setAddAcct] = useState(null) // the Add another account dialog: { kind, account }
  const [tour, setTour] = useState(false)
  const [toured, setToured] = usePersisted('cc-toured', {}) // { desktop, phone }: seen on this device
  const [cmdRef, cmdW] = useWidth()
  const [rowRef, rowW] = useWidth()
  const quota = usePoll('/quota', 5 * 60 * 1000)
  const update = usePoll('/updates', 6 * 60 * 60 * 1000)
  const prevStatus = useRef({})
  useRuntimeTheme()

  const set = (patch) => setL((l) => ({ ...l, ...patch }))
  const agents = fleet?.agents || []
  // Editor tabs hold agents (by pane id) and shell-only herdr tabs (as "tab:<id>").
  const shellTabs = (fleet?.tabs || []).filter((tab) => tab.panes.some((p) => !p.agent))
    .map((tab) => ({ ...tab, shellTab: true, paneId: `tab:${tab.tabId}`, title: tab.label || t('shell'), cwd: tab.panes.find((p) => !p.agent)?.cwd || '' }))
  // Home and meetings in tabs too: always there while their tab is open.
  const meetingTabs = W.tabs.some((id) => id.startsWith('view:meeting:'))
  const meetingList = usePoll(meetingTabs ? '/meetings' : null, 20 * 1000).data?.meetings || []
  const views = [...new Set([...W.tabs, mobileAgent].filter(isView))].map((id) => {
    const m = id.startsWith('view:meeting:') ? meetingList.find((x) => x.id === id.slice(13)) : null
    return { paneId: id, view: true, title: VIEWS[id] ? t(VIEWS[id].title) : m?.title || t('Meeting'), icon: VIEWS[id]?.icon || 'mic' }
  })
  // Agents on your other devices, in tabs here: named from what each device last said about them
  // (or, while that's loading or the device is away, from when the tab was opened).
  const [remoteInfo, setRemoteInfo] = usePersisted('cc-remote-tabs', {})
  const remoteTabs = W.tabs.some(isRemote)
  const devices = useMachines(10000, remoteTabs && !viaRelay).data
  const remotes = W.tabs.filter(isRemote).map((id) => {
    const r = remoteOf(id)
    const d = r.machine ? devices?.machines?.find((m) => m.id === r.machine) : null
    const live = d?.agents?.find((x) => x.paneId === r.pane)
    const info = remoteInfo[id] || {}
    return { paneId: id, remote: r, title: live?.title || info.title || t('Agent'), device: d?.name || info.device || '', kind: live?.kind || info.kind, status: live?.status || (d && !d.online ? 'unknown' : info.status || 'unknown') }
  })
  const byId = Object.fromEntries([...shellTabs, ...agents, ...views, ...remotes].map((a) => [a.paneId, a]))
  // The chief of staff: Main, of its threads (each thread is a chief of its own).
  const mate = agents.find((a) => a.chief && a.thread?.main) || agents.find((a) => a.chief)
  const mateShown = byId[mateId]?.chief ? byId[mateId] : mate
  const needsYou = agents.filter((a) => a.status === 'blocked')

  // herdr sessions each have their own agents (and number panes alike), so each keeps its own open
  // tabs, and a switch announces nothing: the last session's agents only left the view.
  const [wsBySession, setWsBySession] = usePersisted('cc-ws-sessions', {})
  useEffect(() => {
    if (!fleet) return
    const s = fleet.session || ''
    if (W.session === undefined) { if (s) setW((w) => ({ ...w, session: s })); return }
    if (W.session === s) return
    prevStatus.current = {}
    setMobileAgent(null)
    setWsBySession((m) => ({ ...m, [W.session]: W }))
    setW({ ...WS, ...wsBySession[s], session: s })
  }, [fleet]) // eslint-disable-line react-hooks/exhaustive-deps

  // The chief of staff is the first tab that loads, not a fixture: it's added only when no tabs are open.
  // (Not while the herdr session is stopped: its tabs come back with it.)
  useEffect(() => {
    if (!fleet || fleet.down) return
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
      if (before && before !== a.status && (a.status === 'blocked' || a.status === 'done') && document.hidden && !window.bridgeApp && !a.muted &&
        'Notification' in window && Notification.permission === 'granted') {
        const name = a.title || a.workspace
        const show = (q) => {
          const n = new Notification(a.status === 'blocked' ? (q?.text ? t('{name} needs you', { name }) : t('Agent needs you')) : t('Agent finished'), { body: q?.text || name, tag: a.paneId })
          n.onclick = () => { window.focus(); if (a.status === 'blocked') showChat(a.paneId); openAgentRef.current?.(a.paneId); n.close() }
        }
        // Say what it's asking.
        if (a.status === 'blocked') api(`/agents/${encodeURIComponent(a.paneId)}/question`).then(show, () => show(null))
        else show(null)
      }
      prevStatus.current[a.paneId] = a.status
    }
  }, [fleet]) // eslint-disable-line react-hooks/exhaustive-deps

  // In the phone apps: the agents at work, for the lock screen.
  useEffect(() => {
    // With the herdr session: another session's agents left the view, they didn't finish.
    if (relayActivity && fleet && !fleet.down) relayActivity(agents.map((a) => ({ id: a.paneId, name: nameOf(a), status: a.status })), { session: fleet.session || null })
  }, [fleet]) // eslint-disable-line react-hooks/exhaustive-deps

  // replace: the chief's thread bar shows another thread in the same tab.
  const openAgent = useCallback((paneId, { toSide = false, replace = null } = {}) => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
    setView('command')
    // Not on a phone, or in the phone apps (their page holds this one): there, that device is shown.
    if (isRemote(paneId) && (!wide || viaRelay)) { const r = remoteOf(paneId); goMachine(r.machine, { agent: r.pane }); return }
    if (!wide) {
      const a = byId[paneId]
      // On the phone's Cloud agents, Back (Android's) closes the agent first.
      if (cloudOnly && paneId !== mobileAgent) { if (window.history.state?.agent) window.history.replaceState({ agent: paneId }, ''); else window.history.pushState({ agent: paneId }, '') }
      // Meetings, and a meeting, open in the phone's own Meetings tab.
      if (typeof paneId === 'string' && paneId.startsWith('view:meeting')) { setMtab('meetings'); setMobileMeeting(paneId === 'view:meetings' ? null : paneId); return }
      if (a?.chief) { setMtab('mate'); setMobileAgent(null); setMateId(paneId) } else { setMtab('agents'); setMobileAgent(paneId) }
      return
    }
    setW((w) => {
      if (replace && w.tabs.includes(replace) && !w.tabs.includes(paneId)) {
        const tabs = w.tabs.map((t) => (t === replace ? paneId : t))
        return { ...w, tabs, active: w.active === replace ? paneId : w.active, side: w.side === replace ? paneId : w.side }
      }
      const tabs = w.tabs.includes(paneId) ? w.tabs : [...w.tabs, paneId]
      if (toSide || (w.split && w.group === 'side')) return { ...w, tabs, side: paneId, split: true, group: 'side' }
      if (w.split && w.side === paneId) return { ...w, tabs, group: 'side' }
      return { ...w, tabs, active: paneId, group: 'main' }
    })
    setL((l) => (l.max ? { ...l, max: null } : l))
  }, [wide, fleet, mobileAgent]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!cloudOnly) return
    const back = () => setMobileAgent(null)
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])

  // Clicking a notification (browser or the Mac app) opens the agent it was about.
  const openAgentRef = useRef(null)
  const fleetRef = useRef(null)
  fleetRef.current = fleet
  const wsRef = useRef(W)
  wsRef.current = W
  openAgentRef.current = openAgent
  useEffect(() => {
    // "chief" (the home-screen shortcut) means whichever agent is the chief of staff.
    const on = (e) => {
      let id = e.detail?.paneId
      // An agent on another of your devices: in a tab here (remembering what to call it).
      if (isRemote(id) && e.detail.remote) setRemoteInfo((m) => ({ ...Object.fromEntries(Object.entries(m).filter(([k]) => wsRef.current?.tabs.includes(k))), [id]: e.detail.remote }))
      if (id === 'chief') {
        const all = fleetRef.current?.agents || []
        id = (all.find((a) => a.chief && a.thread?.main) || all.find((a) => a.chief))?.paneId
        // No chief running: show where to start one (the phone's Chief tab; on a wide screen the
        // main area already offers it).
        if (!id) { setMtab('mate'); return }
      }
      if (!id) return
      // From a "needs you" notification: at its Chat, where the question card is.
      if (e.detail.view === 'chat') showChat(id)
      openAgentRef.current?.(id, { replace: e.detail.replace || null })
    }
    window.addEventListener('bridge-open-agent', on)
    return () => window.removeEventListener('bridge-open-agent', on)
  }, [])
  // A meeting opened from anywhere (the recording pill, starting a recording, the list).
  useEffect(() => {
    const on = (e) => {
      if (e.detail?.id) openAgentRef.current?.(`view:meeting:${e.detail.id}`, { replace: 'view:meetings' })
      else if (e.detail?.list) openAgentRef.current?.('view:meetings')
    }
    window.addEventListener('bridge-open-meeting', on)
    return () => window.removeEventListener('bridge-open-meeting', on)
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
  // Any part of the app can open a section of Settings (a fix that lives there).
  useEffect(() => {
    const on = (e) => setSettings(e.detail?.section || 'general')
    window.addEventListener('bridge-open-settings', on)
    return () => window.removeEventListener('bridge-open-settings', on)
  }, [])
  useEffect(() => {
    const on = (e) => setAddAcct(e.detail || {})
    window.addEventListener('bridge-add-account', on)
    return () => window.removeEventListener('bridge-add-account', on)
  }, [])
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
    else set({ dockMin: false, todayOpen: true, max: L.max === 'dock' ? 'dock' : null })
    setTimeout(() => document.getElementById(`card-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80)
  }
  showCardRef.current = showCard

  // Open a Today tab full size (desktop) or in the phone's Today tab.
  const showToday = (tab, detail) => {
    setView('command')
    setTodayTab(tab)
    if (!wide) setMtab('today')
    else set({ dockMin: false, todayOpen: true, max: 'dock' })
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
  // Started from Home: the agent takes Home's tab, as the thread takes the new-thread page in T3.
  const fromHome = (out) => { if (out?.paneId) setTimeout(() => { if (wide) openAgent(out.paneId, { replace: 'view:new' }); else openAgent(out.paneId) }, 1200) }
  const openNew = () => openAgent('view:new')
  const queuedFor = (id) => fleet?.queue?.[id] || []
  // A plain terminal on the device on screen, for anything you'd type yourself (brew upgrade, a
  // dev server): in a space's folder ("New terminal here"), else your home folder in a space of its
  // own. Its tab opens once the fleet has it.
  const [termFor, setTermFor] = useState(null) // the new terminal's pane, until its tab shows
  // Not in the demo: it has no computer to run a shell on.
  const newTerminal = import.meta.env.MODE === 'demo' ? null : async ({ workspaceId, cwd } = {}) => {
    const ws = workspaceId || (fleet?.workspaces || []).find((w) => w.label === 'Terminals')?.id
    try {
      const out = await api('/agents/launch', { method: 'POST', body: { kind: 'shell', cwd: cwd || '~', label: 'Terminal', ...(ws ? { workspaceId: ws } : { newSpace: 'Terminals' }) } })
      if (out?.paneId) setTermFor(out.paneId)
    } catch (e) { window.alert(e.message) }
  }
  useEffect(() => {
    const t = termFor && (fleet?.tabs || []).find((x) => x.panes.some((p) => p.paneId === termFor))
    if (t) { setTermFor(null); openAgent(`tab:${t.tabId}`) }
  }, [fleet, termFor]) // eslint-disable-line react-hooks/exhaustive-deps

  const mateLaunch = useLaunchMate(openAgent)
  const meetings = useMeetings()
  useHotkey(useCallback((e) => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k', []), () => setPalette((p) => !p))
  useHotkey(useCallback((e) => (e.metaKey || e.ctrlKey) && e.key === ',', []), () => setSettings((v) => (v ? null : 'general')))
  useHotkey(useCallback((e) => (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f', []), () => setHistory((v) => !v))
  useHotkey(useCallback((e) => e.altKey && (e.code === 'Digit1' || e.code === 'Digit2'), []), (e) => setView(e.code === 'Digit1' ? 'command' : 'herdr'))
  useHotkey(useCallback((e) => e.key === 'Escape' && !e.target.closest?.('.xterm, textarea, input, .quick-open, .tour'), []), () => set({ max: null }))

  // The tour: once per device after setup (the phone layout has its own), and again on request.
  // It waits while anything else is open on top, and starts from the beginning after.
  const device = wide ? 'desktop' : 'phone'
  const covered = !!(onboarding || settings || newAgent || palette || history)
  const ready = !!fleet && !!conf?.setupDone && view === 'command'
  // Not over the chief of staff's own setup card (sign-in, trust): that comes first.
  const chiefSetup = !!fleet?.agents?.some((a) => a.chief && a.setup)
  useEffect(() => {
    // Only when asked for now (Take the tour): a new setup lands on Home, with nothing in the way.
    if (tour || toured[device] || covered || chiefSetup || !ready || cloudOnly || !TOUR_ON_START) return
    const t = setTimeout(() => setTour(true), 1500) // let the chief of staff's tab open first
    return () => clearTimeout(t)
  }, [tour, toured[device], device, covered, chiefSetup, ready]) // eslint-disable-line react-hooks/exhaustive-deps
  const takeTour = () => { setSettings(null); setView('command'); setTour(true) }
  const takeTourRef = useRef(null)
  takeTourRef.current = takeTour
  useEffect(() => {
    const on = () => takeTourRef.current?.()
    window.addEventListener('bridge-tour', on)
    return () => window.removeEventListener('bridge-tour', on)
  }, [])
  const endTour = () => { setTour(false); setToured((t) => ({ ...t, [device]: true })) }
  // The tab being dragged (below). Up here, before the phone layout returns, so a phone turned
  // sideways into the wide layout keeps the same hooks instead of crashing.
  const [tabDrag, setTabDrag] = useState(null) // { id, over, after }

  const nextTheme = { system: 'dark', dark: 'light', light: 'system' }[theme]
  const paletteActions = [
    { id: 'a:home', label: t('New…'), icon: 'plus', keywords: 'new thread start build project agent chat what should we build', run: openNew },
    { id: 'a:new', label: t('New agent with all the options…'), icon: 'bot', keywords: 'launch start claude codex gemini copilot opencode project dialog compare account', run: () => setNewAgent({ mode: 'project' }) },
    { id: 'a:record', label: t('Record a meeting'), icon: 'mic', keywords: 'meeting notes transcript record call granola minutes', run: () => meetings?.start().catch(() => openAgent('view:meetings')) },
    { id: 'a:meetings', label: t('Meetings'), icon: 'mic', keywords: 'meeting notes transcripts summaries', run: () => openAgent('view:meetings') },
    { id: 'a:history', label: t('Search history and closed agents…'), icon: 'clock', keywords: 'search find transcript conversation closed archived resume old past', run: () => setHistory(true) },
    { id: 'a:cloud', label: t('New cloud agent…'), icon: 'cloud', keywords: 'cursor copilot jules claude managed remote github repo pull request', run: () => setNewAgent({ mode: 'cloud' }) },
    { id: 'a:chat', label: t('New chat…'), icon: 'chat', keywords: 'plain vanilla talk ask claude codex gemini assistant', run: () => setNewAgent({ mode: 'chat' }) },
    !cloudOnly && newTerminal && { id: 'a:terminal', label: t('New terminal'), icon: 'terminal', keywords: 'shell command line console bash zsh brew npm run type commands', run: () => newTerminal() },
    { id: 'a:settings', label: t('Settings…'), icon: 'settings', hint: '⌘,', keywords: 'preferences name default agent model location runtime', run: () => setSettings('general') },
    { id: 'a:providers', label: t('Model Providers'), icon: 'layers', keywords: 'api key openai anthropic gemini openrouter bedrock vertex ollama lm studio', run: () => setSettings('providers') },
    { id: 'a:accounts', label: t('Accounts…'), icon: 'users', keywords: 'account switch work personal sign in login claude codex auto', run: () => setSettings('accounts') },
    { id: 'a:add-account', label: t('Add another account…'), icon: 'plus', keywords: 'account second work personal sign in login claude codex both two', run: () => setAddAcct({}) },
    { id: 'a:mcp', label: t('MCP Servers'), icon: 'tool', keywords: 'tools mcp github playwright', run: () => setSettings('mcp') },
    { id: 'a:config', label: t('Edit config file'), icon: 'braces', keywords: 'json config.json settings', run: () => setSettings('config') },
    { id: 'a:mate', label: t('Go to chief of staff'), icon: 'helm', keywords: 'chief staff dispatch route', run: () => (mate ? openAgent(mate.paneId) : mateLaunch.launch()) },
    wide && liveView && { id: 'a:view', label: view === 'herdr' ? t('Switch to Bridge view') : t('Switch to Herdr view'), icon: 'layers', hint: view === 'herdr' ? 'Alt 1' : 'Alt 2', run: () => setView(view === 'herdr' ? 'command' : 'herdr') },
    wide && { id: 'a:rail', label: L.railOpen ? t('Collapse sidebar') : t('Expand sidebar'), icon: 'panel-left', run: () => set({ railOpen: !L.railOpen }) },
    { id: 'a:appearance', label: t('Appearance…'), icon: 'palette', keywords: 'theme color colour dark light mode font text size density compact sidebar slack', run: () => setSettings('appearance') },
    { id: 'a:theme', label: nextTheme === 'dark' ? t('Color mode: switch to dark') : nextTheme === 'light' ? t('Color mode: switch to light') : t('Color mode: switch to system'), icon: theme === 'dark' ? 'sun' : 'moon', keywords: 'dark light mode', run: () => setTheme(nextTheme) },
    { id: 'a:ideas', label: t('Add an idea'), icon: 'bulb', keywords: 'backlog todo', run: () => { showCard('bulb'); setTimeout(() => document.querySelector('.idea-add input')?.focus(), 250) } },
    { id: 'a:cal', label: t('Open calendar'), icon: 'calendar', keywords: 'week month year schedule meetings', run: () => showToday('calendar') },
    { id: 'a:mail', label: t('Open mail'), icon: 'mail', keywords: 'inbox email outlook needs you', run: () => showToday('mail') },
    { id: 'a:triage', label: t('Triage my inbox with an agent'), icon: 'sparkle', keywords: 'mail email', run: async () => { try { const o = await api('/mail/triage', { method: 'POST' }); if (o.paneId) setTimeout(() => openAgent(o.paneId), 1200) } catch { showToday('mail') } } },
    { id: 'a:markets', label: t('Markets & news'), icon: 'trend', keywords: 'fed rates treasury mortgage stocks headlines tech', run: () => showToday('markets') },
    { id: 'a:routines', label: t('Show routines'), icon: 'repeat', run: () => showCard('repeat') },
    { id: 'a:usage', label: t('Show usage'), icon: 'gauge', keywords: 'quota tokens cost', run: () => showCard('gauge') },
    { id: 'a:stats', label: t('Usage stats and history'), icon: 'gauge', keywords: 'stats heatmap tokens cost models projects', run: () => openToday('usage') },
    { id: 'a:tour', label: t('Take the tour'), icon: 'sparkle', keywords: 'help guide walkthrough intro getting started how', run: takeTour },
  ].filter(Boolean)
  // The phone's Cloud agents: only what it has.
  const actions = cloudOnly ? [
    ...paletteActions.filter((a) => ['a:cloud', 'a:history'].includes(a.id)),
    { id: 'a:settings', label: t('Cloud agent keys…'), icon: 'settings', keywords: 'settings key cursor copilot jules claude', run: () => setSettings('cloud') },
    ...paletteActions.filter((a) => ['a:appearance', 'a:theme'].includes(a.id)),
  ] : paletteActions
  const closeSettings = () => { setSettings(null); if (cloudOnly) refetch('/cloud') }
  // The agent on screen, whose message box dictation fills when nothing else has the focus.
  const onScreen = () => {
    const id = wide ? W.active : mtab === 'mate' ? mateShown?.paneId : mtab === 'agents' ? mobileAgent : null
    return id && byId[id] && !byId[id].view && !byId[id].shellTab ? id : null
  }
  const overlays = (
    <>
      {!cloudOnly && <Dictation conf={conf?.dictation} onScreen={onScreen} />}
      {palette && <Palette fleet={fleet} activeId={wide ? W.active : mobileAgent} onClose={() => setPalette(false)} onOpen={openAgent} onOpenFile={openFiles} actions={actions} />}
      {settings && <Settings section={settings} onClose={closeSettings} onOpenAgent={openAgent} />}
      {(fleet?.agents || []).filter((a) => a.chief && a.setup).map((a) => <FirstRunAnswers key={a.paneId} agent={a} />)}
      <CallPrompt />
      {onboarding && <Onboarding onDone={(pane) => { setOnboarding(false); confPoll.refresh(); if (pane) setTimeout(() => openAgent(pane), 800); else openAgent('view:new') }} />}
      {newAgent && <NewAgent fleet={fleet} initial={newAgent} onClose={() => setNewAgent(null)} onLaunched={onLaunched} onAddAccount={(kind) => setAddAcct({ kind })} onCloudSettings={() => { setNewAgent(null); setSettings('cloud') }} />}
      {history && <History onClose={() => setHistory(false)} onOpen={(id, fresh) => (fresh ? setTimeout(() => openAgent(id), 1200) : openAgent(id))} />}
      {addAcct && <AddAccount initial={addAcct} onClose={() => setAddAcct(null)} onOpenAgent={(id) => { setSettings(null); setNewAgent(null); openAgent(id) }}
        onStart={(kind, account) => { setAddAcct(null); setSettings(null); if (!newAgent) setNewAgent({ mode: 'project', kind, account }) }} />}
      {tour && !covered && <Tour key={device} phone={!wide} simple={simple} actionLabel={agents.some((a) => !a.chief) ? t('Start an agent') : t('Start your first agent')}
        onClose={endTour} onAction={() => { endTour(); setNewAgent({ mode: 'project' }) }} />}
    </>
  )

  // railBtn: the sidebar's collapse and expand, at the top left on a wide screen.
  const topbarFor = (railBtn = null) => (
    <header className="topbar">
      <div className="top-left">
      <img className="mark" src={`${import.meta.env.BASE_URL}mark.svg`} alt="Bridge AI" width="24" height="24" />
      {railBtn}
      {!cloudOnly && <Quiet name="Devices menu"><MachineMenu /></Quiet>}
      {wide && liveView && (
        <nav className="view-tabs" role="tablist" aria-label={t('View')}>
          <button role="tab" aria-selected={view === 'command'} className={view === 'command' ? 'on' : ''} onClick={() => setView('command')} title="Alt+1">
            <Icon name="helm" size={14} /> Bridge
          </button>
          <button role="tab" aria-selected={view === 'herdr'} className={view === 'herdr' ? 'on' : ''} onClick={() => setView('herdr')} title="Alt+2">
            <Icon name="layers" size={14} /> Herdr
          </button>
        </nav>
      )}
      </div>
      <button className="search-btn" data-tour="search" onClick={() => setPalette(true)} aria-label={t('Search and commands')} title={t('Search and commands (⌘K)')}>
        <Icon name="search" size={15} /> <span className="hide-sm">{t('Search agents, files and commands')}</span> <kbd className="hide-touch">⌘K</kbd>
      </button>
      <div className="top-right">
        <Quiet name="Recording"><RecordingPill /></Quiet>
        {needsYou.length > 0 && (
          <button className="needs-chip" onClick={() => openAgent(needsYou[0].paneId)}>
            <StatusDot status="blocked" size={8} /> {needsYou.length}<span className="needs-word"> {needsYou.length === 1 ? t('needs you') : t('need you')}</span>
          </button>
        )}
        {!cloudOnly && (
          <>
            <Quiet name="Next meeting"><NextMeetingChip onClick={() => showCard('calendar')} /></Quiet>
            <Quiet name="Usage"><ProviderChip quota={quota.data} primary={primary} onClick={() => showCard('gauge')} onAddAccount={(kind) => setAddAcct({ kind })} /></Quiet>
            {update.data?.available && <Quiet name="Update"><UpdateChip u={update.data} onDetails={() => setSettings('about')} /></Quiet>}
            <Quiet name="Restart"><RestartChip fleet={fleet} runtime={conf?.runtime?.name} keep={!!conf?.runtime?.keep} /></Quiet>
            <Quiet name="Weather"><WeatherChip onClick={() => showCard('sun')} /></Quiet>
            <Quiet name="Clock"><Clock /></Quiet>
          </>
        )}
        {toStart && <button className="win-btn" onClick={toStart} aria-label={t('Your computer')} title={t('Back to the start: pair or open a computer')}><Icon name="laptop" size={15} /></button>}
        <button className="win-btn" data-tour="settings" onClick={() => setSettings('general')} aria-label={t('Settings')} title={t('Settings (⌘,)')}>
          <Icon name="settings" size={15} />
        </button>
      </div>
    </header>
  )
  const topbar = topbarFor()

  // Home, Meetings or a meeting, in a tab.
  const viewFor = (id, { onBack } = {}) => (
    <ErrorBoundary key={id} name="This view" resetKey={id}>
      {id === 'view:new' ? <Home fleet={fleet} onLaunched={fromHome} onMore={(init) => setNewAgent(init)} />
        : id === 'view:meetings' ? <section className="pane view-pane"><MeetingsHome onOpen={(mid) => openAgent(`view:meeting:${mid}`, wide ? { replace: 'view:meetings' } : {})} /></section>
          : <section className="pane view-pane"><MeetingPage id={id.slice(13)} onBack={onBack || (() => openAgent('view:meetings', { replace: id }))} /></section>}
    </ErrorBoundary>
  )
  // ---------- Phone ----------
  // The phone's Cloud agents: their list (or the first key), and one agent at a time.
  if (cloudOnly) {
    const mAgent = byId[mobileAgent]
    const back = () => { if (window.history.state?.agent) window.history.back(); else setMobileAgent(null) }
    return (
      <div className="app narrow cloud-only">
        {topbar}
        <main className="m-body">
          {mAgent
            ? <ErrorBoundary name="This agent's view" resetKey={mAgent.paneId}><Console agent={mAgent} variant="mobile" onBack={back} /></ErrorBoundary>
            : <CloudHome fleet={fleet} onOpen={openAgent} onNew={() => setNewAgent({ mode: 'cloud' })} />}
        </main>
        {overlays}
      </div>
    )
  }
  if (!wide) {
    const mAgent = byId[mobileAgent]
    const tabs = [['mate', 'helm', t('Chief')], ['agents', 'grid', t('Agents')], ['meetings', 'mic', t('Meetings')], ['herdr', 'terminal', t('Terminals')], ['today', 'today', t('Today')]]
    return (
      <div className="app narrow">
        {topbar}
        <RuntimeNotice runtime={conf?.runtime?.name} fellBack={conf?.runtime?.fellBack} />
        <Quiet name="Link requests"><AskBanner /></Quiet>
        <main className="m-body">
          {mtab === 'mate' && (mateShown ? <Console key={mateShown.paneId} agent={mateShown} variant="mobile" queued={queuedFor(mateShown.paneId)} agents={agents} onThread={(id) => setMateId(id)} /> : <MateEmpty onLaunch={mateLaunch.launch} {...mateLaunch} />)}
          {mtab === 'agents' && (mAgent
            ? mAgent.view
              ? <div className="m-view">{!mAgent.paneId.startsWith('view:meeting:') && <button type="button" className="ghost-btn m-view-back" onClick={() => setMobileAgent(null)}><Icon name="back" size={14} /> {t('Agents')}</button>}{viewFor(mAgent.paneId, { onBack: () => openAgent('view:meetings') })}</div>
              : <Console agent={mAgent} variant="mobile" onBack={() => setMobileAgent(null)} queued={queuedFor(mAgent.paneId)} />
            : <><SessionSwitcher fleet={fleet} phone /><Board fleet={fleet} compact onOpen={openAgent}
              action={<span className="m-acts"><button className="btn small" onClick={openNew} aria-label={t('Start something new')}><Icon name="plus" size={12} /> {t('New')}</button></span>} /></>)}
          {mtab === 'meetings' && <div className="m-view m-meetings">{viewFor(mobileMeeting || 'view:meetings', { onBack: () => setMobileMeeting(null) })}</div>}
          {mtab === 'herdr' && <Terminals key={fleet?.session || ''} onChat={(id) => openAgent(id)} />}
          {mtab === 'today' && (
            <div className="m-today">
              <TodayTabs tab={todayTab} setTab={setTodayTab} compact />
              <div className={`m-today-body tab-${todayTab}`}><TodayBody onOpenAgent={openAgent} tab={todayTab} setTab={setTodayTab} stackClass="m-stack" /></div>
            </div>
          )}
        </main>
        <nav className="tabbar" aria-label={t('Sections')}>
          {tabs.map(([id, icon, label]) => (
            <button key={id} className={mtab === id ? 'on' : ''} data-tour={{ mate: 'chief', agents: 'agents', meetings: 'meetings' }[id]} onClick={() => { setMtab(id); if (id === 'agents' && mtab === 'agents') setMobileAgent(null); if (id === 'meetings' && mtab === 'meetings') setMobileMeeting(null) }} aria-current={mtab === id}>
              <span className="tab-icon">
                <Icon name={icon} size={20} />
                {id === 'agents' && needsYou.length > 0 && <span className="badge">{needsYou.length}</span>}
                {id === 'meetings' && meetings?.rec && <span className="badge rec" role="img" aria-label={t('Recording')} />}
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
  // The simple layout (new installs): Today waits behind one button (and opens full size when
  // there's no room beside the agents), and the Agents board shows once there's an agent besides
  // the chief of staff.
  const todayHidden = simple && L.max !== 'dock' && (!L.todayOpen || autoDock)
  const dockMin = L.dockMin || autoDock || todayHidden
  const showBoard = !simple || L.max === 'board' || agents.some((a) => !a.chief && !a.shellTab)
  const autoRail = cmdW > 0 && L.railOpen && cmdW - L.railW - (dockMin ? 58 : dockW) - 30 < MIN_WORK
  const railOpen = L.railOpen && !autoRail
  const canSplit = !rowW || rowW >= MIN_PANE * 2 + 10
  const split = W.split && !!byId[W.side] && W.side !== W.active && canSplit
  const sideW = Math.max(MIN_PANE, Math.min(L.sideW, rowW ? rowW - MIN_PANE - 10 : L.sideW))

  // A pane id names another agent in another herdr session: its views start afresh.
  const sessionKey = fleet?.session ? `${fleet.session}/` : ''
  const paneFor = (id, group) => {
    const a = byId[id]
    // Nothing open: Home, to start something (unless herdr's session is down).
    if (!a) {
      if (!fleet?.down) return <Home fleet={fleet} onLaunched={fromHome} onMore={(init) => setNewAgent(init)} autoFocus={false} />
      return (
        <section className="pane empty-pane">
          <div className="viewer-empty"><Icon name="terminal" size={24} /><p>{fleet.session ? <>The herdr session <b>{fleet.session}</b> isn't running. {t('Start it from the sidebar.')}</> : t('No herdr session is running.')}</p></div>
        </section>
      )
    }
    if (a.view) return viewFor(id)
    if (a.remote) {
      return (
        <div className={`group ${split && W.group === group ? 'focused' : ''}`} onMouseDown={() => split && W.group !== group && setW((w) => ({ ...w, group }))}>
          <ErrorBoundary key={a.paneId} name="This agent's view" resetKey={a.paneId}><RemoteAgent a={a} /></ErrorBoundary>
        </div>
      )
    }
    const controls = { maximized: L.max === group, onMaximize: () => set({ max: L.max === group ? null : group }) }
    return (
      <div className={`group ${split && W.group === group ? 'focused' : ''}`} onMouseDown={() => split && W.group !== group && setW((w) => ({ ...w, group }))}>
        {a.shellTab
          ? <ShellTab key={sessionKey + a.paneId} tab={a} onOpenInHerdr={openInHerdr} controls={controls} />
          : popped.has(a.paneId)
            ? (
              <section className="pane popped-pane">
                <div className="viewer-empty">
                  <Icon name="popout" size={26} />
                  <p><b>{nameOf(a)}</b> is open in its own window.</p>
                  <div className="popped-acts">
                    <button className="btn small" onClick={() => showPopped(a.paneId)}>{t('Show window')}</button>
                    <button className="btn small primary" onClick={() => bringBack(a.paneId)}>{t('Bring back here')}</button>
                  </div>
                </div>
              </section>
            )
            : <ErrorBoundary key={sessionKey + a.paneId} name="This agent's view" resetKey={a.paneId}><Console agent={a} variant={a.chief ? 'mate' : 'focus'} simple={simple} onOpenInHerdr={openInHerdr} onPopOut={() => popOut(a)} controls={controls} queued={queuedFor(a.paneId)}
              agents={a.chief ? agents : undefined} onThread={(id) => openAgent(id, { replace: a.paneId })} /></ErrorBoundary>}
      </div>
    )
  }

  // Drag a tab to reorder; Ctrl+Shift+←/→ moves the focused tab. The order is saved with the layout.
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
    <div className="ws-tabs" role="tablist" aria-label={t('Open agents')}>
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
              }} title={a.view ? a.title : a.shellTab ? `${a.workspace} › ${a.label}` : a.remote ? `${a.title}\n${t('On {name}', { name: a.device })}` : `${a.title}\n${a.cwd}`}>
              {a.view ? <Icon name={a.icon} size={12} className="muted" /> : a.chief ? <Icon name="helm" size={13} className="tab-ship" /> : a.shellTab ? <Icon name="terminal" size={12} className="muted" /> : <StatusDot status={a.status} size={7} />}
              <span className="ws-tab-name">{a.chief ? (a.thread && !a.thread.main ? a.title : t('Chief of Staff')) : a.title || a.tab}</span>
              {a.remote && a.device && <span className="ws-tab-where">{a.device}</span>}
              {a.chief && <StatusDot status={a.status} size={6} />}
              <button className="ws-tab-x" aria-label={t('Close {name}', { name: a.title })} onClick={(e) => { e.stopPropagation(); closeTab(id) }}><Icon name="x" size={11} /></button>
            </div>
          )
        })}
      </div>
      <div className="ws-tab-tools">
        {!mate && !fleet?.down && <button className="ghost-btn" data-tour="chief" onClick={mateLaunch.launch} disabled={mateLaunch.launching}><Icon name="helm" size={12} /> {mateLaunch.launching ? t('Launching…') : t('Chief of Staff')}</button>}
        <button className={`win-btn ${split ? 'on' : ''}`} onClick={toggleSplit} disabled={!canSplit || W.tabs.length < 2}
          title={!canSplit ? t('Not enough room to split') : W.tabs.length < 2 ? t('Open a second agent to split') : split ? t('Unsplit') : t('Split side by side')} aria-label={t('Split')}>
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
      onMinimize={() => set(simple ? { todayOpen: false, dockMin: false, max: null } : { dockMin: !L.dockMin, max: null })} onMaximize={() => set({ max: L.max === 'dock' ? null : 'dock', dockMin: false })} />
  )
  const maxEl = { main: paneFor(W.active, 'main'), side: split && paneFor(W.side, 'side'), board: boardEl, dock: dockEl }[L.max]

  return (
    <div className="app wide">
      {topbarFor(view === 'command' && (
        <button className="win-btn rail-btn" onClick={() => set({ railOpen: !railOpen })} aria-label={railOpen ? t('Collapse sidebar') : t('Expand sidebar')} aria-expanded={railOpen} title={railOpen ? t('Collapse sidebar') : t('Expand sidebar')}>
          <Icon name="panel-left" size={16} />
        </button>
      ))}
      <RuntimeNotice runtime={conf?.runtime?.name} fellBack={conf?.runtime?.fellBack} />
      <Quiet name="Link requests"><AskBanner /></Quiet>
      <div className="views">
        <main className="cmd" hidden={view !== 'command'} ref={cmdRef}>
          <div className="slot rail-slot" style={{ width: railOpen ? L.railW : 52 }}>
            <Rail fleet={fleet} live={live} collapsed={!railOpen} onToggle={() => set({ railOpen: !L.railOpen })}
              selected={W.active} onOpen={openAgent} onOpenInHerdr={openInHerdr} onOpenFiles={openFiles} onNewAgent={(init) => (init ? setNewAgent(init) : openNew())} onNewTerminal={newTerminal} onHistory={() => setHistory(true)}
              onMeetings={() => openAgent('view:meetings')} recording={!!meetings?.rec} />
          </div>
          {railOpen && <Handle axis="x" size={L.railW} min={180} max={380} onSize={(v) => set({ railW: v })} onToggle={() => set({ railOpen: false })} label={t('Resize sidebar')} />}

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
                      <Handle axis="x" size={sideW} min={MIN_PANE} max={Math.max(MIN_PANE, rowW - MIN_PANE - 10)} invert onSize={(v) => set({ sideW: v })} label={t('Resize split')} />
                      <div className="slot" style={{ width: sideW }}>{paneFor(W.side, 'side')}</div>
                    </>
                  )}
                </div>
                {showBoard && !L.boardMin && <Handle axis="y" size={L.boardH} min={150} max={900} invert onSize={(v) => set({ boardH: v })} onToggle={() => set({ boardMin: true })} label={t('Resize agents board')} />}
                {showBoard && <div className={`slot board-slot ${L.boardMin ? 'min' : ''}`} style={L.boardMin ? undefined : { height: L.boardH }}>{boardEl}</div>}
              </div>
              {!dockMin && <Handle axis="x" size={dockW} min={320} max={720} invert onSize={(v) => set({ dockW: v === LAYOUT.dockW ? v + 1 : v })} onToggle={() => set({ dockMin: true })} label={t('Resize Today panel')} />}
              <div className="slot dock-slot" style={dockMin ? undefined : { width: dockW }}>{todayHidden
                ? <Dock minimized simple onOpenAgent={openAgent} onMinimize={() => set({ todayOpen: true, dockMin: false, ...(autoDock ? { max: 'dock' } : {}) })} />
                : dockMin && !L.dockMin
                  ? <Dock minimized onOpenAgent={openAgent} onMinimize={() => set({ dockMin: false, max: 'dock' })} />
                  : dockEl}</div>
            </>
          )}
        </main>
        {liveView && <HerdrView active={view === 'herdr'} onViewHotkey={setView} session={fleet?.session} />}
      </div>
      {overlays}
    </div>
  )
}
