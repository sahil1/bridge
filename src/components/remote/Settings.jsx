// Settings › Account & Devices › Computers, with Remote Screen and Preview on (a Beta Feature): this
// computer's screen (whether your other devices can see it, and if not why), "Let my other devices
// control this computer" (off until you turn it on, here only; on a Mac, macOS's Accessibility
// question then), who's looking now, with Stop, and the record of every session.
import { useState } from 'react'
import Icon from '../Icon.jsx'
import { BASE, api, onThisComputer } from '../../api.js'
import { useTrial } from '../../trials.js'
import { t } from '../../i18n/index.js'
import { useRemote, remoteDo } from './remote.js'
import { Sessions, whoOf } from './Here.jsx'

const desktop = () => (window.bridgeApp?.desktop && window.bridgeApp.remote ? window.bridgeApp : null)

// active: look at all (the devices menu looks only while it's open).
export function useControl(active = true) {
  const here = onThisComputer()
  const on = useTrial('remote-screen')
  const r = useRemote(BASE, 4000, on && active)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = async (want) => {
    setBusy(true)
    setErr(null)
    try {
      // Turned on at a Mac: macOS's own Accessibility question now, never before.
      if (want && r.data?.os === 'mac') await desktop()?.remote.controlAsk().catch(() => null)
      await remoteDo(BASE, '/control', { on: want })
      r.refresh()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  return { on, here, data: r.data, error: r.error, busy, err, set, refresh: r.refresh }
}

export function RemoteSettings() {
  const { on, here, data, error, busy, err, set, refresh } = useControl()
  const [asked, setAsked] = useState(null)
  if (!on) return null
  if (!data) return <section className="st-sec"><h4>{t("This Computer's Screen")}</h4>{error ? <p className="error-text small">{error.message === 'update' ? t('Bridge AI here is too old for this. Update it.') : error.message}</p> : <div className="skeleton-rows"><div /></div>}</section>
  const sc = data.screen || {}
  const c = data.control || {}
  const name = data.name
  const askScreen = async () => { setAsked(null); try { const r = await api('/calls/screen', { method: 'POST' }); setAsked(r.allowed ? 'ok' : 'asked'); refresh() } catch (e) { setAsked(e.message) } }
  const allowAx = async () => { await desktop()?.permission?.ask('accessibility').catch(() => null); refresh() }
  const watching = (data.sessions || []).filter((s) => s.kind === 'screen')
  return (
    <>
      <section className="st-sec rs-settings" data-setting="remote-screen">
        <h4>{t("This Computer's Screen")}</h4>
        <p className="muted small">{t('Your other devices can see this screen, and the apps your agents serve here, through their encrypted link. While one does, this screen says so, with Stop, and each time is kept below.')}</p>
        {sc.can
          ? <p className="small rs-ok"><Icon name="check" size={12} /> {t('Your other devices can see this screen while Bridge AI is open here.')}</p>
          : <p className="small rs-no"><Icon name="info" size={12} /> {sc.why}</p>}
        {data.os === 'mac' && here && sc.can && sc.permission === 'ask' && (
          <div className="st-row between">
            <p className="muted small">{asked === 'asked' ? t('macOS asked: turn on Bridge AI under Screen & System Audio Recording, then open Bridge AI again.') : t('macOS asks about Screen Recording the first time one of your devices looks. You can say yes now instead, so nobody has to be here then.')}</p>
            <button type="button" className="btn small" onClick={askScreen}>{t('Allow Screen Recording')}</button>
          </div>
        )}
        {typeof asked === 'string' && !['ok', 'asked'].includes(asked) && <p className="error-text small">{asked}</p>}
        <label className="st-check rs-control">
          <input type="checkbox" role="switch" checked={!!c.on} disabled={!here || busy || (!c.can && !c.on)} onChange={(e) => set(e.target.checked)} />
          <span>
            <b>{t('Let my other devices control this computer')}</b><br />
            <small className="muted">{t('Their mouse and keyboard work on this screen while they view it, and the clipboard goes both ways. Anyone here moving the mouse or pressing a key pauses them for a moment.')}</small>
          </span>
        </label>
        {!here && <p className="muted small">{t('Control is turned on and off at {name} itself.', { name })}</p>}
        {here && !c.can && c.why && <p className="muted small"><Icon name="info" size={12} /> {c.why}</p>}
        {here && c.on && c.asks === 'accessibility' && c.allowed === false && (
          <div className="st-row between">
            <p className="small">{t("macOS doesn't let Bridge AI control this Mac yet: turn on Bridge AI in System Settings › Privacy & Security › Accessibility.")}</p>
            {desktop() && <button type="button" className="btn small" onClick={allowAx}>{t('Open Accessibility')}</button>}
          </div>
        )}
        {(err) && <p className="error-text small">{err}</p>}
        {watching.length > 0 && (
          <ul className="rs-now">
            {watching.map((s) => (
              <li key={s.id}>
                <span className="rs-dot on" aria-hidden="true" />
                <span>{s.controlled ? t('{who} is controlling this screen', { who: whoOf(s) }) : t('{who} is viewing this screen', { who: whoOf(s) })}</span>
                {here && <button type="button" className="btn small danger" onClick={() => remoteDo(BASE, `/sessions/${encodeURIComponent(s.id)}/stop`).then(refresh, () => {})}>{t('Stop')}</button>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="st-sec" data-setting="remote-sessions">
        <h4>{t('Screen Sessions')}</h4>
        <p className="muted small">{t('Who viewed or controlled this computer, from which device, when and for how long. Kept on this computer only, the last 200.')}</p>
        <Sessions log={data.log} here={here} />
      </section>
    </>
  )
}
