import { usePoll } from '../../api.js'
import { RECENT, byDay, timeOf, Glyph, whereOf, openDictations } from './shared.jsx'
import { t } from '../../i18n/index.js'
import './dictations.css'

// Your latest dictations in the sidebar, under Dictations, the way Meetings lists its meetings: the
// last few days, newest first, each with the icon of where it went and its first words. Click one
// to see it whole in Dictations; All dictations for the rest.
export default function RailDictations() {
  const { data } = usePoll(RECENT, 10000)
  if (!data) return <div className="rail-meetings"><div className="skeleton-rows pad"><div /></div></div>
  const items = data.items || []
  let left = 12
  const groups = byDay(items).slice(0, 3).map((g) => { const shown = g.items.slice(0, Math.max(0, left)); left -= shown.length; return { ...g, shown } }).filter((g) => g.shown.length)
  return (
    <div className="rail-meetings rail-dictations" aria-label={t('Dictations')}>
      {!items.length && <p className="muted small rm-empty">{t('Nothing dictated yet.')}</p>}
      <div className="rm-scroll">
        {groups.map((g) => (
          <div key={g.d} className="rm-day">
            <div className="rd-day muted">{g.d}</div>
            {g.shown.map((r) => (
              <button type="button" key={r.id} className="rm-row rd-row" onClick={() => openDictations(r.id)} title={`${whereOf(r)} · ${timeOf(r.at)}\n${r.text.slice(0, 300)}`}>
                <Glyph r={r} size={13} bare />
                <span className="rm-title">{r.text}</span>
                <span className="rm-time muted">{timeOf(r.at)}</span>
              </button>
            ))}
          </div>
        ))}
        {items.length > 0 && <button type="button" className="link-btn small rd-all" onClick={() => openDictations()}>{t('All dictations')}</button>}
      </div>
    </div>
  )
}
