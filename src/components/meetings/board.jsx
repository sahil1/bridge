import { useState } from 'react'
import Icon from '../Icon.jsx'
import { api, fmtTime } from '../../api.js'
import { clock } from './recording.jsx'
import { openBoard } from '../whiteboard/links.js'
import { t, tx } from '../../i18n/index.js'

// AI Assist's live board of a meeting (a Beta Feature, Live Meeting Board, src/trials.js): its
// Board view. While the meeting records with it on, the model that writes your notes reads along a
// minute or so at a time and puts on a whiteboard of the meeting's own what was decided, a timeline
// with owners and dates, who does what and the questions still open (server meetings.js boardLook,
// meetboard.js). Each is a suggestion, dashed with the wand here and on the board, to keep or
// discard in either place; it only ever adds, and never says the same thing twice. Here it's the
// board in four lists, kept up as it fills in, with Open the board; after the meeting the board
// stays, its action items onto the task list with a click. Where what's said goes is said plainly
// under its switch, as Suggest what to ask says it.

export const PARTS = [['decision', tx('Decisions')], ['step', tx('Timeline')], ['action', tx('Who does what')], ['question', tx('Open questions')]]
const NONE = { decision: tx('Nothing decided yet.'), step: tx('No dates or steps yet.'), action: tx('Nobody has taken anything on yet.'), question: tx('No open questions yet.') }
const meeting = (id) => `/meetings/${encodeURIComponent(id)}`
export const setBoard = (id, on) => api(`${meeting(id)}/board`, { method: 'POST', body: { on } })

// The board in a few words: "3 decisions, 5 action items" (what there is of the two that matter
// most after a meeting), for the floating card and the summary.
export function boardWords(b) {
  const c = b?.counts || {}
  const parts = [c.decision && (c.decision === 1 ? t('1 decision') : t('{n} decisions', { n: c.decision })), c.action && (c.action === 1 ? t('1 action item') : t('{n} action items', { n: c.action }))].filter(Boolean)
  if (!parts.length && (c.step || c.question)) parts.push(t('{n} on it', { n: (c.step || 0) + (c.question || 0) }))
  return parts.join(', ')
}

// Where what's said goes: the model that writes your notes, by name, and who runs it.
function goesTo(model) {
  if (!model) return t('No model to keep it with yet: sign in to an agent, or add one in Settings › Model Providers.')
  return model.via === 'local'
    ? t('It uses the model that writes your notes, {model}, on this computer: what\'s said stays here.', { model: model.label })
    : t('It uses the model that writes your notes, {model} ({provider}): what\'s said goes there as it comes, a minute or so at a time, with what\'s on the board.', { model: model.label, provider: model.provider || model.label })
}

// One item: its words, who and when where they're not in the words already, when in the meeting
// it came up, and Keep and Discard while it's a suggestion.
function Item({ x, busy, onMark, name }) {
  const sug = x.state === 'suggested'
  const words = x.part === 'action' && name && x.label.startsWith(`${name}: `) ? x.label.slice(name.length + 2) : x.label
  return (
    <div className={`mt-bitem${sug ? ' sug' : ''}`}>
      {sug ? <Icon name="wand" size={11} className="mt-bitem-mark" /> : <Icon name="check" size={11} className="mt-bitem-mark kept" />}
      <span className="mt-bitem-text">{words}{x.tasked && <small className="muted"> · {t('On the task list')}</small>}</span>
      {x.t != null && <span className="mt-t">{clock(x.t)}</span>}
      {sug
        ? <span className="mt-tip-acts">
          <button type="button" className="ghost-btn" onClick={() => onMark(x, 'kept')} disabled={busy} aria-label={t('Keep')} title={t('Keep it on the board')}><Icon name="check" size={12} /></button>
          <button type="button" className="ghost-btn" onClick={() => onMark(x, 'dismissed')} disabled={busy} aria-label={t('Discard')} title={t('Take it off the board')}><Icon name="x" size={12} /></button>
        </span>
        : <span className="muted small mt-bitem-kept">{t('Kept')}</span>}
    </div>
  )
}

export function BoardPane({ id, data, onChange, onMsg, models }) {
  const [busy, setBusy] = useState(null)
  const b = data.liveBoard || {}
  const live = data.status === 'recording' || data.status === 'paused'
  const on = !!b.on
  const items = b.items || []
  const waiting = items.filter((x) => x.state === 'suggested')
  const todo = items.filter((x) => x.part === 'action' && !x.tasked)
  const every = data.assistLevel === 'low' ? t('every few minutes') : t('about once a minute')
  const model = (models || []).find((x) => x.id === (b.use || b.model)) || null
  const run = async (name, fn) => {
    setBusy(name)
    try { await fn(); onChange() } catch (e) { onMsg({ error: true, text: e.message }) } finally { setBusy(null) }
  }
  const toggle = () => run('on', () => setBoard(id, !on))
  const now = () => run('now', () => api(`${meeting(id)}/board`, { method: 'POST', body: {} }))
  const mark = (x, state) => run(x.key, () => api(`${meeting(id)}/board/${encodeURIComponent(x.key)}`, { method: 'PATCH', body: { state } }))
  const all = (state) => run('all', () => api(`${meeting(id)}/board`, { method: 'PATCH', body: { state } }))
  const toTasks = () => run('tasks', async () => {
    const r = await api(`${meeting(id)}/board/tasks`, { method: 'POST', body: {} })
    onMsg({ text: r.added === 1 ? t('1 action item is on the Chief of Staff\'s task list.') : t('{n} action items are on the Chief of Staff\'s task list.', { n: r.added }) })
  })
  const state = !on ? (b.id ? t('Off now; the board stays') : t('Off'))
    : b.busy ? t('Adding to the board…')
      : live ? (b.at ? t('Looked at {time}. It adds to the board {every} as people talk.', { time: fmtTime(b.at), every }) : t('It starts once there\'s something to go on, {every}.', { every }))
        : b.id ? t('Kept while the meeting recorded') : t('On for this meeting')
  const byPerson = (list) => {
    const out = new Map()
    for (const x of list) { const k = x.who || ''; if (!out.has(k)) out.set(k, []); out.get(k).push(x) }
    return [...out.entries()]
  }
  return (
    <div className="mt-assist mt-board">
      <div className="mt-phead">
        <Icon name="wand" size={13} className="mt-assist-wand" />
        <label className="mt-assist-on" title={t('AI Assist: while it records, keep a board of what\'s decided, the timeline, who does what and the open questions')}>
          <input type="checkbox" checked={on} onChange={toggle} disabled={busy === 'on'} />
          <b>{t('Live board')}</b>
        </label>
        <span className="muted small" role="status">{state}</span>
        <span className="mt-grow" />
        {on && (live || data.waiting > 0) && <button type="button" className="btn small" onClick={now} disabled={!!busy || b.busy} title={t('Put what was said since the last look on the board now')}><Icon name="wand" size={12} /> {busy === 'now' || b.busy ? t('Updating…') : t('Update now')}</button>}
        {b.id && <button type="button" className="btn small" onClick={() => openBoard(b.id)} title={t('Open "{name}", the whiteboard of this meeting', { name: b.id })}><Icon name="shapes" size={12} /> {t('Open the board')}</button>}
      </div>
      {(on || b.id) && <p className="muted small mt-board-where">{goesTo(model)}</p>}
      {!on && !b.id && <p className="muted small mt-hint">{t('Turn it on and, while the meeting records, AI Assist keeps a whiteboard of it from what\'s said: what\'s decided, a timeline with owners and dates, who does what and the questions still open. In any call app or a room. Each is a suggestion you keep or discard, here or on the board; it only adds, and never moves or takes away what you put there.')}</p>}
      {b.error && <p className="error-text small" role="alert">{t("Couldn't add to the board: {error}", { error: b.error })}</p>}
      {on && !b.id && !b.error && <p className="muted small mt-hint">{live ? t('The board is made once there\'s something to put on it. Update now looks straight away.') : t('Nothing was put on the board.')}</p>}
      {b.id && (
        <div className="mt-board-parts">
          {PARTS.map(([part, title]) => {
            const list = items.filter((x) => x.part === part)
            return (
              <section key={part} className={`mt-bpart p-${part}`} aria-label={t(title)}>
                <h5>{t(title)}{list.length > 0 && <span className="muted"> · {list.length}</span>}</h5>
                {!list.length && <p className="muted small">{t(NONE[part])}</p>}
                {part === 'action'
                  ? byPerson(list).map(([who, xs]) => (
                    <div key={who || '-'} className="mt-bperson">
                      {who && <b className="small">{who}</b>}
                      {xs.map((x) => <Item key={x.key} x={x} name={who} busy={!!busy} onMark={mark} />)}
                    </div>
                  ))
                  : list.map((x) => <Item key={x.key} x={x} busy={!!busy} onMark={mark} />)}
              </section>
            )
          })}
        </div>
      )}
      {b.id && (waiting.length > 1 || todo.length > 0 || b.other > 0) && (
        <div className="mt-board-foot">
          {waiting.length > 1 && <>
            <span className="muted small">{t('{n} suggestions wait on the board.', { n: waiting.length })}</span>
            <button type="button" className="btn small primary" onClick={() => all('kept')} disabled={!!busy}><Icon name="check" size={12} /> {t('Keep all')}</button>
            <button type="button" className="btn small" onClick={() => all('dismissed')} disabled={!!busy}>{t('Discard all')}</button>
          </>}
          <span className="mt-grow" />
          {todo.length > 0 && <button type="button" className="btn small" onClick={toTasks} disabled={!!busy} title={todo.map((x) => x.label).join('\n')}><Icon name="check" size={12} /> {busy === 'tasks' ? t('Adding…') : todo.length === 1 ? t('Add 1 action item to Tasks') : t('Add {n} action items to Tasks', { n: todo.length })}</button>}
          {b.other > 0 && <span className="muted small">{b.other === 1 ? t('And 1 more thing written on the board.') : t('And {n} more things written on the board.', { n: b.other })}</span>}
        </div>
      )}
    </div>
  )
}

// Under a meeting's summary: its live board, in a few words, a click from being opened.
export function BoardLink({ b, onView }) {
  if (!b?.id) return null
  const words = boardWords(b)
  return (
    <div className="mt-chief mt-board-link" role="group" aria-label={t('Live board')}>
      <Icon name="shapes" size={13} className="mt-assist-wand" />
      <span className="small">{words ? t('Live board: {what}', { what: words }) : t('Live board')}</span>
      <button type="button" className="btn small" onClick={() => openBoard(b.id)}><Icon name="shapes" size={12} /> {t('Open the board')}</button>
      <button type="button" className="link-btn small" onClick={onView}>{t('As lists')}</button>
    </div>
  )
}
