import { useState } from 'react'
import Icon from './Icon.jsx'
import { api, usePoll, viaRelay } from '../api.js'

// What macOS asks you to allow, as buttons: open that page of System Settings, show Bridge AI in
// Finder to drag into the list, restart so it takes effect, check again. From a phone, where none of
// it can be done, just the steps. grant: false for pages where you turn something on for an account
// (Internet Accounts) rather than add an app.
export default function PermissionFix({ pane, onCheck, grant = true, children }) {
  const { data } = usePoll('/fix', 10 * 60 * 1000)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(null)
  const run = async (key, path, body) => {
    setBusy(key)
    setNote(null)
    try { await api(path, { method: 'POST', body }) } catch (e) { setNote(e.message) } finally { setBusy(null) }
  }
  if (data && !data.mac) return null
  const label = data?.panes?.[pane] || 'Privacy & Security'
  const name = data?.app?.name
  const desktop = !!data?.app?.desktop
  const here = !viaRelay
  const canRestart = here && desktop && !!window.bridgeApp?.restart
  const restart = () => {
    if (!window.confirm('Restart Bridge AI now? Agents in the middle of something may be interrupted.')) return
    window.bridgeApp.restart()
  }
  const openBtn = here && <button type="button" className="btn small primary" disabled={busy === 'open'} onClick={() => run('open', '/fix/settings', { pane })}><Icon name="external" size={12} /> Open {label}</button>
  // Turning something on for an account: one button, no steps.
  if (!grant) {
    return (
      <div className="perm-fix">
        {children}
        {openBtn}
        {!here && <p className="muted small">Do this on your computer.</p>}
        {note && <p className="error-text">{note}</p>}
        {onCheck && <button type="button" className="btn" onClick={onCheck}><Icon name="refresh" size={13} /> Check again</button>}
      </div>
    )
  }
  return (
    <div className="perm-fix">
      {children}
      <ol className="perm-steps">
        <li>
          <span>Open <b>{label}</b> in System Settings › Privacy & Security.</span>
          {openBtn}
        </li>
        <li>
          <span>Turn on {name ? <b>{name}</b> : 'the terminal you started Bridge AI from'} in the list. Not there? Click <b>+</b> and pick it{desktop && here ? ', or drag it in from Finder' : ''}.</span>
          {desktop && here && <button type="button" className="btn small" disabled={busy === 'reveal'} onClick={() => run('reveal', '/fix/reveal')}><Icon name="folder-open" size={12} /> Show {name} in Finder</button>}
        </li>
        <li>
          <span>Restart Bridge AI so it takes effect{desktop ? '' : <> (<code>npm run stop</code>, then <code>npm start</code>)</>}.</span>
          {canRestart && <button type="button" className="btn small" onClick={restart}><Icon name="refresh" size={12} /> Restart Bridge AI</button>}
        </li>
      </ol>
      {!here && <p className="muted small">Do this on your computer.</p>}
      {note && <p className="error-text">{note}</p>}
      {onCheck && <button type="button" className="btn" onClick={onCheck}><Icon name="refresh" size={13} /> Check again</button>}
    </div>
  )
}
