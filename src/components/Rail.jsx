import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon, { StatusDot } from './Icon.jsx'
import { usePersisted } from './layout.jsx'
import { api, usePoll, fmtRelative, openInTerminal } from '../api.js'

// Mirrors herdr's sidebar: numbered workspaces, each with its tabs. Spaces fold,
// every row shows the folder it works in, and a ⋯ menu covers rename/close/copy.
const RANK = { blocked: 0, done: 1, working: 2, idle: 3, unknown: 4 }
const STATUS_LABEL = { blocked: 'Needs you', done: 'Done', working: 'Working', idle: 'Idle', unknown: 'Unknown' }

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
    return { ...w, number: i + 1, agents: list, rows, status: list.length ? worst(list) : 'unknown' }
  })
}

const rowCwd = (r) => (r.kind === 'agent' ? r.agent.cwd : r.tab.panes.find((p) => !p.agent)?.cwd || r.tab.panes[0]?.cwd)
const rowName = (r) => (r.kind === 'agent'
  ? (r.agent.chief ? 'Chief of staff' : r.agent.tab && !/^\d+$/.test(r.agent.tab) ? r.agent.tab : r.agent.title || 'agent')
  : (r.tab.label && !/^\d+$/.test(r.tab.label) ? r.tab.label : 'shell'))

function GitBit({ g }) {
  if (!g) return null
  return (
    <span className="git-bit" title={`${g.branch}${g.dirty ? `, ${g.dirty} uncommitted change${g.dirty === 1 ? '' : 's'}` : ', clean'}`}>
      <Icon name="branch" size={10} />{g.branch}{g.dirty > 0 && <b>+{g.dirty}</b>}
    </span>
  )
}

// Small dropdown that closes on outside click or Esc.
function Menu({ items, onClose, align = 'right' }) {
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
      onBlur={() => onDone(null)} aria-label="New name" />
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
        <b>{a ? (a.chief ? 'Chief of staff' : a.title || rowName(row)) : rowName(row)}</b>
      </div>
      <div className="hc-meta">
        {a ? <span>{STATUS_LABEL[a.status]} · {a.kind}</span> : <span>{row.tab.panes.length} pane{row.tab.panes.length === 1 ? '' : 's'}</span>}
        {preview?.ts && <span>{fmtRelative(preview.ts)}</span>}
      </div>
      {preview?.text && <p className="hc-preview">{preview.text}</p>}
      <div className="hc-path"><Icon name="folder" size={11} /> <span>{tildePath(cwd)}</span></div>
      {git && <div className="hc-path"><GitBit g={git} /></div>}
    </div>,
    document.body,
  )
}

export default function Rail({ fleet, live, collapsed, onToggle, selected, onOpen, onOpenInHerdr, onOpenFiles, onNewAgent }) {
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState(null)
  const [closedWs, setClosedWs] = usePersisted('cc-rail-closed', {})
  const [menu, setMenu] = useState(null) // row id or `ws:<id>`
  const [renaming, setRenaming] = useState(null) // { kind: 'tab'|'ws', id }
  const [hover, setHover] = useState(null) // { row, rect }
  const [flash, setFlash] = useState(null)
  const [drag, setDrag] = useState(null) // { kind: 'ws'|'tab', id, ws }
  const [over, setOver] = useState(null) // { id, after }
  const [pending, setPending] = useState(null) // optimistic order of space ids until the server confirms
  let groups = groupByWorkspace(fleet)
  if (pending) {
    const pos = Object.fromEntries(pending.map((id, i) => [id, i]))
    if (groups.every((g) => g.id in pos)) groups = [...groups].sort((a, b) => pos[a.id] - pos[b.id]).map((g, i) => ({ ...g, number: i + 1 }))
  }
  useEffect(() => { setPending(null) }, [fleet])
  const hasMate = fleet?.agents?.some((a) => a.chief)
  const places = usePoll('/places', 15000)
  const previews = usePoll('/previews', 10000, { enabled: collapsed })
  const git = (cwd) => places.data?.[cwd] || null
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 2500); return () => clearTimeout(t) }, [flash])

  const launch = async () => {
    setLaunching(true)
    setError(null)
    try { onOpen((await api('/chief/launch', { method: 'POST' })).paneId) } catch (e) { setError(e.message) } finally { setLaunching(false) }
  }
  const allClosed = groups.length > 0 && groups.every((g) => closedWs[g.id])
  const setAll = (closed) => setClosedWs(closed ? Object.fromEntries(groups.map((g) => [g.id, true])) : {})
  const toggleWs = (id) => setClosedWs((c) => { const n = { ...c }; if (n[id]) delete n[id]; else n[id] = true; return n })

  const act = async (fn, ok) => { try { await fn(); if (ok) setFlash(ok) } catch (e) { setFlash(e.message) } }
  const copy = (text) => { navigator.clipboard?.writeText(text).then(() => setFlash('Path copied'), () => setFlash(text)) }
  const rename = async (label) => {
    const r = renaming
    setRenaming(null)
    if (!label) return
    await act(() => api(r.kind === 'ws' ? `/workspaces/${encodeURIComponent(r.id)}/rename` : `/tabs/${encodeURIComponent(r.id)}/rename`, { method: 'POST', body: { label } }))
  }
  const closeTab = (t) => {
    const n = t.panes.length
    if (!window.confirm(`Close the tab "${t.label}"?\n\nThis ends ${n === 1 ? 'the process' : `all ${n} processes`} running in it, the same as closing it in the terminal.`)) return
    act(() => api(`/tabs/${encodeURIComponent(t.tabId)}/close`, { method: 'POST' }), `Closed ${t.label}`)
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
  const dropOn = (e, id) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { id, after: e.clientY > r.top + r.height / 2 }
  }
  const endDrag = () => { setDrag(null); setOver(null) }

  const closeWs = (g) => {
    if (!window.confirm(`Close the space "${g.label}" and all ${g.rows.length} of its tabs?\n\nEverything running in it stops, the same as closing it in the terminal.`)) return
    act(() => api(`/workspaces/${encodeURIComponent(g.id)}/close`, { method: 'POST' }), `Closed ${g.label}`)
  }

  if (collapsed) {
    return (
      <nav className="rail collapsed" aria-label="Workspaces" onMouseLeave={() => setHover(null)}>
        <button className="rail-toggle" onClick={onToggle} aria-label="Expand sidebar" title="Expand sidebar"><Icon name="panel-left" size={16} /></button>
        <div className="rail-mini">
          {groups.filter((g) => g.rows.length).map((g) => (
            <div key={g.id} className="mini-ws">
              <span className="mini-num" title={g.label}>{g.number}</span>
              {g.rows.map((r) => (
                <button key={r.id} className={`mini-agent ${selected === r.id ? 'on' : ''}`} onClick={() => onOpen(r.id)} aria-label={rowName(r)}
                  onMouseEnter={(e) => setHover({ row: r, rect: e.currentTarget.getBoundingClientRect() })} onFocus={(e) => setHover({ row: r, rect: e.currentTarget.getBoundingClientRect() })} onBlur={() => setHover(null)}>
                  {r.kind === 'agent' ? <StatusDot status={r.agent.status} size={9} /> : <Icon name="terminal" size={11} />}
                </button>
              ))}
            </div>
          ))}
        </div>
        <span className={`live-dot ${live ? 'on' : ''}`} title={live ? 'Live' : 'Reconnecting'} />
        {hover && <HoverCard row={hover.row} rect={hover.rect} git={git(rowCwd(hover.row))} preview={hover.row.kind === 'agent' ? previews.data?.[hover.row.id] : null} />}
      </nav>
    )
  }

  return (
    <nav className="rail" aria-label="Workspaces">
      <div className="rail-head">
        <span className="rail-label">Spaces</span>
        <span className={`live-dot ${live ? 'on' : ''}`} title={live ? 'Live updates' : 'Reconnecting'} />
        <span className="rail-tools">
          <button className="rail-tool" onClick={() => onNewAgent?.()} aria-label="New agent" title="New agent"><Icon name="plus" size={14} /></button>
          <button className="rail-tool" onClick={() => setAll(!allClosed)} aria-label={allClosed ? 'Expand all spaces' : 'Collapse all spaces'} title={allClosed ? 'Expand all' : 'Collapse all'}>
            <Icon name={allClosed ? 'unfold-all' : 'fold-all'} size={14} />
          </button>
          <button className="rail-toggle" onClick={onToggle} aria-label="Collapse sidebar" title="Collapse sidebar"><Icon name="panel-left" size={16} /></button>
        </span>
      </div>

      <div className="rail-scroll">
        {!fleet && <div className="skeleton-rows pad"><div /><div /><div /></div>}
        {groups.map((g) => {
          const closed = !!closedWs[g.id]
          const needs = g.agents.filter((a) => a.status === 'blocked').length
          return (
            <section key={g.id} className={`ws ${closed ? 'is-closed' : ''} ${drag?.kind === 'ws' && drag.id === g.id ? 'dragging' : ''} ${drag?.kind === 'ws' && over?.id === g.id ? (over.after ? 'drop-after' : 'drop-before') : ''}`}
              onDragOver={(e) => { if (drag?.kind !== 'ws') return; e.preventDefault(); setOver(dropOn(e, g.id)) }}
              onDrop={(e) => { if (drag?.kind !== 'ws') return; e.preventDefault(); const idx = groups.findIndex((x) => x.id === g.id); moveWs(drag.id, idx + (over?.after ? 1 : 0)); endDrag() }}>
              <div className={`ws-row ${g.rows.length ? '' : 'empty'}`} draggable={!renaming}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', g.label); setDrag({ kind: 'ws', id: g.id }) }} onDragEnd={endDrag}
                title="Drag to reorder">
                <button className="ws-fold" onClick={() => toggleWs(g.id)} aria-expanded={!closed} aria-label={`${closed ? 'Expand' : 'Collapse'} ${g.label}`} title={closed ? 'Expand' : 'Collapse'}>
                  <Icon name="chevron" size={11} className={`caret ${closed ? '' : 'rot90'}`} />
                </button>
                <StatusDot status={g.status} />
                <span className="ws-num">{g.number}</span>
                {renaming?.kind === 'ws' && renaming.id === g.id
                  ? <InlineRename value={g.label} onDone={rename} />
                  : <span className="ws-label" onDoubleClick={() => setRenaming({ kind: 'ws', id: g.id })} title={g.label}>{g.label}</span>}
                {g.crew && <span className="crew-tag">crew</span>}
                {closed && <span className="ws-count" title={`${g.rows.length} tab${g.rows.length === 1 ? '' : 's'}${needs ? `, ${needs} need${needs === 1 ? 's' : ''} you` : ''}`}>{needs ? <b className="needs">{needs}</b> : g.rows.length}</span>}
                <span className="ws-acts">
                  <button className="tab-act" onClick={() => onNewAgent?.({ workspaceId: g.id, cwd: rowCwd(g.rows[0] || {}) })} aria-label={`New agent in ${g.label}`} title="New agent here"><Icon name="plus" size={12} /></button>
                  <button className="tab-act" onClick={() => setMenu(menu === `ws:${g.id}` ? null : `ws:${g.id}`)} aria-label={`${g.label} actions`} title="More"><Icon name="more" size={13} /></button>
                </span>
                {menu === `ws:${g.id}` && (
                  <Menu onClose={() => setMenu(null)} items={[
                    { icon: 'plus', label: 'New agent here', run: () => onNewAgent?.({ workspaceId: g.id, cwd: rowCwd(g.rows[0] || {}) }) },
                    { icon: 'edit', label: 'Rename space', run: () => setRenaming({ kind: 'ws', id: g.id }) },
                    g.number > 1 && { icon: 'chevron', label: 'Move up', run: () => moveWs(g.id, g.number - 2) },
                    g.number < groups.length && { icon: 'chevron', label: 'Move down', run: () => moveWs(g.id, g.number + 1) },
                    '-',
                    { icon: 'x', label: 'Close space…', danger: true, run: () => closeWs(g) },
                  ]} />
                )}
              </div>
              {!closed && g.rows.map((r) => {
                const cwd = rowCwd(r)
                const t = r.tab
                const isRen = renaming?.kind === 'tab' && t && renaming.id === t.tabId
                return (
                  <div key={r.id} className={`tab-row ${r.kind === 'shell' ? 'shell' : ''} ${selected === r.id ? 'on' : ''} ${drag?.kind === 'tab' && t && drag.id === t.tabId ? 'dragging' : ''} ${drag?.kind === 'tab' && over?.id === r.id ? (over.after ? 'drop-after' : 'drop-before') : ''}`}
                    draggable={!!t && !isRen}
                    onDragStart={(e) => { if (!t) return; e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', rowName(r)); setDrag({ kind: 'tab', id: t.tabId, ws: g.id }) }}
                    onDragEnd={endDrag}
                    onDragOver={(e) => { if (drag?.kind !== 'tab' || drag.ws !== g.id || !t) return; e.preventDefault(); e.stopPropagation(); setOver(dropOn(e, r.id)) }}
                    onDrop={(e) => {
                      if (drag?.kind !== 'tab' || drag.ws !== g.id || !t) return
                      e.preventDefault(); e.stopPropagation()
                      const tabs = [...new Set(g.rows.filter((x) => x.tab).map((x) => x.tab.tabId))]
                      moveTab(g, drag.id, tabs.indexOf(t.tabId) + (over?.after ? 1 : 0))
                      endDrag()
                    }}>
                    <button className="tab-main" onClick={() => onOpen(r.id)} onDoubleClick={() => t && setRenaming({ kind: 'tab', id: t.tabId })}
                      title={`${r.kind === 'agent' ? r.agent.title : t.label}\n${tildePath(cwd)}${git(cwd) ? `\n${git(cwd).branch}${git(cwd).dirty ? ` +${git(cwd).dirty}` : ''}` : ''}`}>
                      {r.kind === 'agent' ? <StatusDot status={r.agent.status} size={8} /> : <Icon name="terminal" size={12} className="muted" />}
                      <span className="tab-lines">
                        <span className="tab-line1">
                          {isRen ? <InlineRename value={t.label} onDone={rename} /> : <span className="tab-name">{rowName(r)}</span>}
                          {r.kind === 'agent' && r.agent.chief && <Icon name="helm" size={12} className="tab-badge" />}
                          {r.kind === 'shell' && t.panes.length > 1 && <span className="tab-count">{t.panes.length}</span>}
                        </span>
                        <span className="tab-path"><span className="tp-dir">{shortPath(cwd)}</span><GitBit g={git(cwd)} /></span>
                      </span>
                    </button>
                    <button className="tab-act" onClick={() => setMenu(menu === r.id ? null : r.id)} aria-label={`${rowName(r)} actions`} title="More"><Icon name="more" size={13} /></button>
                    {menu === r.id && (
                      <Menu onClose={() => setMenu(null)} items={[
                        { icon: 'folder', label: 'Browse folder', run: () => onOpenFiles?.(r.id) },
                        { icon: 'copy', label: 'Copy folder path', run: () => copy(cwd) },
                        { icon: 'terminal', label: 'Open in terminal app', run: () => openInTerminal(r.id).catch((e) => window.alert(e.message)) },
                        onOpenInHerdr && { icon: 'external', label: 'Open in Herdr view', run: () => onOpenInHerdr(r.id) },
                        t && '-',
                        t && { icon: 'edit', label: 'Rename tab', run: () => setRenaming({ kind: 'tab', id: t.tabId }) },
                        t && { icon: 'x', label: 'Close tab…', danger: true, run: () => closeTab(t) },
                      ]} />
                    )}
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>

      {flash && <div className="rail-flash" role="status">{flash}</div>}
      {fleet && !hasMate && (
        <div className="rail-foot">
          <button className="btn primary block" onClick={launch} disabled={launching}>
            <Icon name="helm" /> {launching ? 'Launching…' : 'Start chief of staff'}
          </button>
          {error && <p className="error-text">{error}</p>}
        </div>
      )}
    </nav>
  )
}
