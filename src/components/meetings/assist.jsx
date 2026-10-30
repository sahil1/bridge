import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'
import { clock } from './recording.jsx'
import { RecentFiles } from './context.jsx'
import { t, tx } from '../../i18n/index.js'

// AI Assist, while a meeting records: now and then a model reads along and suggests what to ask,
// raise or check next, from what's been said, the invite, the files that go with the meeting (a
// candidate's resume, the deck) and your notes (server meetings.js assist). Each says what it's
// based on. Keep one and it goes in your notes; dismiss the rest. Suggest now asks straight away,
// before anyone has talked too: questions from the resume, say. While it records, files you got
// lately that look like they go with the meeting are offered here too, so Assist can read them.

export const KIND = { question: tx('Ask'), point: tx('Raise'), check: tx('Check'), idea: tx('Idea') }
const meeting = (id) => `/meetings/${encodeURIComponent(id)}`
export const setAssist = (id, on) => api(`${meeting(id)}/assist`, { method: 'POST', body: { on } })
export const markAssist = (id, aid, state) => api(`${meeting(id)}/assist/${encodeURIComponent(aid)}`, { method: 'PATCH', body: { state } })

export function AssistPane({ id, data, onChange, onMsg }) {
  const [busy, setBusy] = useState(null)
  const [sug, setSug] = useState(null)
  const live = data.status === 'recording' || data.status === 'paused'
  const items = [...(data.assistItems || [])].reverse()
  const on = !!data.assist
  // Files that may go with it, looked for again every minute while it records.
  useEffect(() => {
    if (!live) return
    let gone = false
    const look = () => api(`${meeting(id)}/suggest`).then((s) => { if (!gone) setSug(s) }).catch(() => {})
    look()
    const timer = setInterval(look, 60_000)
    return () => { gone = true; clearInterval(timer) }
  }, [id, live])
  const run = async (name, fn) => {
    setBusy(name)
    try { await fn(); onChange() } catch (e) { onMsg({ error: true, text: e.message }) } finally { setBusy(null) }
  }
  const toggle = () => run('on', () => setAssist(id, !on))
  const now = () => run('now', () => api(`${meeting(id)}/assist`, { method: 'POST', body: {} }))
  const mark = (x, state) => run(x.id, async () => { await markAssist(id, x.id, state); if (state === 'kept') onMsg({ text: t('Added to your notes.') }) })
  return (
    <div className="mt-assist">
      <div className="mt-phead">
        <label className="mt-assist-on" title={t('While it records, a model reads along and suggests what to ask or check next')}>
          <input type="checkbox" checked={on} onChange={toggle} disabled={busy === 'on'} />
          <b>{t('AI Assist')}</b>
        </label>
        <span className="muted small">{on ? (data.assisting ? t('Reading along…') : live ? t('Suggests as the meeting goes, about once a minute') : t('On for this meeting')) : t('Off')}</span>
        <span className="mt-grow" />
        {(on || live) && <button type="button" className="btn small" onClick={now} disabled={!!busy || data.assisting} title={t('Suggest something now, from what has been said and the files')}><Icon name="bulb" size={12} /> {busy === 'now' || data.assisting ? t('Thinking…') : t('Suggest now')}</button>}
      </div>
      {!on && !items.length && <p className="muted small mt-hint">{t('Turn it on and, while the meeting records, it suggests questions to ask and things to check: from what\'s said, the invite, the files that go with the meeting (a resume, a deck) and your notes. Each one says what it\'s based on. It uses the model that writes your notes.')}</p>}
      {live && <RecentFiles id={id} sug={sug} compact onAdded={(f) => { onChange(); onMsg({ text: t('Added {name}. Assist and the notes read it now.', { name: f.name }) }); api(`${meeting(id)}/suggest`).then(setSug).catch(() => {}) }} />}
      {data.assistError && <p className="error-text small">{t("Couldn't suggest anything: {error}", { error: data.assistError })}</p>}
      {on && !items.length && !data.assistError && <p className="muted small mt-hint">{live ? t('Suggestions appear here once there\'s something to go on. Suggest now asks straight away.') : t('Nothing was suggested.')}</p>}
      <div className="mt-assist-list">
        {items.map((x) => (
          <div key={x.id} className={`mt-tip ${x.kind}${x.state === 'kept' ? ' kept' : ''}`}>
            <span className="mt-tip-kind">{t(KIND[x.kind] || KIND.idea)}</span>
            <span className="mt-tip-text">{x.text}{x.why && <small className="muted">{x.why}</small>}</span>
            <span className="mt-t">{clock(x.t)}</span>
            {x.state === 'kept'
              ? <span className="muted small">{t('In your notes')}</span>
              : <span className="mt-tip-acts">
                <button type="button" className="ghost-btn" onClick={() => mark(x, 'kept')} disabled={busy === x.id} aria-label={t('Add to my notes')} title={t('Add to my notes')}><Icon name="check" size={12} /></button>
                <button type="button" className="ghost-btn" onClick={() => mark(x, 'dismissed')} disabled={busy === x.id} aria-label={t('Dismiss')} title={t('Dismiss')}><Icon name="x" size={12} /></button>
              </span>}
          </div>
        ))}
      </div>
    </div>
  )
}
