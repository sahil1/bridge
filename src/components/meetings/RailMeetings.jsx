import { useMemo } from 'react'
import Icon from '../Icon.jsx'
import { usePoll } from '../../api.js'
import { usePersisted } from '../layout.jsx'
import { clock } from './recording.jsx'
import { day, timeOf, useSelection, BulkBar } from './bulk.jsx'
import { useMeetingMenu, foldersOf } from './actions.jsx'
import { t, locale } from '../../i18n/index.js'

// Your meetings in the sidebar, under Meetings, the way a space lists its tabs: newest first, the
// open one marked, a dot on the one recording. Meetings in a folder are under it, and archived ones
// under Archived, below the days; both start closed. Click opens one; ⌘ or Ctrl-click picks
// several, Shift-click a run of them, for the actions under the list. Right-click one for the rest:
// save, fix a word, a folder, archive, delete.
//
// As meetings pile up the list stays short, the way spaces fold: each of the last seven days is a
// group of its own, the two most recent open; older ones are under Earlier, by week for the month
// before that and by month after, folded until you open them. What you open or fold is kept on this
// device. The meeting recording and the one open always show, under their group's heading when it's
// folded.

const DAY = 864e5
const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const midnight = (v) => { const d = new Date(v); d.setHours(0, 0, 0, 0); return d }
const shortDate = (iso) => new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })

// The last week by day, then Earlier: by week (from Monday) for four weeks, by month before that.
// Each group: { key, label, items }; Earlier: { key: 'earlier', groups }.
function grouped(list, now) {
  const today = midnight(now)
  const days = []
  const older = []
  const at = new Map()
  const into = (arr, key, label) => { let g = at.get(key); if (!g) { g = { key, label, items: [] }; at.set(key, g); arr.push(g) } return g }
  for (const x of list) {
    const d = midnight(x.startedAt)
    const ago = Math.round((today - d) / DAY)
    if (ago < 7) { into(days, `d:${ymd(d)}`, day(x.startedAt)).items.push(x); continue }
    if (ago < 35) {
      const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))
      into(older, `w:${ymd(mon)}`, t('Week of {date}', { date: shortDate(mon) })).items.push(x)
      continue
    }
    const m = new Date(d.getFullYear(), d.getMonth(), 1)
    into(older, `m:${ymd(m)}`, m.toLocaleDateString(locale(), { month: 'long', year: m.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })).items.push(x)
  }
  return { days, earlier: older.length ? { key: 'earlier', groups: older, count: older.reduce((n, g) => n + g.items.length, 0) } : null }
}

export default function RailMeetings({ selected, onOpen }) {
  const { data } = usePoll('/meetings', 8000)
  const all = useMemo(() => data?.meetings || [], [data])
  const [open, setOpen] = usePersisted('cc-rail-meeting-folders', {})
  // What's open or folded among the days, weeks and months: only what you changed, by its date.
  const [folds, setFolds] = usePersisted('cc-rail-meeting-days', {})
  const today = ymd(new Date())
  const loose = useMemo(() => all.filter((x) => !x.archived && !x.folder), [all])
  const { days, earlier } = useMemo(() => grouped(loose, Date.now()), [loose, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const folders = foldersOf(all.filter((x) => !x.archived))
  const archived = all.filter((x) => x.archived)
  // Open unless folded: the two most recent groups (days, or with no day this week, Earlier's first),
  // and Earlier itself only then.
  const leaves = [...days, ...(earlier?.groups || [])]
  const byDefault = new Set(leaves.slice(0, 2).map((g) => g.key))
  if (earlier && days.length < 2) byDefault.add('earlier')
  const isOpen = (key) => (key in folds ? !!folds[key] : byDefault.has(key))
  const fold = (key) => {
    const known = new Set(['earlier', ...leaves.map((g) => g.key)])
    setFolds((f) => ({ ...Object.fromEntries(Object.entries(f).filter(([k]) => known.has(k))), [key]: !isOpen(key) }))
  }
  // Always shown: the one recording, and the one open.
  const keep = (x) => x.status === 'recording' || x.status === 'paused' || selected === `view:meeting:${x.id}`
  const shownOf = (g, on) => (on ? g.items : g.items.filter(keep))
  const inFolder = (f) => all.filter((x) => !x.archived && x.folder === f)
  // In the order shown, for Shift-click runs.
  const shown = [
    ...days.flatMap((g) => shownOf(g, isOpen(g.key))),
    ...(earlier ? earlier.groups.flatMap((g) => shownOf(g, isOpen('earlier') && isOpen(g.key))) : []),
    ...folders.flatMap((f) => shownOf({ items: inFolder(f) }, !!open[f])),
    ...shownOf({ items: archived }, !!open[':archived']),
  ]
  const selection = useSelection(shown)
  const { sel, toggle, clear } = selection
  const menu = useMeetingMenu({ list: all, onOpen, onGone: () => clear() })
  if (!data) return <div className="rail-meetings"><div className="skeleton-rows pad"><div /><div /></div></div>
  const row = (x, when = timeOf(x.startedAt)) => {
    const on = selected === `view:meeting:${x.id}`
    const live = x.status === 'recording' || x.status === 'paused'
    return (
      <button type="button" key={x.id} className={`rm-row${on ? ' on' : ''}${sel.has(x.id) ? ' picked' : ''}`} aria-pressed={sel.has(x.id) || undefined}
        title={`${x.title}\n${shortDate(x.startedAt)} ${timeOf(x.startedAt)}${x.seconds ? ` · ${clock(x.seconds)}` : ''}\n${t('⌘-click to pick several, right-click for more')}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey) { e.preventDefault(); toggle(x.id, { range: e.shiftKey }); return }
          clear(); onOpen(x.id)
        }}
        onContextMenu={(e) => menu.open(e, x)}>
        {live ? <span className={`rec-dot${x.status === 'paused' ? ' paused' : ''}`} aria-label={x.status === 'paused' ? t('paused') : t('recording')} /> : <Icon name={sel.has(x.id) ? 'check' : x.hasSummary ? 'sparkle' : 'mic'} size={11} className="muted" />}
        <span className="rm-title">{x.title}</span>
        <span className="rm-time muted">{when}</span>
      </button>
    )
  }
  // A heading that folds what's under it, with how many are in it.
  const head = (label, n, on, onClick, cls = '') => (
    <button type="button" className={`rm-fold ${cls}`} onClick={onClick} aria-expanded={on}
      aria-label={`${on ? t('Collapse {name}', { name: label }) : t('Expand {name}', { name: label })} (${n === 1 ? t('{n} meeting', { n }) : t('{n} meetings', { n })})`}>
      <Icon name="chevron" size={10} className={`caret ${on ? 'rot90' : ''}`} /><span className="rm-title">{label}</span><span className="rm-time muted">{n}</span>
    </button>
  )
  const dated = (x) => row(x, shortDate(x.startedAt))
  const group = (key, icon, label, items) => (
    <div key={key} className="rm-day rm-folder">
      <button type="button" className="rm-folder-head" onClick={() => setOpen({ ...open, [key]: !open[key] })} aria-expanded={!!open[key]}>
        <Icon name="chevron" size={10} className={`caret ${open[key] ? 'rot90' : ''}`} /><Icon name={icon} size={11} /><span className="rm-title">{label}</span><span className="rm-time muted">{items.length}</span>
      </button>
      {shownOf({ items }, !!open[key]).map(dated)}
    </div>
  )
  const earlyOpen = earlier && isOpen('earlier')
  return (
    <div className="rail-meetings" aria-label={t('Meetings')}>
      {!all.length && <p className="muted small rm-empty">{t('No meetings yet. The record button above starts one.')}</p>}
      <div className="rm-scroll">
        {days.map((g) => {
          const on = isOpen(g.key)
          return (
            <div key={g.key} className="rm-day">
              {head(g.label, g.items.length, on, () => fold(g.key), 'rm-day-head')}
              {shownOf(g, on).map((x) => row(x))}
            </div>
          )
        })}
        {earlier && (
          <div className="rm-day rm-earlier">
            {head(t('Earlier'), earlier.count, earlyOpen, () => fold('earlier'), 'rm-day-head')}
            {earlyOpen
              ? earlier.groups.map((g) => {
                const on = isOpen(g.key)
                return (
                  <div key={g.key} className="rm-day rm-span">
                    {head(g.label, g.items.length, on, () => fold(g.key), 'rm-span-head')}
                    {shownOf(g, on).map(dated)}
                  </div>
                )
              })
              : earlier.groups.flatMap((g) => g.items.filter(keep)).map(dated)}
          </div>
        )}
        {folders.map((f) => group(f, 'folder', f, inFolder(f)))}
        {archived.length > 0 && group(':archived', 'archive', t('Archived'), archived)}
      </div>
      {menu.msg && <p className={`small rm-msg ${menu.msg.error ? 'error-text' : 'muted'}`} role="status">{menu.msg.text}</p>}
      <BulkBar selection={selection} compact list={all} />
      {menu.node}
    </div>
  )
}
