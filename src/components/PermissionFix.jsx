import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api, refetch, usePoll, viaRelay } from '../api.js'

// Something macOS asks you to allow, as one button. Allow access opens that page of System
// Settings and, in the desktop app, a tile floats beside it with Bridge AI's icon to drag into the
// list. Meanwhile the card checks, gently and only while it's showing, whether access is on: then
// it either clears itself (onCheck reloads what was blocked) or, when Bridge AI needs a restart to
// use it, says so and the top bar offers Restart to apply. From a terminal install it names the
// terminal app instead; from a phone it says what's needed, since the buttons are on the computer.
//   pane      a page in server/fixes.js (full-disk, calendars, files, microphone, notifications...)
//   folder    for files: which folder (Desktop, Documents, Downloads)
//   probe     () => 'ok' | 'denied': ask here instead of the server (the mic, in the desktop app)
//   children  one short sentence: why

// Check on focus, on coming back to the tab, and every `every` ms while the tab is visible.
export function useRecheck(fn, every = 0, enabled = true) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!enabled) return
    const go = () => { if (!document.hidden) ref.current() }
    window.addEventListener('focus', go)
    document.addEventListener('visibilitychange', go)
    const id = every ? setInterval(go, every) : null
    return () => { window.removeEventListener('focus', go); document.removeEventListener('visibilitychange', go); clearInterval(id) }
  }, [every, enabled])
}

export const useFix = () => usePoll('/fix', 10 * 60 * 1000)

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

export default function PermissionFix({ pane, folder, probe, onCheck, children }) {
  const { data } = useFix()
  const [state, setState] = useState(null) // denied | restart | ok | unknown
  const [asked, setAsked] = useState(false) // Allow access was clicked
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const label = data?.panes?.[pane] || 'Privacy & Security'
  const name = data?.app?.name
  const desktopServer = !!data?.app?.desktop
  const desktop = desktopServer && !!window.bridgeApp?.fixTile
  const here = !viaRelay
  const needsRestart = pane === 'full-disk' || pane === 'files'

  // The caller's functions, current without making the check (and its effects) new each render.
  const fns = useRef({})
  fns.current = { probe, onCheck }
  const check = useCallback(async () => {
    let s = 'unknown'
    try { s = fns.current.probe ? await fns.current.probe() : (await api(`/fix/check?pane=${encodeURIComponent(pane)}${folder ? `&folder=${encodeURIComponent(folder)}` : ''}`)).state } catch { /* keep asking */ }
    setState((was) => {
      if (s === 'restart' && was !== 'restart') refetch('/fix')
      return s
    })
    if (s === 'ok') { window.bridgeApp?.closeFixTile?.(); fns.current.onCheck?.() }
    return s
  }, [pane, folder])
  useEffect(() => { check() }, [check])
  // While the problem shows: every few seconds once you've gone to System Settings, else now and then.
  const waiting = state !== 'ok' && state !== 'restart'
  useRecheck(check, asked ? 4000 : 30000, waiting)
  // Stop the quick checks after 10 minutes; focus still checks.
  useEffect(() => { if (!asked) return; const t = setTimeout(() => setAsked(false), 10 * 60 * 1000); return () => clearTimeout(t) }, [asked])
  useEffect(() => () => { window.bridgeApp?.closeFixTile?.() }, [])

  if (data && !data.mac) return null

  const allow = async () => {
    setBusy(true)
    setNote(null)
    try {
      await api('/fix/settings', { method: 'POST', body: { pane } })
      if (desktop) await window.bridgeApp.fixTile(pane)
      setAsked(true)
    } catch (e) { setNote(e.message) } finally { setBusy(false) }
  }
  // "I've turned it on": for when the check can't see it. Panes that need a restart go to the
  // restart; the rest just look again (macOS answers those straight away).
  const turnedOn = async () => {
    window.bridgeApp?.closeFixTile?.()
    setNote(null)
    const s = await check()
    if (s === 'ok') return
    // Nothing here can tell (Automation): take your word for it, and let you try again.
    if (s === 'unknown' && !needsRestart) { fns.current.onCheck?.(); return }
    if (needsRestart) {
      try { await api('/fix/claim', { method: 'POST', body: { pane } }) } catch { /* the restart still applies it */ }
      setState('restart')
      refetch('/fix')
    } else setNote({ soft: true, text: `macOS still has it off. Turn on ${name || (desktopServer ? 'Bridge AI' : 'the terminal you started Bridge AI from')} in ${label}, then check again.` })
  }

  if (state === 'restart') {
    return (
      <div className="perm-fix">
        <p className="perm-ok"><Icon name="check" size={13} /> {label} is on. Bridge AI starts using it after a restart.</p>
        {here ? <button type="button" className="btn small primary" onClick={askRestart}><Icon name="refresh" size={12} /> Restart to apply…</button>
          : <p className="muted small">Restart Bridge AI on your computer to apply it.</p>}
      </div>
    )
  }

  const who = name || 'the terminal you started Bridge AI from'
  return (
    <div className="perm-fix">
      {children}
      {here ? (
        <div className="perm-acts">
          <button type="button" className="btn small primary" disabled={busy} onClick={allow}><Icon name="check" size={12} /> Allow access</button>
          <button type="button" className="ghost-btn" onClick={check}><Icon name="refresh" size={12} /> Check again</button>
        </div>
      ) : <p className="muted small">On your computer, open System Settings › Privacy & Security › {label} and turn on {name || (desktopServer ? 'Bridge AI' : 'the terminal Bridge AI was started from')}. This page notices when it's done.</p>}
      {here && asked && (desktop
        ? <p className="muted small">{pane === 'full-disk' ? `Drag ${name} from the tile at the bottom of your screen into the list, then turn it on.` : `Turn on ${name} in the list.`} <button type="button" className="link-btn" onClick={turnedOn}>I've turned it on</button></p>
        : (
          <ol className="perm-steps">
            <li>Turn on <b>{who}</b> in {label}.{pane === 'full-disk' ? <> Not in the list? Click <b>+</b> and pick it{desktopServer ? <>, or drag it in from <button type="button" className="link-btn" onClick={() => api('/fix/reveal', { method: 'POST' }).catch((e) => setNote(e.message))}>Finder</button></> : null}.</> : null}</li>
            {needsRestart && <li>{desktopServer ? 'Then restart Bridge AI so it takes effect.' : <>Then restart Bridge AI so it takes effect: <code>npm run stop</code>, then <code>npm start</code>.</>}</li>}
            <li><button type="button" className="link-btn" onClick={turnedOn}>I've turned it on</button></li>
          </ol>
        ))}
      {note && (note.soft ? <p className="muted small">{note.text}</p> : <p className="error-text">{note}</p>)}
    </div>
  )
}
