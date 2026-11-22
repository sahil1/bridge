import { useState } from 'react'
import Icon from '../Icon.jsx'
import { api, refetch } from '../../api.js'
import { Dialog } from './tools.jsx'
import { length, openMeeting, clock } from './recording.jsx'
import { t, locale } from '../../i18n/index.js'

// One meeting recorded as two (Bridge AI closed while it recorded, or Stop was pressed by mistake):
// merged, the later one becomes the next part of the earlier, as Resume recording would have made it
// (server meetings.js merge), and Separate puts them back as two for a week. Merge with… picks the
// other one from the meetings that day; the later of two that look like one meeting (the same
// calendar event, or just after) suggests it on its page.

export const mergeMeetings = async (id, other) => {
  const r = await api(`/meetings/${encodeURIComponent(id)}/merge`, { method: 'POST', body: { id: other } })
  refetch('/meetings')
  return r
}
// As bulk.jsx says a time (not imported from there: it imports actions.jsx, which imports this).
const timeOf = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
const endOf = (x) => x.endedAt || new Date(Date.parse(x.startedAt) + (x.seconds || 0) * 1000).toISOString()
const spanOf = (x) => `${timeOf(x.startedAt)}–${timeOf(endOf(x))}`

// The meetings it could be merged with: the same day's, closest first; none recording, combined
// (no recording of its own) or archived.
export function nearby(list, m) {
  const d = new Date(m.startedAt).toDateString()
  const gap = (x) => Math.abs(Date.parse(x.startedAt) - Date.parse(m.startedAt))
  return (list || []).filter((x) => x.id !== m.id && !x.parts && !x.archived && x.status !== 'recording' && x.status !== 'paused' && new Date(x.startedAt).toDateString() === d).sort((a, b) => gap(a) - gap(b))
}

// Merge with…: one of the meetings near it, each with when it was. onDone(merged): the meeting
// they're one of now (the earlier one).
export function MergePick({ m, list, onClose, onDone }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const near = nearby(list, m).slice(0, 12)
  const hinted = (x) => m.mergeHint?.id === x.id || x.mergeHint?.id === m.id
  const go = async (x) => {
    setBusy(x.id); setErr(null)
    try { const r = await mergeMeetings(m.id, x.id); onClose(); onDone?.(r) } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  return (
    <Dialog title={t('Merge with another meeting')} onClose={onClose}>
      <div className="mt-fix mt-merge-pick">
        <p className="muted small">{t('The later of the two becomes the next part of the earlier, as if recording had been resumed: its audio, transcript, notes, pictures and video carry on after it, and the summary is written again. You can separate them again for 7 days.')}</p>
        {near.length ? (
          <div className="mt-pick-list" role="menu" aria-label={t('Merge with another meeting')}>
            {near.map((x) => (
              <button key={x.id} type="button" role="menuitem" className="mt-pick-opt" disabled={!!busy} onClick={() => go(x)}>
                <Icon name={busy === x.id ? 'refresh' : 'branch'} size={16} className={busy === x.id ? 'spin' : ''} />
                <span>{x.title} <small className="muted">{spanOf(x)} · {length(x.seconds)}{hinted(x) ? ` · ${t('suggested')}` : ''}</small></span>
              </button>
            ))}
          </div>
        ) : <p className="muted small">{t('No other meeting that day to merge it with.')}</p>}
        {err && <p className="error-text small" role="alert">{err}</p>}
        <div className="mt-dialog-acts"><button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button></div>
      </div>
    </Dialog>
  )
}

// On the later of two recordings of one meeting: what merging does, in one click, or Not the same
// meeting, and it isn't suggested for these two again. onMerged(merged): the meeting they're one of
// now, this one gone.
export function MergeHint({ data, onMerged, onMsg }) {
  const [busy, setBusy] = useState(false)
  const [gone, setGone] = useState(null)
  const h = data.mergeHint
  if (!h || gone === h.id || data.status !== 'done') return null
  const why = h.why === 'event' ? t('Both were recorded during {event} on your calendar.', { event: data.event?.title || h.title })
    : h.why === 'closed' ? t('Bridge AI closed while that one was recording, and this one started soon after.')
      : t('This one started soon after that one ended.')
  const merge = async () => {
    setBusy(true)
    try { onMerged(await mergeMeetings(data.id, h.id)) } catch (e) { onMsg({ error: true, text: e.message }) } finally { setBusy(false) }
  }
  const no = async () => {
    setGone(h.id)
    try { await api(`/meetings/${encodeURIComponent(data.id)}/merge-hint`, { method: 'POST', body: { not: h.id } }); refetch('/meetings') } catch (e) { setGone(null); onMsg({ error: true, text: e.message }) }
  }
  return (
    <div className="mt-merge-hint" role="status">
      <Icon name="branch" size={15} />
      <span className="mt-merge-text">
        <b>{t('The rest of {title}, {from}–{to}', { title: h.title, from: timeOf(data.startedAt), to: timeOf(endOf(data)) })}</b>
        <small className="muted">{why} {t('Merging makes this recording its next part, with its transcript, notes and pictures, and writes the summary again. You can separate them again for 7 days.')}</small>
      </span>
      <span className="mt-merge-acts">
        <button type="button" className="btn small primary" disabled={busy} onClick={merge}>{busy ? t('Merging…') : t('Merge into one meeting')}</button>
        <button type="button" className="ghost-btn" disabled={busy} onClick={no} title={t("Don't suggest merging these two again")}>{t('Not the same meeting')}</button>
      </span>
    </div>
  )
}

// On a meeting another was merged into, for as long as it can be separated: which, and Separate.
export function Merged({ data, onDone, onMsg }) {
  const [busy, setBusy] = useState(false)
  const last = (data.merged || [])[(data.merged || []).length - 1]
  if (!last?.kept || data.status !== 'done') return null
  const until = new Date(last.until).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }).replace(/ /g, '\u00a0')
  const separate = async () => {
    setBusy(true)
    try {
      const r = await api(`/meetings/${encodeURIComponent(data.id)}/separate`, { method: 'POST', body: { id: last.id } })
      refetch('/meetings')
      onMsg({ text: t('Separated: {title} is a meeting of its own again.', { title: last.title }), act: { label: t('Open it'), run: () => openMeeting(r.separated) } })
      onDone?.()
    } catch (e) { onMsg({ error: true, text: e.message }) } finally { setBusy(false) }
  }
  const words = t('Merged with the recording from {time} ({title}), which carries on from {at}. Separate puts them back as two meetings, until {date}.', { time: timeOf(last.startedAt), title: last.title, at: clock(last.at), date: until })
  const link = <button type="button" className="link-btn" disabled={busy} onClick={separate}>{busy ? t('Separating…') : t('Separate')}</button>
  // Separate kept on a line with the words' last one, so it never starts a line by itself (where
  // the language spaces its words; else the line breaks where it may).
  const cut = words.lastIndexOf(' ')
  const tail = cut > 0 && words.length - cut <= 13 ? words.slice(cut + 1) : ''
  return (
    <p className="mt-merged small muted" role="status">
      <Icon name="branch" size={12} /> <span>{tail ? words.slice(0, cut + 1) : words}</span>
      {tail ? <span className="mt-merged-end">{tail} {link}</span> : <>{' '}{link}</>}
    </p>
  )
}
