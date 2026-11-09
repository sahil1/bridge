import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import { api, refetch } from '../../api.js'
import { t, tx, locale } from '../../i18n/index.js'

// Tools for meetings: how Memory groups its names, fixing a word everywhere in a meeting, and
// transcribing a meeting again from its audio with another engine, model or language.

// A group that folds: its name, how many it has, something more about it, and what's in it.
export function Fold({ id, label, count, extra, open, onToggle, children }) {
  return (
    <div className={`mt-fold${open ? ' open' : ''}`} data-fold={id}>
      <button type="button" className="mt-fold-head" aria-expanded={open} onClick={() => onToggle(!open)}>
        <Icon name="chevron" size={11} className="mt-fold-chev" />
        <span className="mt-fold-name">{label}</span>
        <span className="mt-fold-n num">{count}</span>
        {extra && <span className="muted small mt-fold-extra">{extra}</span>}
      </button>
      {open && <div className="mt-fold-body">{children}</div>}
    </div>
  )
}

export const LANGS = [['auto', tx('Detect it')], ['en', tx('English')], ['es', tx('Spanish')], ['fr', tx('French')], ['de', tx('German')], ['it', tx('Italian')], ['pt', tx('Portuguese')], ['nl', tx('Dutch')], ['hi', tx('Hindi')], ['zh', tx('Chinese')], ['ja', tx('Japanese')], ['ko', tx('Korean')], ['ar', tx('Arabic')], ['ru', tx('Russian')], ['pl', tx('Polish')], ['tr', tx('Turkish')], ['sv', tx('Swedish')], ['uk', tx('Ukrainian')]]
// The languages notes can be written in (meetings.js SUMMARY_LANGS).
export const NOTE_LANGS = [['auto', tx('Its own language')], ['en', tx('English')], ['es', tx('Spanish')], ['fr', tx('French')], ['de', tx('German')], ['it', tx('Italian')], ['pt', tx('Portuguese')], ['nl', tx('Dutch')], ['hi', tx('Hindi')], ['zh', tx('Chinese')], ['ja', tx('Japanese')], ['ko', tx('Korean')], ['ar', tx('Arabic')]]

export function useChatModels() {
  const [list, setList] = useState(null)
  useEffect(() => { api('/chat/models').then((r) => setList(r.models || [])).catch(() => setList([])) }, [])
  return list
}

export function Dialog({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  // On <body>, so no panel it's opened from (the sidebar) can clip or move it.
  return createPortal(
    <div className="mt-dialog-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="mt-dialog" role="dialog" aria-label={title}>
        <header><b>{title}</b><button type="button" className="ghost-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={14} /></button></header>
        {children}
      </div>
    </div>,
    document.body,
  )
}

// What fixing a word did: in how many places, and in every meeting from now on.
function fixed(from, to, n, remembered) {
  if (!n) return remembered ? t('"{from}" is now "{to}", in every meeting from now on.', { from, to }) : t('"{from}" is now "{to}".', { from, to })
  if (n === 1) return remembered ? t('"{from}" is now "{to}" in {n} place, in every meeting from now on.', { from, to, n }) : t('"{from}" is now "{to}" in {n} place.', { from, to, n })
  return remembered ? t('"{from}" is now "{to}" in {n} places, in every meeting from now on.', { from, to, n }) : t('"{from}" is now "{to}" in {n} places.', { from, to, n })
}

// A word or name fixed everywhere in a meeting (transcript, your notes, the summary, the title).
// Remember: in meeting memory too, so it's fixed in every meeting and heard right from now on.
export function FixWord({ id, from: from0 = '', onClose, onDone }) {
  const [from, setFrom] = useState(from0)
  const [to, setTo] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const go = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const r = await api(`/meetings/${encodeURIComponent(id)}/replace`, { method: 'POST', body: { find: from, to, remember } })
      onDone?.(fixed(from, to, r.changed, r.remembered))
      onClose()
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <Dialog title={t('Fix a word')} onClose={onClose}>
      <form className="mt-fix" onSubmit={go}>
        <label><span>{t('Heard as')}</span><input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Ack me" autoFocus={!from0} aria-label={t('Heard as')} /></label>
        <label><span>{t('Should be')}</span><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Acme" autoFocus={!!from0} aria-label={t('Should be')} /></label>
        <label className="st-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span><b>{t('Remember it')}</b> <span className="muted small">{t('Fixed in every meeting, and the speech engine listens for it from now on. It goes in Memory, where you can change it.')}</span></span></label>
        {err && <p className="error-text small">{err}</p>}
        <div className="mt-dialog-acts"><button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button><button type="submit" className="btn primary small" disabled={busy || from.trim().length < 2 || !to.trim()}>{t('Fix it')}</button></div>
      </form>
    </Dialog>
  )
}

// Memory's names (memory/Memory.jsx), as they grow (dozens of meetings bring hundreds of them), in
// groups that fold, each saying how many it has: by the series of meetings a name comes up in (the
// one-off meetings together), by the month it last came up, or A to Z.
export const MEM_BY = [['series', tx('By meeting')], ['month', tx('By month')], ['az', tx('A–Z')]]
export const shortDay = (iso) => new Date(iso).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })

export function memGroups(list, seen, by) {
  const ms = (x) => (x.meetings || []).map((id) => seen[id] && { id, ...seen[id] }).filter(Boolean).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
  const groups = new Map()
  const into = (key, label, x, m) => {
    const g = groups.get(key) || { key, label, items: [], meetings: new Map() }
    g.items.push(x)
    for (const y of m) g.meetings.set(y.id, y)
    groups.set(key, g)
  }
  // A series' name: the newest of its meetings' names.
  const names = new Map()
  for (const m of Object.values(seen).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))) if (m.series && !names.has(m.series)) names.set(m.series, m.title)
  for (const x of list) {
    const m = ms(x)
    if (by === 'az') { const c = x.term.trim()[0]?.toLocaleUpperCase(locale()) || '#'; into(/\p{L}/u.test(c) ? c : '#', /\p{L}/u.test(c) ? c : '#', x, []); continue }
    if (by === 'month') {
      const at = m[0]?.startedAt || x.updatedAt
      const k = at ? at.slice(0, 7) : ':none'
      into(k, at ? new Date(`${k}-15T12:00`).toLocaleDateString(locale(), { month: 'long', year: 'numeric' }) : t('Not from a meeting'), x, m.filter((y) => String(y.startedAt).startsWith(k)))
      continue
    }
    // The series it comes up in most, else the one-off meetings, else none.
    const count = new Map()
    for (const y of m) if (y.series) count.set(y.series, (count.get(y.series) || 0) + 1)
    const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (top) into(top, names.get(top) || top, x, m.filter((y) => y.series === top))
    else if (m.length) into(':one', t('One-off meetings'), x, m)
    else into(':none', t('Not from a meeting'), x, m)
  }
  const out = [...groups.values()].map((g) => ({ ...g, meetings: [...g.meetings.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))) }))
  if (by === 'az') return out.sort((a, b) => (a.key === '#') - (b.key === '#') || a.key.localeCompare(b.key, locale()))
  if (by === 'month') return out.sort((a, b) => (a.key === ':none') - (b.key === ':none') || b.key.localeCompare(a.key))
  return out.sort((a, b) => (a.key.startsWith(':')) - (b.key.startsWith(':')) || (a.key === ':none') - (b.key === ':none') || b.items.length - a.items.length)
}

// Where Memory opens (memory/open.js), for a meeting's menu and Settings › Meetings.
export { openMemory } from '../memory/open.js'

// Transcribe one meeting, or several, again from their audio: with another engine or speech model,
// or another language. The transcript they had is kept beside it.
export function TranscribeAgain({ ids, onClose, onDone }) {
  const [sp, setSp] = useState(null)
  const [pick, setPick] = useState('')
  const [lang, setLang] = useState('auto')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { api('/speech').then((d) => { setSp(d); setPick(d.engine === 'local' ? `local:${d.local.model}` : d.engine) }).catch((e) => setErr(e.message)) }, [])
  const options = sp ? [
    ...sp.local.models.filter((x) => x.have && x.usable).map((x) => [`local:${x.id}`, x.best ? t('On this computer: {model} (best)', { model: x.label }) : t('On this computer: {model}', { model: x.label })]),
    ...sp.services.filter((x) => x.ready).map((x) => { const name = `${x.label}${x.model ? `, ${x.model}` : ''}`; return [x.id, x.price?.[x.model] ? t('{name} ({price} an hour)', { name, price: x.price[x.model] }) : name] }),
  ] : []
  const go = async () => {
    setBusy(true); setErr(null)
    const [engine, localModel] = pick.startsWith('local:') ? ['local', pick.slice(6)] : [pick, undefined]
    const body = { engine, localModel, language: lang === 'auto' ? null : lang }
    try {
      if (ids.length === 1) await api(`/meetings/${encodeURIComponent(ids[0])}/transcribe`, { method: 'POST', body })
      else { const r = await api('/meetings/bulk', { method: 'POST', body: { ids, action: 'transcribe', ...body } }); if (!r.done.length) throw new Error(r.failed[0]?.error || t("Couldn't start")) }
      refetch('/meetings')
      onDone?.(ids.length === 1 ? t('Transcribing it again. The transcript it had is kept.') : t('Transcribing {n} meetings again.', { n: ids.length }))
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Dialog title={ids.length === 1 ? t('Transcribe again') : t('Transcribe {n} meetings again', { n: ids.length })} onClose={onClose}>
      <div className="mt-fix">
        <p className="muted small">{t('From the recording, start to end. Useful when parts were missed or misheard: a bigger speech model hears more, and the right language helps. Names in Memory are listened for. The summary is written again after.')}</p>
        <label><span>{t('With')}</span>
          <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t('Transcribe with')}>
            {!sp && <option value="">{t('Loading…')}</option>}
            {sp && !options.length && <option value="">{t('Nothing set up: Settings › Meetings')}</option>}
            {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label><span>{t('Language')}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('Language spoken')}>
            {LANGS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
          </select>
        </label>
        {sp && sp.local.models.some((x) => !x.have) && <p className="muted small">{t('More speech models are in Settings › Voice.')}</p>}
        {err && <p className="error-text small">{err}</p>}
        <div className="mt-dialog-acts"><button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button><button type="button" className="btn primary small" disabled={busy || !pick} onClick={go}><Icon name="refresh" size={12} /> {t('Transcribe again')}</button></div>
      </div>
    </Dialog>
  )
}
