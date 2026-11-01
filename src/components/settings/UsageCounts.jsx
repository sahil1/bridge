import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'
import { t } from '../../i18n/index.js'
import './counts.css'

// Settings › About & Updates › Usage counts (server/counts.js): off unless you turn it on, and
// shown only where it can work (the project has an endpoint for it, and DO_NOT_TRACK isn't set).
// See exactly what would be sent shows the next report as it would go, and what was sent shows each
// report that went, as it went.
export default function UsageCounts() {
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [open, setOpen] = useState(null) // 'preview' | a week sent
  const [doc, setDoc] = useState(null)
  useEffect(() => { api('/counts').then(setS, () => setS(null)) }, [])
  if (!s || (!s.available && !s.refused)) return null
  const show = async (what) => {
    if (open === what) { setOpen(null); return }
    setOpen(what); setDoc(null)
    try { setDoc(what === 'preview' ? await api('/counts/preview') : { share: true, sent: what, report: await api(`/counts/sent/${what}`) }) } catch (e) { setErr(e.message) }
  }
  const toggle = async (e) => {
    setBusy(true); setErr(null)
    try { setS(await api('/counts', { method: 'POST', body: { share: e.target.checked } })); if (open === 'preview') setDoc(await api('/counts/preview')) } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  return (
    <section className="st-sec">
      <h4>{t('Usage counts')}</h4>
      {s.refused ? <p className="muted small">{t('Off on this computer: {setting} is set.', { setting: s.refused })}</p> : (
        <>
          <label className="ph-check"><input type="checkbox" checked={!!s.share} disabled={busy} onChange={toggle} /> {t('Share anonymous usage counts')}</label>
          <p className="muted small">{t('Once a week: which features you used and how often, as numbers in ranges, sent to {host}. No names, paths, prompts or anything you typed or said, and no ID for you or this computer. Off unless you turn it on; turning it off stops it at once and forgets what wasn\'t sent.', { host: s.to })}</p>
          {s.stopped && <p className="st-note"><Icon name="info" size={13} /><span>{t('The project asked Bridge AI to stop sharing: {why}', { why: s.stopped })}</span></p>}
          <div className="st-row">
            <button type="button" className="ghost-btn" aria-expanded={open === 'preview'} onClick={() => show('preview')}><Icon name="eye" size={12} /> {t('See exactly what would be sent')}</button>
            {s.sent?.length > 0 && <span className="muted small">{t('Sent:')}</span>}
            {(s.sent || []).slice(0, 8).map((w) => <button key={w} type="button" className="link-btn small" aria-expanded={open === w} onClick={() => show(w)}>{w}</button>)}
          </div>
          {open && doc && (
            <div className="counts-doc">
              <p className="muted small">{doc.sent ? t('The report for {week}, as it was sent:', { week: doc.sent }) : doc.share ? (doc.goes === 'next' ? t('The report for {week}, as it goes next:', { week: doc.week }) : t('The report for {week} so far, as it goes once the week is over:', { week: doc.week })) : t('Nothing is counted while this is off. With it on, a week\'s report says this about this computer, and how often each feature below was used:')}</p>
              <pre className="st-code ro">{JSON.stringify(doc.report, null, 2)}</pre>
              {doc.share && doc.empty && <p className="muted small">{t('Nothing has been counted this week yet. A week with nothing counted isn\'t sent.')}</p>}
              {!doc.sent && (
                <details>
                  <summary className="small">{t('Everything that can be counted')}</summary>
                  <ul className="counts-list small">{Object.entries(s.counters || {}).map(([k, v]) => <li key={k}><code>{k}</code> {v}</li>)}</ul>
                </details>
              )}
            </div>
          )}
          {err && <p className="st-note bad"><Icon name="alert" size={13} /> {err}</p>}
        </>
      )}
    </section>
  )
}
