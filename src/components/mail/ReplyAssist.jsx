import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll } from '../../api.js'
import { usePersisted } from '../layout.jsx'
import { CalendarSetup } from '../Agenda.jsx'
import { AssistHead } from '../AiAssist.jsx'
import { locale, t, tx } from '../../i18n/index.js'

// AI Assist's Draft a reply: beside the open email, a reply drafted in your own tone and language by
// the model you picked for meeting notes (server mailassist.js), from your How You Write profile
// (Settings › Mail). Change it here, make it Shorter, Warmer or More direct, then Copy it or Open in
// your mail app, which opens a new message there with it in, to send yourself. It says which model
// wrote it and what went to that model, word for word on request. Bridge AI never sends, and never
// puts anything in your mailbox.
//
// Find a time: when the email asks to meet, or you ask (times: opened for that, with no draft until
// you ask), a few free times from your calendar (read-only) in your working hours and theirs, to put
// in the draft or copy. Nothing is held.
const TWEAKS = [['shorter', tx('Shorter')], ['warmer', tx('Warmer')], ['direct', tx('More direct')]]
export const openMailSettings = () => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'mail' } }))
const openProviders = () => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))
// Each message's draft, kept while the app is open, so going back to it finds it as you left it.
const drafts = new Map()

// A new message in your own mail app, with the draft in it: to, cc, subject and body. It only opens
// there; you send it.
export function mailtoOf(reply, body) {
  const enc = encodeURIComponent
  const to = (reply?.to || []).map((x) => x.address).join(',')
  const cc = (reply?.cc || []).join(',')
  return `mailto:${to}?subject=${enc(reply?.subject || '')}${cc ? `&cc=${enc(cc)}` : ''}&body=${enc(body || '')}`
}

// A free time as you'd say it: yours, and theirs beside it when their time zone is known.
function slotText(s, zone, theirs) {
  const a = new Date(s.start), b = new Date(s.end)
  const day = a.toLocaleDateString(locale(), { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' })
  const clock = (d, tz) => d.toLocaleTimeString(locale(), { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  const mine = `${day}, ${clock(a, zone)}–${clock(b, zone)}`
  if (!theirs) return { mine, theirs: null }
  const shift = (d) => new Date(+d + theirs.offset * 60000)
  const theirDay = shift(a).toLocaleDateString(locale(), { timeZone: 'UTC', weekday: 'short' })
  const same = theirDay === a.toLocaleDateString(locale(), { timeZone: zone, weekday: 'short' })
  return { mine, theirs: `${same ? '' : `${theirDay} `}${clock(shift(a), 'UTC')}–${clock(shift(b), 'UTC')}`, zone: theirs.label }
}

function Scheduling({ id, asked, onUse, busy }) {
  const [st, setSt] = useState(null) // the times route's answer, or { error, code }
  const [off, setOff] = useState({}) // times left out by you
  const [copied, setCopied] = useState(false)
  const load = () => { setSt(null); api(`/mail/${id}/times`).then(setSt, (e) => setSt({ error: e.message, code: e.code })) }
  useEffect(() => { load(); setOff({}) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!st) return <div className="massist-times"><p className="muted small">{t('Looking at your calendar…')}</p></div>
  if (st.error) {
    return (
      <div className="massist-times">
        <b className="small">{t('Find a time')}</b>
        {st.code ? <CalendarSetup error={st.error} code={st.code} onCheck={load} /> : <p className="error-text small">{t("Couldn't read your calendar: {error}", { error: st.error })}</p>}
      </div>
    )
  }
  const kept = st.slots.filter((s) => !off[s.start])
  const s = st.schedule
  const hhmm = (m) => new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
  const copy = async () => {
    const lines = kept.map((x) => { const w = slotText(x, st.zone, st.theirs); return `${w.mine}${w.theirs ? ` (${t('{time} their time ({zone})', { time: w.theirs, zone: w.zone })})` : ''}` })
    try { await navigator.clipboard.writeText(lines.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* the times stay on screen to copy by hand */ }
  }
  return (
    <div className="massist-times">
      <div className="massist-row">
        <b className="small"><Icon name="calendar" size={12} /> {t('Find a time')}</b>
        <span className="muted small">{asked ? t('They ask to meet for {n} minutes.', { n: st.minutes }) : t('{n} minutes', { n: st.minutes })}</span>
      </div>
      {st.slots.length ? (
        <ul className="massist-slots">
          {st.slots.map((x) => {
            const w = slotText(x, st.zone, st.theirs)
            return (
              <li key={x.start}>
                <label>
                  <input type="checkbox" checked={!off[x.start]} onChange={(e) => setOff({ ...off, [x.start]: !e.target.checked })} />
                  <span><b>{w.mine}</b>{w.theirs && <small className="muted">{t('{time} their time ({zone})', { time: w.theirs, zone: w.zone })}</small>}</span>
                </label>
              </li>
            )
          })}
        </ul>
      ) : <p className="small">{t('No free {n} minutes in your working hours in the next two weeks.', { n: st.minutes })}</p>}
      {st.theirs && st.both === false && <p className="muted small">{t("Your working hours and theirs ({zone}) don't meet, so these are in yours.", { zone: st.theirs.label })}</p>}
      <p className="muted small">{t('From your calendar, read-only: {days}, {from} to {to}, {buffer} minutes clear of other meetings ({travel} around one somewhere else){theirs}. Nothing is held or added.', {
        days: s.days.map((d) => new Date(2023, 0, 1 + d).toLocaleDateString(locale(), { weekday: 'short' })).join(' '), from: hhmm(s.start), to: hhmm(s.end), buffer: s.buffer, travel: s.travel,
        theirs: st.theirs ? t(', and in their working day ({zone})', { zone: st.theirs.label }) : '',
      })} <button type="button" className="link-btn" onClick={openMailSettings}>{t('Working hours')}</button></p>
      {kept.length > 0 && (
        <div className="massist-acts">
          <button type="button" className="btn small" disabled={!!busy} onClick={() => onUse(kept, st.theirs)}><Icon name="edit" size={12} /> {busy === 'times' ? t('Writing…') : t('Put these in the draft')}</button>
          <button type="button" className="ghost-btn" onClick={copy}><Icon name="copy" size={12} /> {copied ? t('Copied') : t('Copy times')}</button>
        </div>
      )}
    </div>
  )
}

// What went to the model, in a sentence.
function whatWent(r) {
  const s = r.sent || {}
  const what = [
    s.email && t('the email'), s.quoted && t('the earlier messages it quotes'), s.profile && t('your How You Write profile'),
    s.examples === 1 ? t('one of your replies') : s.examples > 1 && t('{n} of your replies', { n: s.examples }),
    s.times && t('{n} free times from your calendar', { n: s.times }), s.draft && t('your draft so far'),
  ].filter(Boolean).join(', ')
  return r.local ? t('Sent to {model}, on this computer: {what}. Nothing left it.', { model: r.modelLabel, what }) : t('Sent to {model}: {what}.', { model: r.modelLabel, what })
}

export function ReplyAssist({ id, data, nudge, times = false, onClose, beside }) {
  const voice = usePoll('/mail/voice', 5 * 60 * 1000)
  // Looked at afresh as it opens (a model added since, a profile learnt elsewhere) before deciding.
  const [fresh, setFresh] = useState(false)
  useEffect(() => { voice.refresh().finally(() => setFresh(true)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const v = fresh ? voice.data : null
  const [skip, setSkip] = usePersisted('cc-mail-voice-skip', false)
  const [res, setRes] = useState(() => drafts.get(id) || null)
  const [text, setText] = useState(() => drafts.get(id)?.text || '')
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null) // { message, code }
  const [showSent, setShowSent] = useState(false)
  const [copied, setCopied] = useState(false)
  const [findTimes, setFindTimes] = useState(false)
  useEffect(() => { const d = drafts.get(id); setRes(d || null); setText(d?.text || ''); setErr(null); setShowSent(false); setFindTimes(times) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (times) setFindTimes(true) }, [times])
  useEffect(() => { if (res) drafts.set(id, { ...res, text }) }, [id, res, text])

  const write = async (body = {}, what = 'draft') => {
    setBusy(what)
    setErr(null)
    try {
      const r = await api(`/mail/${id}/draft`, { method: 'POST', body: { nudge, voice: !!v?.profile, ...body } })
      setRes(r)
      setText(r.draft)
    } catch (e) { setErr({ message: e.message, code: e.code }) } finally { setBusy(null) }
  }
  const learn = async () => {
    setBusy('learn')
    setErr(null)
    try { await api('/mail/voice/learn', { method: 'POST' }); await voice.refresh(); setBusy(null); write({ voice: true }) } catch (e) { setErr({ message: e.message, code: e.code }); setBusy(null); voice.refresh() }
  }
  // Learning first, the first time, unless you'd rather not; then a draft straight away.
  // Opened for Find a time, the times come first, and a draft when you ask for one.
  const intro = !times && !!v && !v.profile && v.learn && !skip && !!v.now && !res
  useEffect(() => {
    if (!v || res || busy || err || intro || times) return
    write()
  }, [id, !!v, intro, times]) // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setErr({ message: t("Couldn't copy. Select the text and copy it yourself.") }) }
  }
  const who = res?.reply?.to?.[0]
  const asks = !nudge && (data?.meet?.asks || findTimes)
  return (
    <aside className={`massist ${beside ? 'beside' : ''}`} aria-label={t('AI Assist')} data-esc>
      <AssistHead className="massist-head" what={nudge ? t('Draft a nudge') : times && !res ? t('Find a time') : t('Draft a reply')} onClose={onClose} />
      {/* A draft is Bridge AI's, with the model it was written with on hover; before one, which model it will use. */}
      {(res || v?.now) && <p className="muted small massist-by" title={res ? (res.modelLabel ? t('Written with {model}', { model: res.modelLabel }) : undefined) : v.now.label}>{res ? t('By Bridge AI') : t('Uses {model}, the model for your meeting notes', { model: v.now.label })}</p>}

      {intro && (
        <div className="massist-intro">
          <p className="small">{t("AI Assist drafts a reply in your own words. To learn how you write, it reads your replies in Mail's Sent folders and what you said in recorded meetings (the lines Who spoke marks as yours) from the last four months.")}</p>
          <p className="small">{v.now.local
            ? t('Up to 40 of each go to {model}, which runs on this computer, and a short How You Write profile is kept here, for you to read, change or clear in Settings › Mail.', { model: v.now.label })
            : t('Up to 40 of each go to {model} once, and a short How You Write profile is kept on this computer, for you to read, change or clear in Settings › Mail.', { model: v.now.label })}</p>
          <div className="massist-acts">
            <button type="button" className="btn small primary" onClick={learn} disabled={!!busy}><Icon name="wand" size={12} /> {busy === 'learn' ? t('Learning how you write…') : t('Learn how I write')}</button>
            <button type="button" className="ghost-btn" onClick={() => { setSkip(true); write({ voice: false }) }} disabled={!!busy}>{t('Draft without it')}</button>
          </div>
        </div>
      )}

      {fresh && !v && !res && !busy && (
        <div className="massist-err">
          <p className="error-text small">{voice.error || t("Couldn't reach Bridge AI.")}</p>
          <button type="button" className="ghost-btn" onClick={() => write({ voice: false })}><Icon name="refresh" size={12} /> {t('Try again')}</button>
        </div>
      )}
      {busy === 'draft' && <p className="muted small massist-busy"><Icon name="refresh" size={12} className="spin" /> {t('Writing with {model}…', { model: v?.now?.label || t('your model') })}</p>}
      {busy === 'learn' && !intro && <p className="muted small massist-busy"><Icon name="refresh" size={12} className="spin" /> {t('Learning how you write…')}</p>}

      {err && (
        <div className="massist-err">
          <p className="error-text small">{err.message}</p>
          {err.code === 'no_model' && <button type="button" className="btn small" onClick={openProviders}><Icon name="layers" size={12} /> {t('Model Providers')}</button>}
          {err.code === 'nothing' && <button type="button" className="ghost-btn" onClick={() => { setSkip(true); write({ voice: false }) }}>{t('Draft without it')}</button>}
          {err.code !== 'no_model' && err.code !== 'nothing' && <button type="button" className="ghost-btn" onClick={() => write()}><Icon name="refresh" size={12} /> {t('Try again')}</button>}
        </div>
      )}

      {res && (
        <>
          {who && <p className="muted small">{t('To {who}', { who: who.name ? `${who.name} <${who.address}>` : who.address })}{res.reply.cc?.length ? ` · ${t('Cc {who}', { who: res.reply.cc.join(', ') })}` : ''}</p>}
          <textarea className="massist-draft" value={text} onChange={(e) => setText(e.target.value)} aria-label={t('The draft')} rows={Math.min(16, Math.max(6, text.split('\n').length + 1))} disabled={!!busy && busy !== 'times'} />
          <div className="massist-acts">
            {TWEAKS.map(([k, label]) => <button key={k} type="button" className="btn small" disabled={!!busy || !text.trim()} onClick={() => write({ tweak: k, text }, k)}>{busy === k ? t('Writing…') : t(label)}</button>)}
          </div>
          <div className="massist-acts">
            <button type="button" className="btn small" onClick={copy} disabled={!text.trim()}><Icon name="copy" size={12} /> {copied ? t('Copied') : t('Copy')}</button>
            <a className="btn small primary" href={mailtoOf(res.reply, text)}><Icon name="mail" size={12} /> {t('Open in your mail app')}</a>
          </div>
          <p className="muted small massist-sent">{whatWent(res)} {t('Nothing is sent from Bridge AI: you send it from your mail app.')} <button type="button" className="link-btn" onClick={() => setShowSent(!showSent)} aria-expanded={showSent}>{showSent ? t('Hide what was sent') : t('Show what was sent')}</button></p>
          {showSent && <pre className="massist-prompt">{res.prompt}</pre>}
        </>
      )}

      {asks ? <Scheduling id={id} asked={!!data?.meet?.asks} busy={busy} onUse={(times, theirs) => write({ times, theirs }, 'times')} />
        : !nudge && <button type="button" className="ghost-btn massist-find" onClick={() => setFindTimes(true)}><Icon name="calendar" size={12} /> {t('Find a time')}</button>}
      {times && !res && !busy && !err && v && <button type="button" className="ghost-btn massist-find" onClick={() => write()}><Icon name="wand" size={12} /> {t('Draft a reply')}</button>}

      <p className="muted small massist-foot">
        {v?.profile ? t('Written in your voice, from How You Write.') : t('Not using How You Write.')} <button type="button" className="link-btn" onClick={openMailSettings}>{t('How You Write')}</button>
        {!v?.profile && v?.now && !intro && <> · <button type="button" className="link-btn" onClick={() => { setSkip(false); learn() }} disabled={!!busy}>{t('Learn how I write')}</button></>}
      </p>
    </aside>
  )
}
