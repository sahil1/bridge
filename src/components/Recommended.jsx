import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api, settingsChanged, usePoll } from '../api.js'
import { useTrial } from '../trials.js'
import { modelLabel } from './ModelChip.jsx'
import { EFFORTS, EFFORT_LABEL, EFFORT_NOTE, suggestEffort } from '../recommended.js'
import { t, midSentence } from '../i18n/index.js'
import './recommended.css'

// Recommended Settings, a beta feature (src/recommended.js has the table and the reasons): what
// Claude Code starts with, picked for your plan, said once it's signed in (setup's Connect your AI,
// Settings › Agents) with Use these or Keep; what it starts with now, changed in Settings › Agents;
// and a task's effort chip (New, Home's box), suggested from what's asked. Bridge AI passes them
// when it starts the agent (--model, --effort); the agent's own settings files are never written.

export const effortName = (e) => t(EFFORT_LABEL[e] || e)

// What's recommended for each agent that takes an effort, with the beta on: { data, error, reload,
// answer }. data is null while it looks (and with the beta off).
export function useRecommended() {
  const on = useTrial('recommended-settings')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = (fresh) => api(`/recommended${fresh ? '?fresh=1' : ''}`).then((d) => { setData(d); setError(null) }).catch((e) => setError(e.message))
  useEffect(() => { if (on) load(); else setData(null) }, [on]) // eslint-disable-line react-hooks/exhaustive-deps
  const answer = async (kind, choice) => {
    const r = await api(`/recommended/${kind}`, { method: 'POST', body: { choice } })
    setData((d) => d && { ...d, agents: d.agents.map((x) => (x.kind === kind ? r : x)) })
    settingsChanged()
    return r
  }
  const save = async (kind, patch) => {
    const s = await api('/settings')
    const agents = s.user?.agents || {}
    const next = { ...(agents[kind] || {}), ...patch }
    for (const k of Object.keys(patch)) if (patch[k] == null) delete next[k]
    await api('/settings', { method: 'PATCH', body: { agents: { ...agents, [kind]: next } } })
    settingsChanged()
    await load()
  }
  return { on, data, error, reload: load, answer, save }
}

// "Opus, high effort"
const pair = (model, effort) => t('{model}, {effort} effort', { model: modelLabel(model), effort: midSentence(effortName(effort)) })

// The recommendation for one agent, once it's signed in and until it's answered for this plan:
// Use these, or Keep (Claude Code's defaults, or what you set yourself). Says why there's none.
export function RecommendCard({ r, onAnswer, compact = false }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  if (!r || r.signedIn !== true || r.answered) return null
  if (!r.rec || r.rec.none) {
    return (
      <p className="rec-none muted small" data-rec={r.kind}>
        <Icon name="info" size={12} />
        {r.rec?.none
          ? t('{agent} reaches Claude through {to}, where the models differ, so nothing is recommended: it starts with its own defaults.', { agent: r.label, to: t(r.rec.to) })
          : t('No settings recommended for this {agent} sign-in yet: it starts with its own defaults.', { agent: r.label })}
      </p>
    )
  }
  const mine = !!(r.model || r.effort)
  const go = async (choice) => {
    setBusy(choice); setErr(null)
    try { await onAnswer(r.kind, choice) } catch (e) { setErr(e.message) }
    setBusy(null)
  }
  return (
    <div className={`rec-card ${compact ? 'compact' : ''}`} data-rec={r.kind} role="group" aria-label={t('Recommended for {to}', { to: t(r.rec.to) })}>
      <Icon name="gauge" size={15} className="rec-icon" />
      <div className="rec-text">
        <b>{t('Recommended for {to}: {pair}', { to: t(r.rec.to), pair: pair(r.rec.model, r.rec.effort) })}</b>
        <span className="muted small">{t(r.rec.why)}</span>
        {err && <span className="rec-err small" role="alert">{err}</span>}
      </div>
      <div className="rec-acts">
        <button type="button" className="btn small primary" disabled={!!busy} onClick={() => go('use')}>{busy === 'use' ? t('Saving…') : t('Use these')}</button>
        <button type="button" className="btn small" disabled={!!busy} onClick={() => go('keep')}>{mine ? t('Keep my settings') : t("Keep {agent}'s defaults", { agent: r.label })}</button>
      </div>
    </div>
  )
}

// What it starts with now, and where that came from, changed right here (Settings › Agents).
// herdr starts Claude Code with the model from its own settings, so only the effort applies there.
export function StartsWith({ r, runtime, onSave }) {
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)
  if (!r) return null
  const fromRec = r.rec && !r.rec.none && r.answered === 'use' && r.model === r.rec.model && r.effort === r.rec.effort
  const where = fromRec ? t('recommended for {to}', { to: t(r.rec.to) }) : r.model || r.effort ? t('as you set it') : t('whatever its own settings say')
  const now = r.model || r.effort
    ? [r.model ? modelLabel(r.model) : t("{agent}'s model", { agent: r.label }), r.effort ? t('{effort} effort', { effort: effortName(r.effort) }) : t('its own effort')].join(' · ')
    : t("{agent}'s defaults", { agent: r.label })
  const models = [...new Set([...(r.models || []), r.model].filter(Boolean))]
  const save = async (patch) => {
    setErr(null); setSaved(false)
    try { await onSave(r.kind, patch); setSaved(true) } catch (e) { setErr(e.message) }
  }
  return (
    <div className="rec-starts" data-starts={r.kind}>
      <p className="rec-now small"><span className="muted">{t('Starts with')}</span> <b>{now}</b> <span className="muted">({where})</span>{saved && <span className="rec-saved"><Icon name="check" size={11} /> {t('Saved')}</span>}</p>
      <div className="rec-pick">
        <label className="rec-field">
          <span className="muted small">{t('Model')}</span>
          <select className="st-input" value={r.model || ''} onChange={(e) => save({ model: e.target.value || null })} aria-label={t('{agent} model', { agent: r.label })}>
            <option value="">{t("{agent}'s default", { agent: r.label })}</option>
            {models.map((m) => <option key={m} value={m}>{modelLabel(m)}{modelLabel(m).toLowerCase() !== m.toLowerCase() ? ` (${m})` : ''}</option>)}
          </select>
        </label>
        <label className="rec-field">
          <span className="muted small">{t('Effort')}</span>
          <select className="st-input" value={r.effort || ''} onChange={(e) => save({ effort: e.target.value || null })} aria-label={t('{agent} effort', { agent: r.label })}>
            <option value="">{t("{agent}'s default", { agent: r.label })}</option>
            {EFFORTS.map((e) => <option key={e} value={e}>{effortName(e)}</option>)}
          </select>
        </label>
      </div>
      {runtime === 'herdr' && r.model && <p className="muted small">{t('With herdr, {agent} takes its model from its own settings; the effort applies.', { agent: r.label })}</p>}
      {err && <p className="rec-err small" role="alert">{err}</p>}
    </div>
  )
}

// The effort an agent of this kind starts with when a task's chip says nothing: your setting for
// it (Settings › Agents), or null (the agent's own). From /config, only with the beta on.
export function useUsualEffort(kind) {
  const { data } = usePoll('/config', 10 * 60 * 1000)
  return data?.efforts?.[kind] || null
}

// A task's effort, as a chip by its message: the level suggested from what it says (src/recommended.js
// suggestEffort), or the one you picked, which then stays until the message is sent. value: the
// level picked, 'usual', or null (follow the suggestion). launchEffort() says what to start with.
export function launchEffort(text, value) {
  if (value === 'usual') return 'default'
  return value || suggestEffort(text)?.effort || undefined
}
export function EffortChip({ kind, label, text, value, onPick, className = '', up = false }) {
  const usual = useUsualEffort(kind)
  const [open, setOpen] = useState(false)
  const [upward, setUpward] = useState(up)
  const ref = useRef(null)
  const popRef = useRef(null)
  const sugg = suggestEffort(text)
  const picked = value && value !== 'usual' ? value : null
  const level = picked || (value === 'usual' ? null : sugg?.effort) || null
  useEffect(() => {
    if (!open) return
    const down = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); ref.current?.querySelector('.eff-chip')?.focus() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key, true)
    // The ticked one gets the focus, as in the other menus.
    ref.current?.querySelector('.eff-pop [aria-checked="true"]')?.focus()
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true) }
  }, [open])
  // Where there's room for it inside its panel or dialog (Home shares the window with the board
  // below it): below, or above when that has more, as tall as the room it has.
  useLayoutEffect(() => {
    const el = popRef.current
    const chip = ref.current
    if (!open || !el || !chip) return
    const box = chip.closest('.modal, .pane')?.getBoundingClientRect() || { top: 0, bottom: window.innerHeight }
    const r = chip.getBoundingClientRect()
    const below = Math.min(box.bottom, window.innerHeight) - r.bottom - 12
    const above = r.top - Math.max(box.top, 0) - 12
    const want = el.scrollHeight
    const goUp = up ? !(above < want && below > above) : below < want && above > below
    setUpward(goUp)
    el.style.maxHeight = `${Math.max(160, Math.min(420, goUp ? above : below))}px`
  }, [open, up])
  const usualName = usual ? t('{effort} effort', { effort: effortName(usual) }) : t("{agent}'s default", { agent: label })
  const name = level ? t('{effort} effort', { effort: effortName(level) }) : t('Usual effort')
  const why = picked ? t('you picked it') : level ? t(sugg.why) : null
  const title = picked ? t('{effort} effort, for this task: you picked it. Click to change.', { effort: effortName(picked) })
    : level ? t('{effort} effort, suggested for this task: {why}. Click to change.', { effort: effortName(level), why: t(sugg.why) })
    : t('Starts as usual ({usual}). Click to pick an effort for this task.', { usual: usualName })
  const pick = (v) => { onPick(v); setOpen(false); ref.current?.querySelector('.eff-chip')?.focus() }
  return (
    <span className="eff-wrap" ref={ref}>
      <button type="button" className={`eff-chip ${className} ${level ? 'set' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={title} aria-label={title}>
        <Icon name="gauge" size={13} /><span className="eff-name">{name}</span>{why && <span className="eff-why">: {why}</span>}<Icon name="down" size={11} />
      </button>
      {open && (
        <div ref={popRef} className={`eff-pop ${upward ? 'up' : ''}`} role="menu" aria-label={t('Effort for this task')}>
          <button type="button" role="menuitemradio" aria-checked={!level} className={!level ? 'on' : ''} onClick={() => pick('usual')}>
            <span className="eff-main"><b>{t('Usual')}</b><small>{usual ? t('{effort}, as set in Settings › Agents.', { effort: effortName(usual) }) : t('{agent} decides, as when you start it yourself.', { agent: label })}</small></span>
          </button>
          {EFFORTS.map((e) => (
            <button type="button" key={e} role="menuitemradio" aria-checked={level === e} className={level === e ? 'on' : ''} onClick={() => pick(e)}>
              <span className="eff-main"><b>{effortName(e)}{sugg?.effort === e && <span className="eff-tag">{t('Suggested')}</span>}</b><small>{t(EFFORT_NOTE[e])}</small></span>
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
