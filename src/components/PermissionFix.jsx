import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { api, viaRelay } from '../api.js'
import { usePermission, useFix, useRecheck, KINDS, appVersion, updateApp, desktopApp } from '../permissions.js'
import { t, tx } from '../i18n/index.js'

export { useFix, useRecheck }

// A tool to install or sign in to, with one button: it runs a fixed command (server/fixes.js) in a
// terminal tab you can watch and answer, and looks again by itself while that runs and when you
// come back to the window. what: homebrew, icalbuddy, gh, gh-login, xcode.
export function InstallFix({ what, label, icon = 'download', onCheck, children, compact }) {
  const [msg, setMsg] = useState(null) // { openId } | { error }
  const running = !!msg?.openId
  useRecheck(() => onCheck?.(), running ? 8000 : 0)
  const go = async () => {
    setMsg(null)
    try { setMsg({ openId: (await api('/fix/install', { method: 'POST', body: { what } })).openId }) } catch (e) { setMsg({ error: e.message }) }
  }
  const show = () => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: msg.openId } }))
  return (
    <div className={`perm-fix ${compact ? 'compact' : ''}`}>
      {children}
      {viaRelay ? <p className="muted small">Do this in Bridge AI on your computer.</p> : (
        <div className="perm-acts">
          <button type="button" className="btn small primary" disabled={running} onClick={go}><Icon name={icon} size={12} /> {label}</button>
          {onCheck && <button type="button" className="ghost-btn" onClick={onCheck}><Icon name="refresh" size={12} /> Check again</button>}
        </div>
      )}
      {running && <p className="muted small">Running in a terminal tab, in the Setup space. <button type="button" className="link-btn" onClick={show}>Show it</button></p>}
      {msg?.error && <p className="error-text">{msg.error}</p>}
    </div>
  )
}
// The folder macOS asks about for a path in it: Desktop, Documents or Downloads.
export const protectedFolder = (p) => (/^(?:\/Users\/[^/]+|~)\/(Desktop|Documents|Downloads)(?:\/|$)/.exec(p || '') || [])[1] || null
// Open the top bar's Restart to apply.
export const askRestart = () => window.dispatchEvent(new Event('bridge-restart'))

// A desktop app too old for what this page asks of it: said so, with the update one click away,
// instead of a button that can't work.
export function UpdateApp({ why }) {
  const [st, setSt] = useState(null) // going | { error }
  const v = appVersion()
  const go = async () => { setSt('going'); try { await updateApp() } catch (e) { setSt({ error: e.message }) } }
  return (
    <div className="perm-update">
      <p className="small">{why || t('This needs a newer Bridge AI desktop app.')}{v ? ` ${t('This one is {version}.', { version: v })}` : ''}</p>
      {st === 'going'
        ? <p className="st-note ok small"><Icon name="refresh" size={12} className="spin" /> {t('Updating. Bridge AI closes and reopens by itself in a few seconds; your agents carry on.')}</p>
        : <div className="perm-acts"><button type="button" className="btn small primary" onClick={go}><Icon name="download" size={12} /> {t('Update Bridge AI')}</button></div>}
      {st?.error && <p className="error-text small">{st.error}</p>}
    </div>
  )
}

// What a row of Settings › General › Permissions says it is.
const STATE = { ok: tx('On'), restart: tx('On after a restart'), ask: tx('Not asked yet'), denied: tx('Off'), restricted: tx('Managed'), unknown: tx('Not checked') }

// Something the computer asks you to allow, the same everywhere (src/permissions.js asks):
//   pane      a key of KINDS: microphone, accessibility, calendars, full-disk, files, audio,
//             automation, notifications
//   folder    for files: which folder (Desktop, Documents, Downloads)
//   onCheck   what was waiting for it, carried on once it's on
//   stale     the system says it's on and it doesn't take (the mic turned down anyway): Reset first
//   row       as a row of Settings › General › Permissions: its name, whether it's on, one button
//   quiet, initial  not looked at until you act (usePermission), and what it is meanwhile
//   ask       a number: each new one asks right away, as Allow access does (a setting just picked
//             that needs it, or another device asking for it)
//   children  one short sentence: why
export default function PermissionFix({ pane, folder, onCheck, stale = false, row = false, ask = 0, quiet = false, initial = null, children }) {
  const p = usePermission(pane, { folder, onAllowed: onCheck, stale, quiet, initial })
  const { k, fix, where, state, step } = p
  useEffect(() => { if (ask) p.allow() }, [ask]) // eslint-disable-line react-hooks/exhaustive-deps
  // A while in System Settings and still off: Reset and ask again is offered there too.
  const [late, setLate] = useState(false)
  useEffect(() => { setLate(false); if (step !== 'settings') return; const id = setTimeout(() => setLate(true), 20000); return () => clearTimeout(id) }, [step, p.since])
  // Off a Mac (and Windows, for its own few) there's nothing to allow.
  if (p.known && !p.mac && !(p.win && k.win)) return null

  const label = t(k.label || 'Privacy & Security')
  const win = p.win
  // Who macOS lists: the desktop app for what it asks itself, else whatever runs the server (the
  // app, or the terminal it was started from).
  const name = k.app && desktopApp() ? 'Bridge AI' : fix?.app?.name || (fix?.app?.desktop ? 'Bridge AI' : null)
  const who = name || t('the terminal you started Bridge AI from')
  const device = p.device || t('that computer')
  const place = win ? t('Windows Settings › Privacy & security › {label}', { label }) : t('System Settings › Privacy & Security › {label}', { label })
  const here = where === 'here'
  const desktopTile = here && !!fix?.app?.desktop && !!window.bridgeApp?.fixTile
  // Notifications' own page, on Bridge AI (the app opens it; an older one through the server).
  const openNotes = () => (window.bridgeApp?.permission?.open ? window.bridgeApp.permission.open('notifications')
    : api('/fix/settings', { method: 'POST', body: { pane: 'notifications' } }).then(() => window.bridgeApp?.fixTile?.('notifications'))).catch(() => {})
  const settled = state === 'ok' || state === 'restricted' || state === 'restart'

  // The one button, by what it is and where this is.
  let primary = null
  if (p.update || state === 'ok' || state === 'restricted') primary = null
  else if (state === 'restart') primary = here && <button type="button" className="btn small primary" onClick={p.restart}><Icon name="refresh" size={12} /> {t('Restart to apply…')}</button>
  else if (!here) primary = p.listening && step !== 'told' && <button type="button" className="btn small primary" onClick={p.askThere}><Icon name="external" size={12} /> {t('Ask {device}', { device })}</button>
  else if (step === 'stuck') primary = p.canReset ? <button type="button" className="btn small primary" onClick={p.reset}><Icon name="refresh" size={12} /> {t('Reset and ask again')}</button> : null
  else if (step === 'resetting') primary = <button type="button" className="btn small primary" disabled><Icon name="refresh" size={12} className="spin" /> {t('Asking macOS…')}</button>
  else primary = <button type="button" className="btn small primary" disabled={p.busy} onClick={p.allow}><Icon name="check" size={12} /> {row ? t('Allow') : t('Allow access')}</button>

  // What's said before the button: why it can't be done here, or what's wrong.
  let lead = null
  if (p.update) lead = <UpdateApp why={t('Allowing {label} needs a newer Bridge AI desktop app.', { label })} />
  else if (state === 'restricted') lead = <p className="muted small">{t('A profile on this computer decides this, so it can\'t be changed here. Ask whoever manages it.')}</p>
  else if (state === 'restart') {
    lead = row ? (!here && <p className="muted small">{t('Restart Bridge AI on {device} to apply it.', { device })}</p>)
      : <p className="perm-ok"><Icon name="check" size={13} /> {t('{label} is on. Bridge AI starts using it after a restart.', { label })}{here ? '' : ` ${t('Restart Bridge AI on {device} to apply it.', { device })}`}</p>
  } else if (state === 'ok') lead = !row && <p className="perm-ok"><Icon name="check" size={13} /> {t('{label} is on.', { label })}</p>
  else if (!here) {
    // Another device's page, or a phone: the computer it's for is where it's allowed.
    lead = (
      <>
        <p className="small">{t('{label} is allowed on the computer it\'s for: {device}.', { label, device })}</p>
        {step === 'told' ? <p className="muted small">{t('Asked. Answer on {device}; this notices when it\'s on.', { device })}</p>
          : !p.listening && <p className="muted small">{t('On {device}, open Bridge AI and allow it in Settings › General › Permissions.', { device })}</p>}
      </>
    )
  } else if (step === 'stuck') {
    lead = (
      <>
        <p className="small">{t('{label} is still off for {name}. macOS can keep an answer that shows as on and doesn\'t take (one from an earlier version of the app, say).', { label, name: who })}</p>
        {p.canReset ? <p className="muted small">{t('Reset forgets macOS\'s answer for this app only, then macOS asks again. No password.')}</p>
          : <p className="muted small">{t('In {place}, select {name} and remove it with −, then allow it again.', { place, name: who })} <button type="button" className="link-btn" onClick={p.allow}>{t('Allow access')}</button></p>}
      </>
    )
  }

  // What's said after it: what's happening now, and what to do there.
  let doing = null
  if (here && !settled && !p.update) {
    if (step === 'asking') {
      doing = <p className="muted small">{pane === 'accessibility' || pane === 'input-monitoring' ? t('macOS is asking: choose Open System Settings, then turn on {name}.', { name: who })
        : pane === 'calendars' ? t('macOS is asking: choose Allow Full Access in its window (it can be behind this one).')
          : t('macOS is asking: choose Allow in its window (it can be behind this one).')}</p>
    } else if (step === 'tested') {
      doing = <p className="muted small">{t('A test notification is on its way. Didn\'t see it?')} <button type="button" className="link-btn" onClick={openNotes}>{win ? t('Turn on in Windows Settings') : t('Turn on in System Settings')}</button></p>
    } else if (step === 'settings' || step === 'checking') {
      const reset = late && p.canReset && <> {t('Already on in the list?')} <button type="button" className="link-btn" onClick={p.reset}>{t('Reset and ask again')}</button></>
      const on = <button type="button" className="link-btn" disabled={step === 'checking'} onClick={p.turnedOn}>{step === 'checking' ? t('Looking…') : t('I\'ve turned it on')}</button>
      doing = win ? <p className="muted small">{t('In {place}, turn it on for desktop apps.', { place })} {on}</p>
        : desktopTile
          ? <p className="muted small">{pane === 'full-disk' ? t('Drag {name} from the tile at the bottom of your screen into the list, then turn it on.', { name: who }) : t('Turn on {name} in the list.', { name: who })} {on}{reset}</p>
          : (
            <ol className="perm-steps">
              <li>{t('Turn on {name} in {place}.', { name: who, place })}{pane === 'full-disk' ? <> {t('Not in the list? Click + and pick it.')}{fix?.app?.desktop ? <> <button type="button" className="link-btn" onClick={() => api('/fix/reveal', { method: 'POST' }).catch(() => {})}>{t('Show it in Finder')}</button></> : null}</> : null}</li>
              {k.restart && <li>{fix?.app?.desktop ? t('Then restart Bridge AI so it takes effect.') : <>{t('Then restart Bridge AI so it takes effect:')} <code>npm run stop</code>, <code>npm start</code></>}</li>}
              <li>{on}{reset}</li>
            </ol>
          )
    }
  }
  // Check again, for the odd time nothing notices by itself.
  const again = here && !settled && !p.update && step !== 'resetting' && <button type="button" className="ghost-btn" onClick={p.check}><Icon name="refresh" size={12} /> {t('Check again')}</button>
  const from = p.askedFrom != null && !settled && <p className="muted small">{p.askedFrom ? t('Asked from {device}.', { device: p.askedFrom }) : t('Asked from another of your devices.')}</p>

  if (row) {
    const chip = p.update ? tx('Needs an update') : STATE[state] || null
    return (
      <div className={`perm-row ${state === 'ok' ? 'on' : ''}`} data-pane={pane} data-state={state || ''} data-step={step || ''}>
        <div className="perm-row-head">
          <div className="perm-row-what"><b>{label}</b><span className="muted small">{t(k.why)}</span></div>
          {chip && <span className={`st-chip ${state === 'ok' ? 'good' : state === 'restart' || state === 'unknown' ? '' : 'warn'}`}>{t(chip)}</span>}
          {primary}
        </div>
        {(from || lead || doing) && <div className="perm-row-more">{from}{lead}{doing}</div>}
        {p.error && <p className="error-text small">{p.error}</p>}
      </div>
    )
  }
  return (
    <div className="perm-fix" data-pane={pane} data-state={state || ''} data-step={step || ''}>
      {children}
      {from}
      {lead}
      {(primary || again) && <div className="perm-acts">{primary}{again}</div>}
      {doing}
      {p.error && <p className="error-text small">{p.error}</p>}
    </div>
  )
}

export { KINDS }
