import { useCallback, useEffect, useRef, useState } from 'react'
import SoundButton from './components/SoundButton.jsx'
import StatusMenu, { UsageChip, UsageGlance, WeatherChip, ClockChip } from './components/StatusMenu.jsx'
import Icon, { StatusDot } from './components/Icon.jsx'
import { useAppearance, fillFor } from './appearance.js'
import { usePins } from './pins.js'
import ErrorBoundary, { Quiet } from './components/ErrorBoundary.jsx'
import { CrashNotice } from './components/CrashReport.jsx'
import Rail, { agentName } from './components/Rail.jsx'
import Board from './components/Board.jsx'
import TabStrip from './components/TabStrip.jsx'
import Dock from './components/Dock.jsx'
import Console, { MateEmpty, showChat } from './components/Console.jsx'
import { Settings, Onboarding, HerdrView, Terminals, ShellTab, MeetingsHome, MeetingPage, Dictations, WhiteboardsHome, WhiteboardPage, StudioHome, StudioPage, Explorer, UsageStats, preloadViews } from './lazy.jsx'
import Home from './components/Home.jsx'
import { FirstRunAnswers } from './components/FirstRun.jsx'
import { MeetingsProvider, RecordingPill, CallPrompt, useMeetings } from './components/meetings/recording.jsx'
import { memoryTab } from './components/memory/open.js'
import { openLink } from './pwa.js'
import NewAgent from './components/NewAgent.jsx'
import AddAccount from './components/AddAccount.jsx'
import History from './components/History.jsx'
import { RoutineDialog } from './components/Routines.jsx'
import UpdateChip, { withApp } from './components/UpdateChip.jsx'
import RestartChip from './components/RestartChip.jsx'
import SetupChip from './components/SetupChip.jsx'
import TopNotes, { useUpdateNote, FreshChip } from './components/TopNotes.jsx'
import { useFresh, oldApp } from './fresh.js'
import RuntimeNotice from './components/RuntimeNotice.jsx'
import { CHANNEL, nameOf, popOut, tell } from './components/Solo.jsx'
import Palette from './components/Palette.jsx'
import Tour from './components/Tour.jsx'
import { NextMeetingChip } from './components/Agenda.jsx'
import { TodayTabs, TodayBody, openToday } from './components/Dock.jsx'
import { mailDo } from './components/today.js'
import { Handle, usePersisted, useMedia, useHotkey, useWidth, useShared, store } from './components/layout.jsx'
import { api, useFleet, usePoll, relayActivity, cloudOnly, refetch, viaRelay, machineId } from './api.js'
import { takeReturn } from './permissions.js'
import { takeEarlyLink } from './earlyLink.js'
import CloudHome from './components/CloudHome.jsx'
import SessionSwitcher from './components/Sessions.jsx'
import { MachineMenu, AskBanner, SwitchedHere, useMachines, goMachine, isRemote, remoteOf, openRemote, useAsksIn } from './components/Machines.jsx'
import { useNeedsYou, NeedsYouChip, NeedsYouPanel, waitingOn, quietPanes } from './components/NeedsYou.jsx'
import { isQuiet } from '../shared/focus.js'
import AgentMap from './components/AgentMap.jsx'
import NeedsHome, { Everything, useHome, needCount, editHome } from './components/NeedsHome.jsx'
import More from './components/More.jsx'
import RemoteAgent from './components/RemoteAgent.jsx'
import Dictation from './dictation/Dictation.jsx'
import BackForward from './components/BackForward.jsx'
import { start as navStart, stop as navStop, seen as navSeen, recheck as navRecheck, usePlaces, placeOf, placeLabel, showPlaceIn, replacedWith, renamedTab, slotOf } from './backForward.js'
import { t, tn, tx } from './i18n/index.js'

const MIN_PANE = 420
const TOUR_ON_START = false
const MIN_WORK = 620
const LAYOUT = { railW: 232, railOpen: true, dockW: 380, dockMin: false, boardH: 280, boardMin: false, sideW: 560, max: null }
const WS = { tabs: [], active: null, side: null, split: false, group: 'main' }

// Your own tab groups and pinned tabs (TabStrip.jsx), kept with the window's tabs as their colors
// are: tabGroups is { key: { name, tabs } }, a group's color and whether it's folded kept by its key
// (colors, folded) as a space's are; pinned is the pinned tabs' ids. A group goes with its last tab
// (its color and fold too), and a tab closed is no longer pinned.
function tidyTabs(w) {
  const open = new Set(w.tabs)
  const was = w.tabGroups || {}
  const tabGroups = {}
  for (const [k, g] of Object.entries(was)) {
    const tabs = (g?.tabs || []).filter((id) => open.has(id))
    if (tabs.length) tabGroups[k] = tabs.length === g.tabs.length ? g : { ...g, tabs }
  }
  const pinned = (w.pinned || []).filter((id) => open.has(id))
  const gone = Object.keys(was).filter((k) => !tabGroups[k])
  if (!gone.length && Object.keys(tabGroups).every((k) => tabGroups[k] === was[k]) && pinned.length === (w.pinned || []).length) return w
  const colors = { ...(w.colors || {}) }, folded = { ...(w.folded || {}) }
  for (const k of gone) { delete colors[k]; delete folded[k] }
  return { ...w, tabGroups, pinned, colors, folded }
}
const outOfGroups = (groups, id) => Object.fromEntries(Object.entries(groups || {}).map(([k, g]) => [k, g?.tabs?.includes(id) ? { ...g, tabs: g.tabs.filter((x) => x !== id) } : g]))
// A tab into one of your groups (made, if it's a new one), at its end as in Chrome, or where it is
// (keep: dropped there); or, key null, out of its group. A pinned tab is unpinned.
function inGroup(w, id, key, keep = false) {
  if (!w.tabs.includes(id)) return w
  const tabGroups = outOfGroups(w.tabGroups, id)
  const tabs = [...w.tabs]
  if (key) {
    const g = { name: '', ...tabGroups[key], tabs: tabGroups[key]?.tabs || [] }
    const last = tabs.filter((x) => g.tabs.includes(x)).pop()
    if (last && !keep) { tabs.splice(tabs.indexOf(id), 1); tabs.splice(tabs.indexOf(last) + 1, 0, id) }
    tabGroups[key] = { ...g, tabs: [...g.tabs, id] }
  }
  return tidyTabs({ ...w, tabs, tabGroups, pinned: (w.pinned || []).filter((x) => x !== id) })
}
// Pinned: to the end of the pinned tabs, out of its group; unpinned, to just after them (Chrome's way).
function pinTab(w, id, on) {
  if (!w.tabs.includes(id)) return w
  const pinned = (w.pinned || []).filter((x) => x !== id && w.tabs.includes(x))
  const tabs = w.tabs.filter((x) => x !== id)
  tabs.splice(tabs.reduce((n, x, i) => (pinned.includes(x) ? i + 1 : n), 0), 0, id)
  return tidyTabs({ ...w, tabs, pinned: on ? [...pinned, id] : pinned, tabGroups: on ? outOfGroups(w.tabGroups, id) : w.tabGroups })
}
// One tab taking another's place (a meeting in Meetings' tab, a whiteboard renamed): it's the same
// tab, so it stays in its group, pinned and in its color.
function follow(w, from, to) {
  if (!w.tabGroups && !w.pinned && !w.colors?.[from]) return w
  const colors = { ...(w.colors || {}) }
  if (from in colors) { colors[to] = colors[from]; delete colors[from] }
  const swap = (x) => (x === from ? to : x)
  return { ...w, colors, pinned: (w.pinned || []).map(swap), tabGroups: Object.fromEntries(Object.entries(w.tabGroups || {}).map(([k, g]) => [k, g?.tabs?.includes(from) ? { ...g, tabs: g.tabs.map(swap) } : g])) }
}

function useRuntimeTheme() {
  useEffect(() => {
    api('/runtime-theme').then((t) => {
      const root = document.documentElement.style
      // (Badges are white on --needs-fill: a shade of it dark enough to read.)
      if (t.red) { root.setProperty('--needs', t.red); if (fillFor(t.red).on === '#ffffff') root.setProperty('--needs-fill', fillFor(t.red).fill) }
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

// The iPhone or Android app this page is in, when it's older than this page needs (src/fresh.js).
const appTooOld = oldApp()

// Whether this window has shown Bridge AI before: a reload, or a switch to another of your computers
// (which loads that computer's page in the same window). Kept for the window's life alone, so a new
// window (the app opening) starts afresh.
const openedBefore = (() => { try { const was = sessionStorage.getItem('cc-opened') === '1'; sessionStorage.setItem('cc-opened', '1'); return was } catch { return false } })()

// The phone apps' way back to their start screen, from the phone's Cloud agents (cloudOnly).
const toStart = !cloudOnly ? null : window.bridgeAndroid?.home ? () => window.bridgeAndroid.home()
  : window.bridgeNative?.post ? () => window.bridgeNative.post({ type: 'home' }) : null

// The top bar never squeezes, cuts off or wraps what's in it. It has three places that are always
// there: which computer, search, and what's happening now (what needs you, a recording or the
// meeting on now, the next meeting); usage, setup, updates, a restart to apply, sounds, the weather
// and the clock are in the Status menu (StatusMenu.jsx), and each of those that's pinned
// (src/pins.js: all but sounds, unless you change it) shows in the bar too while there's room. When
// it doesn't all fit (a laptop's screen, a busy day), the bar gives way a step at a time, least
// needed first: the time, then the weather (the menu bar and Status have both); the pinned chips'
// words (Update, Restart to apply, usage's account), so each is its icon and value; then their long
// values (which limit usage's figure is, setup's how far it is); the next meeting's title; the word
// Status; the Bridge and Herdr tabs' words; then the other pinned chips themselves, one at a time:
// setup, sounds, a restart to apply, usage, the update and Updated (the news among them then
// counted on the Status button; all of them still in its menu); the recording's title, the words
// after what's waiting, the next meeting (in the Status menu too), the computer's name, and last the
// search's width. Each step is a class on the bar (fit-1 to fit-18, styles.css). The search's words
// are picked after: whole, shorter, or none, never cut off.
//
// It's tried again whenever anything in the bar changes size, not only the bar: text that grows
// while the bar stays the same (a font arriving after the first try, a font or text size picked in
// Appearance) once left chips past the window's edge until something else in the bar changed.
const FIT_STEPS = 18
// The bar's pinned news chips, counted on the Status button while out of the bar. Unpinned ones
// aren't counted: you chose to see them in Status alone.
const FOLDS = '.top-x[data-fold]'
function useFit(onFold) {
  const stop = useRef(null)
  const told = useRef(onFold)
  told.current = onFold
  return useCallback((bar) => {
    stop.current?.()
    stop.current = null
    if (!bar || typeof ResizeObserver !== 'function') return
    let frame = 0
    const over = () => bar.scrollWidth > bar.clientWidth
    const fit = () => {
      frame = 0
      for (let i = 1; i <= FIT_STEPS; i++) bar.classList.remove(`fit-${i}`)
      for (let i = 1; i <= FIT_STEPS && over(); i++) bar.classList.add(`fit-${i}`)
      const search = bar.querySelector('.search-btn')
      if (search) {
        search.classList.remove('s-short', 's-none')
        if (search.scrollWidth > search.clientWidth) search.classList.add('s-short')
        if (search.scrollWidth > search.clientWidth) search.classList.add('s-none')
      }
      told.current?.([...bar.querySelectorAll(FOLDS)].filter((x) => x.firstElementChild && getComputedStyle(x).display === 'none').map((x) => x.dataset.fold).join(','))
    }
    const soon = () => { if (!frame) frame = requestAnimationFrame(fit) }
    // Each thing in the bar as well as the bar, so one that grows is seen as soon as it does.
    const size = new ResizeObserver(soon)
    const watch = () => { size.disconnect(); size.observe(bar); for (const el of bar.querySelectorAll('.top-left > *, .top-right > *, .top-x > *, .search-btn')) size.observe(el) }
    watch()
    fit()
    const words = new MutationObserver((list) => { if (list.some((m) => m.type === 'childList')) watch(); soon() })
    words.observe(bar, { childList: true, subtree: true, characterData: true })
    document.fonts?.addEventListener?.('loadingdone', soon)
    stop.current = () => { cancelAnimationFrame(frame); size.disconnect(); words.disconnect(); document.fonts?.removeEventListener?.('loadingdone', soon) }
  }, [])
}

// Views that open in tabs beside the agents: Home (start something new), Meetings, a meeting,
// Dictations, Whiteboards and a whiteboard, and the agent map (what runs on which of your computers).
// With Home on (a trial): Home (what needs you, NeedsHome.jsx) and Everything.
const VIEWS = { 'view:home': { title: tx('Home'), icon: 'home' }, 'view:everything': { title: tx('Everything'), icon: 'grid' }, 'view:new': { title: tx('New'), icon: 'plus' }, 'view:meetings': { title: tx('Meetings'), icon: 'mic' }, 'view:dictations': { title: tx('Dictations'), icon: 'wave' }, 'view:whiteboards': { title: tx('Whiteboards'), icon: 'shapes' }, 'view:studio': { title: tx('Studio'), icon: 'layers' }, 'view:files': { title: tx('Files'), icon: 'folder' }, 'view:map': { title: tx('Agent Map'), icon: 'grid' } }
// A whiteboard's tab is named as the board is (its id).
const BOARD = 'view:whiteboard:'
// A Studio file's tab: its root (an agent's pane, or place:<id>) and path, each encoded. A
// whiteboard in Studio's Preview is root board, its name the path.
// A beta feature's tab, left open from before it was turned off (or opened on another computer
// where it's on): says so, with the way to turn it on.
function TrialOff({ name }) {
  return (
    <div className="trial-off" role="status">
      <Icon name="layers" size={20} />
      <b>{t('{name} is a beta feature, off here.', { name })}</b>
      <p className="muted small">{t('Turn it on in Settings › About & Updates › Beta Features.')}</p>
      <button type="button" className="btn small" onClick={() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'about' } }))}>{t('Open Settings')}</button>
    </div>
  )
}
const STUDIO = 'view:studio:'
const studioId = (f) => `${STUDIO}${encodeURIComponent(f.root)}:${encodeURIComponent(f.path)}`
const studioOf = (id) => { const [r, p] = id.slice(STUDIO.length).split(':'); return { root: decodeURIComponent(r || ''), path: decodeURIComponent(p || '') } }
const isView = (id) => typeof id === 'string' && id.startsWith('view:')
// Typing in a Studio document, where ⌘K is a link and ⌘, subscript, as in Google Docs and Word.
const writingDoc = (e) => !!e.target?.closest?.('.sd-doc .ProseMirror')

// Memory had a tab of its own, and a row in the phone's More, through 3.13; it's a tab of Meetings
// and of Dictations now. What a window kept from then, before anything shows: Meetings in Memory's tab
// (or Meetings' own, when that was open too), at Memory, all of it, as the page showed.
const MEMORY = 'view:memory'
function memoryMoved() {
  let shown = false
  const move = (w, here) => {
    if (!w?.tabs?.includes(MEMORY)) return w
    if (here) shown ||= w.active === MEMORY || w.side === MEMORY || !w.tabs.includes('view:meetings')
    const to = (id) => (id === MEMORY ? 'view:meetings' : id)
    if (!w.tabs.includes('view:meetings')) return { ...w, tabs: w.tabs.map(to), active: to(w.active), side: to(w.side) }
    const active = to(w.active)
    const side = to(w.side) === active ? null : to(w.side)
    return { ...w, tabs: w.tabs.filter((id) => id !== MEMORY), active, side, split: !!w.split && !!side }
  }
  const ws = store.get('cc-ws', null)
  if (ws?.tabs?.includes(MEMORY)) store.set('cc-ws', move(ws, true))
  const bySession = store.get('cc-ws-sessions', null)
  if (bySession && Object.values(bySession).some((w) => w?.tabs?.includes(MEMORY))) store.set('cc-ws-sessions', Object.fromEntries(Object.entries(bySession).map(([k, w]) => [k, move(w)])))
  if (store.get('cc-more-view', null) === MEMORY) {
    store.set('cc-more-view', null)
    if (store.get('cc-mtab', null) === 'more') { store.set('cc-mtab', 'meetings'); shown = true }
  }
  if (shown) memoryTab({ all: true })
}
memoryMoved()

// The recording of a meeting lives above everything else, so it goes on while you move around.
export default function Root() {
  return <MeetingsProvider><App /></MeetingsProvider>
}

function App() {
  const { fleet, live } = useFleet()
  // The phone's Cloud agents keep the phone layout on any screen.
  const wide = useMedia('(min-width: 900px)') && !cloudOnly
  // The page under the banner asking to keep a new device or allow a link is shown once that banner
  // has its first answer, so the two come together and nothing moves under your finger after.
  const asksIn = useAsksIn()
  const untilAsks = asksIn ? undefined : { visibility: 'hidden' }
  const [savedView, setView] = usePersisted('cc-view', 'command')
  // The live herdr view exists only when herdr is the runtime (see server/runtime).
  const confPoll = usePoll('/config', 10 * 60 * 1000)
  const conf = confPoll.data
  // Studio is a beta feature (src/trials.js): out of sight until it's turned on.
  const studioOn = conf?.trials?.studio === true
  // Meeting Insights and People, tabs of Meetings (a beta feature): ⌘K opens Meetings at either.
  const insightsOn = conf?.trials?.['meeting-insights'] === true
  const studioOnRef = useRef(studioOn)
  studioOnRef.current = studioOn
  // Files, every folder on your computers as Finder shows them (a beta feature too).
  const filesOn = conf?.trials?.files === true
  // So is Home: with it on, it's where the app opens, and what needs you opens there.
  const homeOn = conf?.trials?.home === true
  const routinesOn = conf?.trials?.routines === true
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
  const [settings, setSettings] = useState(null) // null = closed, else where it opens: 'all' (Settings itself) or a section
  const [L, setL] = usePersisted('cc-layout', LAYOUT)
  const [W, setW] = usePersisted('cc-ws', WS)
  const [primary] = useShared('cc-primary', 'claude')
  const [todayTab, setTodayTab] = useShared('cc-today-tab', 'overview')
  const [mtab, setMtab] = usePersisted('cc-mtab', 'mate')
  const [mobileAgent, setMobileAgent] = useState(null)
  const [mobileMeeting, setMobileMeeting] = useState(null) // the meeting open in the phone's Meetings tab
  // What the phone's More tab shows: its list (null), Terminals ('terminals'), or a view (Whiteboards,
  // a whiteboard, the agent map, Dictations). Kept, as a computer keeps its tabs, so a reload comes
  // back to it. Terminals had a tab of its own until 3.8.3 (Memory a row, through 3.13: memoryMoved).
  const [moreView, setMoreView] = usePersisted('cc-more-view', null)
  useEffect(() => { if (mtab === 'herdr') { setMtab('more'); setMoreView('terminals') } }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [homeView, setHomeView] = useState('home') // the phone's Home tab: Home, or Everything
  // With Home on, the phone's Today is in More (Home has what's coming up); off, Home's tab goes.
  useEffect(() => {
    if (!conf) return
    if (homeOn && mtab === 'today') { setMtab('more'); setMoreView('today') }
    if (!homeOn && mtab === 'home') setMtab('mate')
  }, [homeOn, mtab, conf]) // eslint-disable-line react-hooks/exhaustive-deps
  const [mateId, setMateId] = useState(null) // the phone's Chief tab: which thread it shows
  const [palette, setPalette] = useState(false)
  const [newAgent, setNewAgent] = useState(null) // null = closed, {} = open with defaults
  const [history, setHistory] = useState(false) // search every conversation, closed agents
  const [routineDraft, setRoutineDraft] = useState(null) // the New Routine dialog, filled in (Routines.jsx makeRoutine)
  const [addAcct, setAddAcct] = useState(null) // the Add another account dialog: { kind, account }
  const [tour, setTour] = useState(false)
  const [toured, setToured] = usePersisted('cc-toured', {}) // { desktop, phone }: seen on this device
  const [cmdRef, cmdW] = useWidth()
  const [rowRef, rowW] = useWidth()
  const quota = usePoll('/quota', 5 * 60 * 1000)
  const updates = usePoll('/updates', 6 * 60 * 60 * 1000)
  // The desktop app this window is in counts too: it can be behind the server it shows.
  const update = { ...updates, data: withApp(updates.data) }
  const upNote = useUpdateNote(update.data)
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
    if (id.startsWith(BOARD)) return { paneId: id, view: true, title: id.slice(BOARD.length), icon: 'shapes' }
    if (id.startsWith(STUDIO)) return { paneId: id, view: true, title: studioOf(id).path.split('/').pop(), icon: studioOf(id).root === 'board' ? 'shapes' : 'layers' }
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
    // name: what that device's sidebar calls it (its tab's name; older devices send only a title).
    return { paneId: id, remote: r, title: live?.name || live?.title || info.title || t('Agent'), device: d?.name || info.device || '', kind: live?.kind || info.kind, status: live?.status || (d && !d.online ? 'unknown' : info.status || 'unknown') }
  })
  const byId = Object.fromEntries([...shellTabs, ...agents, ...views, ...remotes].map((a) => [a.paneId, a]))
  // The chief of staff: Main, of its threads (each thread is a chief of its own).
  const mate = agents.find((a) => a.chief && a.thread?.main) || agents.find((a) => a.chief)
  const mateShown = byId[mateId]?.chief ? byId[mateId] : mate
  // The needs-you inbox: what waits on you on every device (NeedsYou.jsx). The chip counts this
  // window's agents waiting from its live feed, and the other devices' from the inbox; neither
  // counts one whose wait has gone quiet (shared/focus.js), which the inbox and Home fold away.
  // inbox: null when closed, else { focus }.
  const [inbox, setInbox] = useState(null)
  const ny = useNeedsYou({ fleet, open: !!inbox, on: !cloudOnly })
  const hushed = quietPanes(ny.data, machineId || null)
  const needsYou = agents.filter((a) => a.status === 'blocked' && !hushed.has(a.paneId))
  const waiting = waitingOn(ny.data, { here: needsYou.length, shown: machineId || null })
  // The computer this window shows: one computer's work at a time. The chip, the sidebar and the
  // phone's tab count what waits on you here (with Home on, its count: Chief of Staff's tasks too);
  // the devices menu's chip counts the rest, so the two add up to the window's title (and the Dock's
  // badge, which is the title's).
  const toReview = (ny.data?.items || []).filter((i) => (i.type === 'review' || i.type === 'failed') && i.online && (i.machine || null) === (machineId || null) && !isQuiet(i)).length
  const homeCount = useHome(homeOn && !cloudOnly, 12000)
  const homeNeeds = homeOn && homeCount.data ? needCount(homeCount.data) : null
  // And what other apps ask of you here (Bridge AI as an MCP Server), on this computer's window.
  const needN = homeNeeds ? homeNeeds.here : needsYou.length + (machineId ? 0 : ny.data?.outside?.length || 0)
  const needElse = homeNeeds ? homeNeeds.elsewhere : waiting - needsYou.length

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
  // (Not while the herdr session is stopped: its tabs come back with it.) Only agents and shells that
  // are gone are closed: a view or another device's agent is there as long as its tab is, and this
  // render's byId can be a moment old (one opened just as the fleet came in isn't in it yet).
  useEffect(() => {
    if (!fleet || fleet.down) return
    setW((w) => {
      const open = (id) => isView(id) || isRemote(id) || !!byId[id]
      const tabs = w.tabs.filter(open)
      if (!tabs.length && mate) return tidyTabs({ ...w, tabs: [mate.paneId], active: mate.paneId, side: null, split: false })
      const active = open(w.active) ? w.active : tabs[0] || null
      const side = open(w.side) ? w.side : null
      return tabs.length === w.tabs.length && active === w.active && side === w.side ? w : tidyTabs({ ...w, tabs, active, side })
    })
  }, [fleet]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const a of agents) {
      const before = prevStatus.current[a.paneId]
      // In the Mac app, Bridge itself posts these (so they work while the window is hidden).
      if (before && before !== a.status && (a.status === 'blocked' || a.status === 'done') && document.hidden && !window.bridgeApp && !a.muted &&
        'Notification' in window && Notification.permission === 'granted') {
        const name = a.title || a.workspace
        const show = (q) => {
          const n = new Notification(a.status === 'blocked' ? (q?.text ? t('{name} needs you', { name }) : t('Agent needs you')) : t('Agent finished'), { body: q?.text || name, tag: a.paneId, silent: conf?.alertSounds === false })
          n.onclick = () => { window.focus(); if (a.status === 'blocked') showChat(a.paneId); openAgentRef.current?.(a.paneId); n.close() }
        }
        // Say what it's asking.
        if (a.status === 'blocked') api(`/agents/${encodeURIComponent(a.paneId)}/question`).then(show, () => show(null))
        else show(null)
      }
      prevStatus.current[a.paneId] = a.status
    }
  }, [fleet]) // eslint-disable-line react-hooks/exhaustive-deps

  // The window's title counts what waits on you, on every device, and with other computers linked,
  // says which one this window shows: the Dock and the Window menu list each window by it.
  const { data: macs } = useMachines(60_000, !cloudOnly)
  const shownName = !macs?.machines?.length ? null : machineId ? macs.machines.find((x) => x.id === machineId)?.name : macs.here?.name
  const allNeeds = needN + needElse
  useEffect(() => { document.title = `${allNeeds ? `(${allNeeds}) ` : ''}Bridge AI${shownName ? ` · ${shownName}` : ''}` }, [allNeeds, shownName])
  // A notification about an agent that needs you (pwa.js openLink, ?inbox=1): the inbox, at it.
  useEffect(() => {
    if (cloudOnly) return
    // The agent is the sending computer's: the one this page comes from.
    const on = (e) => setInbox({ focus: e.detail?.paneId ? { paneId: e.detail.paneId, machine: e.detail.machine || null } : null })
    window.addEventListener('bridge-needs-you', on)
    return () => window.removeEventListener('bridge-needs-you', on)
  }, [])

  // In the phone apps: the agents at work, for the lock screen. One whose turn is over while its
  // subagents still work is at work.
  useEffect(() => {
    // With the herdr session: another session's agents left the view, they didn't finish.
    if (relayActivity && fleet && !fleet.down) relayActivity(agents.map((a) => ({ id: a.paneId, name: nameOf(a), status: a.subagents?.running && (a.status === 'done' || a.status === 'idle') ? 'working' : a.status })), { session: fleet.session || null })
  }, [fleet]) // eslint-disable-line react-hooks/exhaustive-deps

  // replace: the chief's thread bar shows another thread in the same tab.
  const openAgent = useCallback((paneId, { toSide = false, replace = null } = {}) => {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
    // Memory is a tab of Meetings and of Dictations, no longer a page of its own: ⌘K's Memory,
    // Settings › Voice & Meetings' Open Memory and anything else that still asks for view:memory get
    // Meetings at Memory, all of it, as the page showed.
    if (paneId === MEMORY) { memoryTab({ all: true }); paneId = 'view:meetings' }
    setView('command')
    // Not on a phone, or in the phone apps (their page holds this one): there, that device is shown.
    if (isRemote(paneId) && (!wide || viaRelay)) { const r = remoteOf(paneId); goMachine(r.machine, { agent: r.pane, back: byId[paneId]?.title || true }); return }
    if (!wide) {
      const a = byId[paneId]
      // On the phone's Cloud agents, Back (Android's) closes the agent first.
      if (cloudOnly && paneId !== mobileAgent) { if (window.history.state?.agent) window.history.replaceState({ agent: paneId }, ''); else window.history.pushState({ agent: paneId }, '') }
      // Meetings, a meeting and Dictations open in the phone's own Meetings tab; Whiteboards and a
      // whiteboard in its More tab.
      if (typeof paneId === 'string' && (paneId.startsWith('view:meeting') || paneId === 'view:dictations')) { setMtab('meetings'); setMobileMeeting(paneId === 'view:meetings' ? null : paneId); return }
      if (typeof paneId === 'string' && (paneId.startsWith('view:whiteboard') || paneId.startsWith('view:studio') || paneId === 'view:files')) { setMtab('more'); setMoreView(paneId); return }
      if (paneId === 'view:home' || paneId === 'view:everything') { setMtab('home'); setHomeView(paneId === 'view:home' ? 'home' : 'everything'); return }
      if (a?.chief) { setMtab('mate'); setMobileAgent(null); setMateId(paneId) } else { setMtab('agents'); setMobileAgent(paneId) }
      return
    }
    // Back from it shows the one it replaced in that tab again (src/backForward.js); not Home's New,
    // which an agent started there takes for good.
    if (replace && replace !== 'view:new' && wsRef.current.tabs.includes(replace) && !wsRef.current.tabs.includes(paneId)) replacedWith(replace, paneId)
    setW((w) => {
      // In the tab it replaces: where that one was, or, when that one was behind another (a meeting
      // opened from Dictations' Memory while Meetings waits in a tab), to the front as any tab opened is.
      if (replace && w.tabs.includes(replace) && !w.tabs.includes(paneId)) {
        const tabs = w.tabs.map((t) => (t === replace ? paneId : t))
        w = follow(w, replace, paneId)
        if (w.active === replace || w.side === replace) return { ...w, tabs, active: w.active === replace ? paneId : w.active, side: w.side === replace ? paneId : w.side }
        w = { ...w, tabs }
      }
      const tabs = w.tabs.includes(paneId) ? w.tabs : [...w.tabs, paneId]
      if (toSide || (w.split && w.group === 'side')) return { ...w, tabs, side: paneId, split: true, group: 'side' }
      if (w.split && w.side === paneId) return { ...w, tabs, group: 'side' }
      return { ...w, tabs, active: paneId, group: 'main' }
    })
    setL((l) => (l.max ? { ...l, max: null } : l))
  }, [wide, fleet, mobileAgent]) // eslint-disable-line react-hooks/exhaustive-deps
  // An agent wherever it runs (the needs-you inbox, Home, the agent map): here, on the device this
  // window shows; or in a tab here for one elsewhere (the device this page comes from too, while it
  // shows another), so what you're doing here stays. chat: at its Chat, where a question's card is.
  const shownHere = (machine) => (machine || null) === (machineId || null)
  const openOn = (machine, paneId, { device, title, kind, chat = false } = {}) => {
    if (shownHere(machine)) { if (chat) showChat(paneId); openAgent(paneId) }
    else openRemote({ id: machine || null, name: device }, { paneId, title, kind })
  }
  const openItem = (it) => { setInbox(null); openOn(it.machine, it.paneId, { device: it.device, title: it.agent?.title, kind: it.agent?.kind, chat: true }) }
  // The map opens full size on a computer (Esc, or its own button, puts the rest back).
  const openMap = () => { openAgent('view:map'); if (wide) set({ max: W.split && W.group === 'side' ? 'side' : 'main' }) }
  const openMapRef = useRef(null)
  openMapRef.current = openMap
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
  const openFilesRef = useRef(null)
  const startChiefRef = useRef(null)
  const wideRef = useRef(wide)
  useEffect(() => {
    // "chief" (the home-screen shortcut) means whichever agent is the chief of staff.
    const on = (e) => {
      let id = e.detail?.paneId
      // An agent on another of your devices: in a tab here (remembering what to call it).
      if (isRemote(id) && e.detail.remote) setRemoteInfo((m) => ({ ...Object.fromEntries(Object.entries(m).filter(([k]) => wsRef.current?.tabs.includes(k))), [id]: e.detail.remote }))
      if (id === 'chief') {
        const all = fleetRef.current?.agents || []
        id = (all.find((a) => a.chief && a.thread?.main) || all.find((a) => a.chief))?.paneId
        // No chief running: on a phone, its Chief tab, which offers to start one; on a computer it's
        // started, as the sidebar's Chief of Staff row does, and opens at its Chat, where its tasks
        // are (Home's Open on one of them, here or switched to from another computer).
        if (!id) { if (wideRef.current) startChiefRef.current?.(); else setMtab('mate'); return }
      }
      if (!id) return
      if (id === 'view:map') { openMapRef.current?.(); return }
      // From a "needs you" notification: at its Chat, where the question card is. From a finished
      // one about a video it made: its Files, at the video.
      if (e.detail.view === 'files') return openFilesRef.current?.(id, e.detail.path || undefined)
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
  // Dictations, from the sidebar's list (with one to open) or anywhere else.
  useEffect(() => {
    const on = () => openAgentRef.current?.('view:dictations')
    window.addEventListener('bridge-open-dictations', on)
    return () => window.removeEventListener('bridge-open-dictations', on)
  }, [])
  // A whiteboard opened from anywhere (the list, a chat's Mermaid, a renamed board taking its tab).
  // One renamed in the list keeps its tab, if it has one open, under the new name.
  useEffect(() => {
    const on = (e) => {
      const d = e.detail || {}
      if (d.id) openAgentRef.current?.(`${BOARD}${d.id}`, { replace: d.replace || (wsRef.current?.tabs.includes('view:whiteboards') ? 'view:whiteboards' : null) })
      else if (d.list) openAgentRef.current?.('view:whiteboards', { replace: d.replace || null })
      else if (d.renamed) {
        const from = `${BOARD}${d.renamed.from}`, to = `${BOARD}${d.renamed.to}`
        renamedTab(from, to)
        setW((w) => (!w.tabs.includes(from) || w.tabs.includes(to) ? w : { ...follow(w, from, to), tabs: w.tabs.map((x) => (x === from ? to : x)), active: w.active === from ? to : w.active, side: w.side === from ? to : w.side }))
      }
    }
    window.addEventListener('bridge-open-board', on)
    return () => window.removeEventListener('bridge-open-board', on)
  }, [])
  // A file opened in Studio from anywhere (Files, a chat's link), or Studio itself.
  useEffect(() => {
    const on = (e) => {
      if (!studioOnRef.current) return
      const d = e.detail || {}
      if (d.root && d.path) openAgentRef.current?.(studioId(d), { replace: wsRef.current?.tabs.includes('view:studio') ? 'view:studio' : null })
      else openAgentRef.current?.('view:studio')
    }
    window.addEventListener('bridge-open-studio', on)
    return () => window.removeEventListener('bridge-open-studio', on)
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
    const on = (e) => setSettings(e.detail?.section || 'all')
    window.addEventListener('bridge-open-settings', on)
    return () => window.removeEventListener('bridge-open-settings', on)
  }, [])
  // Back from a restart to apply a permission: Settings where it was asked for, to see it's on (the
  // agent you had open comes back by itself).
  useEffect(() => { const r = takeReturn(); if (r?.section) setSettings(r.section) }, [])
  // A tester's early-access link (?early=<code>): About & Updates, with the code filled in.
  useEffect(() => { if (takeEarlyLink()) setSettings('about') }, [])
  // Restart to apply, asked for in Settings: the top bar's Restart to apply decides it (with what it
  // means for agents at work), so Settings steps aside for it rather than covering it.
  useEffect(() => {
    const on = () => setSettings(null)
    window.addEventListener('bridge-restart', on)
    return () => window.removeEventListener('bridge-restart', on)
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
  // Make a routine of a message you sent (its chat, History › Commands, a suggestion).
  useEffect(() => {
    const on = (e) => setRoutineDraft(e.detail || {})
    window.addEventListener('bridge-new-routine', on)
    return () => window.removeEventListener('bridge-new-routine', on)
  }, [])
  // A calendar event, with its prep (the floating card's Open prep, Home's Coming Up): Today ›
  // Calendar on its day, with it open.
  const showTodayRef = useRef(null)
  useEffect(() => {
    const on = (e) => { if (e.detail?.date) showTodayRef.current?.('calendar', { date: e.detail.date, event: e.detail.id || null }) }
    window.addEventListener('bridge-open-event', on)
    return () => window.removeEventListener('bridge-open-event', on)
  }, [])
  // Home on: a new window opens there (an agent a link names still comes after). A reload, or this
  // window switched to another of your computers and back, opens what you were on there instead:
  // each computer keeps its own tabs, layout and phone tab (layout.jsx), so Home only when there's
  // nothing to go back to. Nor once you've tapped, clicked or pressed a key here before the page's
  // first answers came: you've picked where you are (it used to take you to Home from there).
  const homed = useRef(false)
  const picked = useRef(false)
  useEffect(() => {
    const on = (e) => { if (e.isTrusted) picked.current = true }
    window.addEventListener('pointerdown', on, true)
    window.addEventListener('keydown', on, true)
    return () => { window.removeEventListener('pointerdown', on, true); window.removeEventListener('keydown', on, true) }
  }, [])
  useEffect(() => {
    if (homed.current || !fleet || !conf || cloudOnly) return
    homed.current = true
    if (!homeOn || picked.current) return
    const back = openedBefore && (wide ? !!W.active && (isView(W.active) || isRemote(W.active) || !!byId[W.active]) : store.get('cc-mtab', null) != null)
    if (back) return
    if (wide) { setW((w) => ({ ...w, tabs: w.tabs.includes('view:home') ? w.tabs : ['view:home', ...w.tabs], active: 'view:home', group: 'main' })); set({ max: 'main' }) }
    else { setMtab('home'); setHomeView('home') }
  }, [fleet, conf]) // eslint-disable-line react-hooks/exhaustive-deps
  // Opened from a notification link (?agent=... or ?card=...): go there once agents have loaded.
  const linked = useRef(false)
  useEffect(() => { if (fleet && !linked.current) { linked.current = true; openLink() } }, [fleet])

  // then: the tab to show in its place (the strip's next one, as in a browser), when it isn't already
  // on screen; else the first that isn't.
  const closeTab = (id, then = null) => setW((w) => {
    const tabs = w.tabs.filter((t) => t !== id)
    const free = (t) => t !== w.active && t !== w.side
    const next = (cur) => (cur === id ? (tabs.includes(then) && free(then) ? then : tabs.find(free)) || null : cur)
    let active = next(w.active)
    let side = next(w.side)
    if (!active && side) { active = side; side = null }
    return tidyTabs({ ...w, tabs, active, side, split: w.split && !!side })
  })

  const toggleSplit = () => setW((w) => {
    if (w.split) return { ...w, split: false, side: null, group: 'main' }
    const side = w.tabs.find((t) => t !== w.active) || null
    return { ...w, split: true, side, group: 'side' }
  })

  const openInHerdr = !liveView && wide ? undefined : async (id) => {
    const url = id.startsWith('tab:') ? `/tabs/${encodeURIComponent(id.slice(4))}/focus` : `/agents/${encodeURIComponent(id)}/focus`
    try { await api(url, { method: 'POST' }) } catch { /* still switch */ }
    if (!wide) { setMtab('more'); setMoreView('terminals'); return }
    setView('herdr')
  }

  // The phone's Today: its own tab, or in More with Home on.
  const phoneToday = () => { if (homeOn) { setMtab('more'); setMoreView('today') } else setMtab('today') }
  // The phone's Usage: a row of its own in More, Home on or off.
  const phoneUsage = () => { setMtab('more'); setMoreView('usage') }
  const showCard = (id) => {
    store.set(`cc-card-${id}`, true)
    setView('command')
    setTodayTab('overview')
    if (!wide) phoneToday()
    else set({ dockMin: false, todayOpen: true, max: L.max === 'dock' ? 'dock' : null })
    setTimeout(() => document.getElementById(`card-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80)
  }
  showCardRef.current = showCard

  // Open a Today tab full size (desktop) or in the phone's Today tab.
  const showToday = (tab, detail) => {
    setView('command')
    setTodayTab(tab)
    if (!wide) { if (tab === 'usage') phoneUsage(); else phoneToday() }
    else set({ dockMin: false, todayOpen: true, max: 'dock' })
    if (detail) setTimeout(() => openToday(tab, detail), 60)
  }
  showTodayRef.current = showToday

  // Open an agent (or shell tab) straight into its Files view, optionally at a file.
  const openFiles = (id, filePath) => {
    if (id.startsWith('tab:')) store.set(`cc-shell-view-${id.slice(4)}`, 'files')
    else {
      try { const v = JSON.parse(localStorage.getItem('cc-agent-views') || '{}'); localStorage.setItem('cc-agent-views', JSON.stringify({ ...v, [id]: 'files' })) } catch { /* private mode */ }
    }
    openAgent(id)
    setTimeout(() => window.dispatchEvent(new CustomEvent('cc-set-view', { detail: { paneId: id, view: 'files', path: filePath } })), 60)
  }
  openFilesRef.current = openFiles
  // A compare launch opens the second agent beside the first.
  // One started from a tab group's menu (New agent in group) goes in that group, while it's there.
  const onLaunched = (out) => {
    const into = newAgent?.group
    setNewAgent(null)
    if (out?.paneId) setTimeout(() => { openAgent(out.paneId); if (into) setW((w) => (w.tabGroups?.[into] ? inGroup(w, out.paneId, into) : w)); if (out.alsoPaneId) openAgent(out.alsoPaneId, { toSide: true }) }, 1200)
  }
  // Started from Home: the agent takes Home's tab, as the thread takes the new-thread page in T3.
  const fromHome = (out) => { if (out?.paneId) setTimeout(() => { if (wide) openAgent(out.paneId, { replace: 'view:new' }); else openAgent(out.paneId) }, 1200) }
  const openNew = () => openAgent('view:new')
  const queuedFor = (id) => fleet?.queue?.[id] || []
  const deliveredFor = (id) => fleet?.delivered?.[id] || []
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
  const startChief = async () => {
    try { const r = await api('/chief/launch', { method: 'POST' }); showChat(r.paneId); openAgent(r.paneId) } catch (e) { window.alert(t("Chief of Staff couldn't start: {why}", { why: e.message })) }
  }
  startChiefRef.current = startChief
  wideRef.current = wide
  const meetings = useMeetings()
  // The computer updated while this page was open: the new one loads by itself when nothing's under
  // way, or a line under the top bar says so with Reload (src/fresh.js).
  const fresh = useFresh({ hold: !!meetings?.rec })
  // ⌘K, but where something on the page has it for its own (a sheet's Insert link, as in Google
  // Sheets and Excel, or a document's link while you write in it): there the top bar's search opens
  // this. ⌘, likewise, but in a document, where it's subscript.
  useHotkey(useCallback((e) => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !writingDoc(e) && !e.target?.closest?.('[data-own-keys~="mod+k"]'), []), () => setPalette((p) => !p))
  useHotkey(useCallback((e) => (e.metaKey || e.ctrlKey) && e.key === ',' && !writingDoc(e), []), () => setSettings((v) => (v ? null : 'all')))
  useHotkey(useCallback((e) => (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f', []), () => setHistory((v) => !v))
  // ⌥1 and ⌥2 alone: with ⌘ (or Ctrl) they're a document's Heading 1 and 2, in Studio.
  useHotkey(useCallback((e) => e.altKey && !e.metaKey && !e.ctrlKey && (e.code === 'Digit1' || e.code === 'Digit2'), []), (e) => setView(e.code === 'Digit1' ? 'command' : 'herdr'))
  // (Not while something open says Esc is its own, data-esc: Mail's AI Assist, say; and an event
  // open in the calendar, or its menu, closes first: Escape is its, then the panel's.)
  useHotkey(useCallback((e) => e.key === 'Escape' && !e.target.closest?.('.xterm, textarea, input, .quick-open, .tour, .excalidraw, .find-bar') && !document.querySelector('[data-esc], .calv .cal-detail, .calv-menu'), []), () => set({ max: null }))

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

  const nextTheme = { system: 'dark', dark: 'light', light: 'system' }[theme]
  // Home and Everything open full size on a computer, as the map does (opening anything from them
  // puts the rest back).
  const openHome = () => { openAgent('view:home'); if (wide) set({ max: 'main' }) }
  const openEverything = () => { openAgent('view:everything'); if (wide) set({ max: 'main' }) }
  const meetingsTab = (tab) => { store.set('cc-meet-tab', tab); window.dispatchEvent(new CustomEvent('bridge-meetings-tab', { detail: { tab } })); openAgent('view:meetings') }
  const paletteActions = [
    homeOn && { id: 'a:homeview', label: t('Home'), icon: 'home', keywords: 'needs you waiting answer ready review coming up today next meeting tasks inbox start', run: openHome },
    homeOn && { id: 'a:everything', label: t('Everything'), icon: 'grid', keywords: 'all every item device computer meetings tasks whiteboards agents lanes', run: openEverything },
    homeOn && { id: 'a:edithome', label: t('Edit Home'), icon: 'edit', keywords: 'arrange reorder order move hide show sections layout customize organize home screen wiggle', run: () => { editHome(); openHome() } },
    { id: 'a:home', label: t('New…'), icon: 'plus', keywords: 'new thread start build project agent chat what should we build', run: openNew },
    { id: 'a:new', label: t('New agent with all the options…'), icon: 'bot', keywords: 'launch start claude codex gemini copilot opencode project dialog compare account', run: () => setNewAgent({ mode: 'project' }) },
    { id: 'a:record', label: t('Record a meeting'), icon: 'mic', keywords: 'meeting notes transcript record call granola minutes', run: () => meetings?.start().catch(() => openAgent('view:meetings')) },
    { id: 'a:meetings', label: t('Meetings'), icon: 'mic', keywords: 'meeting notes transcripts summaries', run: () => openAgent('view:meetings') },
    insightsOn && { id: 'a:insights', label: t('Meeting Insights'), icon: 'trend', keywords: 'meetings stats hours talk time share words week kind', run: () => meetingsTab('insights') },
    insightsOn && { id: 'a:people', label: t('People You Meet'), icon: 'users', keywords: 'people attendees contacts who met meetings together', run: () => meetingsTab('people') },
    { id: 'a:dictations', label: t('Dictations'), icon: 'wave', keywords: 'dictation history voice said typed pasted wispr macwhisper', run: () => openAgent('view:dictations') },
    { id: 'a:memory', label: t('Memory'), sub: t('In Meetings and Dictations'), icon: 'book', keywords: 'memory people organizations organisations companies projects products terms names words misheard about me about you persona context meeting memory', run: () => openAgent(MEMORY) },
    StudioHome && studioOn && { id: 'a:studio', label: t('Studio'), icon: 'layers', keywords: 'studio document word docx sheet excel xlsx spreadsheet deck slides powerpoint pptx pdf page html artifact markdown design pack', run: () => openAgent('view:studio') },
    Explorer && filesOn && { id: 'a:files', label: t('Files'), icon: 'folder', keywords: 'files finder explorer folders browse desktop documents downloads home drive disk icloud onedrive dropbox quick look get info', run: () => openAgent('view:files') },
    WhiteboardsHome && { id: 'a:boards', label: t('Whiteboards'), icon: 'shapes', keywords: 'whiteboard board excalidraw draw sketch diagram flowchart architecture sequence org chart mermaid drawio canvas', run: () => openAgent('view:whiteboards') },
    { id: 'a:map', label: t('Agent Map'), icon: 'grid', keywords: 'what is running where devices computers machines all agents overview cloud subagents', run: openMap },
    { id: 'a:needs', label: t('Needs You'), icon: 'bell', keywords: 'inbox waiting approve allow permission questions answer review finished failed devices', run: () => setInbox({}) },
    { id: 'a:history', label: t('Search history and closed agents…'), icon: 'clock', keywords: 'search find transcript conversation closed archived resume old past', run: () => setHistory(true) },
    { id: 'a:cloud', label: t('New cloud agent…'), icon: 'cloud', keywords: 'cursor copilot jules claude managed remote github repo pull request', run: () => setNewAgent({ mode: 'cloud' }) },
    { id: 'a:chat', label: t('New chat…'), icon: 'chat', keywords: 'plain vanilla talk ask claude codex gemini assistant', run: () => setNewAgent({ mode: 'chat' }) },
    !cloudOnly && newTerminal && { id: 'a:terminal', label: t('New terminal'), icon: 'terminal', keywords: 'shell command line console bash zsh brew npm run type commands', run: () => newTerminal() },
    { id: 'a:settings', label: t('Settings…'), icon: 'settings', hint: '⌘,', keywords: 'preferences name default agent model location runtime', run: () => setSettings('all') },
    { id: 'a:providers', label: t('Model Providers'), icon: 'layers', keywords: 'api key openai anthropic gemini openrouter bedrock vertex ollama lm studio', run: () => setSettings('providers') },
    { id: 'a:accounts', label: t('Accounts…'), icon: 'users', keywords: 'account switch work personal sign in login claude codex auto', run: () => setSettings('accounts') },
    { id: 'a:add-account', label: t('Add another account…'), icon: 'plus', keywords: 'account second work personal sign in login claude codex both two', run: () => setAddAcct({}) },
    { id: 'a:mcp', label: t('MCP Servers'), icon: 'tool', keywords: 'tools mcp github playwright', run: () => setSettings('mcp') },
    { id: 'a:config', label: t('Edit config file'), icon: 'braces', keywords: 'json config.json settings', run: () => setSettings('config') },
    // The chief of staff's one place in ⌘K (its Main thread isn't listed again among the agents).
    { id: 'a:mate', label: t('Chief of Staff'), sub: t('Hands work to the right agent'), status: mate?.status, icon: 'helm', keywords: 'chief staff dispatch route go to open start', run: () => (mate ? openAgent(mate.paneId) : mateLaunch.launch()) },
    wide && liveView && { id: 'a:view', label: view === 'herdr' ? t('Switch to Bridge view') : t('Switch to Herdr view'), icon: 'layers', hint: view === 'herdr' ? 'Alt 1' : 'Alt 2', run: () => setView(view === 'herdr' ? 'command' : 'herdr') },
    wide && { id: 'a:rail', label: L.railOpen ? t('Collapse sidebar') : t('Expand sidebar'), icon: 'panel-left', run: () => set({ railOpen: !L.railOpen }) },
    { id: 'a:appearance', label: t('Appearance…'), icon: 'palette', keywords: 'theme color colour dark light mode font text size density compact sidebar slack', run: () => setSettings('appearance') },
    wide && { id: 'a:topbar', label: t("Choose what's in the top bar…"), icon: 'pin', keywords: 'pin unpin top bar status menu weather temperature clock time usage update restart setup sounds', run: () => setSettings('topbar') },
    { id: 'a:theme', label: nextTheme === 'dark' ? t('Color mode: switch to dark') : nextTheme === 'light' ? t('Color mode: switch to light') : t('Color mode: switch to system'), icon: theme === 'dark' ? 'sun' : 'moon', keywords: 'dark light mode', run: () => setTheme(nextTheme) },
    { id: 'a:ideas', label: t('Add an idea'), icon: 'bulb', keywords: 'backlog todo', run: () => { showCard('bulb'); setTimeout(() => document.querySelector('.idea-add input')?.focus(), 250) } },
    conf?.calendar !== false && { id: 'a:cal', label: t('Open calendar'), icon: 'calendar', keywords: 'week month year schedule meetings', run: () => showToday('calendar') },
    conf?.mail && { id: 'a:mail', label: t('Open mail'), icon: 'mail', keywords: 'inbox email outlook needs you', run: () => showToday('mail') },
    conf?.mail && { id: 'a:triage', label: t('Triage my inbox with an agent'), icon: 'sparkle', keywords: 'mail email', run: async () => { try { const o = await api('/mail/triage', { method: 'POST' }); if (o.paneId) setTimeout(() => openAgent(o.paneId), 1200) } catch { showToday('mail') } } },
    // Mail's keys, taught here: each action with its key beside it. Mail is only where it can be read.
    wide && conf?.mail && { id: 'a:mail-done', label: t('Mail: Done'), icon: 'check', hint: 'E', keywords: 'mail email archive done finished mark inbox zero clear', run: () => { showToday('mail'); mailDo('done') } },
    wide && conf?.mail && { id: 'a:mail-later', label: t('Mail: Remind me…'), icon: 'clock', hint: 'H', keywords: 'mail email snooze later remind reminder set aside nobody answers follow up', run: () => { showToday('mail'); mailDo('later') } },
    wide && conf?.mail && { id: 'a:mail-reply', label: t('Mail: Draft a reply'), icon: 'wand', hint: 'R', keywords: 'mail email reply draft answer write respond voice tone schedule free times ai assist', run: () => { showToday('mail'); mailDo('reply') } },
    wide && conf?.mail && { id: 'a:mail-keys', label: t('Mail: every key'), icon: 'keyboard', hint: '?', keywords: 'mail email keys keyboard shortcuts hotkeys j k next previous', run: () => { showToday('mail'); mailDo('keys') } },
    { id: 'a:markets', label: t('Markets & news'), icon: 'trend', keywords: 'fed rates treasury mortgage stocks headlines tech', run: () => showToday('markets') },
    { id: 'a:routines', label: t('Show routines'), icon: 'repeat', run: () => showCard('repeat') },
    routinesOn && { id: 'a:new-routine', label: t('New routine…'), icon: 'repeat', keywords: 'schedule scheduled recurring repeat every day weekday week cron automation task later', run: () => setRoutineDraft({}) },
    // On a phone, both open More › Usage: plan usage first, then the stats.
    { id: 'a:usage', label: t('Show usage'), icon: 'gauge', keywords: 'quota tokens cost', run: () => (wide ? showCard('gauge') : phoneUsage()) },
    { id: 'a:stats', label: t('Usage stats and history'), icon: 'gauge', keywords: 'stats heatmap tokens cost models projects', run: () => (wide ? openToday('usage') : phoneUsage()) },
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
  // ...and which device it's on, for the dictation window's "the agent I looked at last": another
  // device's in a tab by this computer's id for it (none: this one), this window's own by the device
  // it shows.
  const shownA = byId[onScreen()] || null
  const looking = !shownA ? null : shownA.remote ? { machine: shownA.remote.machine, pane: shownA.remote.pane, name: shownA.title } : { machine: machineId, pane: shownA.paneId, name: agentName(shownA) }
  const overlays = (
    <>
      {!cloudOnly && <Dictation conf={conf?.dictation} onScreen={onScreen} looking={looking} />}
      {palette && <Palette fleet={fleet} activeId={wide ? W.active : mobileAgent} onClose={() => setPalette(false)} onOpen={openAgent} onOpenFile={openFiles} actions={actions} />}
      {settings && <Settings section={settings} onClose={closeSettings} onOpenAgent={openAgent} />}
      {(fleet?.agents || []).filter((a) => a.chief && a.setup).map((a) => <FirstRunAnswers key={a.paneId} agent={a} />)}
      <CallPrompt />
      {!cloudOnly && <Quiet name="Crash notice"><CrashNotice /></Quiet>}
      {inbox && !cloudOnly && <NeedsYouPanel data={ny.data} refresh={ny.refresh} phone={!wide} focus={inbox.focus} onClose={() => setInbox(null)} onOpen={openItem} />}
      {onboarding && <Onboarding onDone={(pane) => { setOnboarding(false); confPoll.refresh(); if (pane) setTimeout(() => openAgent(pane), 800); else openAgent('view:new') }} />}
      {newAgent && <NewAgent fleet={fleet} initial={newAgent} onClose={() => setNewAgent(null)} onLaunched={onLaunched} onAddAccount={(kind) => setAddAcct({ kind })} onCloudSettings={() => { setNewAgent(null); setSettings('cloud') }} />}
      {history && <History onClose={() => setHistory(false)} onOpen={(id, fresh) => (fresh ? setTimeout(() => openAgent(id), 1200) : openAgent(id))} commands={routinesOn} />}
      {routineDraft && routinesOn && <RoutineDialog initial={routineDraft} onClose={() => setRoutineDraft(null)} onShow={() => { setHistory(false); showCard('repeat') }} />}
      {addAcct && <AddAccount initial={addAcct} onClose={() => setAddAcct(null)} onOpenAgent={(id) => { setSettings(null); setNewAgent(null); openAgent(id) }}
        onStart={(kind, account) => { setAddAcct(null); setSettings(null); if (!newAgent) setNewAgent({ mode: 'project', kind, account }) }} />}
      {tour && !covered && <Tour key={device} phone={!wide} simple={simple} actionLabel={agents.some((a) => !a.chief) ? t('Start an agent') : t('Start your first agent')}
        onClose={endTour} onAction={() => { endTour(); setNewAgent({ mode: 'project' }) }} />}
    </>
  )

  // railBtn: the sidebar's collapse and expand, at the top left on a wide screen. On a phone the bar
  // keeps to what needs you now: an agent waiting, a recording, search and Settings. Usage, the
  // next meeting and the weather are in the Today tab (the phone shows the time itself); setup, a
  // restart to apply and an update are a line under the bar (TopNotes). An update you haven't looked
  // at yet puts a dot on Settings, which then opens at About & Updates.
  const setDot = !wide && !cloudOnly && upNote.dot
  const [folded, setFolded] = useState('') // the pinned news chips out of the bar for want of room: 'setup,update'
  const fitBar = useFit(setFolded)
  const foldedList = folded ? folded.split(',') : []
  const pins = usePins() // what's in the desktop's bar besides its three places (src/pins.js)
  const topbarFor = (railBtn = null) => (
    <>
    <header className="topbar" ref={wide ? fitBar : null}>
      <div className="top-left">
      <img className="mark" src={`${import.meta.env.BASE_URL}mark.svg`} alt="Bridge AI" width="24" height="24" />
      {railBtn}
      {wide && <BackForward />}
      {!cloudOnly && <Quiet name="Devices menu"><MachineMenu phone={!wide} elsewhere={homeNeeds || ny.data ? needElse : null} /></Quiet>}
      {wide && liveView && (
        <nav className="view-tabs" role="tablist" aria-label={t('View')}>
          <button role="tab" aria-selected={view === 'command'} className={view === 'command' ? 'on' : ''} onClick={() => setView('command')} title="Alt+1" aria-label="Bridge">
            <Icon name="helm" size={14} /><span className="vt-word">Bridge</span>
          </button>
          <button role="tab" aria-selected={view === 'herdr'} className={view === 'herdr' ? 'on' : ''} onClick={() => setView('herdr')} title="Alt+2" aria-label="Herdr">
            <Icon name="layers" size={14} /><span className="vt-word">Herdr</span>
          </button>
        </nav>
      )}
      </div>
      <button className="search-btn" data-tour="search" onClick={() => setPalette(true)} aria-label={t('Search and commands')} title={t('Search and commands (⌘K)')}>
        <Icon name="search" size={wide ? 15 : 18} /> <span className="s-long">{t('Search agents, files and commands')}</span><span className="s-short">{t('Search')}</span> <kbd className="hide-touch">⌘K</kbd>
      </button>
      <div className="top-right">
        <Quiet name="Recording"><RecordingPill /></Quiet>
        {/* What needs you opens Home when it's on, so the chip waits for the settings that say:
            clicked before they were in (just after a reload), it opened the inbox instead. */}
        {cloudOnly
          ? needsYou.length > 0 && (
            <button className="needs-chip" onClick={() => openAgent(needsYou[0].paneId)} aria-label={needsYou.length === 1 ? t('{n} needs you', { n: needsYou.length }) : t('{n} need you', { n: needsYou.length })}>
              <StatusDot status="blocked" size={8} /> {needsYou.length}<span className="needs-word"> {needsYou.length === 1 ? t('needs you') : t('need you')}</span>
            </button>
          )
          : conf && <NeedsYouChip count={needN} elsewhere={needElse} review={wide ? toReview : 0} open={!!inbox} onClick={() => (homeOn ? openHome() : setInbox(inbox ? null : {}))} />}
        {!cloudOnly && wide && (
          <>
            <Quiet name="Next meeting"><NextMeetingChip onClick={() => showCard('calendar')} recording={meetings?.rec?.title || null} /></Quiet>
            {/* What's pinned: in the bar while there's room, and in the Status menu always. The news
                (data-fold) is counted on the Status button while it has no room. */}
            <div className="top-extras">
              {pins.update && <div className="top-x x-fresh" data-fold="fresh"><Quiet name="Updated"><FreshChip fresh={fresh} /></Quiet></div>}
              {pins.setup && <div className="top-x x-setup" data-fold="setup"><Quiet name="Setting up"><SetupChip /></Quiet></div>}
              {pins.update && <div className="top-x x-update" data-fold="update">{(update.data?.available || (update.data?.held && upNote.line)) && <Quiet name="Update"><UpdateChip u={update.data} onDetails={() => setSettings('about')} onDone={upNote.hide} /></Quiet>}</div>}
              {pins.restart && <div className="top-x x-restart" data-fold="restart"><Quiet name="Restart"><RestartChip fleet={fleet} runtime={conf?.runtime?.name} keep={!!conf?.runtime?.keep} /></Quiet></div>}
              {pins.usage && <div className="top-x x-usage"><Quiet name="Usage"><UsageChip quota={quota.data} primary={primary} onUsage={() => showCard('gauge')} onAddAccount={(kind) => setAddAcct({ kind })} /></Quiet></div>}
              {pins.weather && <div className="top-x x-weather"><Quiet name="Weather"><WeatherChip onClick={() => showCard('sun')} /></Quiet></div>}
              {pins.clock && <div className="top-x x-clock"><Quiet name="Clock"><ClockChip /></Quiet></div>}
              {pins.sounds && <div className="top-x x-sounds"><Quiet name="Sounds"><SoundButton conf={conf} /></Quiet></div>}
            </div>
            <Quiet name="Status"><StatusMenu quota={quota.data} primary={primary} update={update.data} upNote={upNote} fresh={fresh} fleet={fleet} conf={conf} folded={foldedList.length} restartFolded={!pins.restart || foldedList.includes('restart')}
              recording={meetings?.rec?.title || null} onUsage={() => showCard('gauge')} onAddAccount={(kind) => setAddAcct({ kind })} onWeather={() => showCard('sun')} onCalendar={() => showCard('calendar')} onUpdateDetails={() => setSettings('about')} onPins={() => setSettings('topbar')} /></Quiet>
          </>
        )}
        {toStart && <button className="win-btn" onClick={toStart} aria-label={t('Your computer')} title={t('Back to the start: pair or open a computer')}><Icon name="laptop" size={wide ? 15 : 18} /></button>}
        {!cloudOnly && !wide && <Quiet name="Sounds"><SoundButton conf={conf} size={18} /></Quiet>}
        <button className="win-btn settings-btn" data-tour="settings" onClick={() => { if (setDot) { upNote.seen(); setSettings('about') } else setSettings('all') }} aria-label={t('Settings')}
          title={setDot ? t('Bridge AI {latest} is available (you have {current})', { latest: update.data.latest, current: update.data.current }) : t('Settings (⌘,)')}>
          <Icon name="settings" size={wide ? 15 : 18} />
          {setDot && <span className="top-dot" aria-hidden="true" />}
        </button>
      </div>
    </header>
    {!wide && !cloudOnly && <TopNotes update={update.data} onUpdate={() => setSettings('about')} fleet={fleet} conf={conf} fresh={fresh} app={appTooOld} />}
    </>
  )
  const topbar = topbarFor()

  // Home, Meetings or a meeting, in a tab.
  const homeProps = {
    phone: !wide, calendar: !!conf?.calendar,
    onOpen: (it) => openOn(it.machine, it.paneId, { device: it.device, title: it.agent?.title, kind: it.agent?.kind, chat: true }),
    // A meeting, a whiteboard or a Chief of Staff that isn't running, on another computer: that
    // computer's own page, at it, saying this window switched (with Back to this one, which opens
    // what you had here).
    onOpenMeeting: (it) => (shownHere(it.machine) ? openAgent(`view:meeting:${it.meeting.id}`) : goMachine(it.machine, { agent: `view:meeting:${it.meeting.id}`, back: it.meeting.title || true })),
    onOpenBoard: (it) => (shownHere(it.machine) ? openAgent(`${BOARD}${it.board.id}`) : goMachine(it.machine, { agent: `${BOARD}${it.board.id}`, back: it.board.title || true })),
    onOpenChief: (it) => (shownHere(it.machine) ? window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: 'chief' } }))
      : it.chief ? openOn(it.machine, it.chief, { device: it.device, title: t('Chief of Staff') }) : goMachine(it.machine, { agent: 'chief', back: t('Chief of Staff') })),
    onCalendar: () => showCard('calendar'),
  }
  // Home off says how to turn it on, once the settings say it's off (until they're in, nothing).
  const viewFor = (id, { onBack } = {}) => (
    <ErrorBoundary key={id} name="This view" resetKey={id}>
      {(id === 'view:home' || id === 'view:everything') && !homeOn ? <section className="pane view-pane">{conf && <TrialOff name={t('Home')} />}</section>
        : id === 'view:home' ? <section className="pane view-pane"><NeedsHome {...homeProps} onEverything={openEverything} /></section>
        : id === 'view:everything' ? <section className="pane view-pane"><Everything {...homeProps} onOpenAgent={(x) => openOn(x.machine, x.a.paneId, { device: x.device, title: x.a.name || x.a.title, kind: x.a.kind })} onBack={wide ? null : () => setHomeView('home')} /></section>
        : id === 'view:new' ? <Home fleet={fleet} onLaunched={fromHome} onMore={(init) => setNewAgent(init)} />
        : id === 'view:map' ? <section className="pane view-pane"><AgentMap phone={!wide} onOpen={(d, a) => openOn(d.id, a.paneId, { device: d.name, title: a.name || a.title, kind: a.kind })}
          controls={wide ? { maximized: !!L.max, onMaximize: () => set({ max: L.max ? null : 'main' }) } : null} /></section>
        : id === 'view:meetings' ? <section className="pane view-pane"><MeetingsHome onOpen={(mid) => openAgent(`view:meeting:${mid}`, wide ? { replace: 'view:meetings' } : {})} /></section>
          : id === 'view:dictations' ? <section className="pane view-pane"><Dictations /></section>
            : id === 'view:whiteboards' && WhiteboardsHome ? <section className="pane view-pane"><WhiteboardsHome onOpen={(bid) => openAgent(`${BOARD}${bid}`, wide ? { replace: 'view:whiteboards' } : {})} /></section>
              : id.startsWith(BOARD) && WhiteboardPage ? <section className="pane view-pane"><WhiteboardPage id={id.slice(BOARD.length)} onBack={() => openAgent('view:whiteboards', { replace: id })} /></section>
                : id === 'view:files' ? <section className="pane view-pane">{filesOn && Explorer ? <Explorer /> : <TrialOff name={t('Files')} />}</section>
                : id.startsWith('view:studio') && !studioOn ? <section className="pane view-pane"><TrialOff name={t('Studio')} /></section>
                : id === 'view:studio' && StudioHome ? <section className="pane view-pane"><StudioHome onOpen={(f) => openAgent(studioId(f), wide ? { replace: 'view:studio' } : {})} /></section>
                  : id.startsWith(STUDIO) && StudioPage ? <section className="pane view-pane"><StudioPage {...studioOf(id)} onBack={() => openAgent('view:studio', { replace: id })} onOpen={(f, o) => openAgent(studioId(f), o?.replace ? { replace: id } : {})} /></section>
                : <section className="pane view-pane"><MeetingPage id={id.slice(13)} onBack={onBack || (() => openAgent('view:meetings', { replace: id }))} /></section>}
    </ErrorBoundary>
  )

  // ---------- Back and Forward (src/backForward.js, a beta feature) ----------
  // On a computer's layout, once the window has what it shows (its agents and settings). What's on
  // screen is a place: Herdr's view, a section of Settings, Today or the Agents board full size, or
  // the tab in front (and the one beside it), full size or not, with where it is inside itself (an
  // agent's Chat or Terminal, Meetings' Memory, the folder Files is in).
  const navReady = useRef(false)
  if (fleet && conf) navReady.current = true
  const navOn = conf?.trials?.['back-forward'] === true && wide && !cloudOnly && navReady.current
  usePlaces(navOn)
  // rough: before the view has said where it is (its code on its way): what it says next is the same step.
  const saidIn = W.active ? placeOf(W.active) : null
  const navPlace = !navOn ? null : view === 'herdr' ? { herdr: true }
    : settings ? (placeOf('settings') ? { settings: placeOf('settings') } : { settings, rough: true })
      : L.max === 'dock' ? { max: 'dock', today: todayTab }
        : L.max === 'board' ? { max: 'board' }
          : { tab: W.active || null, side: W.split && W.side && W.side !== W.active ? W.side : null, max: L.max || null, inner: saidIn ?? null, ...(saidIn === undefined ? { rough: true } : {}) }
  const navKey = navPlace ? JSON.stringify(navPlace) : ''
  const byIdRef = useRef(byId)
  byIdRef.current = byId
  const tabOpen = (id) => wsRef.current.tabs.includes(id)
  // Where a view or an agent was inside itself: there again as it shows (an agent's Chat or
  // Terminal kept as the tab keeps it; Meetings' tab and Files' folder told to the view).
  const showInner = (id, v) => {
    if (v == null) return
    if (id === 'view:meetings') { store.set('cc-meet-tab', v); window.dispatchEvent(new CustomEvent('bridge-meetings-tab', { detail: { tab: v } })); return }
    if (isView(id) || isRemote(id) || id.startsWith('tab:')) { showPlaceIn(id, v); return }
    try { localStorage.setItem('cc-agent-views', JSON.stringify({ ...JSON.parse(localStorage.getItem('cc-agent-views') || '{}'), [id]: v })) } catch { /* private mode */ }
    setTimeout(() => window.dispatchEvent(new CustomEvent('cc-set-view', { detail: { paneId: id, view: v } })), 60)
  }
  const showPlace = (pl) => {
    if (pl.herdr) { setSettings(null); setView('herdr'); return }
    setView('command')
    if (pl.settings) { window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: pl.settings } })); return }
    setSettings(null)
    if (pl.max === 'dock') { if (pl.today) setTodayTab(pl.today); set({ max: 'dock', dockMin: false, todayOpen: true }); return }
    if (pl.max === 'board') { set({ max: 'board', boardMin: false }); return }
    set({ max: pl.max || null })
    if (!pl.tab) return
    // Its tab, or the one that took its place since (a meeting in Meetings' tab), which it takes back.
    const slot = slotOf(pl.tab, tabOpen)
    if (!slot) return
    if (slot !== pl.tab) replacedWith(slot, pl.tab)
    showInner(pl.tab, pl.inner)
    setW((w) => {
      const tabs = w.tabs.map((x) => (x === slot ? pl.tab : x))
      const side = pl.side && pl.side !== pl.tab && tabs.includes(pl.side) ? pl.side : null
      return { ...(slot === pl.tab || w.tabs.includes(pl.tab) ? w : follow(w, slot, pl.tab)), tabs, active: pl.tab, side, split: !!side, group: 'main' }
    })
  }
  const TODAY_NAMES = { overview: [tx('Today'), 'today'], calendar: [tx('Calendar'), 'calendar'], mail: [tx('Mail'), 'mail'], markets: [tx('Markets & News'), 'trend'], usage: [tx('Usage'), 'gauge'] }
  // How a place is named in ‹'s and ›'s lists.
  const describePlace = (pl) => {
    if (pl.herdr) return { label: 'Herdr', icon: 'layers' }
    if (pl.settings) return { label: placeLabel('settings') || t('Settings'), icon: 'settings' }
    if (pl.max === 'dock') { const [name, icon] = TODAY_NAMES[pl.today] || TODAY_NAMES.overview; return { label: pl.today && pl.today !== 'overview' ? `${t('Today')} › ${t(name)}` : t('Today'), icon } }
    if (pl.max === 'board') return { label: t('Agents'), icon: 'grid' }
    if (!pl.tab) return { label: t('New'), icon: 'plus' }
    const a = byIdRef.current[pl.tab]
    const name = !a ? null : a.view || a.remote || a.shellTab ? a.title : agentName(a)
    const icon = a?.view ? a.icon : a?.chief ? 'helm' : a?.shellTab ? 'terminal' : a?.remote ? 'laptop' : 'bot'
    return { label: [name || t('Agent'), placeLabel(pl.tab)].filter(Boolean).join(' › '), icon }
  }
  const navHooks = useRef({})
  navHooks.current = { show: showPlace, valid: (pl) => !pl.tab || !!slotOf(pl.tab, tabOpen), describe: describePlace }
  useEffect(() => {
    if (!navOn) return
    navStart({ show: (pl) => navHooks.current.show(pl), valid: (pl) => navHooks.current.valid(pl), describe: (pl) => navHooks.current.describe(pl) })
    return () => navStop()
  }, [navOn])
  useEffect(() => { if (navOn) navSeen(navPlace, navKey) }, [navKey, navOn]) // eslint-disable-line react-hooks/exhaustive-deps
  // A tab closed: its places are passed over, and ‹ or › greyed when there's none left that way.
  const openTabs = W.tabs.join('\n')
  useEffect(() => { navRecheck() }, [openTabs])

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
    // Five tabs, the last one More: every other place the desktop opens from its sidebar and ⌘K.
    // With Home on, Home is the first and Today is in More.
    const tabs = homeOn ? [['home', 'home', t('Home')], ['mate', 'helm', t('Chief')], ['agents', 'grid', t('Agents')], ['meetings', 'mic', t('Meetings')], ['more', 'more', t('More')]]
      : [['mate', 'helm', t('Chief')], ['agents', 'grid', t('Agents')], ['meetings', 'mic', t('Meetings')], ['today', 'today', t('Today')], ['more', 'more', t('More')]]
    const moreRows = [
      homeOn && { id: 'today', icon: 'today', label: t('Today'), hint: t('Calendar, mail, markets and usage'), run: () => setMoreView('today') },
      // The usage chip's account and figure (the desktop's top bar has it; a phone's has no room).
      { id: 'usage', icon: 'gauge', label: t('Usage'), hint: t('Plans, limits and history'), side: <UsageGlance quota={quota.data} primary={primary} />, run: () => setMoreView('usage') },
      WhiteboardsHome && { id: 'whiteboards', icon: 'shapes', label: t('Whiteboards'), hint: t('Draw by hand, or describe a diagram'), run: () => setMoreView('view:whiteboards') },
      StudioHome && studioOn && { id: 'studio', icon: 'layers', label: t('Studio'), hint: t('Documents, sheets, decks and pages'), run: () => setMoreView('view:studio') },
      Explorer && filesOn && { id: 'files', icon: 'folder', label: t('Files'), hint: t('Every folder on your computers'), run: () => setMoreView('view:files') },
      { id: 'terminals', icon: 'terminal', label: t('Terminals'), hint: t("Every agent's terminal, live"), run: () => setMoreView('terminals') },
      { id: 'map', icon: 'grid', label: t('Agent Map'), hint: t("What's running on each of your computers"), run: () => setMoreView('view:map') },
      { id: 'dictations', icon: 'wave', label: t('Dictations'), hint: t("Everything you've dictated"), run: () => setMoreView('view:dictations') },
      { id: 'needs', icon: 'bell', label: t('Needs You'), hint: t("What's waiting on you, on every device"), count: waiting, run: () => setInbox({}) },
      { id: 'history', icon: 'clock', label: t('History'), hint: t('Every conversation, and closed agents'), run: () => setHistory(true) },
      { id: 'settings', icon: 'settings', label: t('Settings'), hint: t('Devices, voice, appearance and more'), run: () => setSettings('all') },
    ].filter(Boolean)
    return (
      <div className="app narrow">
        {topbar}
        <RuntimeNotice runtime={conf?.runtime?.name} fellBack={conf?.runtime?.fellBack} />
        <Quiet name="Link requests"><AskBanner /></Quiet>
        <Quiet name="Switched computer"><SwitchedHere /></Quiet>
        <main className="m-body" style={untilAsks}>
          {mtab === 'home' && homeOn && viewFor(homeView === 'everything' ? 'view:everything' : 'view:home')}
          {mtab === 'mate' && (mateShown ? <Console key={mateShown.paneId} agent={mateShown} variant="mobile" queued={queuedFor(mateShown.paneId)} delivered={deliveredFor(mateShown.paneId)} agents={agents} onThread={(id) => setMateId(id)} /> : <MateEmpty onLaunch={mateLaunch.launch} {...mateLaunch} />)}
          {mtab === 'agents' && (mAgent
            ? mAgent.view
              ? <div className="m-view">{!mAgent.paneId.startsWith('view:meeting:') && <button type="button" className="ghost-btn m-view-back" onClick={() => setMobileAgent(null)}><Icon name="back" size={14} /> {t('Agents')}</button>}{viewFor(mAgent.paneId, { onBack: () => openAgent('view:meetings') })}</div>
              : <Console agent={mAgent} variant="mobile" onBack={() => setMobileAgent(null)} queued={queuedFor(mAgent.paneId)} delivered={deliveredFor(mAgent.paneId)} />
            : <><SessionSwitcher fleet={fleet} phone /><Board fleet={fleet} compact onOpen={openAgent}
              action={<span className="m-acts"><button className="btn small" onClick={openMap} aria-label={t('Agent Map')} title={t("What's running on each of your computers")}><Icon name="grid" size={12} /> {t('Map')}</button><button className="btn small" onClick={openNew} aria-label={t('Start something new')}><Icon name="plus" size={12} /> {t('New')}</button></span>} /></>)}
          {mtab === 'meetings' && (
            <div className="m-view m-meetings">
              {/* Meetings or Dictations: what you've said, either way. */}
              {(!mobileMeeting || mobileMeeting === 'view:dictations') && (
                <div className="m-seg" role="tablist" aria-label={t('Meetings or dictations')}>
                  <button type="button" role="tab" aria-selected={!mobileMeeting} className={!mobileMeeting ? 'on' : ''} onClick={() => setMobileMeeting(null)}>{t('Meetings')}</button>
                  <button type="button" role="tab" aria-selected={mobileMeeting === 'view:dictations'} className={mobileMeeting === 'view:dictations' ? 'on' : ''} onClick={() => setMobileMeeting('view:dictations')}>{t('Dictations')}</button>
                </div>
              )}
              {viewFor(mobileMeeting || 'view:meetings', { onBack: () => setMobileMeeting(null) })}
            </div>
          )}
          {mtab === 'more' && (moreView
            ? (
              <div className="m-view m-more-view">
                {/* A whiteboard has its own way back, to the list of them. */}
                {!moreView.startsWith(BOARD) && !moreView.startsWith(STUDIO) && <button type="button" className="ghost-btn m-view-back" onClick={() => setMoreView(null)}><Icon name="back" size={14} /> {t('More')}</button>}
                {moreView === 'terminals' ? <Terminals key={fleet?.session || ''} onChat={(id) => openAgent(id)} />
                  : moreView === 'today' ? <div className="m-today"><TodayTabs tab={todayTab} setTab={setTodayTab} compact /><div className={`m-today-body tab-${todayTab}`}><TodayBody phone onOpenAgent={openAgent} tab={todayTab} setTab={setTodayTab} stackClass="m-stack" /></div></div>
                    : moreView === 'usage' ? <ErrorBoundary name="Usage"><UsageStats phone /></ErrorBoundary>
                    : viewFor(moreView)}
              </div>
            )
            : <More rows={moreRows} />)}
          {mtab === 'today' && (
            <div className="m-today">
              <TodayTabs tab={todayTab} setTab={setTodayTab} compact />
              <div className={`m-today-body tab-${todayTab}`}><TodayBody phone onOpenAgent={openAgent} tab={todayTab} setTab={setTodayTab} stackClass="m-stack" /></div>
            </div>
          )}
        </main>
        <nav className="tabbar" aria-label={t('Sections')}>
          {tabs.map(([id, icon, label]) => (
            <button key={id} className={mtab === id ? 'on' : ''} data-tour={{ mate: 'chief', agents: 'agents', meetings: 'meetings' }[id]} onClick={() => { setMtab(id); if (id === 'agents' && mtab === 'agents') setMobileAgent(null); if (id === 'meetings' && mtab === 'meetings') setMobileMeeting(null); if (id === 'more' && mtab === 'more') setMoreView(null); if (id === 'home') setHomeView('home') }} aria-current={mtab === id}>
              <span className="tab-icon">
                <Icon name={icon} size={20} />
                {(id === 'home' || (id === 'agents' && !homeOn)) && needN > 0 && <span className="badge">{needN}</span>}
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
          <div className="viewer-empty"><Icon name="terminal" size={24} /><p>{fleet.session ? <>{tn('The herdr session {name} isn\'t running.', { name: <b>{fleet.session}</b> })} {t('Start it from the sidebar.')}</> : t('No herdr session is running.')}</p></div>
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
                  <p>{tn('{name} is open in its own window.', { name: <b>{nameOf(a)}</b> })}</p>
                  <div className="popped-acts">
                    <button className="btn small" onClick={() => showPopped(a.paneId)}>{t('Show window')}</button>
                    <button className="btn small primary" onClick={() => bringBack(a.paneId)}>{t('Bring back here')}</button>
                  </div>
                </div>
              </section>
            )
            : <ErrorBoundary key={sessionKey + a.paneId} name="This agent's view" resetKey={a.paneId}><Console agent={a} variant={a.chief ? 'mate' : 'focus'} simple={simple} onOpenInHerdr={openInHerdr} onPopOut={() => popOut(a)} controls={controls} queued={queuedFor(a.paneId)} delivered={deliveredFor(a.paneId)}
              agents={a.chief ? agents : undefined} onThread={(id) => openAgent(id, { replace: a.paneId })} /></ErrorBoundary>}
      </div>
    )
  }

  // Drag a tab to reorder, or Ctrl+Shift+←/→ on the focused one (TabStrip works out where, by what it
  // shows). The order is saved with the layout.
  const moveTab = (id, target, after) => setW((w) => {
    if (id === target) return w
    const rest = w.tabs.filter((t) => t !== id)
    const i = rest.indexOf(target)
    if (i < 0) return w
    rest.splice(after ? i + 1 : i, 0, id)
    return { ...w, tabs: rest }
  })

  // The tabs above the agents (TabStrip.jsx), with Tab Groups when that beta feature is on. A color
  // picked in a tab's or a group's right-click menu is kept with them as a folded group is: a group's
  // by its key, a tab's by its id; none takes it off. Your own groups and pinned tabs are kept the
  // same way (tidyTabs, above).
  const grouping = conf?.trials?.['tab-groups'] === true
  const foldGroup = (key) => setW((w) => ({ ...w, folded: { ...(w.folded || {}), [key]: !w.folded?.[key] } }))
  const colorTab = (key, color) => setW((w) => {
    const colors = { ...(w.colors || {}) }
    if (color) colors[key] = color
    else delete colors[key]
    return { ...w, colors }
  })
  const nameGroup = (key, name) => setW((w) => (w.tabGroups?.[key] ? { ...w, tabGroups: { ...w.tabGroups, [key]: { ...w.tabGroups[key], name } } } : w))
  // Ungroup: the group goes, its tabs stay where they are.
  const ungroup = (key) => setW((w) => tidyTabs({ ...w, tabGroups: { ...(w.tabGroups || {}), [key]: { tabs: [] } } }))
  const tabStrip = (
    <TabStrip ids={W.tabs} byId={byId} active={W.active} side={split ? W.side : null} focus={W.group} folded={W.folded} colors={W.colors} own={W.tabGroups} pinned={W.pinned} grouping={grouping} spaces={fleet?.workspaces}
      onOpen={openAgent} onClose={closeTab} onMove={moveTab} onFold={foldGroup} onColor={colorTab} onSide={canSplit ? (id) => openAgent(id, { toSide: true }) : null} onNewAgent={(init) => setNewAgent(init)}
      onGroup={(id, key, keep) => setW((w) => inGroup(w, id, key, keep))} onName={nameGroup} onUngroup={ungroup} onPin={(id, on) => setW((w) => pinTab(w, id, on))}>
      <button className={`win-btn ${split ? 'on' : ''}`} onClick={toggleSplit} disabled={!canSplit || W.tabs.length < 2}
        title={!canSplit ? t('Not enough room to split') : W.tabs.length < 2 ? t('Open a second agent to split') : split ? t('Unsplit') : t('Split side by side')} aria-label={t('Split')}>
        <Icon name="split" size={15} />
      </button>
    </TabStrip>
  )

  const boardEl = (
    <Board fleet={fleet} selected={W.active} onOpen={openAgent} onOpenInHerdr={openInHerdr} onMap={openMap}
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
      <Quiet name="Switched computer"><SwitchedHere /></Quiet>
      <div className="views" style={untilAsks}>
        <main className="cmd" hidden={view !== 'command'} ref={cmdRef}>
          <div className="slot rail-slot" style={{ width: railOpen ? L.railW : 52 }}>
            <Rail fleet={fleet} live={live} collapsed={!railOpen} onToggle={() => set({ railOpen: !L.railOpen })}
              selected={W.active} onOpen={(id) => (id === 'view:home' ? openHome() : openAgent(id))} onOpenInHerdr={openInHerdr} onOpenFiles={openFiles} onNewAgent={(init) => (init ? setNewAgent(init) : openNew())} onNewTerminal={newTerminal} onHistory={() => setHistory(true)}
              onMeetings={() => openAgent('view:meetings')} onDictations={() => openAgent('view:dictations')} recording={!!meetings?.rec} needs={needN} />
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
