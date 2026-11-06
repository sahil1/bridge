import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import UsageCounts from './UsageCounts.jsx'
import CrashReports from './CrashReports.jsx'
import { api } from '../../api.js'
import { useSettings } from './General.jsx'
import { startTour } from '../Tour.jsx'
import { withApp, installUpdate } from '../UpdateChip.jsx'
import { appVersion } from '../../permissions.js'
import { t, tx, locale } from '../../i18n/index.js'
import { TRIALS } from '../../trials.js'
import { AWAY_MINUTES, RELEASE_HOURS, waitingLong } from '../../../shared/autoupdate.js'

const REPO = 'https://github.com/sahil1/bridge'

// Settings › About & Updates: which version you have, whether there's a newer one (and updating
// to it, now or by itself while you're away), the tour again, what to include when you report a
// problem, usage stats and crash reports, and last, the features on trial.
// Every action here is the same small button (btn small, a 13 px icon); the one that matters most
// in a section is primary.
export default function About() {
  return (
    <div className="st-sections">
      <Updates />
      <section className="st-sec">
        <h4>{t('Tour')}</h4>
        <p className="muted small">{t('A quick look at the main parts of Bridge AI, the same one you saw after setup.')}</p>
        <div className="st-row"><button type="button" className="btn small" onClick={startTour}><Icon name="sparkle" size={13} /> {t('Take the tour')}</button></div>
      </section>
      <Report />
      <UsageCounts />
      <CrashReports />
      <Trials />
    </div>
  )
}

export function useUpdates(force = false) {
  const [u, setU] = useState(null)
  const load = (refresh) => api(`/updates${refresh ? '?refresh=1' : ''}`).then(setU).catch((e) => setU({ error: e.message }))
  useEffect(() => { load(force) }, [force])
  return [u, load]
}

function Updates() {
  const [raw, load] = useUpdates()
  // The desktop app this window is in counts too (UpdateChip.jsx withApp).
  const u = withApp(raw)
  const app = appVersion()
  const { s, save } = useSettings()
  const [state, setState] = useState(null) // checking | installing | { error }
  const check = async () => { setState('checking'); await load(true); setState(null) }
  const install = async () => {
    setState('installing')
    try { await installUpdate(u) } catch (e) { setState({ error: e.message }) }
  }
  const auto = s ? s.effective.updates?.check !== false : true
  const news = u?.url ? <a className="btn small" href={u.url} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> {t("What's new")}</a> : null
  // Updating by itself works in the desktop app on a Mac or Windows only (install() there), so it's
  // offered only there: not from source, in a browser or on a phone.
  const canAuto = !!window.bridgeApp?.desktop && raw?.how === 'app'

  return (
    <section className="st-sec">
      <h4>{t('Version')}</h4>
      {!u ? <div className="skeleton-rows"><div /></div> : (
        <>
          <div className="st-row">
            <span className="ab-version">{t('Bridge AI {version}', { version: raw?.current || u.current })}</span>
            {app && raw?.current && app !== raw.current && <span className="muted small">{t('the desktop app is {version}', { version: app })}</span>}
            {u.disabled ? <span className="muted small">{t('Update checks are off')}</span>
              : u.error && !u.latest ? <span className="muted small">{t("Couldn't check for updates ({error})", { error: u.error })}</span>
              : u.available ? <span className="st-chip warn"><Icon name="download" size={11} /> {t('{version} is available', { version: u.latest })}</span>
              : u.held ? <span className="st-chip good"><Icon name="check" size={11} /> {t('Up to date for this Mac')}</span>
              : <span className="st-chip good"><Icon name="check" size={11} /> {t('Up to date')}</span>}
          </div>
          {u.held && <p className="muted small">{t('Bridge AI {latest} needs macOS {macos} or later, and this Mac has macOS {have}, so Bridge AI stays on {current}, which keeps working. Update macOS in System Settings › General › Software Update to get newer versions.', { latest: u.held.latest, macos: u.held.macos, have: u.held.have, current: u.current })}</p>}
          {u.failed && state !== 'installing' && <p className="st-note bad"><Icon name="alert" size={13} /> {t('The last update didn\'t go through: {why}', { why: u.failed.line || t('the installer stopped') })}{u.failed.auto && ` ${t('It was updating by itself while you were away, and tries again in a few hours.')}`}</p>}
          {u.available && (
            state === 'installing'
              ? <p className="st-note ok"><Icon name="refresh" size={13} /> {t('Updating to {version}. Bridge AI closes and reopens by itself in a few seconds; your agents carry on where they were.', { version: u.latest })}</p>
              : u.how === 'app' || u.forApp
                ? <div className="st-row"><button type="button" className="btn small primary" onClick={install}><Icon name="download" size={13} /> {t('Update to {version}', { version: u.latest })}</button>{news}</div>
                : <div className="ab-cmd"><p className="muted small">{u.how === 'source' ? t('You run Bridge AI from a clone; update it in a terminal, in that folder:') : u.how === 'docker' ? t('Bridge AI runs in Docker; update it on that device, in the folder with docker-compose.yml:') : t('Update from a terminal (it asks for your password to install the package):')}</p><code>{u.command}</code><div className="st-row"><button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(u.command).catch(() => {})}><Icon name="copy" size={13} /> {t('Copy')}</button>{news}</div></div>
          )}
          {state?.error && <p className="st-note bad"><Icon name="alert" size={13} /> {state.error}</p>}
          <div className="st-row">
            {!u.disabled && <button type="button" className="btn small" disabled={state === 'checking'} onClick={check}><Icon name="refresh" size={13} /> {state === 'checking' ? t('Checking…') : t('Check now')}</button>}
          </div>
          <label className="st-check"><input type="checkbox" checked={auto} onChange={(e) => save({ updates: { check: e.target.checked } }).then(() => load(true))} />
            <span><b>{t('Check for new versions')}</b> <span className="muted small">{t('Asks GitHub a few times a day; nothing about you is sent.')}</span></span></label>
          {canAuto && <ByItself u={raw} checks={auto} />}
        </>
      )}
    </section>
  )
}

// What updating by itself waits for, in words (shared/autoupdate.js): the server's reasons and the
// desktop app's.
const WAITS = {
  unchecked: tx("GitHub couldn't be reached to check the new version is still there."),
  agents: tx('An agent is working or waiting on you.'),
  meeting: tx('A meeting is being recorded, or its notes written.'),
  dictation: tx('Dictation is listening.'),
  dictating: tx('Dictation is listening.'),
  here: tx("You've been using the computer."),
  battery: tx("The computer is on battery; it waits until it's plugged in."),
  studio: tx('A document in Studio has unsaved changes.'),
  file: tx("A file you're editing has unsaved changes."),
  draft: tx("A message you started typing in a chat isn't sent yet."),
  board: tx("A whiteboard has changes that aren't saved yet."),
  playing: tx('A video or a sound is playing in Bridge AI.'),
  window: tx("A Bridge AI window didn't say whether it has unsaved work."),
}

// Update by itself while you're away: on unless turned off. Once it has, to which version and
// when, until the next update; a version out a day and still waiting says why (nothing that waits
// goes unsaid). It says nothing else meanwhile, and nothing pops up after.
function ByItself({ u, checks }) {
  const { s, save } = useSettings()
  const [a, setA] = useState(null) // /api/updates/auto
  const [mine, setMine] = useState(null) // as you set it, at once; saved behind it
  const load = () => api('/updates/auto').then(setA).catch(() => setA(null))
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id) }, [])
  const on = mine ?? (s ? s.effective.updates?.auto !== false : true)
  const set = (v) => { setMine(v); save({ updates: { auto: v } }).then(load, load) }
  const why = [...new Set([...(a?.why || []), ...(a?.desktop?.why || [])].map((x) => WAITS[x]).filter(Boolean))]
  const long = on && checks && !u?.failed && waitingLong(u)
  const when = a?.done && new Date(a.done.at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  return (
    <>
      <label className="st-check ab-auto"><input type="checkbox" checked={on} disabled={!s || !checks} onChange={(e) => set(e.target.checked)} />
        <span><b>{t("Update by itself while you're away")}</b> <span className="muted small">{checks
          ? t("Once a new version has been out {hours} hours: while you're away (no keyboard or mouse for {minutes} minutes, or the screen locked), with nothing running or unsaved, and plugged in.", { hours: RELEASE_HOURS, minutes: AWAY_MINUTES })
          : t('It needs Check for new versions on.')}</span></span></label>
      {a?.done && <p className="muted small ab-auto-done">{t('Updated to {version} by itself on {when} while you were away.', { version: a.done.version, when })}</p>}
      {long && <p className="st-note ab-auto-wait"><Icon name="info" size={13} /> {t('Bridge AI {version} is waiting to update by itself:', { version: u.latest })} {why.length ? why.map((x) => t(x)).join(' ') : t("it hasn't found a time yet when you were away and nothing was running.")}</p>}
    </>
  )
}

// Beta features (src/trials.js): each hidden until it's turned on here, for this computer.
function Trials() {
  const { s, save } = useSettings()
  const [mine, setMine] = useState({}) // as you set it, at once; saved behind it
  const on = (id) => mine[id] ?? s?.effective?.trials?.[id] === true
  const set = (id, v) => { setMine((m) => ({ ...m, [id]: v })); save({ trials: { [id]: v } }) }
  return (
    <section className="st-sec">
      <h4>{t('Beta Features')}</h4>
      <p className="muted small">{t("New parts of Bridge AI, in beta. Each stays hidden until you turn it on here, and turning it off hides it again; what you made with it stays where it is.")}</p>
      {TRIALS.map((x) => {
        // One that's part of another works only with that one on, and says so.
        const needs = x.needs && !on(x.needs) ? TRIALS.find((y) => y.id === x.needs) : null
        return (
          <label key={x.id} className="st-check"><input type="checkbox" checked={on(x.id) && !needs} disabled={!s || !!needs} onChange={(e) => set(x.id, e.target.checked)} />
            <span><b>{t(x.label)}</b> <span className="muted small">{t(x.hint)}</span>{needs && <span className="muted small"> {t('It needs {name} on.', { name: t(needs.label) })}</span>}</span></label>
        )
      })}
    </section>
  )
}

function Report() {
  const [d, setD] = useState(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => { api('/diagnostics').then(setD).catch(() => setD(null)) }, [])
  const text = d ? Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') || 'none' : v}`).join('\n') : ''
  const copy = () => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})
  const issue = `${REPO}/issues/new?template=bug.yml&diagnostics=${encodeURIComponent(text)}`
  return (
    <section className="st-sec">
      <h4>{t('Report a problem or suggest something')}</h4>
      <p className="muted small">{t('Bridge AI is open source. Problems and ideas go in GitHub issues. Include the details below; they say which version and system you have, and nothing about you (no names, emails, folders or location).')}</p>
      {d && <pre className="st-code ro ab-diag">{text}</pre>}
      <div className="st-row">
        <a className="btn small primary" href={issue} target="_blank" rel="noreferrer"><Icon name="alert" size={13} /> {t('Report a problem')}</a>
        <a className="btn small" href={`${REPO}/issues/new?template=feature.yml`} target="_blank" rel="noreferrer"><Icon name="sparkle" size={13} /> {t('Suggest an idea')}</a>
        <button type="button" className="btn small" disabled={!d} onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? t('Copied') : t('Copy details')}</button>
      </div>
      <p className="muted small">{t('Free and open source under the Apache License 2.0, as is, with no warranty. Not affiliated with Anthropic, OpenAI, Google, GitHub or the other companies whose tools it works with.')} <a href={`${REPO}/blob/main/TERMS.md`} target="_blank" rel="noreferrer">{t('Terms')}</a> · <a href={`${REPO}/blob/main/PRIVACY.md`} target="_blank" rel="noreferrer">{t('Privacy')}</a> · <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">{t('License')}</a> · <a href={`${REPO}/blob/main/NOTICE`} target="_blank" rel="noreferrer">{t('Notices')}</a></p>
      <p className="muted small">{t('If Bridge AI is useful to you, a star on GitHub helps other people find it.')} <a href={REPO} target="_blank" rel="noreferrer">{t('Star Bridge AI on GitHub')}</a></p>
      {/* The open-source parts Bridge AI is built with are in NOTICE; the one you see most is named. */}
      <p className="muted small">{t('Whiteboards are drawn with Excalidraw (MIT License).')} <a href="https://github.com/excalidraw/excalidraw" target="_blank" rel="noreferrer">github.com/excalidraw/excalidraw</a></p>
    </section>
  )
}
