import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon, { StatusDot } from './Icon.jsx'
import { usePersisted } from './layout.jsx'
import { api, usePoll, fmtRelative, openInTerminal } from '../api.js'
import { CloudMark, linkOf, whereOf } from './cloudBits.jsx'
import SessionSwitcher from './Sessions.jsx'
import RailMeetings from './meetings/RailMeetings.jsx'
import { RailMachines } from './Machines.jsx'
import { Quiet } from './ErrorBoundary.jsx'
import { openMeeting, useMeetings } from './meetings/recording.jsx'
import { Dialog } from './meetings/tools.jsx'
import { t, tx } from '../i18n/index.js'

// Mirrors herdr's sidebar: numbered workspaces, each with its tabs. Spaces fold,
// every row shows the folder it works in, and a ⋯ menu covers rename/close/copy.
const RANK = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 }
const STATUS_LABEL = { blocked: tx('Needs you'), done: tx('Done'), working: tx('Working'), idle: tx('Idle'), unknown: tx('Unknown') }

function worst(agents) {
  return agents.reduce((w, a) => ((RANK[a.status] ?? 9) < (RANK[w] ?? 9) ? a.status : w), 'unknown')
}

export const tildePath = (p) => (p || '').replace(/^\/Users\/[^/]+/, '~')
// "~/code/acme/api-server" -> "acme/api-server" (full path stays in the tooltip)
export const shortPath = (p) => {
  const t = tildePath(p)
  const parts = t.split('/').filter(Boolean)
  return parts.length <= 2 ? t : parts.slice(-2).join('/')
}

// Rows follow herdr's tab order: an agent tab shows its agents, a shell-only tab
// (dev servers, editors) shows as one row that opens the tab's panes.
export function groupByWorkspace(fleet) {
  const agents = fleet?.agents || []
  const tabs = fleet?.tabs || []
  return (fleet?.workspaces || []).map((w, i) => {
    const list = agents.filter((a) => a.workspaceId === w.id)
    const rows = []
    // herdr's own order (its tab numbers don't change when a tab is moved).
    for (const t of tabs.filter((x) => x.workspaceId === w.id)) {
      const inTab = list.filter((a) => a.tabId === t.tabId)
      if (inTab.length) rows.push(...inTab.map((a) => ({ kind: 'agent', id: a.paneId, agent: a, tab: t })))
      else if (t.panes.length) rows.push({ kind: 'shell', id: `tab:${t.tabId}`, tab: t })
    }
    for (const a of list) if (!rows.some((r) => r.id === a.paneId)) rows.push({ kind: 'agent', id: a.paneId, agent: a, tab: null })
    return { ...w, number: i + 1, agents: list, rows, status: list.length ? worst(list) : 'unknown', cloud: w.id === 'cloud' }
  })
}

const rowCwd = (r) => (r.kind === 'agent' ? r.agent.cwd : r.tab?.panes.find((p) => !p.agent)?.cwd || r.tab?.panes[0]?.cwd)
// On its own branch (a worktree Bridge AI made): { repo, branch, base }, else null.
const rowTree = (r) => (r.kind === 'agent' ? r.agent.worktree : (r.tab?.panes.find((p) => !p.agent) || r.tab?.panes[0])?.worktree) || null
const rowName = (r) => (r.kind === 'agent'
  ? (r.agent.chief ? (r.agent.thread && !r.agent.thread.main ? r.agent.title : t('Chief of Staff')) : r.agent.tab && !/^\d+$/.test(r.agent.tab) ? r.agent.tab : r.agent.title || t('agent'))
  : (r.tab.label && !/^\d+$/.test(r.tab.label) ? r.tab.label : t('shell')))

// own: it works on its own branch, in a worktree Bridge AI made.
function GitBit({ g, own }) {
  if (!g) return null
  return (
    <span className={`git-bit ${own ? 'own' : ''}`} title={`${own ? `${t('Own branch, in its own folder:')} ` : ''}${g.branch}${g.dirty ? `, ${g.dirty === 1 ? t('{n} uncommitted change', { n: g.dirty }) : t('{n} uncommitted changes', { n: g.dirty })}` : `, ${t('clean')}`}`}>
      <Icon name="branch" size={10} /><span className="gb-name">{g.branch}</span>{g.dirty > 0 && <b>+{g.dirty}</b>}
    </span>
  )
}
// What a close did with the worktrees of the agents in it (server: worktrees.tidy).
const closedNote = (label, r) => [t('Closed {name}.', { name: label }), ...(r?.worktrees || []).map((w) => (w.removed
  ? t('Its branch {branch} is kept; its folder is removed.', { branch: w.branch })
  : t('Kept its folder on {branch}: {path}.', { branch: w.branch, path: w.kept })))].join(' ')

// Small dropdown that closes on outside click or Esc.
export function Menu({ items, onClose, align = 'right' }) {
  const ref = useRef(null)
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [onClose])
  return (
    <div className={`menu ${align}`} ref={ref} role="menu">
      {items.filter(Boolean).map((it, i) => it === '-' ? <div key={i} className="menu-sep" /> : (
        <button key={it.label} role="menuitem" className={`menu-item ${it.danger ? 'danger' : ''}`} onClick={() => { onClose(); it.run() }}>
          <Icon name={it.icon} size={13} /> {it.label}
        </button>
      ))}
    </div>
  )
}

function InlineRename({ value, onDone }) {
  const [v, setV] = useState(value)
  return (
    <input className="rail-rename" autoFocus value={v} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()}
      onKeyDown={(e) => { if (e.key === 'Enter') onDone(v.trim() && v.trim() !== value ? v.trim() : null); if (e.key === 'Escape') onDone(null) }}
      onBlur={() => onDone(null)} aria-label={t('New name')} />
  )
}

// Hover card for the closed sidebar: what the dot stands for, at a glance.
function HoverCard({ row, rect, git, preview }) {
  if (!row || !rect) return null
  const a = row.agent
  const cwd = rowCwd(row)
  // Rendered on <body> so no panel's stacking layer can cover it.
  return createPortal(
    <div className="hover-card" style={{ top: Math.min(rect.top - 6, window.innerHeight - 200), left: rect.right + 10 }} role="tooltip">
      <div className="hc-crumb">{row.tab?.workspace || a?.workspace}{row.tab && ` › ${row.tab.label}`}</div>
      <div className="hc-title">
        {a ? <StatusDot status={a.status} size={8} /> : <Icon name="terminal" size={12} />}
        <b>{a ? (a.chief ? rowName(row) : a.title || rowName(row)) : rowName(row)}</b>
      </div>
      <div className="hc-meta">
        {a ? <span>{a.cloud?.failed ? t('Failed') : t(STATUS_LABEL[a.status])} · {a.cloud ? t('{name} cloud', { name: a.cloud.label }) : a.kind}</span> : <span>{row.tab.panes.length === 1 ? t('{n} pane', { n: row.tab.panes.length }) : t('{n} panes', { n: row.tab.panes.length })}</span>}
        {preview?.ts && <span>{fmtRelative(preview.ts)}</span>}
      </div>
      {preview?.text && <p className="hc-preview">{preview.text}</p>}
      {a?.cloud
        ? <div className="hc-path"><Icon name="cloud" size={11} /> <span>{a.cloud.label}{whereOf(a.cloud) ? ` · ${whereOf(a.cloud)}` : ''}</span></div>
        : <div className="hc-path"><Icon name="folder" size={11} /> <span>{tildePath(cwd)}</span></div>}
      {git && <div className="hc-path"><GitBit g={git} own={!!rowTree(row)} /></div>}
    </div>,
    document.body,
  )
}

// New (Home: start something) and Meetings sit above the spaces; a red dot while a meeting records.
export default function Rail({ fleet, live, collapsed, onToggle, selected, onOpen, onOpenInHerdr, onOpenFiles, onNewAgent, onNewTerminal, onHistory, onMeetings, recording }) {
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState(null)
  const [closedWs, setClosedWs] = usePersisted('cc-rail-closed', {})
  // Meetings, listed under their row like a space's tabs: open once you go to Meetings.
  const [meetingsOpen, setMeetingsOpen] = usePersisted('cc-rail-meetings', false)
  const [menu, setMenu] = useState(null) // row id or `ws:<id>`
  const [renaming, setRenaming] = useState(null) // { kind: 'tab'|'ws', id }
  const [hover, setHover] = useState(null) // { row, rect }
  const [flash, setFlash] = useState(null)
  const [drag, setDrag] = useState(null) // { kind: 'ws'|'tab', id, ws, name, rowId }
  const [naming, setNaming] = useState(false) // the "New space" name box
  const [moving, setMoving] = useState(null) // a tab whose "Move to space" list is open
  const [over, setOver] = useState(null) // { id, after }
  const [pending, setPending] = useState(null) // optimistic order of space ids until the server confirms
  // Record a meeting now, from beside Meetings (for the calendar event on now, if there is one).
  // While one records, it asks first: stop that one and record a new one, or open it.
  const meet = useMeetings()
  const [recAsk, setRecAsk] = useState(false)
  const [recErr, setRecErr] = useState(null)
  const [recBusy, setRecBusy] = useState(false)
  useEffect(() => { if (!recErr) return; const t = setTimeout(() => setRecErr(null), 8000); return () => clearTimeout(t) }, [recErr])
  const recordNow = async ({ fresh = false } = {}) => {
    setRecErr(null)
    if (meet?.rec && !fresh) { setRecAsk(true); return }
    setRecBusy(true)
    try {
      if (fresh && meet?.rec) await meet.stop()
      setMeetingsOpen(true)
      await meet.startNow()
    } catch (e) { setRecErr(e.message) } finally { setRecBusy(false); setRecAsk(false) }
  }
  let groups = groupByWorkspace(fleet)
  if (pending) {
    const pos = Object.fromEntries(pending.map((id, i) => [id, i]))
    if (groups.every((g) => g.id in pos)) groups = [...groups].sort((a, b) => pos[a.id] - pos[b.id]).map((g, i) => ({ ...g, number: i + 1 }))
  }
  useEffect(() => { setPending(null) }, [fleet])
  const hasMate = fleet?.agents?.some((a) => a.chief)
  // The chief of staff, a click away at the top like New and Meetings (its Main thread, or starts one).
  const chief = fleet?.agents?.find((a) => a.chief && a.thread?.main) || fleet?.agents?.find((a) => a.chief)
  const chiefOn = !!selected && !!fleet?.agents?.some((a) => a.chief && a.paneId === selected)
  const places = usePoll('/places', 15000)
  const previews = usePoll('/previews', 10000, { enabled: collapsed })
  const git = (cwd) => places.data?.[cwd] || null
  // An agent on its own branch shows it from the start, before the folder's git status is in.
  const gitOf = (r) => git(rowCwd(r)) || (rowTree(r) ? { branch: rowTree(r).branch, dirty: 0 } : null)
  // Longer notes (what a close kept, and why) stay up long enough to read.
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), Math.max(2500, flash.length * 60)); return () => clearTimeout(t) }, [flash])

  const launch = async () => {
    setLaunching(true)
    setError(null)
    try { onOpen((await api('/chief/launch', { method: 'POST' })).paneId) } catch (e) { setError(e.message) } finally { setLaunching(false) }
  }
  const goChief = () => (chief ? onOpen(chief.paneId) : launch())
  const allClosed = groups.length > 0 && groups.every((g) => closedWs[g.id])
  const setAll = (closed) => setClosedWs(closed ? Object.fromEntries(groups.map((g) => [g.id, true])) : {})
  const toggleWs = (id) => setClosedWs((c) => { const n = { ...c }; if (n[id]) delete n[id]; else n[id] = true; return n })

  // ok: the note to show after, or a function of the reply that makes it.
  const act = async (fn, ok) => { try { const r = await fn(); if (ok) setFlash(typeof ok === 'function' ? ok(r) : ok) } catch (e) { setFlash(e.message) } }
  const copy = (text) => { navigator.clipboard?.writeText(text).then(() => setFlash(t('Path copied')), () => setFlash(text)) }
  const rename = async (label) => {
    const r = renaming
    setRenaming(null)
    if (!label) return
    await act(() => api(r.kind === 'ws' ? `/workspaces/${encodeURIComponent(r.id)}/rename` : `/tabs/${encodeURIComponent(r.id)}/rename`, { method: 'POST', body: { label } }))
  }
  const closeTab = (tab) => {
    const n = tab.panes.length
    const own = tab.panes.some((p) => p.worktree)
    if (!window.confirm(`${t('Close the tab "{name}"?', { name: tab.label })}\n\n${n === 1 ? t('This ends the process running in it, the same as closing it in the terminal.') : t('This ends all {n} processes running in it, the same as closing it in the terminal.', { n })}${own ? `\n\n${t('Its own branch stays. Its folder is removed only if nothing would be lost (no uncommitted changes, no commits that are only there).')}` : ''}`)) return
    act(() => api(`/tabs/${encodeURIComponent(tab.tabId)}/close`, { method: 'POST' }), (r) => closedNote(tab.label, r))
  }
  // Reorder spaces (and tabs inside a space); herdr gets the same order.
  const moveWs = (id, to) => {
    const ids = groups.map((g) => g.id)
    const from = ids.indexOf(id)
    if (from < 0 || to === from || to === from + 1) return
    const next = ids.filter((x) => x !== id)
    next.splice(to > from ? to - 1 : to, 0, id)
    setPending(next)
    act(() => api(`/workspaces/${encodeURIComponent(id)}/move`, { method: 'POST', body: { index: to } }))
  }
  const moveTab = (g, tabId, to) => {
    const tabs = [...new Set(g.rows.filter((r) => r.tab).map((r) => r.tab.tabId))]
    const from = tabs.indexOf(tabId)
    if (from < 0 || to === from || to === from + 1) return
    act(() => api(`/tabs/${encodeURIComponent(tabId)}/move`, { method: 'POST', body: { index: to } }))
  }
  // Move a tab into another space (at `index` among its tabs, or last), or into a new space
  // (newSpace: its name). herdr gives moved panes new ids, so the open one is followed there.
  const moveToSpace = (d, { workspaceId, newSpace, index }) => act(async () => {
    const out = await api(`/tabs/${encodeURIComponent(d.id)}/move`, { method: 'POST', body: { workspaceId, newSpace, index } })
    if (selected && selected === d.rowId) {
      const next = d.rowId.startsWith('tab:') ? `tab:${out.tabId}` : out.moved?.[d.rowId]
      if (next && next !== d.rowId) onOpen(next)
    }
  }, newSpace ? t('Moved to a new space, {name}', { name: newSpace }) : groups.find((g) => g.id === workspaceId)?.label ? t('Moved to {name}', { name: groups.find((g) => g.id === workspaceId).label }) : t('Moved to that space'))
  const createSpace = async (label) => {
    setNaming(false)
    if (!label) return
    await act(() => api('/workspaces', { method: 'POST', body: { label } }), t('Made {name}. Start an agent in it with +, or drag one in.', { name: label }))
  }
  const dropOn = (e, id) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { id, after: e.clientY > r.top + r.height / 2 }
  }
  const endDrag = () => { setDrag(null); setOver(null) }

  // A cloud agent's ⋯ menu: its pull request or page, notifications, Stop, and no longer following it.
  const cloudItems = (a) => {
    const c = a.cloud
    const link = linkOf(c)
    const pid = encodeURIComponent(a.paneId)
    return [
      link && { icon: 'external', label: link.label, run: () => window.open(link.href, '_blank', 'noopener') },
      c.prUrl && c.url && { icon: 'external', label: c.urlLabel || t('Open in {name}', { name: c.label }), run: () => window.open(c.url, '_blank', 'noopener') },
      { icon: a.muted ? 'bell' : 'bell-off', label: a.muted ? t('Unmute notifications') : t('Mute notifications'),
        run: () => act(() => api(`/agents/${pid}/mute`, { method: 'POST', body: { muted: !a.muted } }), a.muted ? t('Notifications back on') : t('Muted until you unmute it')) },
      a.status === 'working' && c.canStop && { icon: 'stop', label: t('Stop'), run: () => act(() => api(`/cloud/agents/${pid}/stop`, { method: 'POST' }), t('Asked it to stop')) },
      '-',
      { icon: 'x', label: t('Remove from Bridge AI…'), danger: true, run: () => {
        if (!window.confirm(`${t('Stop following "{name}" in Bridge AI?', { name: a.title })}\n\n${t('The agent stays in {where}, with its branch and any pull request.', { where: c.label })}`)) return
        act(() => api(`/cloud/agents/${pid}`, { method: 'DELETE' }), t("Removed {name}. It's still in {where}.", { name: a.title, where: c.label }))
      } },
    ]
  }

  const closeWs = (g) => {
    if (!window.confirm(`${t('Close the space "{name}" and all {n} of its tabs?', { name: g.label, n: g.rows.length })}\n\n${t('Everything running in it stops, the same as closing it in the terminal.')}`)) return
    act(() => api(`/workspaces/${encodeURIComponent(g.id)}/close`, { method: 'POST' }), (r) => closedNote(g.label, r))
  }

  if (collapsed) {
    return (
      <nav className="rail collapsed" aria-label={t('Workspaces')} data-tour="agents" onMouseLeave={() => setHover(null)}>
        <button className={`mini-nav ${selected === 'view:new' ? 'on' : ''}`} data-tour="new-agent" onClick={() => onNewAgent?.()} aria-label={t('New')} title={t('New')}><Icon name="edit" size={15} /></button>
        {!fleet?.down && <button className={`mini-nav ${chiefOn ? 'on' : ''}`} onClick={goChief} disabled={launching} aria-label={t('Chief of Staff')} title={t('Chief of Staff')}><Icon name="helm" size={15} />{chief?.status === 'blocked' && <span className="mini-needs" />}</button>}
        <button className={`mini-nav ${String(selected || '').startsWith('view:meeting') ? 'on' : ''}`} onClick={() => onMeetings?.()} aria-label={recording ? t('Meetings (recording)') : t('Meetings')} title={t('Meetings')}><Icon name="mic" size={15} />{recording && <span className="rec-dot mini-rec" />}</button>
        <div className="rail-mini">
          {groups.filter((g) => g.rows.length).map((g) => (
            <div key={g.id} className="mini-ws">
              <span className="mini-num" title={g.label}>{g.number}</span>
              {g.rows.map((r) => (
                <button key={r.id} className={`mini-agent ${selected === r.id ? 'on' : ''}`} data-tour={r.agent?.chief ? 'chief' : undefined} onClick={() => onOpen(r.id)} aria-label={rowName(r)}
                  onMouseEnter={(e) => setHover({ row: r, rect: e.currentTarget.getBoundingClientRect() })} onFocus={(e) => setHover({ row: r, rect: e.currentTarget.getBoundingClientRect() })} onBlur={() => setHover(null)}>
                  {r.kind === 'agent' ? <StatusDot status={r.agent.status} size={9} /> : <Icon name="terminal" size={11} />}
                </button>
              ))}
            </div>
          ))}
        </div>
        <span className={`live-dot ${live ? 'on' : ''}`} title={live ? t('Live') : t('Reconnecting')} />
        {hover && <HoverCard row={hover.row} rect={hover.rect} git={gitOf(hover.row)} preview={hover.row.kind === 'agent' ? previews.data?.[hover.row.id] : null} />}
      </nav>
    )
  }

  return (
    <nav className="rail" aria-label={t('Workspaces')} data-tour="agents">
      <div className="rail-nav">
        <button className={`rail-nav-btn ${selected === 'view:new' ? 'on' : ''}`} data-tour="new-agent" onClick={() => onNewAgent?.()}><Icon name="edit" size={14} /> {t('New')}</button>
        {!fleet?.down && (
          <button className={`rail-nav-btn ${chiefOn ? 'on' : ''}`} onClick={goChief} disabled={launching}>
            <Icon name="helm" size={14} /> {launching ? t('Starting…') : t('Chief of Staff')}{chief?.status === 'blocked' && <span className="rm-badge" title={t('Needs you')}>!</span>}
          </button>
        )}
        <div className="rail-nav-row">
          <button className={`rail-nav-btn ${String(selected || '').startsWith('view:meeting') ? 'on' : ''}`} onClick={() => { setMeetingsOpen(true); onMeetings?.() }}><Icon name="mic" size={14} /> {t('Meetings')}{recording && <span className="rec-dot" aria-label={t('recording')} />}</button>
          {meet && <button className={`rail-rec${meet.rec ? ' busy' : ''}`} onClick={() => recordNow()} disabled={recBusy} aria-label={t('Record a meeting now')} title={meet.rec ? t('Recording "{name}". Click to record a new one', { name: meet.rec.title }) : t('Record a meeting now. Named after the calendar event on now, if there is one')}><Icon name="record" size={13} /></button>}
          <button className="rail-nav-fold" onClick={() => setMeetingsOpen(!meetingsOpen)} aria-expanded={meetingsOpen} aria-label={meetingsOpen ? t('Hide the meetings list') : t('Show the meetings list')} title={meetingsOpen ? t('Hide the list') : t('Show the list')}><Icon name="down" size={12} className={meetingsOpen ? '' : 'rot-up'} /></button>
        </div>
        {recErr && <p className="error-text small rail-rec-err" role="alert">{recErr}</p>}
        {recAsk && meet?.rec && (
          <Dialog title={t('Record a new meeting?')} onClose={() => setRecAsk(false)}>
            <div className="mt-fix">
              <p><b>{meet.rec.title}</b> is recording. {t('Stop it and record a new one? It keeps everything recorded so far, and its notes are written as usual.')}</p>
              <div className="mt-dialog-acts">
                <button type="button" className="ghost-btn" onClick={() => setRecAsk(false)}>{t('Cancel')}</button>
                <button type="button" className="btn small" onClick={() => { setRecAsk(false); openMeeting(meet.rec.id) }}>{t('Open it')}</button>
                <button type="button" className="btn small primary" disabled={recBusy} onClick={() => recordNow({ fresh: true })} autoFocus><Icon name="record" size={12} /> {t('Stop it and record a new one')}</button>
              </div>
            </div>
          </Dialog>
        )}
        {meetingsOpen && <Quiet name="Meetings list"><RailMeetings selected={selected} onOpen={openMeeting} /></Quiet>}
        <Quiet name="Devices"><RailMachines /></Quiet>
      </div>
      <div className="rail-head">
        <span className="rail-label">{t('Spaces')}</span>
        <span className={`live-dot ${live ? 'on' : ''}`} title={live ? t('Live updates') : t('Reconnecting')} />
        <span className="rail-tools">
          <button className="rail-tool" onClick={() => setNaming(true)} aria-label={t('New space')} title={t('New space')}><Icon name="layers" size={14} /></button>
          {onNewTerminal && !fleet?.down && <button className="rail-tool" onClick={() => onNewTerminal()} aria-label={t('New terminal')} title={t('New terminal, to run commands on this computer')}><Icon name="terminal" size={14} /></button>}
          <button className="rail-tool" onClick={() => onHistory?.()} aria-label={t('History')} title={t('Search every conversation, and closed agents (⌘⇧F)')}><Icon name="clock" size={14} /></button>
          <button className="rail-tool" onClick={() => setAll(!allClosed)} aria-label={allClosed ? t('Expand all spaces') : t('Collapse all spaces')} title={allClosed ? t('Expand all') : t('Collapse all')}>
            <Icon name={allClosed ? 'unfold-all' : 'fold-all'} size={14} />
          </button>
        </span>
      </div>
      <SessionSwitcher fleet={fleet} />

      <div className="rail-scroll">
        {!fleet && <div className="skeleton-rows pad"><div /><div /><div /></div>}
        {naming && (
          <div className="ws-row new-space-row">
            <Icon name="layers" size={12} className="muted" />
            <InlineRename value="" onDone={createSpace} />
          </div>
        )}
        {groups.map((g) => {
          const closed = !!closedWs[g.id]
          const needs = g.agents.filter((a) => a.status === 'blocked').length
          return (
            <section key={g.id} className={`ws ${closed ? 'is-closed' : ''} ${drag?.kind === 'tab' && over?.id === `into:${g.id}` && drag.ws !== g.id ? 'drop-into' : ''} ${drag?.kind === 'ws' && drag.id === g.id ? 'dragging' : ''} ${drag?.kind === 'ws' && over?.id === g.id ? (over.after ? 'drop-after' : 'drop-before') : ''}`}
              onDragOver={(e) => {
                if (g.cloud) return // cloud agents run elsewhere: nothing moves in or out
                if (drag?.kind === 'tab') { e.preventDefault(); setOver({ id: `into:${g.id}` }); return }
                if (drag?.kind !== 'ws') return
                e.preventDefault(); setOver(dropOn(e, g.id))
              }}
              onDrop={(e) => {
                // A tab dropped on a space (its name, or anywhere that isn't another tab): to the end of it.
                if (drag?.kind === 'tab') {
                  e.preventDefault()
                  const d = drag
                  endDrag()
                  if (d.ws === g.id) moveTab(g, d.id, [...new Set(g.rows.filter((x) => x.tab).map((x) => x.tab.tabId))].length)
                  else moveToSpace(d, { workspaceId: g.id })
                  return
                }
                if (drag?.kind !== 'ws') return
                e.preventDefault(); const idx = groups.findIndex((x) => x.id === g.id); moveWs(drag.id, idx + (over?.after ? 1 : 0)); endDrag()
              }}>
              <div className={`ws-row ${g.rows.length ? '' : 'empty'} ${g.cloud ? 'ws-cloud' : ''}`} draggable={!renaming && !g.cloud}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', g.label); setDrag({ kind: 'ws', id: g.id }) }} onDragEnd={endDrag}
                title={t('Drag to reorder')}>
                <button className="ws-fold" onClick={() => toggleWs(g.id)} aria-expanded={!closed} aria-label={closed ? t('Expand {name}', { name: g.label }) : t('Collapse {name}', { name: g.label })} title={closed ? t('Expand') : t('Collapse')}>
                  <Icon name="chevron" size={11} className={`caret ${closed ? '' : 'rot90'}`} />
                </button>
                <StatusDot status={g.status} />
                <span className="ws-num">{g.number}</span>
                {renaming?.kind === 'ws' && renaming.id === g.id
                  ? <InlineRename value={g.label} onDone={rename} />
                  : <span className="ws-label" onDoubleClick={() => !g.cloud && setRenaming({ kind: 'ws', id: g.id })} title={g.cloud ? t("Agents running in a provider's cloud") : g.label}>{g.cloud && <Icon name="cloud" size={12} />}{g.label}</span>}
                {g.crew && <span className="crew-tag">{t('crew')}</span>}
                {closed && <span className="ws-count" title={`${g.rows.length === 1 ? t('{n} tab', { n: g.rows.length }) : t('{n} tabs', { n: g.rows.length })}${needs ? `, ${needs === 1 ? t('{n} needs you', { n: needs }) : t('{n} need you', { n: needs })}` : ''}`}>{needs ? <b className="needs">{needs}</b> : g.rows.length}</span>}
                <span className="ws-acts">
                  <button className="tab-act" onClick={() => onNewAgent?.(g.cloud ? { mode: 'cloud' } : { workspaceId: g.id, cwd: rowCwd(g.rows[0] || {}) })} aria-label={g.cloud ? t('New cloud agent') : t('New agent in {name}', { name: g.label })} title={g.cloud ? t('New cloud agent') : t('New agent here')}><Icon name="plus" size={12} /></button>
                  <button className="tab-act" onClick={() => setMenu(menu === `ws:${g.id}` ? null : `ws:${g.id}`)} aria-label={t('{name} actions', { name: g.label })} title={t('More')}><Icon name="more" size={13} /></button>
                </span>
                {menu === `ws:${g.id}` && g.cloud && <Menu onClose={() => setMenu(null)} items={[{ icon: 'plus', label: t('New cloud agent'), run: () => onNewAgent?.({ mode: 'cloud' }) }]} />}
                {menu === `ws:${g.id}` && !g.cloud && (
                  <Menu onClose={() => setMenu(null)} items={[
                    { icon: 'plus', label: t('New agent here'), run: () => onNewAgent?.({ workspaceId: g.id, cwd: rowCwd(g.rows[0] || {}) }) },
                    onNewTerminal && { icon: 'terminal', label: t('New terminal here'), run: () => onNewTerminal({ workspaceId: g.id, cwd: rowCwd(g.rows[0] || {}) || undefined }) },
                    { icon: 'edit', label: t('Rename space'), run: () => setRenaming({ kind: 'ws', id: g.id }) },
                    g.number > 1 && { icon: 'chevron', label: t('Move up'), run: () => moveWs(g.id, g.number - 2) },
                    g.number < groups.length && { icon: 'chevron', label: t('Move down'), run: () => moveWs(g.id, g.number + 1) },
                    '-',
                    { icon: 'x', label: t('Close space…'), danger: true, run: () => closeWs(g) },
                  ]} />
                )}
              </div>
              {!closed && g.rows.map((r) => {
                const cwd = rowCwd(r)
                const tab = r.tab
                const isRen = renaming?.kind === 'tab' && tab && renaming.id === tab.tabId
                return (
                  <div key={r.id} className={`tab-row ${r.kind === 'shell' ? 'shell' : ''} ${selected === r.id ? 'on' : ''} ${drag?.kind === 'tab' && tab && drag.id === tab.tabId ? 'dragging' : ''} ${drag?.kind === 'tab' && over?.id === r.id ? (over.after ? 'drop-after' : 'drop-before') : ''}`}
                    draggable={!!tab && !isRen} data-tour={r.agent?.chief ? 'chief' : undefined}
                    onDragStart={(e) => { if (!tab) return; e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', rowName(r)); setDrag({ kind: 'tab', id: tab.tabId, ws: g.id, name: rowName(r), rowId: r.id }) }}
                    onDragEnd={endDrag}
                    onDragOver={(e) => { if (drag?.kind !== 'tab' || !tab) return; e.preventDefault(); e.stopPropagation(); setOver(dropOn(e, r.id)) }}
                    onDrop={(e) => {
                      if (drag?.kind !== 'tab' || !tab) return
                      e.preventDefault(); e.stopPropagation()
                      const tabs = [...new Set(g.rows.filter((x) => x.tab).map((x) => x.tab.tabId))]
                      const at = tabs.indexOf(tab.tabId) + (over?.after ? 1 : 0)
                      const d = drag
                      endDrag()
                      // Within the space: reorder. From another space: move it in, here.
                      if (d.ws === g.id) moveTab(g, d.id, at)
                      else moveToSpace(d, { workspaceId: g.id, index: at })
                    }}>
                    <button className="tab-main" onClick={() => onOpen(r.id)} onDoubleClick={() => tab && setRenaming({ kind: 'tab', id: tab.tabId })}
                      title={r.agent?.cloud ? `${r.agent.title}\n${t('{name} cloud', { name: r.agent.cloud.label })}${whereOf(r.agent.cloud) ? ` · ${whereOf(r.agent.cloud)}` : ''}` : `${r.kind === 'agent' ? r.agent.title : tab.label}\n${tildePath(cwd)}${gitOf(r) ? `\n${gitOf(r).branch}${gitOf(r).dirty ? ` +${gitOf(r).dirty}` : ''}` : ''}`}>
                      {r.kind === 'agent' ? <StatusDot status={r.agent.status} size={8} /> : <Icon name="terminal" size={12} className="muted" />}
                      <span className="tab-lines">
                        <span className="tab-line1">
                          {isRen ? <InlineRename value={tab.label} onDone={rename} /> : <span className="tab-name">{rowName(r)}</span>}
                          {r.kind === 'agent' && r.agent.chief && <Icon name="helm" size={12} className="tab-badge" />}
                          {r.kind === 'agent' && r.agent.account && <span className="acct-tag" title={t('On the {name} account', { name: r.agent.account })}>{r.agent.account}</span>}
                          {r.kind === 'agent' && r.agent.muted && <Icon name="bell-off" size={11} className="muted" />}
                          {r.kind === 'shell' && tab.panes.length > 1 && <span className="tab-count">{tab.panes.length}</span>}
                        </span>
                        {r.agent?.cloud
                          ? <span className="tab-path"><span className="tp-dir cloud-where"><CloudMark provider={r.agent.cloud.provider} label={r.agent.cloud.label} size={12} />{r.agent.cloud.repo ? r.agent.cloud.repo.split('/').pop() : r.agent.cloud.label}</span>{r.agent.cloud.branch && <span className="git-bit own" title={t('Branch {name}', { name: r.agent.cloud.branch })}><Icon name="branch" size={10} /><span className="gb-name">{r.agent.cloud.branch}</span></span>}</span>
                          : r.agent?.plainChat
                            ? <span className="tab-path"><span className="tp-dir">{r.agent.kind === 'chat' ? t('Chat, any model') : t('Chat with {name}', { name: r.agent.kindLabel || r.agent.kind })}</span></span>
                            : <span className="tab-path"><span className="tp-dir">{rowTree(r) ? rowTree(r).repo.split(/[\\/]/).pop() : shortPath(cwd)}</span><GitBit g={gitOf(r)} own={!!rowTree(r)} /></span>}
                      </span>
                    </button>
                    <button className="tab-act" onClick={() => setMenu(menu === r.id ? null : r.id)} aria-label={t('{name} actions', { name: rowName(r) })} title={t('More')}><Icon name="more" size={13} /></button>
                    {menu === r.id && r.agent?.cloud && <Menu onClose={() => setMenu(null)} items={cloudItems(r.agent)} />}
                    {menu === r.id && !r.agent?.cloud && (
                      <Menu onClose={() => setMenu(null)} items={[
                        { icon: 'folder', label: t('Browse folder'), run: () => onOpenFiles?.(r.id) },
                        { icon: 'copy', label: t('Copy folder path'), run: () => copy(cwd) },
                        { icon: 'terminal', label: t('Open in terminal app'), run: () => openInTerminal(r.id).catch((e) => window.alert(e.message)) },
                        onOpenInHerdr && { icon: 'external', label: t('Open in Herdr view'), run: () => onOpenInHerdr(r.id) },
                        r.kind === 'agent' && { icon: r.agent.muted ? 'bell' : 'bell-off', label: r.agent.muted ? t('Unmute notifications') : t('Mute notifications'),
                          run: () => act(() => api(`/agents/${encodeURIComponent(r.id)}/mute`, { method: 'POST', body: { muted: !r.agent.muted } }), r.agent.muted ? t('Notifications back on') : t('Muted until you unmute it')) },
                        tab && '-',
                        tab && { icon: 'edit', label: t('Rename tab'), run: () => setRenaming({ kind: 'tab', id: tab.tabId }) },
                        tab && { icon: 'layers', label: t('Move to space…'), run: () => setMoving({ rowId: r.id, id: tab.tabId, ws: g.id, name: rowName(r) }) },
                        tab && { icon: 'x', label: t('Close tab…'), danger: true, run: () => closeTab(tab) },
                      ]} />
                    )}
                    {moving?.rowId === r.id && (
                      <Menu onClose={() => setMoving(null)} items={[
                        ...groups.filter((x) => x.id !== g.id).map((x) => ({ icon: 'layers', label: `${x.number}. ${x.label}`, run: () => moveToSpace(moving, { workspaceId: x.id }) })),
                        '-',
                        { icon: 'plus', label: t('A new space'), run: () => moveToSpace(moving, { newSpace: moving.name || t('New space') }) },
                      ]} />
                    )}
                  </div>
                )
              })}
            </section>
          )
        })}
        {drag?.kind === 'tab' && (
          <div className={`new-space-drop ${over?.id === 'new-space' ? 'on' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver({ id: 'new-space' }) }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); const d = drag; endDrag(); moveToSpace(d, { newSpace: d.name || t('New space') }) }}>
            <Icon name="plus" size={13} /> {t('Drop here for a new space')}
          </div>
        )}
      </div>
      {flash && <div className="rail-flash" role="status">{flash}</div>}
      {fleet && !hasMate && !fleet.down && (
        <div className="rail-foot">
          <button className="btn primary block" data-tour="chief" onClick={launch} disabled={launching}>
            <Icon name="helm" /> {launching ? t('Launching…') : t('Chief of Staff')}
          </button>
          {error && <p className="error-text">{error}</p>}
        </div>
      )}
    </nav>
  )
}
