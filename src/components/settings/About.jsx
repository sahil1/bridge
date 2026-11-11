import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import CopyButton from '../CopyButton.jsx'
import UsageCounts from './UsageCounts.jsx'
import CrashReports from './CrashReports.jsx'
import { api, usePoll } from '../../api.js'
import { useSettings } from './General.jsx'
import { startTour } from '../Tour.jsx'
import { withApp, installUpdate } from '../UpdateChip.jsx'
import { appVersion } from '../../permissions.js'
import { t, tx, locale } from '../../i18n/index.js'
import { TRIALS } from '../../trials.js'
import { AWAY_MINUTES, RELEASE_HOURS, waitingLong } from '../../../shared/autoupdate.js'
import { isPre } from '../../../shared/version.js'
import { earlyFromLink, doneWithEarlyLink } from '../../earlyLink.js'
import { Advanced } from './Advanced.jsx'

const REPO = 'https://github.com/sahil1/bridge'

// Settings › About & Updates: which version you have, whether there's a newer one (and updating
// to it, now or by itself while you're away), Early Access for testers with a code, reporting a
// problem, usage stats and crash reports, and last, the features on trial. Under Advanced: the
// tour again, the details a report includes, and the license and credits.
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
  // Early Access: a code from a link (?early=), or the quiet link below opens it. Only in a build that
  // takes codes (offered): elsewhere a link's code is dropped and nothing about it shows.
  const [link] = useState(earlyFromLink)
  const [joining, setJoining] = useState(!!link)
  const early = raw?.early
  const earlyShown = !!early && ((joining && early.offered) || early.on || !!early.problem)
  // A link's code in a build that takes none is dropped.
  useEffect(() => { if (early && !early.offered) doneWithEarlyLink() }, [early?.offered]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
    <section className="st-sec" data-setting="version">
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
          {/* A pre-release, off Early Access (left, or its code ended): it's never put back to an older version. */}
          {raw?.channel === 'stable' && isPre(raw.current) && !u.available && <p className="muted small ab-pre-stays">{t('{version} is a pre-release. Bridge AI stays on it until a regular release is newer, then updates to that.', { version: raw.current })}</p>}
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
          {early?.offered && !earlyShown && <p className="small ab-early-ask"><button type="button" className="link-btn" onClick={() => setJoining(true)}>{t('Have an early-access code?')}</button></p>}
        </>
      )}
    </section>
    {earlyShown && <EarlyAccess u={raw} code={link} onDone={() => { doneWithEarlyLink(); setJoining(false) }} onChange={() => load(false)} onJoined={doneWithEarlyLink} />}
    </>
  )
}

// Early Access: pre-releases for testers, joined with a code the project made for them, or by itself
// with a tester's Bold Bridge account (Settings › Account). Joined, it says who it's for and when it
// ends (or that it's the account's, renewed by itself), with Leave Early Access; a code that stopped working says why
// (ended, taken back), and this computer is on regular releases again, never put back to an older
// version. A code that's wrong when pasted says why too (server/earlyaccess.js).
const day = (iso) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })
// Who a pasted code says it's for and when it ends, to say why it can't be used (the server checked
// it; this only reads it).
function detailsOf(code) {
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(String(code).replace(/\s+/g, '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))) } catch { return {} }
}
function whyNot(err, code) {
  const d = detailsOf(code)
  if (err.code === 'early-malformed') return t("That isn't a whole early-access code. Paste all of it, from ea1. to the end.")
  if (err.code === 'early-forged') return t("That code doesn't check out: it wasn't made by the Bridge AI project, or it changed on the way. Paste it exactly as you got it.")
  if (err.code === 'early-expired' && d.for && d.until) return t('That code, for {name}, ended on {date}. Ask for a new one.', { name: d.for, date: day(d.until * 1000) })
  if (err.code === 'early-revoked' && d.for) return t('That code, for {name}, was taken back. Ask for a new one.', { name: d.for })
  if (err.code === 'early-none') return t("This version of Bridge AI doesn't take early-access codes.")
  return err.message
}
function EarlyAccess({ u, code: fromLink, onDone, onChange, onJoined }) {
  const e = u.early
  const [code, setCode] = useState(fromLink || '')
  const [state, setState] = useState(null) // joining | leaving | { error }
  const join = async () => {
    setState('joining')
    try { await api('/updates/early', { method: 'POST', body: { code } }); setCode(''); setState(null); onJoined?.(); onChange() } catch (err) { setState({ error: whyNot(err, code) }) }
  }
  // Left: the section goes, and the version line says the version here stays until Stable passes it.
  const leave = async () => {
    setState('leaving')
    try { await api('/updates/early', { method: 'DELETE' }); setState(null); onDone(); onChange() } catch (err) { setState({ error: err.message }) }
  }
  const PROBLEM = {
    expired: t('The early-access code for {name} ended on {date}, so this computer is back on regular releases.', { name: e.for, date: e.until && day(e.until) }),
    revoked: t('The early-access code for {name} was taken back, so this computer is back on regular releases.', { name: e.for }),
    forged: t("The early-access code saved here doesn't check out, so this computer is on regular releases."),
    malformed: t("The early-access code saved here doesn't check out, so this computer is on regular releases."),
    none: t("This version of Bridge AI doesn't take early-access codes, so this computer is on regular releases."),
    unsupported: u.how === 'docker' ? t("Early Access is for the desktop app. Bridge AI in Docker updates by its image's tag, which stays on regular releases.") : t('Early Access is for the desktop app. Bridge AI from a clone already runs the newest code there is (git pull).'),
  }
  const form = (
    <>
      <div className="st-row ab-early-form">
        <input className="st-input mono" value={code} onChange={(x) => setCode(x.target.value)} onKeyDown={(x) => { if (x.key === 'Enter' && code.trim()) join() }} placeholder="ea1.…" aria-label={t('Early-access code')} spellCheck={false} autoComplete="off" autoFocus={!e.on && !e.problem} />
        <button type="button" className="btn small primary" disabled={!code.trim() || state === 'joining'} onClick={join}><Icon name="check" size={13} /> {state === 'joining' ? t('Joining…') : t('Join')}</button>
        {!e.on && !e.problem && <button type="button" className="btn small" onClick={onDone}>{t('Cancel')}</button>}
      </div>
      {state?.error && <p className="st-note bad ab-early-error"><Icon name="alert" size={13} /> {state.error}</p>}
    </>
  )
  return (
    <section className="st-sec ab-early">
      <h4>{t('Early Access')}</h4>
      {e.on ? (
        <>
          <div className="st-row"><span className="st-chip good"><Icon name="check" size={11} /> {e.fromAccount ? t('On with your Bold Bridge account') : t('On for {name}', { name: e.for })}</span></div>
          <p className="muted small">{e.fromAccount ? t("This computer gets pre-releases of Bridge AI as soon as they're out, before everyone else, to try new things and say what's wrong. Its usage stats and crash reports say they're from your account's Early Access (by its id, never your email).") : t("This computer gets pre-releases of Bridge AI as soon as they're out, before everyone else, to try new things and say what's wrong. Its usage stats and crash reports say they're from {name}'s Early Access.", { name: e.for })}</p>
          <p className="muted small ab-early-code">{e.fromAccount ? t('Your account renews it by itself while it has Early Access.') : e.until ? t('Code made on {made}, good until {until}.', { made: day(e.made), until: day(e.until) }) : t('Code made on {made}, with no end date.', { made: day(e.made) })}</p>
          {state?.error && <p className="st-note bad ab-early-error"><Icon name="alert" size={13} /> {state.error}</p>}
          <div className="st-row"><button type="button" className="btn small" disabled={state === 'leaving'} onClick={leave}><Icon name="x" size={13} /> {t('Leave Early Access')}</button></div>
          <p className="muted small">{t('Leaving keeps the version you have: Bridge AI stays on it until a regular release is newer.')}{e.fromAccount && ` ${t('To join again, open Settings › Account.')}`}</p>
        </>
      ) : e.problem ? (
        <>
          <p className="st-note bad ab-early-problem"><Icon name="alert" size={13} /> {PROBLEM[e.problem] || PROBLEM.forged}</p>
          {e.offered && <p className="muted small">{t('Paste a new code to carry on:')}</p>}
          {e.offered ? form : state?.error && <p className="st-note bad ab-early-error"><Icon name="alert" size={13} /> {state.error}</p>}
          <div className="st-row"><button type="button" className="btn small" disabled={state === 'leaving'} onClick={leave}>{t('Remove the code')}</button></div>
        </>
      ) : (
        <>
          <p className="muted small">{t('Pre-releases of Bridge AI, for testers, before everyone else. Paste the code the Bridge AI project sent you.')}</p>
          {form}
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
  studio: tx('Documents, sheets, decks and PDFs, edited here or by your agents.'),
  home: tx('Where Bridge AI opens: what needs you on every computer, and what\'s coming up.'),
  'dictation-cleanup': tx('Dictation from other apps tidied by a model before it\'s pasted.'),
  'usage-everywhere': tx('The tokens each provider and model used, in Today › Usage. It stays on this computer.'),
  'meeting-insights': tx('Your meetings added up, and the people you meet. It turns on by itself once 5 meetings are recorded here.'),
  'tab-groups': tx('The tabs above your agents, grouped as the sidebar has them.'),
  'back-forward': tx('‹ and › in the top bar, as in a browser: back to where you were, and forward again. On to start with.'),
  routines: tx('Routines that run by themselves at the time you set, and History › Commands.'),
  files: tx('Every folder on this computer and your others, as Finder shows them. Read-only for now.'),
  'signature-assist': tx('In Studio, AI Assist\'s Sign this on a PDF you\'re asked to sign.'),
  'make-sheet': tx('In Studio, a new sheet written by AI Assist from what it\'s for, shown to keep or discard.'),
  'mcp-server': tx('Claude Code, Claude Desktop, Cursor and Codex read your boards, files and meeting summaries, and suggest changes you keep. Set up in Settings › MCP Servers.'),
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
      {TRIALS.map((x) => {
        // One that's part of another works only with that one on, and says so.
        const needs = x.needs && !on(x.needs) ? TRIALS.find((y) => y.id === x.needs) : null
        return (
          <label key={x.id} className="st-check"><input type="checkbox" checked={on(x.id) && !needs} disabled={!s || !!needs} onChange={(e) => set(x.id, e.target.checked)} />
            <span title={t(x.hint)}><b>{t(x.label)}</b> <span className="muted small">{SHORT[x.id] ? t(SHORT[x.id]) : t(x.hint)}</span>{needs && <span className="muted small"> {t('It needs {name} on.', { name: t(needs.label) })}</span>}{auto[x.id] && on(x.id) && <span className="muted small ab-auto-on"> {t('Turned on by itself on {date}, once there were meetings to add up.', { date: new Date(auto[x.id]).toLocaleDateString(locale(), { month: 'long', day: 'numeric' }) })}</span>}</span></label>
        )
      })}
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
