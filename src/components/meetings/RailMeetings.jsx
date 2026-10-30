import Icon from '../Icon.jsx'
import { usePoll } from '../../api.js'
import { usePersisted } from '../layout.jsx'
import { clock } from './recording.jsx'
import { byDay, timeOf, useSelection, BulkBar } from './bulk.jsx'
import { useMeetingMenu, foldersOf } from './actions.jsx'
import { t } from '../../i18n/index.js'

// Your meetings in the sidebar, under Meetings, the way a space lists its tabs: by day, newest
// first, the open one marked, a dot on the one recording. Meetings in a folder are under it, and
// archived ones under Archived, below the days; both start closed. Click opens one; ⌘ or
// Ctrl-click picks several, Shift-click a run of them, for the actions under the list. Right-click
// one for the rest: save, fix a word, a folder, archive, delete.
export default function RailMeetings({ selected, onOpen }) {
  const { data } = usePoll('/meetings', 8000)
  const all = data?.meetings || []
  const [open, setOpen] = usePersisted('cc-rail-meeting-folders', {})
  const loose = all.filter((x) => !x.archived && !x.folder)
  const folders = foldersOf(all.filter((x) => !x.archived))
  const archived = all.filter((x) => x.archived)
  // In the order shown, for Shift-click runs: the days, then each open folder, then Archived if open.
  const shown = [...loose, ...folders.flatMap((f) => (open[f] ? all.filter((x) => !x.archived && x.folder === f) : [])), ...(open[':archived'] ? archived : [])]
  const selection = useSelection(shown)
  const { sel, toggle, clear } = selection
  const menu = useMeetingMenu({ list: all, onOpen, onGone: () => clear() })
  if (!data) return <div className="rail-meetings"><div className="skeleton-rows pad"><div /><div /></div></div>
  const row = (x) => {
    const on = selected === `view:meeting:${x.id}`
    const live = x.status === 'recording' || x.status === 'paused'
    return (
      <button type="button" key={x.id} className={`rm-row${on ? ' on' : ''}${sel.has(x.id) ? ' picked' : ''}`} aria-pressed={sel.has(x.id) || undefined}
        title={`${x.title}\n${timeOf(x.startedAt)}${x.seconds ? ` · ${clock(x.seconds)}` : ''}\n${t('⌘-click to pick several, right-click for more')}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) { e.preventDefault(); toggle(x.id, { range: e.shiftKey }); return }
          clear(); onOpen(x.id)
        }}
        onContextMenu={(e) => menu.open(e, x)}>
        {live ? <span className={`rec-dot${x.status === 'paused' ? ' paused' : ''}`} aria-label={x.status === 'paused' ? t('paused') : t('recording')} /> : <Icon name={sel.has(x.id) ? 'check' : x.hasSummary ? 'sparkle' : 'mic'} size={11} className="muted" />}
        <span className="rm-title">{x.title}</span>
        <span className="rm-time muted">{timeOf(x.startedAt)}</span>
      </button>
    )
  }
  const group = (key, icon, label, items) => (
    <div key={key} className="rm-day rm-folder">
      <button type="button" className="rm-folder-head" onClick={() => setOpen({ ...open, [key]: !open[key] })} aria-expanded={!!open[key]}>
        <Icon name="chevron" size={10} className={`caret ${open[key] ? 'rot90' : ''}`} /><Icon name={icon} size={11} /><span className="rm-title">{label}</span><span className="rm-time muted">{items.length}</span>
      </button>
      {open[key] && items.map(row)}
    </div>
  )
  return (
    <div className="rail-meetings" aria-label={t('Meetings')}>
      {!all.length && <p className="muted small rm-empty">{t('No meetings yet. The record button above starts one.')}</p>}
      <div className="rm-scroll">
        {byDay(loose).map((g) => (
          <div key={g.d} className="rm-day">
            <div className="rm-day-label">{g.d}</div>
            {g.items.map(row)}
          </div>
        ))}
        {folders.map((f) => group(f, 'folder', f, all.filter((x) => !x.archived && x.folder === f)))}
        {archived.length > 0 && group(':archived', 'archive', t('Archived'), archived)}
      </div>
      {menu.msg && <p className={`small rm-msg ${menu.msg.error ? 'error-text' : 'muted'}`} role="status">{menu.msg.text}</p>}
      <BulkBar selection={selection} compact list={all} />
      {menu.node}
    </div>
  )
}
