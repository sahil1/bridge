import { useEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from '../Icon.jsx'
import { PaneHeader } from '../layout.jsx'
import { api, apiUrl, usePoll, refetch } from '../../api.js'
import { keyLabel } from '../../../shared/dictation/keys.js'
import { keysPlatform, dictationKey, settings as dictationSettings } from '../../dictation/controller.js'
import { RECENT, ANY, byDay, timeOf, length, whereOf, Glyph, takeWanted } from './shared.jsx'
import PermissionFix from '../PermissionFix.jsx'
import { t } from '../../i18n/index.js'
import './dictations.css'

// Dictations: everything you've said with the dictation key, kept on this computer
// (server/dictations.js), newest first by day, each with where it went (the app's icon, or the
// agent's). Search; click one to see it whole (and what was heard, before the cleanup, and the
// recording when it was kept), to Copy it, Paste it again into the app it went to (the desktop app,
// where pasting works), Send it to an agent, or Delete it, with Undo for a moment. It sits under
// Meetings in the sidebar, and in the phone's Meetings tab: the other things you've said.
const app = () => window.bridgeApp || {}
const nameOf = (a) => (a.chief ? t('Chief of Staff') : a.title || a.tab || a.workspace || a.paneId)
const WHY = {
  secure: () => t('Secure input is on (a password field, or Secure Keyboard Entry), so it wasn\'t pasted.'),
  moved: () => t('That app didn\'t come to the front, so it wasn\'t pasted.'),
  focus: () => t('Bridge AI was in front, so it wasn\'t pasted.'),
  held: () => t('A key was still held down, so it wasn\'t pasted. Let go of the keys once you\'ve said it.'),
}

export default function Dictations() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => { const id = setTimeout(() => setQuery(q.trim()), 200); return () => clearTimeout(id) }, [q])
  const [limit, setLimit] = useState(200)
  const path = `/dictations?limit=${limit}${query ? `&q=${encodeURIComponent(query)}` : ''}`
  const { data, error, refresh } = usePoll(path, 15000)
  const [open, setOpen] = useState(null)
  const [hidden, setHidden] = useState(() => new Set()) // deleted here, before the list says so
  const [gone, setGone] = useState(null) // the one just deleted, for Undo
  const [msg, setMsg] = useState(null) // { text, error }
  const [paste, setPaste] = useState(null) // the desktop app's: can it paste here?
  useEffect(() => { app().dictateStatus?.().then((s) => setPaste(s?.paste?.can ? s.paste : null), () => {}) }, [])
  // Opened for one (the sidebar's list): that one, open and in view.
  const listRef = useRef(null)
  useEffect(() => {
    const take = () => { const id = takeWanted(); if (id) { setQ(''); setOpen(id) } }
    take()
    window.addEventListener('bridge-open-dictations', take)
    return () => window.removeEventListener('bridge-open-dictations', take)
  }, [])
  useEffect(() => {
    if (!open || !data) return
    listRef.current?.querySelector(`[data-id="${CSS.escape(open)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, !!data]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!msg) return; const id = setTimeout(() => setMsg(null), msg.error ? 8000 : 3500); return () => clearTimeout(id) }, [msg])
  useEffect(() => { if (!gone) return; const id = setTimeout(() => setGone(null), 8000); return () => clearTimeout(id) }, [gone])

  const items = (data?.items || []).filter((r) => !hidden.has(r.id))
  const changed = () => { refresh(); refetch(RECENT); refetch(ANY) }
  const remove = async (r) => {
    setHidden((h) => new Set(h).add(r.id))
    setOpen(null)
    try { const out = await api(`/dictations/${encodeURIComponent(r.id)}`, { method: 'DELETE' }); setGone(out.deleted || r); changed() } catch (e) {
      setHidden((h) => { const n = new Set(h); n.delete(r.id); return n })
      setMsg({ text: e.message, error: true })
    }
  }
  const undo = async () => {
    const r = gone
    setGone(null)
    try { await api('/dictations', { method: 'POST', body: { restore: r } }); setHidden((h) => { const n = new Set(h); n.delete(r.id); return n }); changed() } catch (e) { setMsg({ text: e.message, error: true }) }
  }
  const label = keyLabel(dictationKey(dictationSettings()), keysPlatform())
  const total = data?.total ?? 0
  const groups = byDay(items)
  return (
    <div className="dc-view">
      <PaneHeader icon="wave" title={t('Dictations')} subtitle={<span className="dc-count">{data ? (total === 1 ? t('{n} dictation', { n: total }) : t('{n} dictations', { n: total })) : t('Dictations')} · {t('On this computer')}</span>}>
        <button type="button" className="btn small" onClick={() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'voice' } }))} title={t('Keep history, how long, the recordings, Delete all')}><Icon name="settings" size={13} /> {t('Settings')}</button>
      </PaneHeader>
      <div className="dc-home" ref={listRef}>
        {data && !data.history && (
          <p className="dc-off small" role="status"><Icon name="info" size={13} /> {t('History is off, so new dictations aren\'t kept. Turn it on in Settings › Voice.')}</p>
        )}
        {(total > 0 || q) && <input className="dc-search" type="search" placeholder={t('Search what you said, and where')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('Search dictations')} />}
        {error && !data && <p className="error-text small">{error}</p>}
        {data && !total && !q && (
          <div className="dc-empty">
            <Icon name="wave" size={22} />
            <p><b>{t('Nothing dictated yet.')}</b></p>
            <p className="muted small">{!matchMedia('(pointer: coarse)').matches
              ? t('Hold {key} and talk, in Bridge AI or (once you turn it on) in any app. What you say is kept here, on this computer, with where it went.', { key: label })
              : t('Hold the mic button in a message box and talk. What you say is kept here, on your computer, with where it went.')}</p>
          </div>
        )}
        {data && query && !items.length && <p className="muted small">{t('Nothing matches "{q}".', { q: query })}</p>}
        {groups.map((g) => (
          <section key={g.d} className="dc-group">
            <h3>{g.d}</h3>
            {g.items.map((r) => <Row key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} onDelete={() => remove(r)} paste={paste} onMsg={setMsg} />)}
          </section>
        ))}
        {data?.more && <button type="button" className="btn small dc-more" onClick={() => setLimit((n) => n + 200)}>{t('Show more')}</button>}
      </div>
      {(gone || msg) && (
        <div className={`dc-toast${msg?.error ? ' error' : ''}`} role="status">
          {gone ? <><span>{t('Deleted.')}</span><button type="button" className="link-btn" onClick={undo}>{t('Undo')}</button></> : <span>{msg.text}</span>}
        </div>
      )}
    </div>
  )
}

// One dictation: where it went, when, how long, and its words (a few lines). Open: all of them,
// what was heard, the recording, and what to do with it.
function Row({ r, open, onToggle, onDelete, paste, onMsg }) {
  const [picking, setPicking] = useState(false)
  const [heard, setHeard] = useState(false)
  const [busy, setBusy] = useState(false)
  // Paste again with no Accessibility yet: the way to allow it, right here, and then it's pasted.
  // stale: macOS says it's on and the paste was refused anyway, so Reset and ask again first.
  const [access, setAccess] = useState(null) // null | 'off' | 'stale'
  // The agents running now, asked for when the list of them opens.
  const [agents, setAgents] = useState([])
  const pick = () => {
    if (!picking) api('/fleet').then((f) => setAgents((f?.agents || []).filter((a) => !a.shellTab && !a.cloudOnly)), () => {})
    setPicking((v) => !v)
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(r.text); onMsg({ text: t('Copied.') }) } catch (e) { onMsg({ text: e.message, error: true }) }
  }
  const again = async () => {
    setBusy(true)
    try {
      const x = await app().dictateRepaste({ text: r.text, bundle: r.app?.bundle || null })
      if (x?.pasted) onMsg({ text: r.app?.name ? t('Pasted into {app}', { app: r.app.name }) : t('Pasted') })
      else if (x?.error === 'accessibility') setAccess((await app().pasteAccess?.().catch(() => null)) === 'ok' ? 'stale' : 'off')
      else onMsg({ text: (WHY[x?.error] || (() => t('Couldn\'t paste it there.')))(), error: true })
    } catch (e) { onMsg({ text: e.message, error: true }) } finally { setBusy(false) }
  }
  const send = async (a) => {
    setPicking(false)
    try {
      // As the message box does: a working agent that can't take a message now gets it when it's free.
      await api(`/agents/${encodeURIComponent(a.paneId)}/${a.status === 'working' && !a.caps?.typeAhead ? 'queue' : 'prompt'}`, { method: 'POST', body: { text: r.text } })
      onMsg({ text: t('Sent to {name}', { name: nameOf(a) }) })
    } catch (e) { onMsg({ text: e.message, error: true }) }
  }
  const where = whereOf(r)
  return (
    <div className={`dc-row${open ? ' open' : ''}`} data-id={r.id}>
      <button type="button" className="dc-head" onClick={onToggle} aria-expanded={open}>
        <Glyph r={r} />
        <span className="dc-main">
          <span className="dc-where"><b>{where}</b><span className="muted">{timeOf(r.at)}{r.ms ? ` · ${length(r.ms)}` : ''}</span></span>
          {!open && <span className="dc-text">{r.text}</span>}
        </span>
      </button>
      {open && (
        <div className="dc-body">
          <p className="dc-full">{heard && r.raw ? r.raw : r.text}</p>
          {r.raw && <button type="button" className="link-btn small dc-heard" onClick={() => setHeard((v) => !v)}>{heard ? t('Show it as it was put in') : t('Show it as it was heard, before the cleanup')}</button>}
          {access && <PermissionFix pane="accessibility" stale={access === 'stale'} ask={access === 'off' ? 1 : 0} onCheck={() => { setAccess(null); again() }}><p className="small">{t('Pasting needs Accessibility.')}</p></PermissionFix>}
          {r.audio && <audio className="dc-audio" controls preload="none" src={apiUrl(`/dictations/${encodeURIComponent(r.id)}/audio`)} />}
          <div className="dc-acts">
            <button type="button" className="btn small" onClick={copy}><Icon name="copy" size={12} /> {t('Copy')}</button>
            {paste && app().dictateRepaste && (
              <button type="button" className="btn small" onClick={again} disabled={busy} title={r.app?.name ? t('Paste it where you were typing in {app}', { app: r.app.name }) : t('Paste it where you were typing before Bridge AI')}>
                <Icon name="clipboard" size={12} /> {r.app?.name ? t('Paste again in {app}', { app: r.app.name }) : t('Paste again')}
              </button>
            )}
            <span className="dc-send">
              <button type="button" className="btn small" onClick={pick} aria-haspopup="menu" aria-expanded={picking}><Icon name="send" size={12} /> {t('Send to an agent')} <Icon name="down" size={11} /></button>
              {picking && (
                <div className="dc-menu" role="menu">
                  {agents.map((a) => (
                    <button key={a.paneId} type="button" role="menuitem" data-pane={a.paneId} onClick={() => send(a)}>
                      {a.chief ? <Icon name="helm" size={12} /> : <StatusDot status={a.status} size={7} />} <span>{nameOf(a)}</span>
                    </button>
                  ))}
                  {!agents.length && <p className="muted small">{t('No agents are running.')}</p>}
                </div>
              )}
            </span>
            <span className="grow" />
            <button type="button" className="btn small danger-soft" onClick={onDelete}><Icon name="trash" size={12} /> {t('Delete')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
