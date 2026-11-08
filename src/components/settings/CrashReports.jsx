import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'
import { t } from '../../i18n/index.js'
import './counts.css'

// Settings › About & Updates › Crash Reports (server/crashes.js): on unless you turn it off, and
// shown only where it can work (the project has a crash server, and DO_NOT_TRACK isn't set). On, a
// crash's report goes to the project by itself: the same text Report on GitHub shows, with names,
// folders, emails and keys taken out. Each report sent can be read here, as it went.
export default function CrashReports() {
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(null) // a report's id
  const [doc, setDoc] = useState(null)
  useEffect(() => { api('/crashes/sending').then(setS, () => setS(null)) }, [])
  if (!s || (!s.available && !s.refused)) return null
  const toggle = async (e) => {
    setBusy(true); setErr(null)
    try { setS(await api('/crashes/sending', { method: 'POST', body: { send: e.target.checked } })) } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  const show = async (id) => {
    if (open === id) { setOpen(null); return }
    setOpen(id); setDoc(null)
    try { setDoc(await api(`/crashes/sent/${encodeURIComponent(id)}`)) } catch (x) { setErr(x.message) }
  }
  return (
    <section className="st-sec">
      <h4>{t('Crash Reports')}</h4>
      {s.refused ? <p className="muted small">{t('Off on this computer: {setting} is set.', { setting: s.refused })}</p> : (
        <>
          <label className="ph-check"><input type="checkbox" checked={!!s.send} disabled={busy} onChange={toggle} /> {t('Send crash reports by themselves')}</label>
          <p className="muted small">{t('When something in Bridge AI crashes, its report goes to {host}: what crashed, the error and where in Bridge AI\'s code, the version, your system and the last lines of its log, the same text Report on GitHub shows. Names, folders, emails and keys are taken out first. Kept for 90 days, with no ID for you or this computer. On unless you turn it off.', { host: s.to })} {t('It also says its update channel.')}</p>
          {s.stopped && <p className="st-note"><Icon name="info" size={13} /><span>{t('The project asked Bridge AI to stop sending crash reports: {why}', { why: s.stopped })}</span></p>}
          {s.sent?.length > 0 && (
            <div className="st-row">
              <span className="muted small">{t('Sent:')}</span>
              {s.sent.slice(0, 8).map((r) => <button key={r.id} type="button" className="link-btn small" aria-expanded={open === r.id} onClick={() => show(r.id)}>{String(r.at || '').slice(0, 10)} {r.kind}</button>)}
            </div>
          )}
          {open && doc && (
            <div className="counts-doc">
              <p className="muted small">{t('The report, as it was sent:')}</p>
              <pre className="st-code ro">{JSON.stringify(doc.report, null, 2)}</pre>
            </div>
          )}
          {err && <p className="st-note bad"><Icon name="alert" size={13} /> {err}</p>}
        </>
      )}
    </section>
  )
}
