import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { usePersisted } from '../layout.jsx'
import { api, usePoll, refetch, machineId } from '../../api.js'
import { t, tx } from '../../i18n/index.js'
import { Fold, MEM_BY, memGroups, shortDay } from '../meetings/tools.jsx'
import { memoryAll, setMemoryAll } from './open.js'
import { openMeeting } from '../meetings/recording.jsx'
import { openDictations } from '../dictations/shared.jsx'
import { useMachines } from '../Machines.jsx'
import '../meetings/meetings.css'
import './memory.css'

// Memory (server/memoryview.js), a page in Meetings and in Dictations, a tab of each beside their
// lists: what Bridge AI has learned from your meetings and dictations. Each shows what came up there,
// and the names you added yourself (speech to text listens for those in both), until you pick All
// memory; the counts follow. The collections and a search come first: People (memory's and, with
// Meeting Insights on, the people you meet, who come from meetings), Organizations, Projects &
// Products and Terms, each name with how it's misheard, its note, and the meetings and dictations it
// came up in (each opens). Beside them (under them, on a phone): About You (a few lines made from
// all of memory, in either place, or as you wrote them, on or off) and what there is to look over,
// what looks the same (merged, or kept apart) and what looks like it adds little. In a window that
// shows another of your computers, it's that computer's memory, and it says so.
const COLLECTIONS = [['all', tx('All'), 'book'], ['person', tx('People'), 'users'], ['org', tx('Organizations'), 'layers'], ['project', tx('Projects & Products'), 'shapes'], ['term', tx('Terms'), 'quote']]
const KINDS = [['person', tx('Person')], ['org', tx('Organization')], ['project', tx('Project or product')], ['term', tx('Term')]]
const KIND = Object.fromEntries(KINDS)
const WHY = { place: tx('A place'), language: tx('A language or nationality'), time: tx('A day, month or year'), common: tx('An everyday word or acronym'), once: tx('Came up once, over a month ago, with nothing to fix') }
// Where it is, and what it says of what came up there.
const HERE = {
  meetings: { label: tx('From meetings'), find: tx('Nothing from meetings matches "{q}".'), none: tx('None of these from meetings yet.'), icon: 'mic', empty: tx('Nothing in memory has come up in a meeting yet.'), fills: tx('It fills as your meetings are summarized and as you fix a misheard word with Remember on.') },
  dictations: { label: tx('From dictations'), find: tx('Nothing from dictations matches "{q}".'), none: tx('None of these from dictations yet.'), icon: 'wave', empty: tx('Nothing in memory has come up in a dictation yet.'), fills: tx('A name memory has counts here once you say it in a dictation.') },
}
// With no more than this many shown, every group is open.
const OPEN = 30
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean)
const newest = (a, b) => String(b.startedAt || b.at).localeCompare(String(a.startedAt || a.at))

// The computer this window shows, when it's another of yours (/m/<id>/): its name.
export function useElsewhere() {
  const { data } = useMachines(60_000, !!machineId)
  return machineId ? data?.machines?.find((m) => m.id === machineId)?.name || t('that computer') : null
}

// from: where it is, 'meetings' or 'dictations'.
export default function Memory({ from = 'meetings' }) {
  const { data, error, refresh } = usePoll('/memory', 60000)
  const elsewhere = useElsewhere()
  const [q, setQ] = useState('')
  const [coll, setColl] = usePersisted('cc-mm-coll', 'all')
  // Most of what's said in dictations came up in no meeting: A to Z there to start with.
  const [by, setBy] = usePersisted(from === 'dictations' ? 'cc-mm-by-dictations' : 'cc-mm-by', from === 'dictations' ? 'az' : 'series')
  const [all, setAll] = useState(() => memoryAll(from))
  useEffect(() => {
    const on = (e) => { if (e.detail?.from === from) setAll(e.detail.all) }
    window.addEventListener('bridge-memory-all', on)
    return () => window.removeEventListener('bridge-memory-all', on)
  }, [from])
  const showAll = (v) => setMemoryAll(from, v)
  const [open, setOpen] = useState({})
  const [full, setFull] = useState({})
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState(null)
  const terms = data?.terms || []
  const seen = data?.meetings || {}
  const byId = useMemo(() => Object.fromEntries(terms.map((x) => [x.id, x])), [terms])
  const act = async (fn) => { setErr(null); try { await fn(); refresh(); refetch('/meetings') } catch (e) { setErr(e.message) } }
  const save = (x, patch) => act(() => api(`/meetings/memory/${x.id}`, { method: 'PATCH', body: patch }))
  const remove = (x) => act(() => api(`/meetings/memory/${x.id}`, { method: 'DELETE' }))
  // What came up here, and what you added; everything with All memory. The people you meet come
  // from meetings' invites and transcripts.
  const ours = (x) => all || x.source === 'you' || (from === 'dictations' ? x.dictations : x.meetings || []).length > 0
  const here = terms.filter(ours)
  const people = all || from === 'meetings' ? data?.people || [] : []
  const s = q.trim().toLowerCase()
  const match = (x) => !s || `${x.term} ${x.heard.join(' ')} ${x.also.join(' ')} ${x.note}`.toLowerCase().includes(s)
  const inColl = (x) => coll === 'all' || x.kind === coll
  const shown = here.filter(inColl).filter(match)
  // As many again in all of memory: said, with the way to them, rather than nothing.
  const beyond = all ? 0 : terms.filter((x) => !ours(x) && inColl(x) && match(x)).length
  const met = people.filter((p) => !s || `${p.name} ${p.also.join(' ')}`.toLowerCase().includes(s))
  const groups = useMemo(() => memGroups(shown, seen, by), [shown.map((x) => `${x.id}:${x.updatedAt}:${x.kind}`).join('|'), seen, by]) // eslint-disable-line react-hooks/exhaustive-deps
  const every = !!s || shown.length <= OPEN
  const count = (k) => (k === 'all' ? here.length : here.filter((x) => x.kind === k).length) + (k === 'person' ? people.length : 0)
  const any = terms.length > 0 || data?.people?.length > 0
  const anyHere = here.length > 0 || people.length > 0
  // What there is to look over, of what's shown: a pair when either one is.
  const mine = new Set(here.map((x) => x.id))
  const same = (data?.same || []).filter((p) => p.some((id) => mine.has(id)))
  const little = (data?.little || []).filter((x) => mine.has(x.id))
  const at = HERE[from] || HERE.meetings
  const names = here.length === terms.length ? (terms.length === 1 ? t('{n} name', { n: 1 }) : t('{n} names', { n: terms.length })) : t('{n} of {total} names', { n: here.length, total: terms.length })
  const how = t('What Bridge AI has learned from your meetings and dictations: who and what comes up, how it\'s spelled and misheard, and what it is. Speech to text listens for these, and your notes know who and what they are. It grows as meetings are summarized and as you fix words.')
  return (
    <div className="mm-view" data-from={from}>
      <div className={`mm-page${s ? ' finding' : ''}${data ? '' : ' solo'}`}>
        {/* Which memory, how many names and whose, and Add. */}
        <div className="mm-bar">
          {data && any && (
            <div className="seg small-seg mm-scope" role="tablist" aria-label={t('Which memory')}>
              <button type="button" role="tab" data-scope="here" aria-selected={!all} className={all ? '' : 'on'} onClick={() => showAll(false)}><Icon name={at.icon} size={12} /> {t(at.label)}</button>
              <button type="button" role="tab" data-scope="all" aria-selected={all} className={all ? 'on' : ''} onClick={() => showAll(true)}><Icon name="book" size={12} /> {t('All memory')}</button>
            </div>
          )}
          <span className="muted small mm-count">{data ? names : t('Memory')} · {elsewhere ? t('On {name}', { name: elsewhere }) : t('On this computer')}</span>
          <button type="button" className="btn small mm-add-btn" aria-expanded={adding} disabled={!data} onClick={() => setAdding((v) => !v)}><Icon name="plus" size={13} /> {t('Add')}</button>
        </div>
        <div className="mm-main">
          {adding && <AddOne kind={coll === 'all' ? 'term' : coll} onDone={() => { setAdding(false); refresh() }} />}
          {data && anyHere && (
            <div className="mm-tools">
              <div className="mt-places mm-colls" role="tablist" aria-label={t('Collections')}>
                {COLLECTIONS.map(([k, label, icon]) => <button key={k} type="button" role="tab" data-coll={k} aria-selected={coll === k} className={coll === k ? 'on' : ''} onClick={() => setColl(k)}><Icon name={icon} size={12} /> {t(label)} <span className="muted num">{count(k)}</span></button>)}
              </div>
              <div className="mm-find">
                <input className="mt-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={here.length === 1 ? t('Find a name') : t('Find a name among {n}', { n: here.length })} aria-label={t('Find a name')} />
                <div className="seg small-seg" role="tablist" aria-label={t('Group by')}>
                  {MEM_BY.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={by === k} className={by === k ? 'on' : ''} onClick={() => setBy(k)}>{t(l)}</button>)}
                </div>
              </div>
            </div>
          )}
          {data && !data.dictationsKept && (all || from === 'dictations') && <p className="mm-note muted small" role="status"><Icon name="info" size={13} /> {t('Dictation history is off, so the names you say in dictations aren\'t counted here. Turn it on in Settings › Voice & Meetings › Dictation.')}</p>}
          {err && <p className="error-text small" role="alert">{err}</p>}
          {/* Memory couldn't be read (the computer this window shows is away, say): said, with Try
              again. Once it's been read, a look that fails says so above what it showed. */}
          {error && !data && (
            <div className="mm-empty mm-cant" role="alert">
              <Icon name="alert" size={22} />
              <p><b>{elsewhere ? t('Memory on {name} can\'t be shown right now.', { name: elsewhere }) : t('Memory can\'t be shown right now.')}</b></p>
              <p className="muted small">{error}</p>
              <button type="button" className="btn small" onClick={() => refresh()}><Icon name="refresh" size={12} /> {t('Try again')}</button>
            </div>
          )}
          {error && data && <p className="mm-note muted small" role="status"><Icon name="alert" size={13} /> {t('Couldn\'t look at memory again just now ({error}), so this is how it was.', { error })}</p>}
          {!data && !error && <div className="skeleton-rows"><div /><div /><div /></div>}
          {data && !any && (
            <div className="mm-empty">
              <Icon name="book" size={22} />
              <p><b>{t('Nothing in memory yet.')}</b></p>
              <p className="muted small">{how}</p>
              <p className="muted small">{t('It fills as your meetings are summarized and as you fix a misheard word with Remember on. Or add a name yourself.')}</p>
            </div>
          )}
          {/* Memory has names, none of them from here yet: said, with the way to all of them. */}
          {data && any && !anyHere && (
            <div className="mm-empty mm-none-here">
              <Icon name={at.icon} size={22} />
              <p><b>{t(at.empty)}</b></p>
              <p className="muted small">{t(at.fills)}</p>
              <button type="button" className="btn small" onClick={() => showAll(true)}><Icon name="book" size={12} /> {t('Show all memory')}</button>
            </div>
          )}
          {data && here.length > 0 && !shown.length && (
            <p className="muted small mm-none">
              {s ? (all ? t('Nothing matches "{q}".', { q: q.trim() }) : t(at.find, { q: q.trim() })) : (all ? t('None of these yet.') : t(at.none))}
              {beyond > 0 && <> {beyond === 1 ? t('All memory has one.') : t('All memory has {n}.', { n: beyond })} <button type="button" className="link-btn" onClick={() => showAll(true)}>{t('Show all memory')}</button></>}
            </p>
          )}
          {groups.length > 0 && (
            <div className="mt-mem-list mm-list">
              {groups.map((g, i) => (
                <Fold key={`${by}:${g.key}`} id={`mm-${g.key}`} count={g.items.length} open={g.key in open ? open[g.key] : every || i === 0} onToggle={(v) => setOpen((o) => ({ ...o, [g.key]: v }))}
                  label={<>{by === 'series' && !g.key.startsWith(':') && <Icon name="repeat" size={11} className="muted" />}{g.label}</>}
                  extra={g.meetings.length > 0 && (g.meetings.length === 1 ? t('in {n} meeting', { n: 1 }) : t('in {n} meetings', { n: g.meetings.length }))}>
                  <div className="mt-mem-group">
                    {(full[g.key] || every ? g.items : g.items.slice(0, OPEN)).map((x) => <Item key={x.id} x={x} seen={seen} dicts={data.dictations} onSave={save} onRemove={remove} />)}
                    {!every && g.items.length > OPEN && <button type="button" className="ghost-btn mt-mem-more" onClick={() => setFull((f) => ({ ...f, [g.key]: !f[g.key] }))}>{full[g.key] ? t('Show fewer') : t('Show all {n}', { n: g.items.length })} <Icon name={full[g.key] ? 'up' : 'down'} size={11} /></button>}
                  </div>
                </Fold>
              ))}
            </div>
          )}
          {data && coll === 'person' && <Met people={met} insights={data.insights} act={act} />}
        </div>
        {data && (
          <div className="mm-side">
            <AboutYou a={data.aboutYou} me={data.me} elsewhere={elsewhere} scoped={!all} onChange={refresh} />
            {(same.length > 0 || little.length > 0) && (
              <div className="mm-looks">
                {same.length > 0 && <Same pairs={same} byId={byId} act={act} />}
                {little.length > 0 && <Tidy list={little} byId={byId} act={act} />}
              </div>
            )}
            {any && <p className="muted small mm-how">{how}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

// One name: what it is, how it's misheard and written otherwise, its note, its kind (a guess until
// you or a summary say), yours or learned, and the meetings and dictations it came up in (each
// opens). Edit puts its fields in place of it.
function Item({ x, seen, dicts, onSave, onRemove }) {
  const [edit, setEdit] = useState(false)
  const [shown, setShown] = useState(false)
  const ms = (x.meetings || []).map((id) => seen[id] && { id, ...seen[id] }).filter(Boolean).sort(newest)
  const ds = x.dictations.map((id) => dicts?.[id] && { id, ...dicts[id] }).filter(Boolean).sort(newest)
  const from = [ms.length && (ms.length === 1 ? t('{n} meeting', { n: 1 }) : t('{n} meetings', { n: ms.length })), ds.length && (ds.length === 1 ? t('{n} dictation', { n: 1 }) : t('{n} dictations', { n: ds.length }))].filter(Boolean).join(' · ')
  // Open while it saves: each field as it is now once a save is back (keyed by when it changed).
  if (edit) {
    return (
      <div className="mm-edit" data-term={x.term} key={x.updatedAt}>
        <label><span>{t('Name')}</span><input defaultValue={x.term} autoFocus onBlur={(e) => e.target.value.trim() !== x.term && onSave(x, { term: e.target.value })} /></label>
        <label><span>{t('What it is')}</span>
          <select value={x.kind} onChange={(e) => onSave(x, { kind: e.target.value })}>
            {KINDS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
          </select>
        </label>
        <label><span>{t('Heard as')}</span><input defaultValue={x.heard.join(', ')} onBlur={(e) => e.target.value !== x.heard.join(', ') && onSave(x, { heard: list(e.target.value) })} placeholder={t('Ack me, Act me')} /></label>
        <label><span>{t('Note')}</span><input defaultValue={x.note} onBlur={(e) => e.target.value !== x.note && onSave(x, { note: e.target.value })} placeholder={t('Who or what it is')} /></label>
        <div className="mm-edit-acts">
          <button type="button" className="ghost-btn danger" onClick={() => onRemove(x)}><Icon name="trash" size={13} /> {t('Delete')}</button>
          <button type="button" className="btn small" onClick={() => setEdit(false)}>{t('Done')}</button>
        </div>
      </div>
    )
  }
  return (
    <div className="mm-item" data-term={x.term} data-kind={x.kind}>
      <div className="mm-line">
        <span className="mt-mem-what">
          <b>{x.term}</b>
          {x.heard.length > 0 && <span className="mt-mem-heard small">{t('heard as')} {x.heard.slice(0, 4).map((h) => <i key={h}>{h}</i>)}{x.heard.length > 4 ? ` +${x.heard.length - 4}` : ''}</span>}
          {x.also.length > 0 && <span className="muted small">{t('also {names}', { names: x.also.join(', ') })}</span>}
          {x.note && <span className="muted small mt-mem-note">{x.note}</span>}
        </span>
        <span className="mm-tags">
          <span className={`mm-kind k-${x.kind}${x.guessed ? ' guess' : ''}`} title={x.guessed ? t('A guess, from its note and your meetings. Edit it to say what it is.') : undefined}>{t(KIND[x.kind])}</span>
          <span className={`mt-mem-src ${x.source}`}>{x.source === 'you' ? t('yours') : t('learned')}</span>
          {from && <button type="button" className="ghost-btn mm-from small" aria-expanded={shown} onClick={() => setShown((v) => !v)}>{from}</button>}
        </span>
        <button type="button" className="ghost-btn mm-pen" onClick={() => setEdit(true)} aria-label={t('Edit {name}', { name: x.term })} title={t('Edit')}><Icon name="edit" size={13} /></button>
      </div>
      {shown && (
        <div className="mt-mem-meetings">
          {ms.slice(0, 12).map((m) => <button key={m.id} type="button" className="mt-mem-meeting small" onClick={() => openMeeting(m.id)} title={t('Open {name}', { name: m.title })}><Icon name="mic" size={11} /> <span>{m.title}</span> <span className="muted">{shortDay(m.startedAt)}</span></button>)}
          {ms.length > 12 && <span className="muted small">{t('and {n} earlier', { n: ms.length - 12 })}</span>}
          {ds.slice(0, 12).map((d) => <button key={d.id} type="button" className="mt-mem-meeting small mm-dict" onClick={() => openDictations(d.id)} title={t('Open this dictation')}><Icon name="wave" size={11} /> <span>{around(d.text, [x.term, ...x.also])}</span> <span className="muted">{shortDay(d.at)}</span></button>)}
          {ds.length > 12 && <span className="muted small">{t('and {n} earlier', { n: ds.length - 12 })}</span>}
        </div>
      )}
    </div>
  )
}
// A few words of a dictation, around where it says the name.
function around(text, names) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  const at = Math.max(0, ...names.map((n) => s.toLowerCase().indexOf(String(n).toLowerCase())))
  const from = Math.max(0, at - 30)
  const cut = s.slice(from, from + 80)
  return `${from > 0 ? '…' : ''}${cut}${from + 80 < s.length ? '…' : ''}`
}

// About You: what it says (its first lines, and the rest when you ask), on or off, which models are
// given it, where it came from, and your own words for it. scoped: the page shows only what came up
// in meetings or in dictations, while About You is made from all of memory, so it says so.
function AboutYou({ a, me, elsewhere, scoped, onChange }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [whole, setWhole] = useState(false)
  // On or off at once, and back as it was if that couldn't be saved.
  const [on, setOn] = useState(a.on)
  useEffect(() => setOn(a.on), [a.on])
  const save = async (body) => {
    setBusy(true); setErr(null)
    if ('on' in body) setOn(body.on)
    try { await api('/memory/about', { method: 'POST', body }); setEditing(false); onChange() } catch (e) { setErr(e.message); setOn(a.on) } finally { setBusy(false) }
  }
  const made = scoped ? (a.at ? t('Made from all your memory, {date}', { date: shortDay(a.at) }) : t('Made from all your memory'))
    : a.at ? t('Made from memory, {date}', { date: shortDay(a.at) }) : t('Made from memory')
  // More than its first few lines fit: those, and Show all (looked at again as the page's width changes).
  const box = useRef(null)
  const [more, setMore] = useState(false)
  useLayoutEffect(() => {
    const el = box.current
    if (!el || whole) return
    const look = () => setMore(el.scrollHeight > el.clientHeight + 1)
    look()
    const ro = new ResizeObserver(look)
    ro.observe(el)
    return () => ro.disconnect()
  }, [a.text, editing, whole])
  return (
    <section className={`mm-card mm-you${on ? '' : ' off'}`} aria-label={t('About You')}>
      <div className="mm-card-head">
        <Icon name="user" size={14} />
        <b>{t('About You')}</b>
        <label className="mm-switch">
          <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={(e) => save({ on: e.target.checked })} aria-label={t('Use About You')} />
          <span>{on ? t('On') : t('Off')}</span>
        </label>
      </div>
      {editing
        ? <textarea className="mm-you-edit" value={text} onChange={(e) => setText(e.target.value)} rows={6} autoFocus aria-label={t('About You')} placeholder={t('Who you are, what you work on, the people and organizations you deal with most')} />
        : a.text ? <p ref={box} className={`mm-you-text${whole ? '' : ' clamp'}`}>{a.text}</p>
          : <p className="muted small mm-you-text">{t('Nothing to go on yet: it\'s made from the people, organizations and projects memory has, once your meetings and dictations bring some. Or write it yourself.')}</p>}
      <p className="muted small mm-you-where">
        {!on ? t('Off: no model and not Chief of Staff is given it.')
          : elsewhere ? t('While it\'s on, the models you use for meetings (notes, Who spoke, cleanup, AI Assist and your questions) and the one that tidies your dictation are given it, and Chief of Staff reads it. It\'s made and kept on {name}.', { name: elsewhere })
            : t('While it\'s on, the models you use for meetings (notes, Who spoke, cleanup, AI Assist and your questions) and the one that tidies your dictation are given it, and Chief of Staff reads it. It\'s made and kept on this computer.')}
        {!me && ` ${t('Your name, in Settings › General, starts it off.')}`}
      </p>
      {err && <p className="error-text small" role="alert">{err}</p>}
      <div className="mm-acts">
        {editing ? <>
          <button type="button" className="btn small primary" disabled={busy} onClick={() => save({ text })}>{t('Save')}</button>
          <button type="button" className="ghost-btn" onClick={() => setEditing(false)}>{t('Cancel')}</button>
        </> : <>
          <button type="button" className="btn small" onClick={() => { setText(a.text || ''); setEditing(true) }}><Icon name="edit" size={12} /> {t('Edit')}</button>
          {a.text && (more || whole) && <button type="button" className="ghost-btn mm-you-more" aria-expanded={whole} onClick={() => setWhole((v) => !v)}>{whole ? t('Show less') : t('Show all')}</button>}
          {a.yours && a.draft && <button type="button" className="ghost-btn" disabled={busy} onClick={() => save({ text: '' })}>{t('Use the one made from memory')}</button>}
          <span className="muted small mm-by">{a.yours ? t('As you wrote it') : made}</span>
        </>}
      </div>
    </section>
  )
}

// A name of your own: what it is, how it gets misheard, a note.
function AddOne({ kind, onDone }) {
  const [v, setV] = useState({ term: '', kind, heard: '', note: '' })
  const [err, setErr] = useState(null)
  const go = async (e) => {
    e.preventDefault()
    setErr(null)
    try { await api('/meetings/memory', { method: 'POST', body: { term: v.term, kind: v.kind, heard: list(v.heard), note: v.note } }); onDone() } catch (x) { setErr(x.message) }
  }
  return (
    <form className="mm-card mm-add" onSubmit={go}>
      <input value={v.term} onChange={(e) => setV({ ...v, term: e.target.value })} placeholder={t('Name or term (Acme)')} aria-label={t('Name or term')} autoFocus />
      <select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} aria-label={t('What it is')}>
        {KINDS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
      </select>
      <input value={v.heard} onChange={(e) => setV({ ...v, heard: e.target.value })} placeholder={t('Heard as (Ack me, Act me)')} aria-label={t('Heard as')} />
      <input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder={t('Note (our company)')} aria-label={t('Note')} />
      <button type="submit" className="btn small primary" disabled={v.term.trim().length < 2}><Icon name="plus" size={12} /> {t('Add')}</button>
      {err && <p className="error-text small">{err}</p>}
    </form>
  )
}

// Something to look over, in a line: what and how many, opened to look them over (with what it's
// about), and shut again.
function Look({ kind, icon, label, title, open, onOpen, children }) {
  return (
    <section className={`mm-card mm-look mm-${kind}${open ? ' open' : ''}`} aria-label={label}>
      <button type="button" className="mm-look-head" aria-expanded={open} onClick={() => onOpen(!open)}>
        <Icon name={icon} size={14} />
        <span className="mm-look-what"><b>{title}</b> <span className="mm-look-go">{open ? t('Hide') : t('Review')}</span></span>
        <Icon name="chevron" size={11} className="mm-look-chev" />
      </button>
      {open && children}
    </section>
  )
}

// Two that look like the same one: merged under the name you pick (the other kept as another way
// it's written), or said not to be.
function Same({ pairs, byId, act }) {
  const [open, setOpen] = useState(false)
  const rows = pairs.map(([a, b]) => [byId[a], byId[b]]).filter(([a, b]) => a && b)
  if (!rows.length) return null
  return (
    <Look kind="same" icon="split" label={t('May Be the Same')} open={open} onOpen={setOpen}
      title={rows.length === 1 ? t('{n} pair may be the same', { n: 1 }) : t('{n} pairs may be the same', { n: rows.length })}>
      <p className="muted small">{t('Written alike, or one is the start of the other. Merged, the one you keep gets the other\'s meetings, dictations and note, and the other spelling stays as another way it\'s written.')}</p>
      <div className="mm-rows">
        {rows.map(([a, b]) => (
          <div key={`${a.id}:${b.id}`} className="mm-same-row" data-pair={`${a.term}|${b.term}`}>
            <span className="mm-same-what">{t('"{a}" and "{b}"', { a: a.term, b: b.term })}</span>
            <span className="mm-same-acts">
              <button type="button" className="btn small" onClick={() => act(() => api('/memory/merge', { method: 'POST', body: { into: a.id, from: b.id } }))}>{t('Keep "{name}"', { name: a.term })}</button>
              <button type="button" className="btn small" onClick={() => act(() => api('/memory/merge', { method: 'POST', body: { into: b.id, from: a.id } }))}>{t('Keep "{name}"', { name: b.term })}</button>
              <button type="button" className="ghost-btn" onClick={() => act(() => api('/memory/apart', { method: 'POST', body: { a: a.id, b: b.id } }))}>{t('Not the same')}</button>
            </span>
          </div>
        ))}
      </div>
    </Look>
  )
}

// What looks like it adds little, each with why, all ticked: the ticked ones taken out, the others
// kept (and not offered again). Nothing goes until you say.
function Tidy({ list: these, byId, act }) {
  const [open, setOpen] = useState(false)
  const [off, setOff] = useState(() => new Set()) // unticked
  const rows = these.map((x) => ({ ...x, t: byId[x.id] })).filter((x) => x.t)
  if (!rows.length) return null
  const out = rows.filter((x) => !off.has(x.id)).map((x) => x.id)
  const kept = rows.filter((x) => off.has(x.id)).map((x) => x.id)
  const flip = (id) => setOff((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <Look kind="tidy" icon="trash" label={t('Tidy Up')} open={open} onOpen={setOpen}
      title={rows.length === 1 ? t('{n} looks like it adds little', { n: 1 }) : t('{n} look like they add little', { n: rows.length })}>
      <p className="muted small">{t('Places, languages, days and everyday words that speech to text spells right anyway, and terms that came up once a while ago with nothing to fix. Summaries no longer add these. Nothing goes until you say.')}</p>
      <div className="mm-rows mm-tidy-list">
        {rows.map((x) => (
          <label key={x.id} className="st-check mm-tidy-row" data-term={x.t.term}>
            <input type="checkbox" checked={!off.has(x.id)} onChange={() => flip(x.id)} />
            <span><b>{x.t.term}</b> <span className="muted small">{t(WHY[x.why] || WHY.common)}</span></span>
          </label>
        ))}
      </div>
      <div className="mm-acts">
        <button type="button" className="btn small primary" disabled={!out.length} onClick={() => act(() => api('/memory/tidy', { method: 'POST', body: { remove: out, keep: kept } }))}>
          {!kept.length ? (out.length === 1 ? t('Remove it') : t('Remove all {n}', { n: out.length })) : t('Remove {n}, keep the rest', { n: out.length })}
        </button>
        <button type="button" className="ghost-btn" onClick={() => act(() => api('/memory/tidy', { method: 'POST', body: { keep: rows.map((x) => x.id) } }))}>{t('Keep them all')}</button>
      </div>
    </Look>
  )
}

// People: the ones you meet that memory doesn't have (Meeting Insights), the most met first, each
// one click from memory. With Meeting Insights off (a beta feature), nothing of it shows.
function Met({ people, insights, act }) {
  const [all, setAll] = useState(false)
  if (!insights || !people.length) return null
  const shown = all ? people : people.slice(0, 30)
  return (
    <section className="mm-met" aria-label={t('People You Meet')}>
      <h3>{t('People You Meet')}</h3>
      <p className="muted small">{t('From your meetings\' invites and transcripts, not in memory yet. Keep one to give them a note, say how their name gets misheard, and count them in About You by name.')}</p>
      {shown.map((p) => (
        <div key={p.id} className="mm-met-row" data-person={p.name}>
          <span className="mm-met-what"><b>{p.name}</b> <span className="muted small">{p.meetings === 1 ? t('{n} meeting', { n: 1 }) : t('{n} meetings', { n: p.meetings })}{p.last ? ` · ${t('last {date}', { date: shortDay(p.last) })}` : ''}</span></span>
          <button type="button" className="btn small" onClick={() => act(() => api('/memory/people/keep', { method: 'POST', body: { id: p.id } }))}><Icon name="plus" size={12} /> {t('Keep in memory')}</button>
        </div>
      ))}
      {people.length > 30 && <button type="button" className="ghost-btn mt-mem-more" onClick={() => setAll((v) => !v)}>{all ? t('Show fewer') : t('Show all {n}', { n: people.length })}</button>}
    </section>
  )
}
