import Icon, { StatusDot } from './Icon.jsx'
import { PaneHeader, usePersisted } from './layout.jsx'
import { usePoll, fmtRelative } from '../api.js'
import { t, tx } from '../i18n/index.js'

const FILTERS = [
  ['all', tx('All')],
  ['blocked', tx('Needs you')],
  ['working', tx('Working')],
  ['done', tx('Done')],
  ['idle', tx('Idle')],
]
// A status the filters don't name (unknown) counts as idle.
const bucket = (s) => (s === 'blocked' || s === 'working' || s === 'done' ? s : 'idle')

function Tile({ a, p, selected, onOpen, onOpenInHerdr, onOpenSide }) {
  return (
    <article className={`tile tile-${a.status} ${selected ? 'on' : ''}`}>
      <button className="tile-main" onClick={() => onOpen(a.paneId)}>
        <div className="tile-top">
          <StatusDot status={a.status} />
          <span className="tile-title">{a.title || a.tab || t('Untitled')}</span>
        </div>
        <div className="tile-meta">
          <span>{a.workspace}</span>
          {a.tab && !/^\d+$/.test(a.tab) && <><Icon name="chevron" size={10} /><span>{a.tab}</span></>}
          {a.cloud?.repo && <><Icon name="chevron" size={10} /><span>{a.cloud.repo}</span></>}
          <span className={`tile-kind ${a.crew ? 'crew' : ''}`}>{a.crew ? t('crew · {kind}', { kind: a.kind }) : a.cloud ? t('{label} cloud', { label: a.cloud.label }) : a.kind}</span>
          {a.account && <span className="acct-tag" title={t('On the {account} account', { account: a.account })}>{a.account}</span>}
        </div>
        {p?.tool && a.status === 'working'
          ? <p className="tile-preview mono"><Icon name="tool" size={11} /> {p.tool}</p>
          : <p className="tile-preview">{p?.text || <span className="muted">{t('No messages yet')}</span>}</p>}
      </button>
      <footer className="tile-foot">
        <span className="muted">{p?.ts ? fmtRelative(p.ts) : ''}</span>
        <div className="tile-acts">
          {onOpenInHerdr && !a.cloud && <button className="ghost-btn" onClick={() => onOpenInHerdr(a.paneId)} title={t('Open in Herdr view')}><Icon name="external" size={12} /> Herdr</button>}
          {onOpenSide && <button className="ghost-btn" onClick={() => onOpenSide(a.paneId)} title={t('Open beside the current tab')}><Icon name="split" size={12} /> {t('Side')}</button>}
          <button className="ghost-btn strong" onClick={() => onOpen(a.paneId)}><Icon name="chat" size={12} /> {t('Open')}</button>
        </div>
      </footer>
    </article>
  )
}

// title, icon, action (in the header), empty (instead of the plain note) and tally (what each is
// doing rather than how many run, as agents in the cloud end): the phone's Cloud agents.
// onMap: the agent map, with every computer's agents (AgentMap.jsx).
export default function Board({ fleet, selected, onOpen, onOpenInHerdr, onMap, minimized, maximized, onMinimize, onMaximize, compact, title = t('Agents'), icon = 'grid', action = null, empty = null, tally = false }) {
  const [filter, setFilter] = usePersisted('cc-board-filter', 'all')
  const previews = usePoll('/previews', 5000, { enabled: !minimized })
  const all = (fleet?.agents || []).filter((a) => !a.chief)
  const counts = all.reduce((c, a) => ({ ...c, [bucket(a.status)]: (c[bucket(a.status)] || 0) + 1 }), {})
  const shown = (filter === 'all' ? all : all.filter((a) => bucket(a.status) === filter))
    .sort((x, y) => (y.crew - x.crew))
  const tile = (a) => <Tile key={a.paneId} a={a} p={previews.data?.[a.paneId]} selected={selected === a.paneId} onOpen={onOpen} onOpenInHerdr={onOpenInHerdr} onOpenSide={compact ? null : (id) => onOpen(id, { toSide: true })} />

  return (
    <section className={`pane board ${minimized ? 'is-min' : ''}`} aria-label={t('Agents')}>
      <PaneHeader icon={icon} title={title} subtitle={minimized || tally ? summary(counts) : t('{n} running', { n: all.length })}
        minimized={minimized} maximized={maximized} onMinimize={onMinimize} onMaximize={onMaximize}>
        {!minimized && !compact && (
          <div className="chips" role="tablist" aria-label={t('Filter agents')}>
            {FILTERS.map(([id, label]) => {
              const n = id === 'all' ? all.length : counts[id] || 0
              if (id !== 'all' && !n && filter !== id) return null
              return (
                <button key={id} role="tab" aria-selected={filter === id} className={`fchip ${filter === id ? 'on' : ''} f-${id}`} onClick={() => setFilter(filter === id ? 'all' : id)}>
                  {id !== 'all' && <StatusDot status={id} size={7} />}{t(label)}<span className="fcount">{n}</span>
                </button>
              )
            })}
          </div>
        )}
        {onMap && !compact && <button type="button" className="ghost-btn board-map" onClick={onMap} title={t("What's running on each of your computers")}><Icon name="grid" size={12} /> {t('Map')}</button>}
        {action}
      </PaneHeader>
      {/* A phone: every state at a glance, all five in one row that fits, each a filter. */}
      {!minimized && compact && (
        <div className="board-stats" role="tablist" aria-label={t('Filter agents')}>
          {FILTERS.map(([id, label]) => {
            const n = id === 'all' ? all.length : counts[id] || 0
            return (
              <button key={id} role="tab" aria-selected={filter === id} className={`bstat s-${id} ${filter === id ? 'on' : ''} ${n ? '' : 'none'}`} onClick={() => setFilter(id)}>
                <b>{n}</b><span>{t(label)}</span>
              </button>
            )
          })}
        </div>
      )}
      {!minimized && (
        <div className={`board-grid ${compact ? 'compact' : ''}`}>
          {/* All, on a phone: grouped by state, the ones that need you first. */}
          {compact && filter === 'all'
            ? FILTERS.slice(1).map(([id, label]) => {
              const group = shown.filter((a) => bucket(a.status) === id)
              return group.length > 0 && (
                <section key={id} className="board-group" aria-label={t(label)}>
                  <h3 className="bgroup-head"><StatusDot status={id} size={7} />{t(label)}<span className="fcount">{group.length}</span></h3>
                  {group.map(tile)}
                </section>
              )
            })
            : shown.map(tile)}
          {fleet && !shown.length && (filter === 'all' && empty ? empty : <p className="muted empty-note">{filter === 'all' ? t('No other agents running.') : t('Nothing here right now.')}</p>)}
        </div>
      )}
    </section>
  )
}

function summary(c) {
  const parts = []
  if (c.blocked) parts.push(t('{n} need you', { n: c.blocked }))
  if (c.working) parts.push(t('{n} working', { n: c.working }))
  if (c.done) parts.push(t('{n} done', { n: c.done }))
  if (c.idle) parts.push(t('{n} idle', { n: c.idle }))
  return parts.join(' · ') || t('none running')
}
