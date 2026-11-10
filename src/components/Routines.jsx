import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { Card, Updated } from './Trackers.jsx'
import AgentMark from './settings/agentMark.jsx'
import { api, usePoll, fmtRelative, refetch, BASE } from '../api.js'
import { useTrial } from '../trials.js'
import { parse, tidy, toText, describe, next, EXAMPLE } from '../../shared/schedule.js'
import { makeRoutine, nameFrom, shortDir } from './routineDraft.js'
import { t, tx, locale } from '../i18n/index.js'

const EVERY = [['day', tx('Daily')], ['weekday', tx('Weekdays')], ['2d', tx('Every 2 days')], ['3d', tx('Every 3 days')], ['week', tx('Weekly')], ['2w', tx('Every 2 weeks')], ['month', tx('Monthly')]]
const everyLabel = (e) => {
  const l = EVERY.find(([k]) => k === e)?.[1]
  return l ? t(l) : (/^\d+d$/.test(e) ? t('Every {n} days', { n: parseInt(e, 10) }) : e)
}
const STATE = { ok: ['check', tx('Up to date')], due: ['alert', tx('Due')], overdue: ['alert', tx('Overdue')], never: ['dot', tx('No run found')], error: ['alert', tx('Check failed')], paused: ['pause', tx('Paused')], missed: ['alert', tx('Missed')] }
const exact = (iso) => (iso ? new Date(iso).toLocaleString(locale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const dateOnly = (iso) => new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })
const Loading = () => <div className="skeleton-rows"><div /><div /></div>

function useFlash() {
  const [msg, setMsg] = useState(null)
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) }, [msg])
  return [msg, setMsg]
}

// ---------- Schedules (Scheduled Routines, a beta feature: shared/schedule.js) ----------

// A schedule in words, in this page's language.
export const scheduleSaid = (w) => { const [s, v] = describe(w, locale()); return t(s, v) }
// "today 9:00 AM", "tomorrow 9:00 AM", "Mon 16 Nov, 9:00 AM".
export function dayTime(d) {
  const at = new Date(d)
  const time = at.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })
  const days = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()) - new Date(new Date().setHours(0, 0, 0, 0))) / 864e5)
  if (days === 0) return t('today {time}', { time })
  if (days === 1) return t('tomorrow {time}', { time })
  return at.toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
const FREQ = [['day', tx('Every day')], ['weekday', tx('Every weekday')], ['week', tx('Every week')], ['2w', tx('Every 2 weeks')], ['month', tx('Every month')]]
const WEEK = [1, 2, 3, 4, 5, 6, 0]
const dayName = (d, weekday = 'short') => new Date(2000, 0, 2 + d).toLocaleDateString(locale(), { weekday }) // 2 Jan 2000 was a Sunday

// Typed in words ("every weekday at 9"), or picked: how often, the days, the time. Either writes
// the words, which say back what they mean and when the next runs are.
export function SchedulePicker({ text, onText, since = null }) {
  const r = useMemo(() => parse(text), [text])
  const w = r.when
  const set = (patch) => {
    const n = { ...(w || { every: 'weekday', at: '09:00' }), ...patch }
    if ((n.every === 'week' || /^\d+w$/.test(n.every)) && !n.days?.length) n.days = [new Date().getDay()]
    if (n.every === 'month' && !n.date) n.date = new Date().getDate()
    onText(toText(tidy(n)))
  }
  const freqs = w && !FREQ.some(([k]) => k === w.every) ? [...FREQ, [w.every, w.every.endsWith('w') ? t('Every {n} weeks', { n: parseInt(w.every, 10) }) : t('Every {n} days', { n: parseInt(w.every, 10) })]] : FREQ
  const weeks = w && (w.every === 'week' || /^\d+w$/.test(w.every))
  const upcoming = w ? next(w, { from: new Date(), since: since || new Date(), n: 3 }) : []
  return (
    <div className="r-sched">
      <input className="r-sched-text" value={text} onChange={(e) => onText(e.target.value)} placeholder={EXAMPLE} aria-label={t('When it runs')} spellCheck="false" />
      <div className="r-sched-pick">
        <select value={w ? w.every : ''} onChange={(e) => set({ every: e.target.value })} aria-label={t('How often')}>
          {!w && <option value="">{t('How often…')}</option>}
          {freqs.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </select>
        {weeks && (
          <span className="r-days" role="group" aria-label={t('On these days')}>
            {WEEK.map((d) => {
              const on = w.days.includes(d)
              return <button type="button" key={d} className={on ? 'on' : ''} aria-pressed={on} title={dayName(d, 'long')} onClick={() => { const days = on ? w.days.filter((x) => x !== d) : [...w.days, d]; if (days.length) set({ days }) }}>{dayName(d)}</button>
            })}
          </span>
        )}
        {w?.every === 'month' && (
          <select value={w.date} onChange={(e) => set({ date: Number(e.target.value) })} aria-label={t('On day')}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{t('Day {n}', { n })}</option>)}
            <option value={-1}>{t('Its last day')}</option>
          </select>
        )}
        <input type="time" value={w?.at || '09:00'} onChange={(e) => { if (e.target.value) set({ at: e.target.value }) }} aria-label={t('At')} />
      </div>
      {r.error
        ? <p className="r-sched-says bad" role="status"><Icon name="alert" size={11} /> {r.error}</p>
        : (
          <p className="r-sched-says" role="status">
            <Icon name="check" size={11} /> <b>{scheduleSaid(w)}</b>{r.assumed === 'time' && <span className="muted"> {t('(no time given, so 9:00)')}</span>}
            <span className="r-next">{t('Next: {times}', { times: upcoming.map(dayTime).join(' · ') })}</span>
          </p>
        )}
    </div>
  )
}

// ---------- Routines ----------

// beta: Scheduled Routines is on, so it can run by itself at a time, go to the Chief of Staff, and
// start the agent you pick. computer: where it runs.
function RoutineForm({ initial, onSave, onCancel, beta = false, computer = null }) {
  const [f, setF] = useState(() => {
    const base = { name: '', command: '', cwd: '~/', every: 'week', workspace: '', detail: '', kind: '', ...(initial || {}) }
    // A new one runs by itself to start with; one saved before keeps how it was.
    const timed = beta && (initial?.id ? !!(initial.at || initial.schedule) && initial.auto !== false : true)
    return { ...base, to: base.to === 'chief' ? 'chief' : 'agent', timed, schedule: base.schedule || (base.at ? toText(tidy(base)) : 'every weekday at 9:00') }
  })
  const [err, setErr] = useState(null)
  const [kinds, setKinds] = useState(null)
  useEffect(() => { if (beta) api('/agent-kinds').then(setKinds).catch(() => setKinds([])) }, [beta])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const chief = beta && f.to === 'chief'
  const bad = beta && f.timed ? parse(f.schedule).error : null
  const save = async (e) => {
    e.preventDefault()
    if (bad) { setErr(bad); return }
    const body = { name: f.name, command: f.command, cwd: chief ? '' : f.cwd, every: f.every, workspace: chief ? '' : f.workspace, detail: f.detail }
    if (beta) Object.assign(body, { to: chief ? 'chief' : '', kind: chief ? '' : f.kind || '', ...(f.timed ? { schedule: f.schedule, auto: true } : initial?.at ? { schedule: '' } : {}) })
    try { await onSave(body) } catch (x) { setErr(x.message) }
  }
  return (
    <form className="r-form" onSubmit={save}>
      <label><span>{t('Name')}</span><input value={f.name} onChange={set('name')} placeholder={t('Weekly dependency check')} required autoFocus={!initial?.name} /></label>
      <label><span>{t('Command')}</span>
        {beta
          ? <textarea className="mono" rows={3} value={f.command} onChange={set('command')} placeholder={t('/review or a task description')} required />
          : <input className="mono" value={f.command} onChange={set('command')} placeholder={t('/review or a task description')} required />}
      </label>
      {beta && (
        <div className="r-form-row">
          <label><span>{t('Goes to')}</span>
            <select value={f.to} onChange={set('to')}>
              <option value="agent">{t('A new agent')}</option>
              <option value="chief">{t('Chief of Staff')}</option>
            </select>
          </label>
          {!chief && (
            <label><span>{t('Agent')}</span>
              <select value={f.kind} onChange={set('kind')}>
                <option value="">{t('Your default agent')}</option>
                {(kinds || []).map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {!chief && <label><span>{t('Folder')}</span><input className="mono" value={f.cwd} onChange={set('cwd')} placeholder="~/code/my-project" /></label>}
      {beta && (
        <label className="r-check"><input type="checkbox" checked={f.timed} onChange={(e) => setF({ ...f, timed: e.target.checked })} />
          <span><b>{computer ? t('Runs by itself on {computer}', { computer }) : t('Runs by itself')}</b> <span className="muted">{t('At the times below, while Bridge AI is open there. One missed while that computer was off or asleep runs when it\'s back, up to 12 hours late.')}</span></span></label>
      )}
      {beta && f.timed && <div className="r-field"><span>{t('When it runs')}</span><SchedulePicker text={f.schedule} onText={(schedule) => { setErr(null); setF((x) => ({ ...x, schedule })) }} since={initial?.since} /></div>}
      <div className="r-form-row">
        {!(beta && f.timed) && (
          <label><span>{t('Repeats')}</span>
            <select value={f.every} onChange={set('every')}>{EVERY.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select>
          </label>
        )}
        {!chief && <label><span>{t('Space')}</span><input value={f.workspace} onChange={set('workspace')} placeholder={t('Maintenance')} /></label>}
      </div>
      <p className="muted small">{chief
        ? t('Run sends the command to your Chief of Staff (started first if it isn\'t running), after what it\'s doing.')
        : beta && f.timed ? t('Each run opens a new agent in that space and types the command. It asks before it changes files or runs commands, and each run\'s result is kept here.')
          : t('Run opens a Claude tab in that space and types the command. The last run is found in your Claude Code history automatically.')}</p>
      {err && <p className="error-text">{err}</p>}
      <div className="r-form-actions">
        <button type="button" className="btn" onClick={onCancel}>{t('Cancel')}</button>
        <button type="submit" className="btn primary">{initial?.id ? t('Save') : t('Add routine')}</button>
      </div>
    </form>
  )
}

// What became of a run, in a few words: [icon, words, a class for its colour].
function runSaid(x) {
  const when = exact(x.slot || x.at)
  const late = x.how === 'late' && x.slot ? Math.round((new Date(x.at) - new Date(x.slot)) / 60000) : 0
  const lateBy = late ? (late >= 90 ? t('{n} h late', { n: Math.round(late / 60) }) : t('{n} min late', { n: late })) : ''
  if (x.error) return ['alert', t("Didn't run {when}: {error}", { when, error: x.error }), 'bad']
  if (x.missed) return ['alert', t('Missed {when}: {why}', { when, why: x.why }), 'bad']
  if (x.skipped) return ['minus', t('Skipped {when}: {why}', { when, why: x.why }), 'warn']
  const how = x.how === 'hand' || !x.how ? t('by hand') : lateBy || t('by itself')
  if (x.ended?.closed) return ['x', t('Ran {when} ({how}), closed before it finished', { when: exact(x.at), how }), '']
  if (x.ended) return ['check', t('Ran {when} ({how}) and finished', { when: exact(x.at), how }), 'good']
  if (x.waiting) return ['alert', t('Ran {when} ({how}), waiting on you', { when: exact(x.at), how }), 'warn']
  return ['play', t('Running since {when} ({how})', { when: exact(x.at), how }), '']
}

function RunList({ runs, onOpenAgent }) {
  if (!runs?.length) return <p className="muted small r-runs-none">{t('No runs yet.')}</p>
  return (
    <ul className="r-runs">
      {runs.map((x, i) => {
        const [icon, words, tone] = runSaid(x)
        return (
          <li key={`${x.at}-${i}`} className={tone}>
            <Icon name={icon} size={11} />
            <span className="r-run-main">{words}{x.ended?.said && <q className="r-said">{x.ended.said}</q>}</span>
            {x.paneId && !x.ended?.closed && onOpenAgent && <button type="button" className="link-btn" onClick={() => onOpenAgent(x.paneId)}>{t('Open')}</button>}
          </li>
        )
      })}
    </ul>
  )
}

function RoutineRow({ r, editing, onChanged, onOpenAgent, setFlash, beta, computer }) {
  const [busy, setBusy] = useState(null)
  const [edit, setEdit] = useState(false)
  const [open, setOpen] = useState(false)
  const timed = beta && !!r.when
  const [icon, label] = timed && r.state === 'error' ? ['alert', tx("Didn't run")] : STATE[r.state] || STATE.never
  const act = async (kind) => {
    setBusy(kind)
    try {
      if (kind === 'run') {
        const out = await api(`/routines/${r.id}/run`, { method: 'POST' })
        setFlash(r.to === 'chief' ? t('{name} sent to your Chief of Staff', { name: r.name }) : out.waiting ? t('{name} started; Claude is waiting on a prompt', { name: r.name }) : r.workspace ? t('{name} started in {space}', { name: r.name, space: r.workspace }) : t('{name} started in a new space', { name: r.name }))
        if (out.paneId) setTimeout(() => onOpenAgent?.(out.paneId), 1500)
      } else if (kind === 'done') {
        await api(`/routines/${r.id}/done`, { method: 'POST' })
        setFlash(t('Logged {name} as done', { name: r.name }))
      } else if (kind === 'pause') {
        await api(`/routines/${r.id}`, { method: 'PATCH', body: { paused: !r.paused } })
        setFlash(r.paused ? t('{name} runs again from its next time', { name: r.name }) : t('{name} is paused; it won\'t run until you resume it', { name: r.name }))
      } else if (kind === 'delete') {
        if (!window.confirm(t('Remove the routine "{name}"? Its history stays in your Claude Code transcripts.', { name: r.name }))) return
        await api(`/routines/${r.id}`, { method: 'DELETE' })
      }
      onChanged()
    } catch (e) { setFlash(e.message); if (kind === 'run') onChanged() } finally { setBusy(null) }
  }
  if (edit) {
    return <RoutineForm initial={r} beta={beta} computer={computer} onCancel={() => setEdit(false)} onSave={async (f) => { await api(`/routines/${r.id}`, { method: 'PATCH', body: f }); setEdit(false); onChanged() }} />
  }
  const launched = r.lastLaunch && (!r.last || r.lastLaunch.at > r.last.at)
  const lastRun = timed ? r.runs?.[0] : null
  const [, lastWords, lastTone] = lastRun ? runSaid(lastRun) : []
  return (
    <li className={`r-row st-${r.state}`}>
      <span className="r-state" title={t(label)}><Icon name={icon} size={13} /></span>
      <div className="r-main">
        <div className="r-title">
          <b>{r.name}</b>
          {r.to === 'chief' && <span className="r-to"><Icon name="helm" size={10} /> {t('Chief of Staff')}</span>}
          <code className="r-cmd">{r.command}</code>
        </div>
        {timed ? (
          <>
            <div className="r-meta">
              <span className="r-when"><Icon name="repeat" size={10} /> {scheduleSaid(r.when)}</span>
              {r.paused ? <span className="r-note">{t('Paused')}</span> : r.next?.[0] && <span title={r.next.map(exact).join('\n')}>{t('Next {time}', { time: dayTime(r.next[0]) })}</span>}
            </div>
            {lastRun && <div className={`r-last ${lastTone}`}>{lastWords}</div>}
          </>
        ) : (
          <div className="r-meta">
            {r.note && <span className={`r-note s-${r.state}`}>{r.note}</span>}
            {r.last ? <span title={`${exact(r.last.at)} · ${r.last.source}`}>{t('Last {time}', { time: fmtRelative(r.last.at) })}</span> : <span>{t('No run found')}</span>}
            {launched && <span title={exact(r.lastLaunch.at)}>{t('Started {time}', { time: fmtRelative(r.lastLaunch.at) })}</span>}
            <span>{everyLabel(r.every)}</span>
            {r.link && <a href={r.link} target="_blank" rel="noreferrer">{t('Open output')} <Icon name="external" size={10} /></a>}
            {r.auto && r.at && !beta && <span className="r-note">{t("Doesn't run by itself while Scheduled Routines is off (Beta Features)")}</span>}
          </div>
        )}
      </div>
      <div className="r-actions">
        {editing ? (
          <>
            <button className="icon-btn" onClick={() => setEdit(true)} aria-label={t('Edit {name}', { name: r.name })} title={t('Edit')}><Icon name="edit" size={13} /></button>
            <button className="icon-btn danger" onClick={() => act('delete')} aria-label={t('Remove {name}', { name: r.name })} title={t('Remove')}><Icon name="trash" size={13} /></button>
          </>
        ) : (
          <>
            {timed
              ? <>
                <button className={`icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t('Runs of {name}', { name: r.name })} title={t('Its runs')}><Icon name="clock" size={13} /></button>
                <button className="icon-btn" onClick={() => act('pause')} disabled={!!busy} aria-label={r.paused ? t('Resume {name}', { name: r.name }) : t('Pause {name}', { name: r.name })} title={r.paused ? t('Resume') : t('Pause')}><Icon name={r.paused ? 'play' : 'pause'} size={13} /></button>
              </>
              : <button className="icon-btn" onClick={() => act('done')} disabled={!!busy} aria-label={t('Mark {name} done', { name: r.name })} title={t('I did this (log it now)')}><Icon name="check" size={13} /></button>}
            <button className={`run-btn ${r.state === 'ok' || r.state === 'paused' ? '' : 'hot'}`} onClick={() => act('run')} disabled={!!busy} title={r.to === 'chief' ? t('Send {command} to your Chief of Staff now', { command: r.command }) : t('Open a Claude tab in {folder} and run {command}', { folder: r.cwd, command: r.command })}>
              <Icon name={busy === 'run' ? 'refresh' : 'play'} size={11} className={busy === 'run' ? 'spin' : ''} /> {timed ? t('Run now') : t('Run')}
            </button>
          </>
        )}
      </div>
      {timed && open && <RunList runs={r.runs} onOpenAgent={onOpenAgent} />}
    </li>
  )
}

// Asked again and again on a schedule (History › Commands, server/cmdhistory.js): a routine
// offered, filled in, at most two at a time. Dismissed, it's never offered again.
export function Suggested({ limit = 2, onMade }) {
  const { data, refresh } = usePoll('/command-history/suggestions', 10 * 60 * 1000)
  const [err, setErr] = useState(null)
  const items = (data?.suggestions || []).slice(0, limit)
  useEffect(() => { const on = () => refresh(); window.addEventListener('bridge-routine-made', on); return () => window.removeEventListener('bridge-routine-made', on) }, [refresh])
  if (!items.length) return null
  const dismiss = async (s) => { try { await api(`/command-history/suggestions/${s.key}/dismiss`, { method: 'POST' }); refresh() } catch (e) { setErr(e.message) } }
  return (
    <div className="r-suggest">
      {items.map((s) => (
        <div key={s.key} className="r-sug">
          <Icon name="sparkle" size={13} />
          <div className="r-sug-main">
            <b>{t('Make this a routine?')}</b>
            <q>{s.text.length > 140 ? `${s.text.slice(0, 140)}…` : s.text}</q>
            <span className="muted small">{s.to?.chief ? t('Asked of your Chief of Staff on {n} days since {date}, about the same time.', { n: s.count, date: dateOnly(s.first) }) : t('Asked on {n} days since {date}, about the same time, in {folder}.', { n: s.count, date: dateOnly(s.first), folder: shortDir(s.to?.cwd) || '~' })} {t('Suggested: {schedule}.', { schedule: scheduleSaid(s.when) })}</span>
          </div>
          <span className="r-sug-acts">
            <button type="button" className="btn small primary" onClick={() => { makeRoutine({ name: nameFrom(s.text), command: s.text, to: s.to?.chief ? 'chief' : 'agent', cwd: s.to?.cwd || '~/', kind: s.to?.chief || s.to?.kind === 'chat' ? '' : s.to?.kind || '', schedule: toText(s.when) }); onMade?.() }}>{t('Make a routine')}</button>
            <button type="button" className="icon-btn" onClick={() => dismiss(s)} aria-label={t('Dismiss')} title={t("Don't suggest this again")}><Icon name="x" size={12} /></button>
          </span>
        </div>
      ))}
      {err && <p className="error-text small">{err}</p>}
    </div>
  )
}

// The routine dialog, from a message you sent (its chat, History, a suggestion) or ⌘K: the form,
// filled in, then where it runs and when it runs next.
export function RoutineDialog({ initial = {}, onClose, onShow }) {
  const { data } = usePoll('/routines', 5 * 60 * 1000)
  const beta = useTrial('routines')
  const [made, setMade] = useState(null)
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const computer = data?.computer || null
  const when = made?.at ? tidy(made) : null
  const upcoming = when && made.auto ? next(when, { from: new Date(), since: made.since, n: 1 }) : []
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal r-dialog" role="dialog" aria-label={t('New Routine')}>
        <header className="modal-head">
          <Icon name="repeat" size={16} />
          <h3>{t('New Routine')}</h3>
          <button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={14} /></button>
        </header>
        {made ? (
          <div className="r-made" role="status">
            <p><Icon name="check" size={13} /> <b>{t('{name} is a routine now.', { name: made.name })}</b></p>
            <p className="muted small">{when ? `${scheduleSaid(when)}, ${computer ? t('on {computer}', { computer }) : t('on this computer')}.` : t('It shows in Today › Routines, to run when it\'s due.')}{upcoming[0] ? ` ${t('Its first run is {time}.', { time: dayTime(upcoming[0]) })}` : ''}</p>
            <div className="modal-foot">
              <button type="button" className="btn" onClick={() => { onShow?.(); onClose() }}><Icon name="repeat" size={12} /> {t('Show routines')}</button>
              <button type="button" className="btn primary" onClick={onClose}>{t('Done')}</button>
            </div>
          </div>
        ) : (
          <RoutineForm initial={initial} beta={beta} computer={computer} onCancel={onClose} onSave={async (f) => {
            const def = await api('/routines', { method: 'POST', body: f })
            refetch('/routines')
            window.dispatchEvent(new Event('bridge-routine-made'))
            setMade(def)
          }} />
        )}
      </div>
    </div>
  )
}

export function Routines({ onOpenAgent }) {
  const { data, error, refresh } = usePoll('/routines', 5 * 60 * 1000)
  const beta = useTrial('routines')
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [flash, setFlash] = useFlash()
  const list = data?.routines || []
  // A scheduled one ticks over by itself: looked at again a little after its next time.
  const soonest = beta ? list.filter((r) => r.when && !r.paused && r.next?.[0]).map((r) => new Date(r.next[0]) - Date.now()).sort((a, b) => a - b)[0] : null
  useEffect(() => {
    if (soonest == null || soonest > 6 * 3600e3) return
    const id = setTimeout(() => refresh('?refresh=1'), Math.max(5000, soonest + 20000))
    return () => clearTimeout(id)
  }, [soonest, refresh])
  useEffect(() => { const on = () => refresh('?refresh=1'); window.addEventListener('bridge-routine-made', on); return () => window.removeEventListener('bridge-routine-made', on) }, [refresh])
  const due = list.filter((r) => ['due', 'overdue', 'never'].includes(r.state))
  const failed = beta ? list.filter((r) => r.when && ['error', 'missed'].includes(r.state)) : []
  const summary = data ? (failed.length ? t("{n} didn't run · {names}", { n: failed.length, names: failed.map((r) => r.name).join(', ') }) : due.length ? t('{n} due · {names}', { n: due.length, names: due.map((r) => r.name).join(', ') }) : t('All up to date')) : ''
  return (
    <Card icon="repeat" title={t('Routines')} summary={summary} right={
      <span className="updated">
        <button className={`icon-btn ${editing ? 'on' : ''}`} onClick={() => { setEditing(!editing); setAdding(false) }} aria-label={t('Edit routines')} title={editing ? t('Done editing') : t('Edit routines')}><Icon name={editing ? 'check' : 'edit'} size={13} /></button>
        <Updated data={data} onRefresh={() => refresh('?refresh=1')} />
      </span>
    }>
      {!data && !error && <Loading />}
      {error && <p className="error-text">{error}</p>}
      {beta && <Suggested />}
      {data && (
        <ul className="r-list">
          {list.map((r) => <RoutineRow key={r.id} r={r} beta={beta} computer={data.computer} editing={editing} onChanged={() => refresh('?refresh=1')} onOpenAgent={onOpenAgent} setFlash={setFlash} />)}
        </ul>
      )}
      {flash && <p className="r-flash">{flash}</p>}
      {adding ? (
        <RoutineForm beta={beta} computer={data?.computer} onCancel={() => setAdding(false)} onSave={async (f) => { await api('/routines', { method: 'POST', body: f }); setAdding(false); refresh('?refresh=1') }} />
      ) : (
        <button className="ghost-btn add-line" onClick={() => setAdding(true)}><Icon name="plus" size={12} /> {t('Add a routine')}</button>
      )}
      {beta && data?.computer && <p className="muted small r-where"><Icon name="laptop" size={11} /> {t('These run on {computer}. Another computer\'s routines are in its own Today.', { computer: data.computer })}</p>}
    </Card>
  )
}

// ---------- Insights (every agent and account: server/insights.js) ----------

const WRITER = 'bridge-insights-writer'
const SECTIONS = [['working', tx("What's working")], ['friction', tx("What's in your way")], ['tryNext', tx('Try next')]]
const shortDay = (d) => new Date(/^\d{4}-\d\d-\d\d$/.test(d) ? `${d}T00:00` : d).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) // a YYYY-MM-DD is a local day
const hrs = (h) => (h >= 10 ? Math.round(h) : h)

// Rows with a bar for each one's share of the hours.
function Split({ title, rows }) {
  const top = Math.max(...rows.map((r) => r.hours), 0.1)
  return (
    <div className="ins-split">
      <h4>{title}</h4>
      <ul>
        {rows.map((r) => (
          <li key={r.key} className={r.kind ? '' : 'noicon'}>
            {r.kind && <AgentMark kind={r.kind} label={r.name} size={16} />}
            <span className="ins-name" title={r.hint || r.name}>{r.name}</span>
            <span className="ins-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, (r.hours / top) * 100)}%` }} /></span>
            <span className="ins-num">{r.sessions === 1 ? t('{hours} h · {n} session', { hours: hrs(r.hours), n: r.sessions }) : t('{hours} h · {n} sessions', { hours: hrs(r.hours), n: r.sessions })}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Insights() {
  const [fast, setFast] = useState(false)
  const { data, error, refresh } = usePoll('/insights', fast ? 4000 : 10 * 60 * 1000)
  const [open, setOpen] = useState(null)
  const [flash, setFlash] = useFlash()
  const [who, setWho] = useState(() => { try { return localStorage.getItem(WRITER) || '' } catch { return '' } })
  useEffect(() => { if (data) setFast(!!data.running) }, [data])
  const s = data?.stats
  const r = data?.report
  const writers = data?.writers || []
  const pick = writers.some((w) => w.id === who) ? who : writers.some((w) => w.id === r?.who) ? r.who : writers[0]?.id || ''
  const ageDays = r ? (Date.now() - new Date(r.generatedAt)) / 864e5 : null
  const choose = (id) => { setWho(id); try { localStorage.setItem(WRITER, id) } catch { /* private window */ } }
  const write = async () => {
    try { await api('/insights/run', { method: 'POST', body: { who: pick } }); setFast(true); refresh() } catch (e) { setFlash(e.message) }
  }
  const empty = s && !s.totals.sessions
  const top = s ? Math.max(...s.daily.map((d) => d.hours), 0.1) : 1
  return (
    <Card icon="sparkle" title={t('Insights')} summary={s && !empty ? t('{n} sessions, {hours} h in {days} days', { n: s.totals.sessions, hours: hrs(s.totals.hours), days: s.days }) : ''}
      right={s && <span className="updated">{t('Last {n} days', { n: s.days })}</span>}>
      {!data && !error && <Loading />}
      {error && <p className="error-text">{error}</p>}
      {empty && <p className="muted small">{t('No sessions with your agents in the last {n} days yet. This fills in as you work with them, whichever agent and account you use.', { n: s.days })}</p>}
      {s && !empty && (
        <>
          <div className="ins-stats">
            <div><b>{s.totals.sessions}</b><span>{t('Sessions')}</span></div>
            <div><b>{hrs(s.totals.hours)}</b><span>{t('Hours working')}</span></div>
            <div><b>{s.totals.projects}</b><span>{t('Projects')}</span></div>
            {s.totals.waitingHours != null && <div title={t('Time agents spent waiting for you to answer')}><b>{hrs(s.totals.waitingHours)} h</b><span>{t('Waited on you')}</span></div>}
          </div>
          <div className="ins-days" role="img" aria-label={t('Hours working each day, {from} to {to}', { from: shortDay(s.from), to: shortDay(s.to) })}>
            {s.daily.map((d) => <i key={d.date} title={`${shortDay(d.date)}: ${d.hours} h`} style={{ height: `${d.hours ? Math.max(8, (d.hours / top) * 100) : 0}%` }} />)}
          </div>
          <Split title={t('By agent')} rows={s.agents.map((a) => ({ key: a.kind, kind: a.kind, name: a.label, hint: a.fromBridge ? t('{agent}: counted while Bridge AI ran it', { agent: a.label }) : a.label, sessions: a.sessions, hours: a.hours }))} />
          {s.accounts.length > 0 && <Split title={t('By account')} rows={s.accounts.map((a) => { const name = a.id === '?' ? t('Not known') : a.account; return { key: `${a.kind}:${a.id || a.account}`, kind: a.kind, name, hint: a.id === '?' ? t('{agent}: conversations nothing ties to one account', { agent: a.agent }) : `${a.agent}: ${name}`, sessions: a.sessions, hours: a.hours } })} />}
          <Split title={t('Projects')} rows={s.projects.slice(0, 5).map((p) => ({ key: p.name, name: p.name, hint: `${p.name}: ${p.agents.join(', ')}`, sessions: p.sessions, hours: p.hours }))} />
        </>
      )}
      {r && (
        <div className="ins-report">
          <p className="ins-by muted small">{t('Written by {name}, {date}', { name: r.by, date: shortDay(r.generatedAt) })}</p>
          {r.summary && <p className="ins-summary">{r.summary}</p>}
          {SECTIONS.filter(([k]) => r[k]?.length).map(([k, label]) => (
            <div key={k}>
              <h4>{t(label)}</h4>
              <ul className="ins-glance">
                {r[k].map((g, i) => {
                  const id = `${k}${i}`
                  return (
                    <li key={id} className={open === id ? 'open' : ''}>
                      <button onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}>
                        <Icon name="chevron" size={11} className={`caret ${open === id ? 'rot90' : ''}`} />
                        <b>{g.title}</b>
                      </button>
                      <p>{g.detail}</p>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          {r.agents?.length > 0 && (
            <div>
              <h4>{t('Your agents')}</h4>
              <ul className="ins-notes">{r.agents.map((a) => <li key={a.agent}><b>{a.agent}</b> {a.note}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {s && !empty && !r && !data.running && <p className="muted small ins-lead">{t("The numbers above cost nothing. For what's working and what to try next, one of your agents reads them and writes it up.")}</p>}
      {data?.error && !data.running && <p className="error-text">{data.error}</p>}
      {flash && <p className="r-flash">{flash}</p>}
      {data && !empty && (
        writers.length
          ? (
            <div className="ins-actions">
              {data.running
                ? <p className="ins-running muted small"><Icon name="refresh" size={11} className="spin" /> {t('{name} is writing it. Usually a minute or two; you can close this.', { name: data.running.label })}</p>
                : <>
                  {writers.length > 1 && (
                    <label className="ins-who"><span>{t('Write with')}</span>
                      <select value={pick} onChange={(e) => choose(e.target.value)}>{writers.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select>
                    </label>
                  )}
                  <button className={`btn ${!r || ageDays > 7 ? 'primary' : ''}`} onClick={write}><Icon name="sparkle" size={12} /> {!r ? (writers.length > 1 ? t('Write insights') : t('Write with {name}', { name: writers[0].label })) : ageDays > 7 ? t('Refresh ({n}d old)', { n: Math.round(ageDays) }) : t('Write again')}</button>
                </>}
            </div>
          )
          : (
            <div className="ins-actions">
              <p className="muted small">{t('To get a write-up, sign in to an agent or add an API key for any provider.')}</p>
              <button className="btn" onClick={() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))}><Icon name="layers" size={12} /> {t('Model Providers')}</button>
            </div>
          )
      )}
      {data?.claudeReport && <a className="ins-claude" href={`${BASE}/api/insights/report`} target="_blank" rel="noreferrer">{t("Claude Code's own /insights report, {date}", { date: shortDay(data.claudeReport.generatedAt) })} <Icon name="external" size={10} /></a>}
    </Card>
  )
}

// ---------- Ideas backlog ----------

function IdeaRow({ it, onChanged, setFlash }) {
  const [edit, setEdit] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const patch = async (body) => { await api(`/ideas/${it.id}`, { method: 'PATCH', body }); onChanged() }
  const send = async () => {
    setBusy(true)
    try { const r = await api(`/ideas/${it.id}/send`, { method: 'POST' }); setFlash(r.queued ? t('Queued for your chief of staff. Once it gets to it, it plans it and checks with you.') : t('Sent to your chief of staff; it will plan it and check with you')); onChanged() } catch (e) { setFlash(e.message) } finally { setBusy(false) }
  }
  const del = async () => {
    if (!window.confirm(`${t('Delete this idea?')}\n\n${it.text}`)) return
    await api(`/ideas/${it.id}`, { method: 'DELETE' }); onChanged()
  }
  if (edit) {
    return (
      <li className="idea editing">
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={async (e) => { if (e.key === 'Enter' && text.trim()) { await patch({ text }); setEdit(false) } if (e.key === 'Escape') setEdit(false) }}
          onBlur={() => setEdit(false)} />
      </li>
    )
  }
  return (
    <li className={`idea ${it.done ? 'done' : ''}`}>
      <button className={`idea-check ${it.done ? 'on' : ''}`} onClick={() => patch({ done: !it.done })} aria-label={it.done ? t('Mark open') : t('Mark done')}>{it.done && <Icon name="check" size={11} />}</button>
      <div className="idea-main" onDoubleClick={() => { setText(it.raw); setEdit(true) }}>
        <span className="idea-text">{it.text}</span>
        <span className="idea-meta">
          {it.tags.map((t) => <span key={t} className="idea-tag">#{t}</span>)}
          {it.sent && <span className="idea-sent"><Icon name="helm" size={10} /> {t('sent {date}', { date: it.sent.slice(5) })}</span>}
        </span>
      </div>
      <div className="idea-actions">
        {!it.done && <button className="icon-btn" onClick={send} disabled={busy} title={t('Hand to chief of staff')} aria-label={t('Hand to chief of staff')}><Icon name="helm" size={13} /></button>}
        <button className="icon-btn" onClick={() => { setText(it.raw); setEdit(true) }} title={t('Edit')} aria-label={t('Edit')}><Icon name="edit" size={13} /></button>
        <button className="icon-btn danger" onClick={del} title={t('Delete')} aria-label={t('Delete')}><Icon name="trash" size={13} /></button>
      </div>
    </li>
  )
}

export function Ideas() {
  const { data, error, refresh } = usePoll('/ideas', 60 * 1000)
  const [text, setText] = useState('')
  const [filter, setFilter] = useState('open')
  const [all, setAll] = useState(false)
  const [flash, setFlash] = useFlash()
  const inputRef = useRef(null)
  const items = data?.items || []
  const tags = [...new Set(items.filter((i) => !i.done).flatMap((i) => i.tags))]
  const shown = items.filter((i) => (filter === 'done' ? i.done : filter === 'open' ? !i.done : !i.done && i.tags.includes(filter)))
  const openCount = items.filter((i) => !i.done).length
  const add = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    try { await api('/ideas', { method: 'POST', body: { text } }); setText(''); refresh() } catch (x) { setFlash(x.message) }
  }
  return (
    <Card icon="bulb" title={t('Ideas')} summary={data ? t('{n} open', { n: openCount }) : ''} right={<span className="updated">{t('{n} open', { n: openCount })}</span>}>
      <form className="idea-add" onSubmit={add}>
        <Icon name="plus" size={14} className="muted" />
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Add an idea… use #tags to group')} />
        {text.trim() && <button className="btn primary small" type="submit">{t('Add')}</button>}
      </form>
      {error && <p className="error-text">{error}</p>}
      {items.length > 0 && (
        <div className="chips news-chips">
          {[['open', t('Open {n}', { n: openCount })], ...tags.map((tag) => [tag, `#${tag}`]), ['done', t('Done')]].map(([k, l]) => (
            <button key={k} className={`fchip ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      )}
      {flash && <p className="r-flash">{flash}</p>}
      <ul className="idea-list">
        {(all ? shown : shown.slice(0, 8)).map((it) => <IdeaRow key={it.id} it={it} onChanged={refresh} setFlash={setFlash} />)}
      </ul>
      {shown.length > 8 && <button className="ghost-btn idea-more" onClick={() => setAll(!all)}>{all ? t('Show fewer') : t('Show {n} more', { n: shown.length - 8 })}</button>}
      {data && !shown.length && <p className="muted small">{filter === 'done' ? t('Nothing finished yet.') : t('No ideas here yet.')}</p>}
      {data?.file && <p className="muted small idea-file">Saved in <code>{data.file.replace(/^\/Users\/[^/]+/, '~')}</code>, editable in any editor.</p>}
    </Card>
  )
}
