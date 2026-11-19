import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'
import { ago } from '../Machines.jsx'
import { t } from '../../i18n/index.js'
import './conversations.css'

// A bot's conversations, one place for all of them (its page's Conversations, in Settings › Bots and
// on the phone too): everyone it talked with, or everywhere it talked (a channel, a direct message),
// one row each, the latest first, never a chat or a sidebar entry of their own. A row opens to its
// turns, oldest first: what was asked, what came of it and what was sent back, and what ran for each
// (server/frontdesk.js turnsIn). A person's row also has their running context (server/botcontext.js):
// what it keeps of their earlier conversations, to pick up where they left off, which you keep or let
// go of as its memory setting says, and forget all at once.
// And Answer In, a setting in its Set Up: where a question at the top of a channel is answered.

// Where, as the platform calls it: a direct message, #a-channel, or a Teams channel by its name.
const placeName = (p) => (p?.kind === 'dm' ? t('a direct message') : !p?.name ? t('a channel') : String(p.id || '').startsWith('teams:') ? p.name : `#${p.name}`)
const PLAT = { discord: 'Discord', teams: 'Microsoft Teams' }
const OUTCOME = () => ({
  sent: t('Sent'), edited: t('Sent, as you edited it'), auto: t('Sent without asking'), waiting: t('Waiting for you'), 'passed-on': t('Passed on to you'), sending: t('Sending'),
  discarded: t('Discarded'), refused: t('Refused'), failed: t('Failed'), answering: t('Being answered'), skipped: t('Not for it'), stopped: t('Stopped'), queued: t('Waiting its turn'), command: t('A command'),
})
const outcomeOf = (o) => OUTCOME()[o] || o || ''
const good = (o) => ['sent', 'edited', 'auto'].includes(o)
const saved = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v) } catch { /* private window */ } return null }

// ---------- Answer In ----------
export function AnswerIn({ d, save }) {
  const s = d.settings
  const n = d.carryOn || 30
  const modes = [
    ['channel', t('The Channel'), t('A question at the top of a channel is answered right there, in the channel.')],
    ['thread', t('A Thread'), t('A question at the top of a channel is answered in a thread started from it.')],
  ]
  return (
    <section className="st-sec" data-setting="bots-answer-in">
      <h4>{t('Answer In')}</h4>
      <div className="sb-modes" role="radiogroup" aria-label={t('Answer In')}>
        {modes.map(([k, label, what]) => (
          <label key={k} className={`sb-mode ${s.answerIn === k ? 'on' : ''}`}>
            <input type="radio" name={`sb-answer-in-${d.id}`} checked={s.answerIn === k} onChange={() => save({ answerIn: k })} />
            <span><b>{label}</b><span className="muted small">{what}</span></span>
          </label>
        ))}
      </div>
      <p className="muted small">{t('Either way, when the same person asks again in the same place within {n} minutes, it carries on that conversation: it answers where it answered last, knowing what was said. A reply in a thread stays in that thread, and a direct message is one running conversation.', { n })}</p>
      {s.answerIn === 'channel' && s.auto && <p className="muted small">{t('Slack streams an answer only in a thread, so one in the channel is posted whole.')}</p>}
    </section>
  )
}

// ---------- Conversations ----------
export default function Conversations({ d }) {
  const [by, setBy] = useState(() => (saved('cc-bot-convs-by') === 'place' ? 'place' : 'person'))
  const [x, setX] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    const load = () => api(`/bots/${d.id}/conversations?by=${by}`).then((r) => { if (live) { setX(r); setError(null) } }, (e) => live && setError(e.message))
    load()
    const every = setInterval(() => { if (!document.hidden) load() }, 6000)
    return () => { live = false; clearInterval(every) }
  }, [d.id, by, tick])
  const pick = (k) => { setBy(k); setOpen(null); setX(null); saved('cc-bot-convs-by', k) }
  const rows = x?.by === by ? x.rows : null
  return (
    <section className="st-sec bcv" data-setting="bots-conversations">
      <h4>{t('Conversations')}</h4>
      <p className="muted small">{t('Everyone {bot} talked with, and everywhere, one row each, the latest first. Open one for its turns: what was asked, what was sent back, and what ran for each.', { bot: d.name })}</p>
      <div className="seg bcv-by" role="radiogroup" aria-label={t('Group conversations')}>
        <button type="button" role="radio" aria-checked={by === 'person'} className={by === 'person' ? 'on' : ''} onClick={() => pick('person')}><Icon name="user" size={12} /> {t('By Person')}</button>
        <button type="button" role="radio" aria-checked={by === 'place'} className={by === 'place' ? 'on' : ''} onClick={() => pick('place')}><Icon name="chat" size={12} /> {t('By Channel')}</button>
      </div>
      {error && <p className="error-text small" role="alert">{error}</p>}
      {!rows && !error && <div className="skeleton-rows"><div /><div /><div /></div>}
      {rows && !rows.length && <p className="small sb-none">{t('Nothing yet. Each person who asks {bot} something, and each place they ask it, shows here.', { bot: d.name })}</p>}
      {rows && rows.length > 0 && (
        <ul className="bcv-rows">
          {rows.map((r) => (
            <li key={r.id} className={`bcv-row o-${r.outcome || 'none'} ${open === r.id ? 'open' : ''}`} data-key={r.id}>
              <button type="button" className="bcv-head" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                <span className="bcv-av" aria-hidden="true">{by === 'person' ? (r.person?.name || '?').slice(0, 1).toUpperCase() : <Icon name={r.place?.kind === 'dm' ? 'user' : 'chat'} size={13} />}</span>
                <span className="bcv-text">
                  <span className="small bcv-name">
                    <b>{by === 'person' ? r.person?.name || r.id : r.place?.kind === 'dm' ? t('Direct messages with {name}', { name: r.people?.[0]?.name || t('someone') }) : placeName(r.place)}</b>
                    {PLAT[r.platform] && <span className={`sb-plat p-${r.platform}`}>{PLAT[r.platform]}</span>}
                    {r.waiting > 0 && <span className="sb-tag">{t('{n} waiting in Needs You', { n: r.waiting })}</span>}
                    {r.context?.proposed > 0 && <span className="sb-tag">{t('{n} to keep', { n: r.context.proposed })}</span>}
                  </span>
                  <span className="muted small">
                    {[r.turns === 1 ? t('1 turn') : t('{n} turns', { n: r.turns }),
                      by === 'person' ? (r.places || []).slice(0, 3).map(placeName).join(', ') : (r.people || []).slice(0, 4).map((p) => p.name || p.id).join(', '),
                      r.context?.kept > 0 ? t('Remembers {n} of their conversations', { n: r.context.kept }) : null].filter(Boolean).join(' · ')}
                  </span>
                  {r.asked && <span className="sb-log-q">{r.asked}</span>}
                  {r.outcome && <span className={`muted small bcv-out ${good(r.outcome) ? 'good' : ''}`}>{outcomeOf(r.outcome)}{r.answer ? ` · “${r.answer}”` : ''}</span>}
                </span>
                {r.last && <time className="muted small" dateTime={r.last}>{ago(r.last)}</time>}
              </button>
              {open === r.id && <Turns d={d} by={by} row={r} memory={x?.memory} onChanged={() => setTick((n) => n + 1)} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// One person's or one place's turns, with what ran for each; a person's running context first.
function Turns({ d, by, row, memory, onChanged }) {
  const [x, setX] = useState(null)
  const [error, setError] = useState(null)
  const load = () => api(`/bots/${d.id}/conversations/${by}/${encodeURIComponent(row.id)}`).then((r) => { setX(r); setError(null) }, (e) => setError(e.message))
  useEffect(() => { load() }, [d.id, by, row.id, row.last]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="bcv-open" role="region" aria-label={by === 'person' ? t('Conversations with {name}', { name: row.person?.name || row.id }) : t('Conversations in {place}', { place: placeName(row.place) })}>
      {error && <p className="error-text small">{error}</p>}
      {!x && !error && <div className="skeleton-rows"><div /><div /></div>}
      {x && by === 'person' && <Running d={d} person={row.person} context={x.context} problem={x.problem} memory={memory} onChanged={() => { load(); onChanged() }} />}
      {x && !x.turns.length && <p className="muted small">{t('Its record of these conversations is gone: only what it keeps of them is left.')}</p>}
      {x && x.turns.length > 0 && <ol className="bcv-turns">{x.turns.map((q) => <Turn key={q.id} d={d} q={q} by={by} />)}</ol>}
    </div>
  )
}

// A turn: who asked, where and when, their words (and what was joined to them), what came of it, and
// what ran for it.
function Turn({ d, q, by }) {
  const when = new Date(q.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const reply = q.answer ?? (q.draft || null)
  return (
    <li className={`bcv-turn o-${q.outcome}`} data-q={q.id}>
      <p className="muted small bcv-when">
        {[by === 'place' ? q.from?.name || q.from?.id || t('Someone') : placeName(q.place), when, q.carried ? t('carried on the conversation') : null].filter(Boolean).join(' · ')}
      </p>
      <p className="bcv-asked">{q.text || t('(no words)')}</p>
      {q.more.map((m, i) => <p key={i} className="bcv-asked more"><b>{m.from?.name || m.from?.id || t('Someone')}:</b> {m.text || t('(no words)')}</p>)}
      {reply && <p className={`bcv-answer ${q.answer != null ? 'sent' : ''}`}><b>{d.name}:</b> {reply}</p>}
      <p className={`small bcv-out ${good(q.outcome) ? 'good' : 'muted'}`}>{outcomeOf(q.outcome)}{q.why ? `: ${q.why}` : ''}{q.problem ? ` (${q.problem})` : ''}</p>
      {q.runs.length > 0 && (
        <details className="sb-ctx bcv-ran">
          <summary><Icon name="chevron" size={11} />{q.runs.length === 1 ? t('What ran') : t('What ran ({n})', { n: q.runs.length })}</summary>
          <ul>
            {q.runs.map((r, i) => (
              <li key={i} className="small">
                <b>{r.answerer || (r.agent === 'codex' ? 'Codex' : r.agent === 'model' ? r.model : 'Claude Code')}</b>
                {` · ${r.folders?.length ? r.folders.join(', ') : t('no folders')}`}
                {r.goesOn ? ` · ${t('going on from its earlier conversation')}` : ''}
                {r.earlier?.turns > 0 ? ` · ${r.earlier.turns === 1 ? t('given 1 earlier turn') : t('given {n} earlier turns', { n: r.earlier.turns })}` : ''}
                {r.earlier?.person > 0 ? ` · ${t('given {n} of their earlier conversations', { n: r.earlier.person })}` : ''}
                {r.reads.length > 0 ? ` · ${t('Opened {files}', { files: r.reads.slice(0, 6).join(', ') })}${r.reads.length > 6 ? '…' : ''}` : ''}
                {r.tools.length > 0 ? ` · ${t('Used the MCP tools {tools}', { tools: r.tools.map((x) => `${x.server}: ${x.tool}`).join(', ') })}` : ''}
                {r.end === 'finished' && r.took != null ? ` · ${t('{n} s', { n: Math.round(r.took / 1000) })}` : r.end && r.end !== 'finished' ? ` · ${t('Ended: {why}', { why: r.end })}` : ''}
                {r.earlier?.problem && <span className="error-text"> · {r.earlier.problem}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  )
}

// A person's running context: what it keeps of their earlier conversations (their words and its
// answers, given only when they ask), what waits for you to keep, and Forget.
function Running({ d, person, context, problem, memory, onChanged }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const name = person?.name || person?.id || t('them')
  const act = async (what) => {
    setBusy(what); setError(null)
    try { await api(`/bots/${d.id}/people/${encodeURIComponent(person.id)}/${what}`, { method: 'POST' }); onChanged() } catch (e) { setError(e.message) }
    setBusy(null)
  }
  const kept = context?.kept || []
  const waiting = context?.proposed || []
  const line = (x) => <li key={x.q || x.at} className="small"><span className="muted">{[new Date(x.at).toLocaleDateString([], { month: 'short', day: 'numeric' }), x.where ? placeName(x.where) : null].filter(Boolean).join(' · ')}</span> {t('They asked “{asked}”; it answered “{answered}”', { asked: x.asked, answered: x.answered })}</li>
  return (
    <div className="bcv-running" data-setting="bots-running-context">
      <p className="small sb-sub"><b>{t('Running Context')}</b></p>
      <p className="muted small">{memory === 'off' ? t('Memory is off, so {bot} keeps nothing of its conversations with {name}, and is given nothing it kept before.', { bot: d.name, name }) : t('What {bot} keeps of its earlier conversations with {name}, to pick up where they left off: their words and its answers, given only when {name} asks, never for anyone else.', { bot: d.name, name })}</p>
      {problem && <p className="st-note bad small" role="alert"><Icon name="alert" size={13} /><span>{problem}</span></p>}
      {kept.length > 0 && <ul className="bcv-ctx">{kept.map(line)}</ul>}
      {waiting.length > 0 && (
        <div className="bcv-waiting">
          <p className="small"><b>{t('Waiting for you')}</b></p>
          <ul className="bcv-ctx">{waiting.map(line)}</ul>
          <div className="st-row">
            <button type="button" className="btn small" disabled={!!busy} onClick={() => act('keep')}><Icon name="check" size={12} /> {t('Keep')}</button>
            <button type="button" className="ghost-btn" disabled={!!busy} onClick={() => act('drop')}><Icon name="x" size={12} /> {t('Discard')}</button>
          </div>
        </div>
      )}
      {!kept.length && !waiting.length && <p className="small sb-none">{t('Nothing kept.')}</p>}
      {(kept.length > 0 || waiting.length > 0) && (
        <div className="st-row">
          <button type="button" className="ghost-btn danger" disabled={!!busy} onClick={() => act('forget')} data-act="forget"><Icon name="trash" size={12} /> {t('Forget {name}', { name })}</button>
        </div>
      )}
      {error && <p className="error-text small" role="alert">{error}</p>}
    </div>
  )
}
