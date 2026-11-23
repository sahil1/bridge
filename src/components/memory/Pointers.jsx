import { useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll } from '../../api.js'
import { t, tx } from '../../i18n/index.js'
import { shortDay } from '../meetings/tools.jsx'

// Pointers, in Memory (server/pointers.js): what you mean by "that". The deck from Tuesday is its
// file, the pricing doc a link. Chief of Staff, your agents and your bots read them, and add one when
// they had to search or ask; yours you add here. Each says what it points to and who added it; one an
// agent or a bot added says so until you keep it (only then can it be pinned, or let bots use it: a
// kept one is yours). Pin one and it's never tidied away; Bots May Use It
// lets a bot whose folders hold its file or folder be given it (never anything else of yours). Past a
// size the list is tidied, and it says when and what went. On a phone, as on a computer.
const KINDS = [['file', tx('File')], ['folder', tx('Folder')], ['link', tx('Link')], ['task', tx('Task')], ['meeting', tx('Meeting')], ['board', tx('Whiteboard')], ['note', tx('Note')]]
const KIND = Object.fromEntries(KINDS)
const HINT = { file: tx('/Users/you/Decks/q3.pptx or ~/Decks/q3.pptx'), folder: tx('~/Projects/launch'), link: tx('https://…'), task: tx('Its number: 12'), meeting: tx('Its id'), board: tx('Its name'), note: tx('A few words') }
const FEW = 8
const isPath = (k) => k === 'file' || k === 'folder'

export default function Pointers({ elsewhere = null }) {
  const { data, error, refresh } = usePoll('/pointers', 60000)
  const [adding, setAdding] = useState(false)
  const [all, setAll] = useState(false)
  const [err, setErr] = useState(null)
  const items = data?.items || []
  const act = async (fn) => { setErr(null); try { await fn(); refresh() } catch (e) { setErr(e.message) } }
  const shown = all ? items : items.slice(0, FEW)
  return (
    <section className="mm-card mm-points" aria-label={t('Pointers')}>
      <div className="mm-card-head">
        <Icon name="link" size={14} />
        <b>{t('Pointers')}</b>
        {data && <span className="muted small">{items.length}</span>}
        <button type="button" className="btn small mm-pt-add" aria-expanded={adding} disabled={!data} onClick={() => setAdding((v) => !v)}><Icon name="plus" size={12} /> {t('Add')}</button>
      </div>
      <p className="muted small mm-pt-what">{t('What you mean by "that": the deck from Tuesday, the doc Dana sent. Chief of Staff and your agents read these and add to them; a bot sees only its own and the ones you let bots use.')}</p>
      {adding && <Edit onDone={() => { setAdding(false); refresh() }} onCancel={() => setAdding(false)} />}
      {err && <p className="error-text small" role="alert">{err}</p>}
      {error && !data && <p className="error-text small" role="alert">{elsewhere ? t('Pointers on {name} can\'t be shown right now: {error}', { name: elsewhere, error }) : t('Pointers can\'t be shown right now: {error}', { error })}</p>}
      {data?.problem && <p className="mm-note muted small" role="status"><Icon name="alert" size={13} /> {t('The list couldn\'t be read ({why}), so it starts again empty; the old file is kept beside it.', { why: data.problem })}</p>}
      {data && !items.length && !adding && <p className="muted small">{t('None yet. They come as your agents find what you meant, or add one yourself.')}</p>}
      {shown.length > 0 && (
        <div className="mm-pt-list">
          {shown.map((x) => <Row key={x.id} x={x} act={act} refresh={refresh} />)}
        </div>
      )}
      {items.length > FEW && <button type="button" className="ghost-btn mm-pt-more" onClick={() => setAll((v) => !v)}>{all ? t('Show fewer') : t('Show all {n}', { n: items.length })}</button>}
      {data?.tidied && <p className="muted small mm-pt-tidied" role="status"><Icon name="info" size={12} /> {data.tidied.n === 1 ? t('Tidied {date}: one old pointer went ({words}).', { date: shortDay(data.tidied.at), words: data.tidied.words.join(', ') }) : t('Tidied {date}: {n} old pointers went ({words}).', { date: shortDay(data.tidied.at), n: data.tidied.n, words: data.tidied.words.join(', ') })}</p>}
    </section>
  )
}

// Who added it, in a few words: yours, Chief of Staff's or an agent's (not checked until you keep
// it), or a bot's, and whom it learned it from.
function whose(x) {
  if (x.yours) return x.kept ? t('yours, from {bot}', { bot: x.kept.name || t('a bot') }) : t('yours')
  if (x.by?.kind === 'bot') return x.person?.name ? t('{bot}, from {name}', { bot: x.by.name || t('a bot'), name: x.person.name }) : x.by.name || t('a bot')
  return x.by?.kind === 'chief' ? t('Chief of Staff') : t('an agent')
}

function Row({ x, act, refresh }) {
  const [edit, setEdit] = useState(false)
  if (edit) return <Edit x={x} onDone={() => { setEdit(false); refresh() }} onCancel={() => setEdit(false)} onRemove={() => act(() => api(`/pointers/${x.id}`, { method: 'DELETE' }))} />
  const save = (patch) => act(() => api(`/pointers/${x.id}`, { method: 'PATCH', body: patch }))
  return (
    <div className={`mm-pt${x.pinned ? ' pinned' : ''}`} data-pointer={x.words}>
      <div className="mm-pt-line">
        <span className="mm-pt-words"><b>{x.words}</b> <span className="muted small mm-pt-to" title={x.shown}>{t(KIND[x.to.kind] || 'Note')}: {x.shown}</span></span>
        {x.yours && <button type="button" className={`ghost-btn mm-pt-pin${x.pinned ? ' on' : ''}`} aria-pressed={x.pinned} onClick={() => save({ pinned: !x.pinned })} aria-label={x.pinned ? t('Unpin {name}', { name: x.words }) : t('Pin {name}', { name: x.words })} title={x.pinned ? t('Pinned: never tidied away') : t('Pin it, so it\'s never tidied away')}><Icon name="pin" size={13} /></button>}
        <button type="button" className="ghost-btn mm-pen" onClick={() => setEdit(true)} aria-label={t('Edit {name}', { name: x.words })} title={t('Edit')}><Icon name="edit" size={13} /></button>
      </div>
      <div className="mm-pt-tags">
        <span className={`mt-mem-src ${x.yours ? 'you' : 'learned'}`}>{whose(x)}</span>
        {!x.yours && <span className="muted small">{t('not checked')}</span>}
        {x.bots && <span className="mm-kind"><Icon name="bot" size={10} /> {t('Bots may use it')}</span>}
        {x.note && <span className="muted small mm-pt-note">{x.note}</span>}
        {!x.yours && <button type="button" className="link-btn small mm-pt-keep" onClick={() => save({ keep: true })}>{t('Keep')}</button>}
      </div>
    </div>
  )
}

// Adding one, or changing one: its words, what it points to, a note, and whether bots may use it (a
// file or a folder only, and only a bot whose folders hold it).
function Edit({ x = null, onDone, onCancel, onRemove = null }) {
  const [v, setV] = useState(() => ({ words: x?.words || '', kind: x?.to.kind || 'file', ref: x ? x.to.ref : '', note: x?.note || '', bots: !!x?.bots }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const go = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    // (Changing one an agent or a bot added is keeping it: it's yours as you leave it.)
    const body = { words: v.words, to: { kind: v.kind, ref: v.ref }, note: v.note, bots: isPath(v.kind) && v.bots, ...(x && !x.yours ? { keep: true } : {}) }
    try { await api(x ? `/pointers/${x.id}` : '/pointers', { method: x ? 'PATCH' : 'POST', body }); onDone() } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }
  return (
    <form className="mm-pt-edit" onSubmit={go} data-pointer-edit={x?.words || ''}>
      <label><span>{t('What you call it')}</span><input value={v.words} onChange={(e) => setV({ ...v, words: e.target.value })} placeholder={t('the deck from Tuesday')} autoFocus maxLength={80} /></label>
      <label><span>{t('It\'s a')}</span>
        <select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
          {KINDS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </select>
      </label>
      <label className="mm-pt-ref"><span>{t('Where it is')}</span><input value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} placeholder={t(HINT[v.kind])} /></label>
      <label className="mm-pt-ref"><span>{t('Note')}</span><input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder={t('Optional')} maxLength={140} /></label>
      {isPath(v.kind) && (
        <label className="st-check mm-pt-bots">
          <input type="checkbox" checked={v.bots} onChange={(e) => setV({ ...v, bots: e.target.checked })} />
          <span><b>{t('Bots may use it')}</b> <span className="muted small">{t('Only a bot whose folders hold it is given it, with anyone who asks it.')}</span></span>
        </label>
      )}
      {err && <p className="error-text small" role="alert">{err}</p>}
      <div className="mm-edit-acts">
        {onRemove && <button type="button" className="ghost-btn danger" onClick={onRemove}><Icon name="trash" size={13} /> {t('Delete')}</button>}
        <button type="button" className="ghost-btn" onClick={onCancel}>{t('Cancel')}</button>
        <button type="submit" className="btn small primary" disabled={busy || v.words.trim().length < 2 || !v.ref.trim()}>{x ? t('Save') : t('Add')}</button>
      </div>
    </form>
  )
}
