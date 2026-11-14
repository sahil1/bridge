import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, fmtTime } from '../../api.js'
import { clock } from './recording.jsx'
import { RecentFiles } from './context.jsx'
import { usePersisted } from '../layout.jsx'
import { useTrial } from '../../trials.js'
import { day } from './bulk.jsx'
import { t, tx } from '../../i18n/index.js'

// AI Assist's Suggest what to ask, while a meeting records (its Suggestions view): now and then a
// model reads along and suggests what to ask, raise or check next, from what's been said, the
// invite, the files that go with the meeting (a candidate's resume, the deck) and your notes (server
// meetings.js assist). Each says what it's based on. Keep one and it goes in your notes; dismiss the
// rest. Suggest now asks straight away, before anyone has talked too: questions from the resume,
// say. While it records, files you got lately that look like they go with the meeting are offered
// here too, so AI Assist can read them.
// It says when it last looked, so a quiet stretch never looks like it stopped: "Looked at 2:14 PM:
// nothing stood out yet". How often it suggests is a slider, Low to High, for every meeting (Settings ›
// Voice & Meetings has it too), and the suggestions sort newest first, oldest first or by kind (per browser).
// With Answers in AI Assist on (a beta feature, src/trials.js), a question raised in the meeting that
// has a general or factual answer is answered here too, on a card of its own (AnswerTip).

export const KIND = { question: tx('Ask'), point: tx('Raise'), check: tx('Check'), idea: tx('Idea'), answer: tx('Answered') }
const LEVELS = ['low', 'medium', 'high']
const LEVEL = { low: tx('Low'), medium: tx('Medium'), high: tx('High') }
const EVERY = { low: tx('every few minutes, and only when something stands out'), medium: tx('about once a minute'), high: tx('about every 30 seconds') }
const SORTS = [['new', tx('Newest first')], ['old', tx('Oldest first')], ['kind', tx('By kind')]]
const KIND_ORDER = ['question', 'point', 'check', 'idea', 'answer']
const meeting = (id) => `/meetings/${encodeURIComponent(id)}`
export const setAssist = (id, on) => api(`${meeting(id)}/assist`, { method: 'POST', body: { on } })
export const markAssist = (id, aid, state) => api(`${meeting(id)}/assist/${encodeURIComponent(aid)}`, { method: 'PATCH', body: { state } })

// Where an answer is from, each as it reads: a past meeting (its name and day), your notes, this
// meeting's files, meeting memory, the model's own knowledge (which may be out of date) or the web.
const FROM = { notes: tx('Your notes'), files: tx("This meeting's files"), memory: tx('Meeting memory') }
const modelName = (id) => String(id || '').replace(/^\w+:/, '') || t('the model')
export function fromWords(s, x) {
  if (s.kind === 'meeting') return `${s.title} · ${day(s.startedAt)}`
  if (s.kind === 'general') return t("{model}'s own knowledge, which may be out of date", { model: modelName(x.model) })
  if (s.kind === 'web') return t('The web, via {via}', { via: s.via })
  return FROM[s.kind] ? t(FROM[s.kind]) : null
}
// Where a lookup on the web has got to, in a few words: looking, couldn't (and why), or not set up.
export function webWords(x) {
  if (x.web?.state === 'looking') return t('Looking it up on the web, via {via}…', { via: x.web.via })
  if (x.web?.state === 'failed') return t("Couldn't look it up on the web: {error}", { error: x.web.error || t('no reason given') })
  if (x.web?.state === 'off') return t('Answers like this can be looked up on the web: add a Perplexity key in Settings › Model Providers.')
  return null
}
const openMeeting = (mid) => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { id: mid } }))
const openProviders = () => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))
const who = (w) => (w === 'Them' ? t('Them') : w === 'You' ? t('You') : w)

// An answer to a question raised in the meeting: the question as asked, who asked it and when, the
// answer in a sentence or three, and where it's from, yours first: a past meeting (a click opens
// it), your notes, the files, meeting memory, the model's own knowledge or the web with its pages.
// A lookup on the web says how it's going: looking, couldn't (and why), or how to set one up.
function AnswerTip({ x, busy, onMark }) {
  const web = webWords(x)
  return (
    <div className={`mt-tip k-answer${x.state === 'kept' ? ' kept' : ''}`}>
      <span className="mt-tip-kind">{t(KIND.answer)}</span>
      <span className="mt-tip-text">
        <span className="mt-ans-q"><small className="muted">{x.asked?.who ? t('{who} asked', { who: who(x.asked.who) }) : t('Asked')}</small> <q title={x.asked?.text || ''}>{x.q}</q></span>
        <span className="mt-ans-a">{x.text}</span>
        <span className="mt-ans-from">
          <small className="muted">{t('Sources')}</small>
          {(x.sources || []).map((s, i) => (s.kind === 'meeting'
            ? <button type="button" key={`m${s.id}`} className="chip mt-source" onClick={() => openMeeting(s.id)} title={t('Open "{title}"', { title: s.title })}><Icon name="calendar" size={11} /> {fromWords(s, x)}</button>
            : s.kind === 'web'
              ? <span key={`w${i}`} className="mt-ans-web">
                <small className="mt-ans-src k-web"><Icon name="search" size={11} /> {fromWords(s, x)}</small>
                {(s.links || []).map((l, n) => <a key={n} className="chip mt-source" href={l.url} target="_blank" rel="noopener noreferrer" title={l.url}><b>{n + 1}</b> {l.title || l.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/.*$/, '')}</a>)}
              </span>
              : <small key={s.kind} className={`mt-ans-src k-${s.kind}`}>{fromWords(s, x)}</small>))}
        </span>
        {web && <small className={`mt-ans-web-state ${x.web.state === 'failed' ? 'error-text' : 'muted'}`}>{x.web.state === 'looking' && <span className="aa-spin" />}{web}{x.web.state === 'off' && <> <button type="button" className="link-btn" onClick={openProviders}>{t('Open Model Providers')}</button></>}</small>}
      </span>
      <span className="mt-t">{clock(x.t)}</span>
      {x.state === 'kept'
        ? <span className="muted small">{t('In your notes')}</span>
        : <span className="mt-tip-acts">
          <button type="button" className="ghost-btn" onClick={() => onMark(x, 'kept')} disabled={busy === x.id} aria-label={t('Add to my notes')} title={t('Add to my notes')}><Icon name="check" size={12} /></button>
          <button type="button" className="ghost-btn" onClick={() => onMark(x, 'dismissed')} disabled={busy === x.id} aria-label={t('Dismiss')} title={t('Dismiss')}><Icon name="x" size={12} /></button>
        </span>}
    </div>
  )
}

export function AssistPane({ id, data, onChange, onMsg }) {
  const [busy, setBusy] = useState(null)
  const [sug, setSug] = useState(null)
  const live = data.status === 'recording' || data.status === 'paused'
  const [sort, setSort] = usePersisted('cc-assist-sort', 'new')
  const [level, setLevel] = useState(null) // as picked here, until the meeting says so too
  const lv = LEVELS.includes(level) ? level : LEVELS.includes(data.assistLevel) ? data.assistLevel : 'medium'
  const every = t(EVERY[lv])
  const asSaid = data.assistItems || []
  const items = sort === 'old' ? asSaid : sort === 'kind'
    ? [...asSaid].reverse().sort((a, b) => (KIND_ORDER.indexOf(a.kind) + 1 || 9) - (KIND_ORDER.indexOf(b.kind) + 1 || 9))
    : [...asSaid].reverse()
  const on = !!data.assist
  const answers = useTrial('assist-answers')
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
  // Shown at once; put back, with why, if it couldn't be saved.
  const pickLevel = async (i) => {
    const next = LEVELS[i]
    if (!next || next === lv) return
    setLevel(next)
    try { await api(`${meeting(id)}/assist`, { method: 'POST', body: { level: next } }); onChange() } catch (e) { setLevel(null); onMsg({ error: true, text: e.message }) }
  }
  useEffect(() => { if (level && data.assistLevel === level) setLevel(null) }, [data.assistLevel, level])
  const now = () => run('now', () => api(`${meeting(id)}/assist`, { method: 'POST', body: {} }))
  const mark = (x, state) => run(x.id, async () => { await markAssist(id, x.id, state); if (state === 'kept') onMsg({ text: t('Added to your notes.') }) })
  return (
    <div className="mt-assist">
      <div className="mt-phead">
        <Icon name="wand" size={13} className="mt-assist-wand" />
        <label className="mt-assist-on" title={t('AI Assist: while it records, a model reads along and suggests what to ask or check next')}>
          <input type="checkbox" checked={on} onChange={toggle} disabled={busy === 'on'} />
          <b>{t('Suggest what to ask')}</b>
        </label>
        <span className="muted small">{on ? (data.assisting ? t('Reading along…') : live ? (data.assistAt ? t('Looked at {time}. It looks again {every}.', { time: fmtTime(data.assistAt), every }) : t('It looks once there\'s something to go on, {every}.', { every })) : t('On for this meeting')) : t('Off')}</span>
        <span className="mt-grow" />
        {(on || live) && <button type="button" className="btn small" onClick={now} disabled={!!busy || data.assisting} title={t('Suggest something now, from what has been said and the files')}><Icon name="wand" size={12} /> {busy === 'now' || data.assisting ? t('Thinking…') : t('Suggest now')}</button>}
      </div>
      {(on || items.length > 1) && (
        <div className="mt-assist-opts">
          {on && (
            <label className="mt-assist-level" title={t('How often it suggests something, in every meeting')}>
              <small>{t('How often')}</small>
              <input type="range" min={0} max={2} step={1} value={LEVELS.indexOf(lv)} onChange={(e) => pickLevel(Number(e.target.value))} aria-label={t('How often AI Assist suggests something')} aria-valuetext={t(LEVEL[lv])} />
              <b>{t(LEVEL[lv])}</b>
            </label>
          )}
          <span className="mt-grow" />
          {items.length > 1 && (
            <label className="mt-assist-sort"><small>{t('Sort')}</small>
              <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t('Sort the suggestions')}>{SORTS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>
            </label>
          )}
        </div>
      )}
      {!on && !items.length && <p className="muted small mt-hint">{t('Turn it on and, while the meeting records, it suggests questions to ask and things to check: from what\'s said, the invite, the files that go with the meeting (a resume, a deck) and your notes. Each one says what it\'s based on. It uses the model that writes your notes.')}{answers && ` ${t('It answers questions raised that have a general or factual answer too: from your past meetings, notes and files first, else from what the model knows.')}`}</p>}
      {live && <RecentFiles id={id} sug={sug} compact onLook={() => api(`${meeting(id)}/suggest?ask=1`).then(setSug).catch((e) => onMsg({ error: true, text: t("Couldn't look again: {error}", { error: e.message }) }))} onAdded={(f) => { onChange(); onMsg({ text: t('Added {name}. AI Assist and the notes read it now.', { name: f.name }) }); api(`${meeting(id)}/suggest`).then(setSug).catch(() => {}) }} />}
      {data.assistError && <p className="error-text small">{t("Couldn't suggest anything: {error}", { error: data.assistError })}</p>}
      {on && !items.length && !data.assistError && <p className="muted small mt-hint">{live ? (data.assistAt ? t('Nothing stood out yet. Suggest now asks straight away.') : t('Suggestions appear here once there\'s something to go on. Suggest now asks straight away.')) : t('Nothing was suggested.')}</p>}
      <div className="mt-assist-list">
        {items.map((x) => (x.kind === 'answer' ? <AnswerTip key={x.id} x={x} busy={busy} onMark={mark} /> : (
          <div key={x.id} className={`mt-tip k-${x.kind}${x.state === 'kept' ? ' kept' : ''}`}>
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
        )))}
      </div>
    </div>
  )
}
