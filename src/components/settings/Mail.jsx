import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll } from '../../api.js'
import { useSettings, SaveNote } from './General.jsx'
import { locale, t } from '../../i18n/index.js'
import '../mail/mail.css'

// Settings › Mail, where Mail is read (a Mac): How You Write, the profile AI Assist writes replies in
// your voice from (server mailassist.js), to read, change, learn again or clear; and Scheduling
// Assist's working hours, the time kept clear around meetings and how many times it offers.
// Bridge AI only reads mail: nothing here changes Mail.
const DEFAULT = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', buffer: 15, travel: 30, count: 3 }
const openProviders = () => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))
const when = (iso) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) : '')

function HowYouWrite() {
  const { data: v, refresh } = usePoll('/mail/voice', 15000)
  const [text, setText] = useState(null)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [sure, setSure] = useState(false)
  useEffect(() => { if (v && text === null) setText(v.profile || '') }, [v]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!v) return <div className="skeleton-rows"><div /><div /></div>
  const dirty = text !== null && text !== (v.profile || '')
  const run = async (what, fn, done) => {
    setBusy(what)
    setMsg(null)
    try { const r = await fn(); if (r && 'profile' in r) setText(r.profile || ''); await refresh(); if (done) setMsg({ text: done }) } catch (e) { setMsg({ error: true, text: e.message, code: e.code }); refresh() } finally { setBusy(null) }
  }
  const learn = () => run('learn', () => api('/mail/voice/learn', { method: 'POST' }), t('Learnt.'))
  const save = () => run('save', () => api('/mail/voice', { method: 'PUT', body: { profile: text } }), t('Saved. It isn\'t learnt again by itself now; Learn again still does.'))
  const drop = (i) => run('drop', () => api('/mail/voice', { method: 'PUT', body: { examples: v.examples.filter((_, j) => j !== i) } }))
  const clear = () => { setSure(false); run('clear', () => api('/mail/voice', { method: 'DELETE' }), t('Cleared. Nothing of it is kept.')) }
  const f = v.from
  return (
    <>
      <p className="muted small">{v.learntAt
        ? t('Learnt on {date} from {replies} emails you sent and {lines} things you said in {meetings} meetings, by {model}.', { date: when(v.learntAt), replies: f?.replies ?? 0, lines: f?.lines ?? 0, meetings: f?.meetings ?? 0, model: v.modelLabel || v.model })
        : v.profile ? t('Written by you.') : t('Not learnt yet. AI Assist offers to learn it the first time it drafts a reply, or Learn now here.')}
        {v.editedAt ? ` ${t('Changed by you on {date}.', { date: when(v.editedAt) })}` : ''}</p>
      {(v.profile || text) && (
        <>
          <textarea className="st-input mvoice-text" rows={Math.min(12, Math.max(4, (text || '').split('\n').length + 1))} value={text ?? ''} onChange={(e) => setText(e.target.value)} aria-label={t('How You Write')} />
          {dirty && <div className="st-row"><button type="button" className="btn small primary" onClick={save} disabled={!!busy}>{t('Save')}</button><button type="button" className="ghost-btn" onClick={() => setText(v.profile || '')}>{t('Cancel')}</button></div>}
        </>
      )}
      {v.examples.length > 0 && (
        <div className="mvoice-examples">
          <b className="small">{t('Examples, from your own mail')}</b>
          {v.examples.map((e, i) => (
            <div key={i} className="mvoice-example">
              <p className="small">{e.text}</p>
              <span className="muted small">{[e.to && t('To {who}', { who: e.to }), e.at && when(e.at)].filter(Boolean).join(' · ')}</span>
              <button type="button" className="icon-btn" onClick={() => drop(i)} disabled={!!busy} aria-label={t('Take this example out')} title={t('Take this example out')}><Icon name="x" size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="st-row">
        <button type="button" className="btn small" onClick={learn} disabled={!!busy || v.learning || !v.now}><Icon name="wand" size={12} /> {busy === 'learn' || v.learning ? t('Learning…') : v.learntAt || v.profile ? t('Learn again') : t('Learn now')}</button>
        {(v.profile || v.examples.length > 0) && (sure
          ? <><button type="button" className="btn small danger" onClick={clear} disabled={!!busy}>{t('Clear it')}</button><button type="button" className="ghost-btn" onClick={() => setSure(false)}>{t('Keep it')}</button></>
          : <button type="button" className="ghost-btn" onClick={() => setSure(true)} disabled={!!busy}><Icon name="trash" size={12} /> {t('Clear')}</button>)}
      </div>
      {!v.now && <p className="small">{t('No model to learn with yet.')} <button type="button" className="link-btn" onClick={openProviders}>{t('Model Providers')}</button></p>}
      {msg && <p className={`small ${msg.error ? 'error-text' : 'muted'}`} role="status">{msg.text}</p>}
      {!msg && v.error && !busy && <p className="error-text small">{t("Last time it couldn't learn: {error}", { error: v.error })}</p>}
      <p className="muted small">{v.now
        ? (v.now.local ? t("It reads your replies in Mail's Sent folders and your own lines in recorded meetings (the ones Who spoke marks as yours), up to 40 of each from the last four months, here on this computer. {model}, the model for your meeting notes, runs on this computer too, so none of it leaves it. Only the profile and its examples are kept, in Bridge AI's folder.", { model: v.now.label })
          : t("It reads your replies in Mail's Sent folders and your own lines in recorded meetings (the ones Who spoke marks as yours), up to 40 of each from the last four months, on this computer, and sends them to {model}, the model for your meeting notes, to write the profile. Only the profile and its examples are kept, in Bridge AI's folder.", { model: v.now.label }))
        : t("It reads your replies in Mail's Sent folders and your own lines in recorded meetings (the ones Who spoke marks as yours), up to 40 of each from the last four months, for the model for your meeting notes to write the profile.")}</p>
    </>
  )
}

export default function Mail() {
  const { s, save, note } = useSettings()
  const [sched, setSched] = useState(null)
  useEffect(() => { if (s && !sched) setSched({ ...DEFAULT, ...(s.effective?.mail?.schedule || {}) }) }, [s]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!s || !sched) return <div className="skeleton-rows"><div /><div /><div /></div>
  const mail = s.effective?.mail || {}
  const put = (patch) => { const next = { ...sched, ...patch }; setSched(next); save({ mail: { schedule: next } }) }
  const day = (d) => new Date(2023, 0, 1 + d).toLocaleDateString(locale(), { weekday: 'short' })
  const order = [1, 2, 3, 4, 5, 6, 0]
  return (
    <div className="st-sections st-mail">
      <SaveNote note={note} />
      <section className="st-sec">
        <h4>{t('How You Write')}</h4>
        <p className="muted small">{t('AI Assist drafts replies in your own tone and language from this: a few lines on how you write, and some of your own replies as examples. Read it, change it, or clear it.')}</p>
        <HowYouWrite />
        <label className="st-check">
          <input type="checkbox" checked={mail.learn !== false} onChange={(e) => save({ mail: { learn: e.target.checked } })} />
          <span><b>{t('Learn it again now and then')}</b> <span className="muted small">{t("Once a week or so, while AI Assist drafts your replies, from the mail and meetings you have then. Not once you've changed it yourself.")}</span></span>
        </label>
      </section>

      <section className="st-sec">
        <h4>{t('Find a Time')}</h4>
        <p className="muted small">{t('When an email asks to meet, AI Assist offers free times from your calendar, read-only: nothing is held or added. They fit these hours, and the other side\'s working day when their time zone is known.')}</p>
        <div className="st-row mdays" role="group" aria-label={t('Working days')}>
          <span>{t('Working days')}</span>
          {order.map((d) => {
            const on = sched.days.includes(d)
            return <button key={d} type="button" className={`fchip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => { const days = on ? sched.days.filter((x) => x !== d) : [...sched.days, d]; if (days.length) put({ days: days.sort() }) }}>{day(d)}</button>
          })}
        </div>
        <div className="st-row">
          <span>{t('Working hours')}</span>
          <input type="time" className="st-input mtime" value={sched.start} onChange={(e) => e.target.value && e.target.value < sched.end && put({ start: e.target.value })} aria-label={t('From')} />
          <span className="muted">{t('to')}</span>
          <input type="time" className="st-input mtime" value={sched.end} onChange={(e) => e.target.value && e.target.value > sched.start && put({ end: e.target.value })} aria-label={t('To')} />
        </div>
        <label className="st-row">
          <span>{t('Kept clear around meetings')}</span>
          <select className="st-input" value={sched.buffer} onChange={(e) => put({ buffer: Number(e.target.value) })} aria-label={t('Kept clear around meetings')}>
            {[0, 5, 10, 15, 30].map((n) => <option key={n} value={n}>{n ? t('{n} minutes', { n }) : t('None')}</option>)}
          </select>
        </label>
        <label className="st-row">
          <span>{t('Around a meeting somewhere else')}</span>
          <select className="st-input" value={sched.travel} onChange={(e) => put({ travel: Number(e.target.value) })} aria-label={t('Around a meeting somewhere else')}>
            {[0, 15, 30, 45, 60].map((n) => <option key={n} value={n}>{n ? t('{n} minutes', { n }) : t('None')}</option>)}
          </select>
        </label>
        <label className="st-row">
          <span>{t('How many times to offer')}</span>
          <select className="st-input" value={sched.count} onChange={(e) => put({ count: Number(e.target.value) })} aria-label={t('How many times to offer')}>
            {[3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </section>

      <section className="st-sec">
        <h4>{t('Read-Only')}</h4>
        <p className="muted small">{t('Bridge AI reads Mail and never changes it: it doesn\'t send, archive, flag, move or delete mail, or put drafts in your mailbox. Done and Remind me are kept by Bridge AI, and you send replies from your own mail app.')}</p>
      </section>
    </div>
  )
}
