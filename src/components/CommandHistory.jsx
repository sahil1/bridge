// History › Commands (Scheduled Routines, a beta feature): what you asked in Bridge AI's boxes, kept on
// this computer (server/cmdhistory.js): messages to an agent or the Chief of Staff, new agents' first
// messages, tasks and answers. Searched, a day at a time, each made a routine or deleted; with a
// routine suggested on top when you ask the same thing on a schedule.
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import AgentMark from './settings/agentMark.jsx'
import { api } from '../api.js'
import { Suggested } from './Routines.jsx'
import { makeRoutine, nameFrom, scheduleNear, shortDir } from './routineDraft.js'
import { t, tx, locale } from '../i18n/index.js'

const BOX = { message: tx('Message box'), new: tx('New'), tasks: tx('Tasks'), reply: tx('Needs you') }
const KEEP = { '30d': tx('30 days'), '90d': tx('90 days'), '1y': tx('a year') }
const dayOf = (iso) => new Date(iso).toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric' })
const timeOf = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })

export default function CommandHistory({ onClose, onSettings }) {
  const [q, setQ] = useState('')
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const seq = useRef(0)
  const load = (term = q) => {
    const n = ++seq.current
    return api(`/command-history?limit=300${term.trim() ? `&q=${encodeURIComponent(term.trim())}` : ''}`).then((d) => { if (n === seq.current) { setData(d); setErr(null) } }).catch((e) => setErr(e.message))
  }
  useEffect(() => { const id = setTimeout(() => load(q), q ? 200 : 0); return () => clearTimeout(id) }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const del = async (r) => { try { await api(`/command-history/${r.id}`, { method: 'DELETE' }); load() } catch (e) { setErr(e.message) } }
  const routine = (r) => {
    makeRoutine({ name: nameFrom(r.text), command: r.text, to: r.to?.chief ? 'chief' : 'agent', cwd: r.to?.cwd || '~/', kind: r.to?.chief || r.to?.kind === 'chat' ? '' : r.to?.kind || '', schedule: scheduleNear(r.at) })
  }
  const items = data?.items || []
  let lastDay = null
  return (
    <>
      <div className="hist-search">
        <Icon name="search" size={14} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search what you asked: a project, a request, a word…')} aria-label={t('Search what you asked')} />
      </div>
      {err && <p className="error-text small">{err}</p>}
      <div className="hist-list cmd-list">
        {!q && data?.history && <Suggested onMade={onClose} />}
        {data && !data.history && (
          <p className="st-note cmd-off"><Icon name="info" size={13} /> {t('Command History is off, so nothing new is kept.')} <button type="button" className="link-btn" onClick={onSettings}>{t('Turn it on in Settings › General')}</button></p>
        )}
        {!data && !err && <p className="muted small hist-sub">{t('Loading…')}</p>}
        {data && (
          <p className="muted small hist-sub">{q.trim()
            ? (data.found ? t('{n} of what you asked match "{q}"', { n: data.found, q: q.trim() }) : t('Nothing you asked matches "{q}".', { q: q.trim() }))
            : items.length ? t('What you asked your agents and Chief of Staff, newest first.') : data.history ? t('What you ask your agents and Chief of Staff from here on shows up here, to find again or make a routine of.') : null}</p>
        )}
        {items.map((r) => {
          const day = dayOf(r.at)
          const head = day !== lastDay ? <h4 key={`d-${day}`} className="cmd-day">{day}</h4> : null
          lastDay = day
          return [head, (
            <div key={r.id} className="hist-item cmd-item">
              {r.to?.chief ? <span className="cmd-mark"><Icon name="helm" size={14} /></span> : <AgentMark kind={r.to?.kind || 'claude'} size={18} />}
              <div className="hist-body">
                <div className="cmd-text">{r.text}</div>
                <div className="muted small hist-where">
                  {timeOf(r.at)} · {r.to?.chief ? t('Chief of Staff') : [r.to?.name, shortDir(r.to?.cwd)].filter(Boolean).join(' · ') || t('An agent')} · {t(BOX[r.box] || BOX.message)}{r.files ? ` · ${r.files === 1 ? t('1 file') : t('{n} files', { n: r.files })}` : ''}
                </div>
              </div>
              <span className="cmd-acts">
                <button type="button" className="btn small" onClick={() => routine(r)} title={t('Run this again on a schedule')}><Icon name="repeat" size={12} /> {t('Make a routine')}</button>
                <button type="button" className="win-btn" onClick={() => del(r)} aria-label={t('Delete from your history')} title={t('Delete from your history')}><Icon name="trash" size={12} /></button>
              </span>
            </div>
          )]
        })}
        {data?.more && <p className="muted small hist-sub">{t('The newest 300 are shown. Search finds the rest.')}</p>}
      </div>
      {data && <p className="muted small cmd-foot"><Icon name="laptop" size={11} /> {data.history ? t('Kept on this computer for {time}, never sent anywhere.', { time: t(KEEP[data.keepFor] || KEEP['90d']) }) : t('Kept on this computer only.')} <button type="button" className="link-btn" onClick={onSettings}>{t('Settings')}</button></p>}
    </>
  )
}
