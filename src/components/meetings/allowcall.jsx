import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api, usePoll, onThisComputer, refetch } from '../../api.js'
import { useFix, useRecheck, askRestart } from '../PermissionFix.jsx'
import { t } from '../../i18n/index.js'

// A call's two switches, on one page of System Settings (Privacy & Security › Screen & System Audio
// Recording): Screen Recording at the top, for the names a call shows as people talk (what:
// 'screen'), and System Audio Recording Only further down, for the call's sound (what: 'sound').
// Bridge AI on in the top list doesn't cover the sound. Either one reaches Bridge AI only once it
// restarts (macOS's own Quit & Reopen is easy to miss), so a switch that's on there can still read
// as off here. So, as Settings › General › Permissions does it (PermissionFix.jsx): Open it; then
// "Already on there?" and Restart Bridge AI (saying first that it stops a recording); and once it
// has restarted and it's still off, Reset and ask again, for that list alone (server/fixes.js
// reset). Whether Screen Recording is on is looked at again each time you come back to the window,
// never the answer the server kept a moment ago (?fresh=1); after a restart the server's first
// look is its own (it restarts too), and started says when that was.
// The desktop app restarts itself; a browser opens the top bar's Restart to apply, which says how.
const MARK = 'cc-allow-restart' // { screen, sound }: when Restart Bridge AI was asked for here
const marks = () => { try { const v = JSON.parse(localStorage.getItem(MARK) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} } }
const mark = (what, at) => { try { const v = { ...marks() }; if (at) v[what] = at; else delete v[what]; localStorage.setItem(MARK, JSON.stringify(v)) } catch { /* no storage: no Reset offered after */ } }
const SERVICE = { screen: 'ScreenCapture', sound: 'AudioCapture' }

// Screen Recording as the server last saw it ({ allowed, started }), looked at afresh whenever you
// come back to the window. on: only while something here needs it.
export function useScreenAccess(on = true) {
  const here = onThisComputer()
  const poll = usePoll(here && on ? '/calls/screen' : null, 10_000)
  useRecheck(() => api('/calls/screen?fresh=1').then(() => poll.refresh(), () => {}), 0, here && on)
  // On: a restart asked for along the way did it, so nothing's offered after the next one.
  useEffect(() => { if (poll.data?.allowed) mark('screen', 0) }, [poll.data?.allowed])
  return { ...poll, here }
}

// The steps after what to turn on: Open it, then Restart Bridge AI, then Reset and ask again.
// what: 'screen' or 'sound'. recording: a meeting records, which a restart stops (said first).
// started: when the server started (useScreenAccess's), to tell a restart since. opened: Open it
// was clicked already. onAsked: after Reset, macOS was asked again.
export function useAllowCall(what, { recording = false, started = null, opened: was = false, onAsked } = {}) {
  const { data: fix } = useFix()
  const [opened, setOpened] = useState(false)
  const [sure, setSure] = useState(false) // asked whether to stop the recording
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState(null) // after Reset: what happens now
  const [err, setErr] = useState(null)
  const at = Number(marks()[what]) || 0
  // Restarted since Restart Bridge AI was asked for here (within a few hours), and still off.
  const restarted = !!started && at > 0 && Date.parse(started) > at && Date.now() - at < 3 * 3600e3
  const open = () => { setErr(null); api('/fix/settings', { method: 'POST', body: { pane: 'audio' } }).then(() => setOpened(true), (e) => setErr(e.message)) }
  const restart = async () => {
    if (recording && !sure) { setSure(true); return }
    setErr(null)
    setSure(false)
    mark(what, Date.now())
    const app = onThisComputer() ? window.bridgeApp : null
    try {
      if (app?.restart) { setBusy(true); await app.restart() } else {
        await api('/fix/claim', { method: 'POST', body: { pane: 'audio' } })
        refetch('/fix')
        askRestart()
      }
    } catch (e) { setBusy(false); setErr(t("Couldn't restart Bridge AI: {error}", { error: e.message })) }
  }
  const reset = async () => {
    setErr(null)
    setBusy(true)
    try {
      await api('/fix/reset', { method: 'POST', body: { pane: 'audio', service: SERVICE[what] } })
      mark(what, 0)
      setOpened(false)
      if (what === 'screen') {
        await api('/calls/screen', { method: 'POST' })
        setSaid(t('macOS asks again: answer its window, or turn on Bridge AI in Screen Recording.'))
        onAsked?.()
      } else setSaid(t('macOS asks again the next time a call is recorded.'))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const stage = said ? 'reset' : restarted ? 'restarted' : opened || was ? 'opened' : 'off'
  return { stage, open, restart, reset, sure, setSure, busy, said, err, canReset: !!fix?.canReset }
}

// What to say and do at each step, after the words that say what to turn on: { say, acts }, for
// the line of text and its buttons. a: useAllowCall's. link: Open it as a link, in a line of text.
export function allowSteps(what, a, { link = false } = {}) {
  const list = what === 'screen' ? t('Screen Recording') : t('System Audio Recording Only')
  const openIt = <button type="button" className={link ? 'link-btn' : 'btn small'} onClick={a.open}>{t('Open it')}</button>
  let say = null
  let acts = openIt
  if (a.sure) {
    say = t("Restarting stops this recording. What's been said so far is kept; record again after.")
    acts = <><button type="button" className="btn small primary" onClick={a.restart}><Icon name="refresh" size={12} /> {t('Restart now')}</button><button type="button" className="ghost-btn" onClick={() => a.setSure(false)}>{t('Not now')}</button></>
  } else if (a.stage === 'reset') say = a.said
  else if (a.stage === 'restarted') {
    say = `${what === 'screen'
      ? t("Still off since Bridge AI restarted. macOS can keep an answer that shows as on and doesn't take (one from an earlier version of the app, say).")
      : t("Still no sound since Bridge AI restarted. macOS can keep an answer that shows as on and doesn't take (one from an earlier version of the app, say).")}${a.canReset ? '' : ` ${t('In System Settings, remove Bridge AI from {list} with −, then turn it on again.', { list })}`}`
    if (a.canReset) acts = <button type="button" className="btn small primary" disabled={a.busy} onClick={a.reset}><Icon name="refresh" size={12} className={a.busy ? 'spin' : ''} /> {t('Reset and ask again')}</button>
  } else if (a.stage === 'opened') {
    say = t('Already on there? macOS applies it once Bridge AI restarts.')
    acts = <button type="button" className="btn small" disabled={a.busy} onClick={a.restart}><Icon name="refresh" size={12} className={a.busy ? 'spin' : ''} /> {a.busy ? t('Restarting…') : t('Restart Bridge AI')}</button>
  }
  return { say: <>{say && <span className="ac-say"> {say}</span>}{a.err && <span className="error-text" role="alert"> {a.err}</span>}</>, acts }
}
