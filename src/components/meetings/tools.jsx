import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from '../Icon.jsx'
import { api, refetch } from '../../api.js'
import { t, tx } from '../../i18n/index.js'

// Tools for meetings: meeting memory (the names and terms in your meetings, how they get misheard,
// a note on each), fixing a word everywhere in a meeting, and transcribing a meeting again from its
// audio with another engine, model or language.

export const LANGS = [['auto', tx('Detect it')], ['en', tx('English')], ['es', tx('Spanish')], ['fr', tx('French')], ['de', tx('German')], ['it', tx('Italian')], ['pt', tx('Portuguese')], ['nl', tx('Dutch')], ['hi', tx('Hindi')], ['zh', tx('Chinese')], ['ja', tx('Japanese')], ['ko', tx('Korean')], ['ar', tx('Arabic')], ['ru', tx('Russian')], ['pl', tx('Polish')], ['tr', tx('Turkish')], ['sv', tx('Swedish')], ['uk', tx('Ukrainian')]]
// The languages notes can be written in (meetings.js SUMMARY_LANGS).
export const NOTE_LANGS = [['auto', tx('Its own language')], ['en', tx('English')], ['es', tx('Spanish')], ['fr', tx('French')], ['de', tx('German')], ['it', tx('Italian')], ['pt', tx('Portuguese')], ['nl', tx('Dutch')], ['hi', tx('Hindi')], ['zh', tx('Chinese')], ['ja', tx('Japanese')], ['ko', tx('Korean')], ['ar', tx('Arabic')]]

export function useChatModels() {
  const [list, setList] = useState(null)
  useEffect(() => { api('/chat/models').then((r) => setList(r.models || [])).catch(() => setList([])) }, [])
  return list
}

export function Dialog({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  // On <body>, so no panel it's opened from (the sidebar) can clip or move it.
  return createPortal(
    <div className="mt-dialog-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`mt-dialog${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
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
        <label className="st-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span><b>{t('Remember it')}</b> <span className="muted small">{t('Fixed in every meeting, and the speech engine listens for it from now on. It goes in meeting memory, where you can change it.')}</span></span></label>
        {err && <p className="error-text small">{err}</p>}
        <div className="mt-dialog-acts"><button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button><button type="submit" className="btn primary small" disabled={busy || from.trim().length < 2 || !to.trim()}>{t('Fix it')}</button></div>
      </form>
    </Dialog>
  )
}

// Meeting memory: yours to read and change. Learned ones came from summaries; edit one and it's yours.
export function MemoryPanel({ onClose }) {
  const [terms, setTerms] = useState(null)
  const [q, setQ] = useState('')
  const [add, setAdd] = useState({ term: '', heard: '', note: '' })
  const [err, setErr] = useState(null)
  const load = () => api('/meetings/memory').then((r) => setTerms(r.terms)).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean)
  const save = async (x, patch) => { setErr(null); try { await api(`/meetings/memory/${x.id}`, { method: 'PATCH', body: patch }); load(); refetch('/meetings') } catch (e) { setErr(e.message) } }
  const remove = async (x) => { setErr(null); try { await api(`/meetings/memory/${x.id}`, { method: 'DELETE' }); load() } catch (e) { setErr(e.message) } }
  const create = async (e) => {
    e.preventDefault()
    setErr(null)
    try { await api('/meetings/memory', { method: 'POST', body: { term: add.term, heard: list(add.heard), note: add.note } }); setAdd({ term: '', heard: '', note: '' }); load() } catch (x) { setErr(x.message) }
  }
  const shown = (terms || []).filter((x) => !q || `${x.term} ${x.heard.join(' ')} ${x.note}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Dialog title={t('Meeting memory')} onClose={onClose} wide>
      <p className="muted small mt-mem-about">{t('Names and terms from your meetings. The speech engine listens for them, transcripts show them fixed where they were misheard, and the notes and answers know who and what they are. Fixing a word with Remember on adds it here, and each summary adds the names it finds.')}</p>
      <form className="mt-mem-add" onSubmit={create}>
        <input value={add.term} onChange={(e) => setAdd({ ...add, term: e.target.value })} placeholder={t('Name or term (Acme)')} aria-label={t('Name or term')} />
        <input value={add.heard} onChange={(e) => setAdd({ ...add, heard: e.target.value })} placeholder={t('Heard as (Ack me, Act me)')} aria-label={t('Heard as')} />
        <input value={add.note} onChange={(e) => setAdd({ ...add, note: e.target.value })} placeholder={t('Note (our company)')} aria-label={t('Note')} />
        <button type="submit" className="btn small" disabled={add.term.trim().length < 2}><Icon name="plus" size={12} /> {t('Add')}</button>
      </form>
      {err && <p className="error-text small">{err}</p>}
      {terms && terms.length > 8 && <input className="mt-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Find a name')} aria-label={t('Find a name')} />}
      <div className="mt-mem-list">
        {!terms && <div className="skeleton-rows"><div /><div /></div>}
        {terms && !terms.length && <p className="muted small">{t('Nothing yet. Fix a misheard name in a transcript, or add one above.')}</p>}
        {shown.map((x) => (
          <div key={`${x.id}:${x.updatedAt}`} className="mt-mem-row">
            <input className="mt-mem-term" defaultValue={x.term} onBlur={(e) => e.target.value.trim() !== x.term && save(x, { term: e.target.value })} aria-label={t('{term}: name', { term: x.term })} />
            <input defaultValue={x.heard.join(', ')} onBlur={(e) => e.target.value !== x.heard.join(', ') && save(x, { heard: list(e.target.value) })} placeholder={t('Heard as')} aria-label={t('{term}: heard as', { term: x.term })} />
            <input defaultValue={x.note} onBlur={(e) => e.target.value !== x.note && save(x, { note: e.target.value })} placeholder={t('Note')} aria-label={t('{term}: note', { term: x.term })} />
            <span className={`mt-mem-src ${x.source}`} title={x.seen ? (x.seen === 1 ? t('In {n} meeting', { n: x.seen }) : t('In {n} meetings', { n: x.seen })) : ''}>{x.source === 'you' ? t('yours') : t('learned')}</span>
            <button type="button" className="ghost-btn" onClick={() => remove(x)} aria-label={t('Remove {name}', { name: x.term })} title={t('Remove')}><Icon name="trash" size={13} /></button>
          </div>
        ))}
      </div>
    </Dialog>
  )
}

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
    ...(sp.local.program ? sp.local.models.filter((x) => x.have).map((x) => [`local:${x.id}`, x.best ? t('On this computer: {model} (best)', { model: x.label }) : t('On this computer: {model}', { model: x.label })]) : []),
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
        <p className="muted small">{t('From the recording, start to end. Useful when parts were missed or misheard: a bigger speech model hears more, and the right language helps. Names in meeting memory are listened for. The summary is written again after.')}</p>
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
        {sp && sp.local.program && sp.local.models.some((x) => !x.have) && <p className="muted small">{t('More speech models are in Settings › Meetings.')}</p>}
        {err && <p className="error-text small">{err}</p>}
        <div className="mt-dialog-acts"><button type="button" className="ghost-btn" onClick={onClose}>{t('Cancel')}</button><button type="button" className="btn primary small" disabled={busy || !pick} onClick={go}><Icon name="refresh" size={12} /> {t('Transcribe again')}</button></div>
      </div>
    </Dialog>
  )
}
