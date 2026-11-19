import { Fragment, useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import CopyButton from '../CopyButton.jsx'
import UsageCounts from './UsageCounts.jsx'
import CrashReports from './CrashReports.jsx'
import { api, usePoll, onThisComputer } from '../../api.js'
import { useSettings } from './General.jsx'
import { startTour } from '../Tour.jsx'
import { withApp, installUpdate, channelTag } from '../UpdateChip.jsx'
import { appVersion } from '../../permissions.js'
import { t, tx, locale } from '../../i18n/index.js'
import { openSettings } from '../SignIn.jsx'
import { TRIALS } from '../../trials.js'
import { AWAY_MINUTES, RELEASE_HOURS, waitingLong } from '../../../shared/autoupdate.js'
import { isPre } from '../../../shared/version.js'
import { Advanced } from './Advanced.jsx'
import { StaysOut } from '../remote/Settings.jsx'

const REPO = 'https://github.com/sahil1/bridge'

// Settings › About & Updates: which version you have, whether there's a newer one (and updating
// to it, now or by itself while you're away), the update channel, reporting a problem, usage stats
// and crash reports, and last, the features on trial. Under Advanced: the tour again, the details a
// report includes, and the license and credits.
// Every action here is the same small button (btn small, a 13 px icon); the one that matters most
// in a section is primary.
export default function About() {
  return (
    <div className="st-sections">
      <Updates />
      <Advanced order={10}>
        <section className="st-sec" data-setting="tour">
          <h4>{t('Tour')}</h4>
          <p className="muted small">{t('A quick look at the main parts of Bridge AI, the same one you saw after setup.')}</p>
          <div className="st-row"><button type="button" className="btn small" onClick={startTour}><Icon name="sparkle" size={13} /> {t('Take the tour')}</button></div>
        </section>
      </Advanced>
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
    <>
    <section className="st-sec" data-setting="version">
      <h4>{t('Version')}</h4>
      {!u ? <div className="skeleton-rows"><div /></div> : (
        <>
          <div className="st-row">
            <span className="ab-version">{t('Bridge AI {version}', { version: raw?.current || u.current })}</span>
            {raw?.channel && <BuildLine u={raw} />}
            {app && raw?.current && app !== raw.current && <span className="muted small">{t('the desktop app is {version}', { version: app })}</span>}
            {u.disabled ? <span className="muted small">{t('Update checks are off')}</span>
              : u.error && !u.latest ? <span className="muted small">{t("Couldn't check for updates ({error})", { error: u.error })}</span>
              : u.available ? <span className="st-chip warn"><Icon name="download" size={11} /> {channelTag(u.latest) ? t('{version} is available ({kind})', { version: u.latest, kind: channelTag(u.latest) }) : t('{version} is available', { version: u.latest })}</span>
              : u.held ? <span className="st-chip good"><Icon name="check" size={11} /> {t('Up to date for this Mac')}</span>
              : <span className="st-chip good"><Icon name="check" size={11} /> {t('Up to date')}</span>}
          </div>
          {u.held && <p className="muted small">{t('Bridge AI {latest} needs macOS {macos} or later, and this Mac has macOS {have}, so Bridge AI stays on {current}, which keeps working. Update macOS in System Settings › General › Software Update to get newer versions.', { latest: u.held.latest, macos: u.held.macos, have: u.held.have, current: u.current })}</p>}
          {/* A pre-release, off Early Access and Nightly (left): it's never put back to an older version. */}
          {raw?.channel !== 'early' && raw?.channel !== 'nightly' && isPre(raw.current) && !u.available && <p className="muted small ab-pre-stays">{t('{version} is a pre-release. Bridge AI stays on it until a regular release is newer, then updates to that.', { version: raw.current })}</p>}
          {u.failed && state !== 'installing' && <p className="st-note bad"><Icon name="alert" size={13} /> {t('The last update didn\'t go through: {why}', { why: u.failed.line || t('the installer stopped') })}{u.failed.auto && ` ${t('It was updating by itself while you were away, and tries again in a few hours.')}`}</p>}
          {u.available && (
            state === 'installing'
              ? <p className="st-note ok"><Icon name="refresh" size={13} /> {t('Updating to {version}. Bridge AI closes and reopens by itself in a few seconds; your agents carry on where they were.', { version: u.latest })}</p>
              : u.how === 'app' || u.forApp
                ? <div className="st-row"><button type="button" className="btn small primary" onClick={install}><Icon name="download" size={13} /> {t('Update to {version}', { version: u.latest })}</button>{news}</div>
                : <div className="ab-cmd"><p className="muted small">{u.how === 'source' ? t('You run Bridge AI from a clone; update it in a terminal, in that folder:') : u.how === 'docker' ? t('Bridge AI runs in Docker; update it on that device, in the folder with docker-compose.yml:') : t('Update from a terminal (it asks for your password to install the package):')}</p><code>{u.command}</code><div className="st-row"><CopyButton text={u.command} className="btn small" size={13} />{news}</div></div>
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
    {raw?.how && <Channel u={raw} onChange={() => load(false)} />}
    </>
  )
}

// Which channel this computer is on, and when this build was made and from which commit (the app
// stamps both; a clone has neither): "Nightly · built Nov 16, 2:10 PM from 1a2b3c4".
const CHANNEL = { stable: tx('Stable'), early: tx('Early Access'), nightly: tx('Nightly') }
function BuildLine({ u }) {
  const at = u.built?.at && new Date(u.built.at)
  const when = at && !Number.isNaN(at.getTime()) ? at.toLocaleString(locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null
  const sha = u.built?.commit
  return (
    <span className="muted small ab-build" data-channel={u.channel}>
      {t(CHANNEL[u.channel] || CHANNEL.stable)}
      {when && <> · {sha ? <>{t('built {when} from', { when })} <a href={`${REPO}/commit/${sha}`} target="_blank" rel="noreferrer" className="mono">{sha.slice(0, 7)}</a></> : t('built {when}', { when })}</>}
    </span>
  )
}

// Update Channel: Stable, Early Access or Nightly, each in a line, picked here with no code (POST
// /api/updates/channel). Only on the computer itself: a phone or a window showing another computer
// shows it read-only, saying where to change it (the server refuses it from there too). Leaving Early
// Access or Nightly keeps the version here until a regular release is newer (the version line says
// so then). They're the desktop app's (and Linux's package's): in Docker or from a clone it says why
// not, and one switched on there anyway (by hand in config.json, or Early Access from your Bold Bridge
// account) says so, with the way back.
const CHANNELS = [
  ['stable', tx('Regular releases. The default.')],
  ['early', tx('Betas, before everyone else.')],
  ['nightly', tx('A build of main each day it changes. It may be broken some days.')],
]
function Channel({ u, onChange }) {
  const here = onThisComputer()
  const [state, setState] = useState(null) // the channel being picked | { error }
  const pick = async (channel) => {
    setState(channel)
    try { await api('/updates/channel', { method: 'POST', body: { channel } }); setState(null); onChange() } catch (err) { setState({ error: err.message }) }
  }
  const busy = typeof state === 'string'
  const there = !here && <p className="muted small ab-channel-there">{t('Change it in Bridge AI on that computer.')}</p>
  const error = state?.error && <p className="st-note bad"><Icon name="alert" size={13} /> {state.error}</p>
  if (!['app', 'app-linux'].includes(u.how)) {
    const docker = u.how === 'docker'
    const on = u.nightly?.problem ? 'nightly' : u.early?.problem ? 'early' : null
    return (
      <section className="st-sec ab-channel" data-setting="channel">
        <h4>{t('Update Channel')}</h4>
        {on === 'nightly' ? <p className="st-note bad"><Icon name="alert" size={13} /> {docker ? t("Nightly is switched on, but it's for the desktop app: Bridge AI in Docker updates by its image's tag, which stays on regular releases.") : t('Nightly is switched on, but it\'s for the desktop app: Bridge AI from a clone updates with git pull, which is main already.')}</p>
          : on === 'early' ? <p className="st-note bad"><Icon name="alert" size={13} /> {docker ? t("Early Access is for the desktop app. Bridge AI in Docker updates by its image's tag, which stays on regular releases.") : t('Early Access is for the desktop app. Bridge AI from a clone already runs the newest code there is (git pull).')}</p>
          : <p className="muted small ab-channel-why">{docker ? t("Early Access and Nightly are for the desktop app. Bridge AI in Docker updates by its image's tag, which stays on regular releases.") : t('Early Access and Nightly are for the desktop app. Bridge AI from a clone updates with git pull, which is main already.')}</p>}
        {on && (here ? <div className="st-row"><button type="button" className="btn small" disabled={busy} onClick={() => pick('stable')}><Icon name="x" size={13} /> {on === 'nightly' ? t('Leave Nightly') : t('Leave Early Access')}</button></div> : there)}
        {error}
      </section>
    )
  }
  const now = busy ? state : u.channel
  return (
    <section className="st-sec ab-channel" data-setting="channel">
      <h4>{t('Update Channel')}</h4>
      <div className="ab-channels" role="radiogroup" aria-label={t('Update Channel')}>
        {CHANNELS.map(([id, line]) => (
          <label key={id} className={`ab-channel-pick ${now === id ? 'on' : ''}`} data-channel={id}>
            <input type="radio" name="update-channel" checked={now === id} disabled={!here || busy} onChange={() => pick(id)} />
            <span><b>{t(CHANNEL[id])}</b><span className="muted small">{t(line)}</span></span>
          </label>
        ))}
      </div>
      {there || (u.channel !== 'stable' && <p className="muted small ab-channel-leave">{t('Leaving keeps the version you have: Bridge AI stays on it until a regular release is newer.')}</p>)}
      {error}
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
      <label className="st-check ab-auto" data-setting="auto-update"><input type="checkbox" checked={on} disabled={!s || !checks} onChange={(e) => set(e.target.checked)} />
        <span><b>{t("Update by itself while you're away")}</b> <span className="muted small">{checks
          ? t("Once a new version has been out {hours} hours: while you're away (no keyboard or mouse for {minutes} minutes, or the screen locked), with nothing running or unsaved, and plugged in.", { hours: RELEASE_HOURS, minutes: AWAY_MINUTES })
          : t('It needs Check for new versions on.')}</span></span></label>
      {a?.done && <p className="muted small ab-auto-done">{t('Updated to {version} by itself on {when} while you were away.', { version: a.done.version, when })}</p>}
      {long && <p className="st-note ab-auto-wait"><Icon name="info" size={13} /> {t('Bridge AI {version} is waiting to update by itself:', { version: u.latest })} {why.length ? why.map((x) => t(x)).join(' ') : t("it hasn't found a time yet when you were away and nothing was running.")}</p>}
    </>
  )
}

// Beta features (src/trials.js): each hidden until it's turned on here, for this computer. Each
// says what it is in a line (all of it on hover).
const SHORT = {
  home: tx('Where Bridge AI opens: what needs you on every computer, and what\'s coming up.'),
  'dictation-cleanup': tx('Dictation from other apps tidied by a model before it\'s pasted.'),
  'usage-everywhere': tx('The tokens each provider and model used, in Today › Usage. It stays on this computer.'),
  'meeting-insights': tx('Your meetings added up, and the people you meet. It turns on by itself once 5 meetings are recorded here.'),
  routines: tx('Routines that run by themselves at the time you set, and History › Commands.'),
  'call-video': tx("On a call, whose mouth moves on its video names who said what. Read on this Mac; no pictures kept."),
  'mcp-server': tx('Claude Code, Claude Desktop, Cursor and Codex read your boards, files and meeting summaries, and suggest changes you keep. Set up in Settings › MCP Servers.'),
}
// Bots just turned on: Set up a bot, which opens Settings › Bots. (Settings lists Bots once it's heard
// the beta feature is on, a moment after: asked again until it's there, and this has gone with
// About.)
function StartBots() {
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const go = (n = 0) => { openSettings('slack-bot'); if (n < 20) setTimeout(() => { if (alive.current) go(n + 1) }, 250) }
  return <div className="st-row ab-trial-go" data-setting="beta-bots-start"><button type="button" className="btn small" onClick={() => go()}><Icon name="chat" size={12} /> {t('Set up a bot')}</button></div>
}
function Trials() {
  const { s, save } = useSettings()
  const [mine, setMine] = useState({}) // as you set it, at once; saved behind it
  const on = (id) => mine[id] ?? s?.effective?.trials?.[id] === true
  const set = (id, v) => { setMine((m) => ({ ...m, [id]: v })); save({ trials: { [id]: v } }) }
  // The ones that turned themselves on (Meeting Insights, once there were meetings to add up), when.
  const { data: conf } = usePoll('/config', 10 * 60 * 1000)
  const auto = conf?.trialsAuto || {}
  return (
    <section className="st-sec" data-setting="beta">
      <h4>{t('Beta Features')}</h4>
      <p className="muted small" title={t("New parts of Bridge AI, in beta. Each stays hidden until you turn it on here, and turning it off hides it again; what you made with it stays where it is.")}>{t('Each stays hidden until you turn it on here.')}</p>
      {TRIALS.filter((x) => !x.mac || conf?.platform === 'darwin').map((x) => (
        <Fragment key={x.id}>
          <label className="st-check"><input type="checkbox" checked={on(x.id)} disabled={!s || (x.id === 'remote-screen' && !onThisComputer())} onChange={(e) => set(x.id, e.target.checked)} />
            <span title={t(x.hint)}><b>{t(x.label)}</b> <span className="muted small">{SHORT[x.id] ? t(SHORT[x.id]) : t(x.hint)}</span>{auto[x.id] && on(x.id) && <span className="muted small ab-auto-on"> {t('Turned on by itself on {date}, once there were meetings to add up.', { date: new Date(auto[x.id]).toLocaleDateString(locale(), { month: 'long', day: 'numeric' }) })}</span>}</span></label>
          {/* (Bots on: where to start, right there.) */}
          {x.id === 'slack-bot' && on(x.id) && <StartBots />}
          {/* Remote Screen and Preview guards which devices may connect: changed at the computer itself,
              and off, the devices unticked there still stay out (server/remote.js). */}
          {x.id === 'remote-screen' && !onThisComputer() && <p className="muted small ab-trial-go">{t('Turned on and off at the computer itself.')}</p>}
          {x.id === 'remote-screen' && !on(x.id) && <StaysOut />}
        </Fragment>
      ))}
    </section>
  )
}

function Report() {
  const [d, setD] = useState(null)
  useEffect(() => { api('/diagnostics').then(setD).catch(() => setD(null)) }, [])
  const text = d ? Object.entries(d).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') || 'none' : v}`).join('\n') : ''
  const issue = `${REPO}/issues/new?template=bug.yml&diagnostics=${encodeURIComponent(text)}`
  return (
    <section className="st-sec" data-setting="report">
      <h4>{t('Report a problem or suggest something')}</h4>
      <p className="muted small" title={t('Bridge AI is open source. Problems and ideas go in GitHub issues. Include the details below; they say which version and system you have, and nothing about you (no names, emails, folders or location).')}>{t('In GitHub issues, with your version and system, and nothing about you.')}</p>
      <div className="st-row">
        <a className="btn small primary" href={issue} target="_blank" rel="noreferrer"><Icon name="alert" size={13} /> {t('Report a problem')}</a>
        <a className="btn small" href={`${REPO}/issues/new?template=feature.yml`} target="_blank" rel="noreferrer"><Icon name="sparkle" size={13} /> {t('Suggest an idea')}</a>
        <CopyButton text={text} label={t('Copy details')} className="btn small" size={13} disabled={!d} />
      </div>
      <Advanced order={20}>
        <section className="st-sec" data-setting="report-details">
          <h4>{t('Details for a Report')}</h4>
          {d && <pre className="st-code ro ab-diag">{text}</pre>}
        </section>
        <section className="st-sec" data-setting="license">
          <h4>{t('License and Credits')}</h4>
          <p className="muted small">{t('Free and open source under the Apache License 2.0, as is, with no warranty. Not affiliated with Anthropic, OpenAI, Google, GitHub or the other companies whose tools it works with.')} <a href={`${REPO}/blob/main/TERMS.md`} target="_blank" rel="noreferrer">{t('Terms')}</a> · <a href={`${REPO}/blob/main/PRIVACY.md`} target="_blank" rel="noreferrer">{t('Privacy')}</a> · <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">{t('License')}</a> · <a href={`${REPO}/blob/main/NOTICE`} target="_blank" rel="noreferrer">{t('Notices')}</a></p>
          <p className="muted small">{t('If Bridge AI is useful to you, a star on GitHub helps other people find it.')} <a href={REPO} target="_blank" rel="noreferrer">{t('Star Bridge AI on GitHub')}</a></p>
          {/* The open-source parts Bridge AI is built with are in NOTICE; the one you see most is named. */}
          <p className="muted small">{t('Whiteboards are drawn with Excalidraw (MIT License).')} <a href="https://github.com/excalidraw/excalidraw" target="_blank" rel="noreferrer">github.com/excalidraw/excalidraw</a></p>
        </section>
      </Advanced>
    </section>
  )
}
