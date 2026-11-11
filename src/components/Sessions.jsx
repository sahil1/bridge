import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api, usePoll, settingsChanged } from '../api.js'
import { t, tn } from '../i18n/index.js'
import './sessions.css'

// Your herdr sessions, when agents run in herdr: which one Bridge AI shows, the others (with how
// many agents wait on you there), one-click switching, a new session started in the background,
// stopping one, and opening one in your terminal. The pick is saved like the one in Settings ›
// General, and the fleet, board and Herdr view follow it at once.
const NAME = /^[A-Za-z0-9._-]{1,64}$/
const ok = (name) => NAME.test(name) && name !== '.' && name !== '..'

export default function SessionSwitcher({ fleet, phone = false }) {
  const conf = usePoll('/config', 10 * 60 * 1000).data
  const herdr = conf?.runtime?.name === 'herdr'
  const list = usePoll(herdr ? '/herdr/sessions?needs=1' : null, 30 * 1000)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(null) // the session being switched to
  const [note, setNote] = useState(null) // { text, bad, name: a session to offer Open in terminal for }
  const [busy, setBusy] = useState(null) // what's running: 'start:<name>', 'stop:<name>'
  const ref = useRef(null)

  const shown = fleet?.session ?? conf?.runtime?.session ?? null
  // Switched: refresh what depends on the session (the list, the brief, previews).
  useEffect(() => {
    if (pending && shown === pending) { setPending(null); settingsChanged() }
  }, [shown, pending])
  useEffect(() => { if (open) list.refresh() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!note || note.bad) return; const t = setTimeout(() => setNote(null), 3500); return () => clearTimeout(t) }, [note])
  useEffect(() => {
    if (!open) return
    const down = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open])

  if (!herdr) return null
  const sessions = list.data?.sessions || []
  const name = pending || shown
  const down = !!fleet?.down && !pending
  // Agents waiting on you in the other sessions (this one's are on the board already).
  const elsewhere = sessions.filter((s) => s.name !== shown && s.running).reduce((n, s) => n + (s.needsYou || 0), 0)

  const run = async (what, fn) => {
    setBusy(what)
    setNote(null)
    try { return await fn() } catch (e) { setNote({ text: e.message, bad: true, name: e.session }); return null } finally { setBusy(null); list.refresh() }
  }
  const show = (s) => {
    if (s.name === shown && !fleet?.down) { setOpen(false); return }
    // A stopped one starts first (in the background), then shows. If it can't, your terminal can.
    run(`start:${s.name}`, async () => {
      if (s.running) await api('/herdr/session', { method: 'POST', body: { name: s.name } })
      else { try { await api('/herdr/sessions', { method: 'POST', body: { name: s.name } }) } catch (e) { throw Object.assign(e, { session: s.name }) } }
      setPending(s.name)
      setOpen(false)
    })
  }
  const create = (raw) => {
    const n = raw.trim()
    if (!ok(n)) { setNote({ text: t("Use letters, numbers, '.', '_' or '-' (up to 64)."), bad: true }); return }
    run(`start:${n}`, async () => {
      // Couldn't start it in the background: offer your terminal instead.
      try { await api('/herdr/sessions', { method: 'POST', body: { name: n } }) } catch (e) { throw Object.assign(e, { session: n }) }
      setPending(n)
      setOpen(false)
      setNote({ text: t('Started {name}', { name: n }) })
    })
  }
  const stop = (s) => {
    if (!window.confirm(t('Stop the herdr session "{name}"?\n\nEverything running in it ends, the same as herdr session stop. herdr keeps its layout, so starting it again brings the spaces and tabs back.', { name: s.name }))) return
    run(`stop:${s.name}`, async () => {
      await api(`/herdr/sessions/${encodeURIComponent(s.name)}/stop`, { method: 'POST' })
      // The one in view says so itself (isn't running, Start it).
      if (s.name !== shown) setNote({ text: t('Stopped {name}', { name: s.name }) })
    })
  }
  const terminal = (n, create = false) => run(`term:${n}`, async () => {
    const r = await api(`/herdr/sessions/${encodeURIComponent(n)}/terminal`, { method: 'POST', body: { create } })
    setNote({ text: t('Opened {name} in {app}', { name: n, app: r.app }) })
  })

  return (
    <div className={`hs ${phone ? 'hs-phone' : ''}`} ref={ref}>
      <button type="button" className={`hs-trigger ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        title={name ? t('herdr session: {name}. Switch, start or stop sessions.', { name }) : t('herdr session: none running. Switch, start or stop sessions.')}>
        <Icon name="terminal" size={12} className="hs-icon" />
        <span className="hs-kind">herdr</span>
        <span className="hs-name">{name || t('No session')}</span>
        {pending && <span className="hs-state">{t('switching…')}</span>}
        {elsewhere > 0 && <span className="hs-badge" title={elsewhere === 1 ? t('1 agent in other sessions needs you') : t('{n} agents in other sessions need you', { n: elsewhere })}>{elsewhere}</span>}
        <Icon name="chevron" size={10} className={`hs-caret ${open ? 'flip-up' : ''}`} />
      </button>

      {down && !open && (
        <div className="hs-down" role="status">
          <span>{name ? tn('{name} isn\'t running.', { name: <b>{name}</b> }) : t('No herdr session is running.')}</span>
          {name && <button type="button" className="ghost-btn strong" disabled={!!busy} onClick={() => show({ name, running: false })}>{busy === `start:${name}` ? t('Starting…') : t('Start it')}</button>}
        </div>
      )}
      {note && !open && <p className={`hs-note ${note.bad ? 'bad' : ''}`} role="status">{note.text}
        {note.bad && note.name && !phone && <button type="button" className="link-btn" onClick={() => terminal(note.name, !sessions.some((s) => s.name === note.name))}>{t('Open in terminal instead')}</button>}</p>}

      {open && (
        <div className="hs-menu" role="menu" aria-label={t('herdr sessions')}>
          <div className="hs-head">{t('herdr sessions')}</div>
          {!list.data && <div className="skeleton-rows pad"><div /><div /></div>}
          {list.data && !list.data.installed && <p className="hs-empty" title={list.data.error}>{t('herdr isn\'t installed, or isn\'t answering.')}</p>}
          {sessions.map((s) => {
            const here = s.name === shown
            const atWork = (s.working || 0) + (s.needsYou || 0)
            return (
              <div key={s.name} className={`hs-row ${here ? 'here' : ''}`}>
                <button type="button" role="menuitemradio" aria-checked={here} className="hs-pick" disabled={!!busy} onClick={() => show(s)}
                  title={here ? t('Shown now') : s.running ? t('Show {name}', { name: s.name }) : t('Start {name} in the background and show it', { name: s.name })}>
                  <span className={`hs-dot ${s.running ? 'on' : ''}`} aria-hidden="true" />
                  <span className="hs-row-name">{s.name}</span>
                  {!s.running && <span className="hs-row-state">{busy === `start:${s.name}` ? t('starting…') : t('stopped')}</span>}
                  {s.running && !here && s.needsYou > 0 && <span className="hs-badge" title={s.needsYou === 1 ? t('1 needs you') : t('{n} need you', { n: s.needsYou })}>{s.needsYou}</span>}
                  {here && <Icon name="check" size={13} className="hs-check" />}
                </button>
                {!phone && (
                  <button type="button" className="hs-act" onClick={() => terminal(s.name)} disabled={!!busy} aria-label={t('Open {name} in your terminal', { name: s.name })} title={t('Open in terminal (herdr session attach)')}>
                    <Icon name="external" size={phone ? 16 : 12} />
                  </button>
                )}
                {s.running && (
                  <button type="button" className="hs-act danger" onClick={() => stop(s)} disabled={!!busy || atWork > 0} aria-label={t('Stop {name}', { name: s.name })}
                    title={atWork ? t('Agents are working or waiting on you in {name}; it can\'t be stopped now', { name: s.name }) : t('Stop {name}…', { name: s.name })}>
                    <Icon name="stop" size={phone ? 16 : 12} />
                  </button>
                )}
              </div>
            )
          })}
          {list.data?.installed && <>
            <div className="menu-sep" />
            <NewSession busy={busy} onCreate={create} taken={(n) => sessions.some((s) => s.name === n)} />
          </>}
          {note && <p className={`hs-note in-menu ${note.bad ? 'bad' : ''}`} role="status">{note.text}
            {note.bad && note.name && !phone && <button type="button" className="link-btn" onClick={() => terminal(note.name, !sessions.some((s) => s.name === note.name))}>{t('Open in terminal instead')}</button>}</p>}
        </div>
      )}
    </div>
  )
}

// "New session…": a name, then herdr starts it in the background and Bridge AI shows it.
function NewSession({ busy, onCreate, taken }) {
  const [naming, setNaming] = useState(false)
  const [v, setV] = useState('')
  if (!naming) {
    return <button type="button" role="menuitem" className="menu-item" onClick={() => setNaming(true)} disabled={!!busy}><Icon name="plus" size={13} /> {t('New session…')}</button>
  }
  const n = v.trim()
  const starting = busy === `start:${n}`
  return (
    <form className="hs-new" onSubmit={(e) => { e.preventDefault(); if (n) onCreate(n) }}>
      <input className="hs-input" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={t('Name, e.g. side-project')} maxLength={64} spellCheck={false} aria-label={t('New session name')}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(false) } }} />
      <button type="submit" className="btn small primary" disabled={!n || !!busy}>{starting ? t('Starting…') : taken(n) ? t('Show') : t('Start')}</button>
    </form>
  )
}
