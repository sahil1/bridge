import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, refetch } from '../../api.js'
import { t } from '../../i18n/index.js'

// Small things the floating card, the top bar's pill and a call's prompt share: going from one
// meeting to another that's on at the same time, and a recording's name changed where it shows.

// More than one meeting at once (double-booked, or minutes apart): ‹ 1 of 2 ›, to go from one to
// the other where a card or a prompt is about one of them. Nothing with only one. what: said of
// the one showing, on hover. onStep(-1 or 1).
export function Among({ n, i, onStep, what, disabled = false }) {
  if (!(n > 1)) return null
  return (
    <span className="mt-among" role="group" aria-label={t('Meetings at the same time')}>
      <button type="button" className="mt-among-btn" disabled={disabled} onClick={() => onStep(-1)} aria-label={t('Previous meeting')} title={t('Previous meeting')}><Icon name="chevron" size={11} className="flip" /></button>
      <span className="mt-among-n" aria-live="polite" title={what || undefined}>{t('{i} of {n}', { i: i + 1, n })}</span>
      <button type="button" className="mt-among-btn" disabled={disabled} onClick={() => onStep(1)} aria-label={t('Next meeting')} title={t('Next meeting')}><Icon name="chevron" size={11} /></button>
    </span>
  )
}

// The calendar events a call on app that started at `at` could be for (server callevent.js): the
// likeliest first, the one Take notes names it after, then the rest that are on, to pick another
// before it starts. { ev, n, i, step }: the one picked (null: none, or not known yet).
export function useCallEvents(at, app) {
  const [list, setList] = useState([])
  const [i, setI] = useState(0)
  useEffect(() => {
    setList([])
    setI(0)
    if (!at) return
    let on = true
    api(`/calls/event${app ? `?app=${encodeURIComponent(app)}` : ''}`).then((d) => on && setList(d?.event ? [d.event, ...(d.others || [])] : [])).catch(() => {})
    return () => { on = false }
  }, [at, app])
  const n = list.length
  return { ev: list[i] || null, n, i, step: (d) => setI((v) => (v + d + n) % n) }
}

// A recording's name, changed where it shows: the pencil by it (there on hover, or with the
// keyboard), or a double-click on the name, makes it a box with the name selected. Enter or a click
// elsewhere keeps it, Esc leaves it as it was, and an empty name isn't kept. The meeting's invite
// isn't touched: it's the notes' name. onRenamed(title): kept; onError(message): why it wasn't.
export function MeetingName({ id, title, className = '', onRenamed, onError }) {
  const [text, setText] = useState(null) // what's being typed
  const [kept, setKept] = useState(null) // what was just kept, until the title that comes is it
  const left = useRef(false) // Esc: not kept
  useEffect(() => { setKept(null) }, [title])
  useEffect(() => { setText(null) }, [id])
  const shown = kept ?? title
  const edit = () => { left.current = false; setText(shown || '') }
  const keep = async () => {
    if (left.current || text == null) return
    const name = text.trim()
    setText(null)
    if (!name || name === shown) return
    setKept(name)
    try {
      const m = await api(`/meetings/${encodeURIComponent(id)}`, { method: 'PATCH', body: { title: name } })
      refetch('/meetings')
      onRenamed?.(m.title)
    } catch (e) { setKept(null); onError?.(t("Couldn't rename it: {error}", { error: e.message })) }
  }
  const key = (e) => {
    // Typing a name isn't a shortcut of the card's or the app's.
    e.stopPropagation()
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') { left.current = true; setText(null) }
  }
  if (text != null) return <input className="mt-rename" value={text} maxLength={200} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setText(e.target.value)} onBlur={keep} onKeyDown={key} aria-label={t('Meeting title')} />
  return (
    <>
      <span className={className} title={shown} onDoubleClick={edit}>{shown}</span>
      <button type="button" className="fc-x mt-rename-btn" onClick={edit} aria-label={t('Rename the meeting')} title={t('Rename the meeting')}><Icon name="edit" size={12} /></button>
    </>
  )
}
