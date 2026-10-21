import Icon, { StatusDot } from './Icon.jsx'
import { PaneHeader, usePersisted } from './layout.jsx'
import { usePoll, fmtRelative } from '../api.js'

const FILTERS = [
  ['all', 'All'],
  ['blocked', 'Needs you'],
  ['working', 'Working'],
  ['done', 'Done'],
  ['idle', 'Idle'],
]

function Tile({ a, p, selected, onOpen, onOpenInHerdr, onOpenSide }) {
  return (
    <article className={`tile tile-${a.status} ${selected ? 'on' : ''}`}>
      <button className="tile-main" onClick={() => onOpen(a.paneId)}>
        <div className="tile-top">
          <StatusDot status={a.status} />
          <span className="tile-title">{a.title || a.tab || 'Untitled'}</span>
        </div>
        <div className="tile-meta">
          <span>{a.workspace}</span>
          {a.tab && !/^\d+$/.test(a.tab) && <><Icon name="chevron" size={10} /><span>{a.tab}</span></>}
          <span className={`tile-kind ${a.crew ? 'crew' : ''}`}>{a.crew ? `crew · ${a.kind}` : a.kind}</span>
        </div>
        {p?.tool && a.status === 'working'
          ? <p className="tile-preview mono"><Icon name="tool" size={11} /> {p.tool}</p>
          : <p className="tile-preview">{p?.text || <span className="muted">No messages yet</span>}</p>}
      </button>
      <footer className="tile-foot">
        <span className="muted">{p?.ts ? fmtRelative(p.ts) : ''}</span>
        <div className="tile-acts">
          {onOpenInHerdr && <button className="ghost-btn" onClick={() => onOpenInHerdr(a.paneId)} title="Open in Herdr view"><Icon name="external" size={12} /> Herdr</button>}
          {onOpenSide && <button className="ghost-btn" onClick={() => onOpenSide(a.paneId)} title="Open beside the current tab"><Icon name="split" size={12} /> Side</button>}
          <button className="ghost-btn strong" onClick={() => onOpen(a.paneId)}><Icon name="chat" size={12} /> Open</button>
        </div>
      </footer>
    </article>
  )
}

export default function Board({ fleet, selected, onOpen, onOpenInHerdr, minimized, maximized, onMinimize, onMaximize, compact }) {
  const [filter, setFilter] = usePersisted('cc-board-filter', 'all')
  const previews = usePoll('/previews', 5000, { enabled: !minimized })
  const all = (fleet?.agents || []).filter((a) => !a.chief)
  const counts = all.reduce((c, a) => ({ ...c, [a.status]: (c[a.status] || 0) + 1 }), {})
  const shown = (filter === 'all' ? all : all.filter((a) => a.status === filter))
    .sort((x, y) => (y.crew - x.crew))

  return (
    <section className={`pane board ${minimized ? 'is-min' : ''}`} aria-label="Agents">
      <PaneHeader icon="grid" title="Agents" subtitle={minimized ? summary(counts) : `${all.length} running`}
        minimized={minimized} maximized={maximized} onMinimize={onMinimize} onMaximize={onMaximize}>
        {!minimized && (
          <div className="chips" role="tablist" aria-label="Filter agents">
            {FILTERS.map(([id, label]) => {
              const n = id === 'all' ? all.length : counts[id] || 0
              if (id !== 'all' && !n && filter !== id) return null
              return (
                <button key={id} role="tab" aria-selected={filter === id} className={`fchip ${filter === id ? 'on' : ''} f-${id}`} onClick={() => setFilter(filter === id ? 'all' : id)}>
                  {id !== 'all' && <StatusDot status={id} size={7} />}{label}<span className="fcount">{n}</span>
                </button>
              )
            })}
          </div>
        )}
      </PaneHeader>
      {!minimized && (
        <div className={`board-grid ${compact ? 'compact' : ''}`}>
          {shown.map((a) => (
            <Tile key={a.paneId} a={a} p={previews.data?.[a.paneId]} selected={selected === a.paneId} onOpen={onOpen} onOpenInHerdr={onOpenInHerdr} onOpenSide={compact ? null : (id) => onOpen(id, { toSide: true })} />
          ))}
          {fleet && !shown.length && <p className="muted empty-note">{filter === 'all' ? 'No other agents running.' : 'Nothing here right now.'}</p>}
        </div>
      )}
    </section>
  )
}

function summary(c) {
  const parts = []
  if (c.blocked) parts.push(`${c.blocked} need you`)
  if (c.working) parts.push(`${c.working} working`)
  if (c.done) parts.push(`${c.done} done`)
  if (c.idle) parts.push(`${c.idle} idle`)
  return parts.join(' · ') || 'none running'
}
