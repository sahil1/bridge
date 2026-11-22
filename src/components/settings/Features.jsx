import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import SetupAll from '../SetupAll.jsx'
import { api, onThisComputer, settingsChanged, usePoll } from '../../api.js'
import { TRIALS } from '../../trials.js'
import { useBeta } from './Beta.jsx'
import { useSettings } from './General.jsx'
import { keyLabel } from '../../../shared/dictation/keys.js'
import { keysPlatform, dictationKey } from '../../dictation/controller.js'
import { t, tx, locale } from '../../i18n/index.js'
import './features.css'

// Settings › Your Features, where Settings opens: each feature as a card, with its switch where it
// has one, how it's doing in a line ("Notes by Claude · 12 this week", "3 links open"), and Open,
// to its place in Settings. Tidy What I Say only where dictation from other apps can work (the
// desktop app, where this computer lets it hear the key). The beta features after the rest, each
// marked Beta: none of them is hidden here, on or off. Then Set up, what Bridge AI uses besides
// your agents (SetupAll). Each line is one line, cut short if it's longer (all of it on hover), and
// only what this computer already knows, asked once as the page opens; a part that can't be asked
// (Bots while it's off) just says Off.
const open = (section) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section } }))

// One answer, asked once while on (null until then, or if it fails).
function useOnce(path, on = true) {
  const [d, setD] = useState(null)
  useEffect(() => {
    if (!on || !path) { setD(null); return undefined }
    let live = true
    api(path).then((x) => live && setD(x), () => live && setD(null))
    return () => { live = false }
  }, [path, on])
  return d
}

const WEEK = 7 * 24 * 3600 * 1000
// A count in words: one, or many (each marked tx, so it's translated).
const n = (count, one, many, v = {}) => t(count === 1 ? one : many, { n: count, ...v })

function Card({ id, icon, name, beta = false, on = null, onSwitch = null, why = null, status, tone = '', to }) {
  return (
    <li className={`ft-card${on === false ? ' off' : ''}`} data-feature={id}>
      <div className="ft-top">
        <span className="ft-ico" aria-hidden="true"><Icon name={icon} size={16} /></span>
        <span className="ft-name"><b>{name}</b></span>
        {onSwitch && <input type="checkbox" role="switch" className="tg" checked={!!on} disabled={!!why} title={why || undefined} onChange={(e) => onSwitch(e.target.checked)} aria-label={name} />}
      </div>
      <p className={`ft-status small ${tone || 'muted'}`}>{status || ' '}</p>
      <div className="ft-foot">
        {beta && <span className="st-chip beta">{t('Beta')}</span>}
        <button type="button" className="ft-open" onClick={() => open(to)} aria-label={t('Open {name}', { name })}>{t('Open')}<Icon name="chevron" size={11} /></button>
      </div>
    </li>
  )
}

// A beta feature's card: its switch, and while it's on, how it's doing (line, else On); while it's
// off, what it is (its switch already says off).
function BetaCard({ x, icon, line = null, why = null }) {
  const { on, set } = useBeta(x.id)
  return <Card id={x.id} icon={icon} name={t(x.label)} beta on={on} onSwitch={set} why={why} status={on ? line || t('On') : t(x.card)} to={x.setting} />
}

const BETA_ICON = { 'usage-everywhere': 'bar-chart', 'meeting-board': 'shapes', 'assist-answers': 'sparkle', 'slack-bot': 'chat', 'remote-screen': 'screen', 'share-links': 'link', 'call-video': 'video' }

export default function Features({ onOpenAgent }) {
  const { s, save } = useSettings()
  const { data: conf } = usePoll('/config', 10 * 60 * 1000)
  const trials = conf?.trials || {}
  // The features out of beta, each with its switch here: as you set one, at once (saved behind it,
  // and put back if that fails), else as the server says.
  const [mine, setMine] = useState({})
  useEffect(() => { setMine((m) => Object.fromEntries(Object.entries(m).filter(([k, v]) => conf?.features?.[k] !== v))) }, [conf])
  const features = { ...(conf?.features || {}), ...mine }
  const mac = conf?.platform === 'darwin'
  const meetings = useOnce('/meetings')
  const chat = useOnce('/chat/models')
  const relay = useOnce('/relay')
  const shares = useOnce('/shares')
  const pushes = useOnce('/push/devices')
  const remote = useOnce('/remote')
  const voice = useOnce(conf?.mail ? '/mail/voice' : null)
  const bots = useOnce('/bots', trials['slack-bot'] === true)
  const conns = useOnce('/connections', trials['slack-bot'] === true)
  const mcp = useOnce('/mcp-server', features['mcp-server'] === true)
  const routines = useOnce('/routines', features.routines === true)
  // Dictation from other apps, where the desktop app can hear the key there: Tidy What I Say's card.
  const [fromApps, setFromApps] = useState(false)
  useEffect(() => { window.bridgeApp?.dictateStatus?.().then((st) => setFromApps(!!st?.mode), () => {}) }, [])
  const tidy = useOnce('/dictation/tidy', fromApps && features['dictation-cleanup'] === true)
  const [agents, setAgents] = useState(null)
  useEffect(() => { api('/agents/catalog').then(setAgents, () => setAgents([])) }, [])
  if (!s || !conf) return <div className="skeleton-rows"><div /><div /><div /></div>
  const eff = s.effective
  const here = onThisComputer()

  // Meetings: how many this week, and the model that writes their notes.
  const since = Date.now() - WEEK
  const week = meetings?.meetings ? meetings.meetings.filter((m) => Date.parse(m.startedAt || 0) > since).length : null
  const notesId = eff.meetings?.model || chat?.automatic
  const notes = notesId && (chat?.models || []).find((m) => m.id === notesId)
  const meetingLine = [notes ? t('Notes by {model}', { model: notes.label }) : chat ? t('No model for notes yet') : null, week != null ? t('{n} this week', { n: week }) : null].filter(Boolean).join(' · ')

  // Dictation: on or off, and the key.
  const d = eff.dictation || {}
  const dictOn = d.on !== false
  const touch = matchMedia('(pointer: coarse)').matches
  const dictLine = !dictOn ? t('Talk to your agents by holding a key') : touch ? t('The mic button in a message box') : t('Hold {key} and talk', { key: keyLabel(dictationKey(d), keysPlatform()) })

  // The Chief of Staff: its agent, and its helpers.
  const chiefAgent = (agents || []).find((a) => a.kind === (eff.chief?.kind || 'claude'))
  const chiefLine = chiefAgent ? n(Math.max(1, Math.min(10, Number(eff.chief?.helpers?.max) || 3)), tx('On {agent} · {n} helper at once'), tx('On {agent} · {n} helpers at once'), { agent: chiefAgent.label }) : null

  // Phone: your phones through your relay, or Tailscale.
  const phones = (relay?.devices || []).filter((x) => x.kind !== 'computer')
  const phoneLine = !relay ? null : phones.length ? n(phones.length, tx('{n} phone paired'), tx('{n} phones paired')) : relay.configured ? t('Relay on · no phone paired yet') : t('Not set up')

  // Share Links (a beta feature): how many are open now.
  const live = (shares?.shares || []).filter((x) => !x.ended)
  const shareLine = !shares ? null : live.length ? n(live.length, tx('{n} link open'), tx('{n} links open')) : t('None shared now')

  // Notifications: where they go, and the sound.
  const sounds = conf.alertSounds !== false
  const noteLine = [pushes ? (pushes.length ? n(pushes.length, tx('{n} device'), tx('{n} devices')) : t('This computer')) : null, sounds ? t('with sound') : t('silent')].filter(Boolean).join(' · ')

  // Mail: How You Write, learnt or not.
  const mailLine = !voice ? t('Read-only') : voice.learntAt ? t('How You Write learnt {date}', { date: new Date(voice.learntAt).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) }) : t('How You Write not learnt yet')

  // Remote Screen: the password, and control.
  const ac = remote?.access
  const remoteLine = [ac ? (ac.password ? t('password set') : t('no password')) : null, remote?.control?.on ? t('control on') : null].filter(Boolean).join(' · ')

  // Bots: how many, through how many connections.
  const botLine = bots ? [n((bots.bots || []).length, tx('{n} bot'), tx('{n} bots')), conns ? n((conns.connections || []).length, tx('{n} connection'), tx('{n} connections')) : null].filter(Boolean).join(' · ') : null

  // Bridge AI as an MCP Server: the apps it's added to.
  const added = (mcp?.apps || []).filter((a) => a.added).map((a) => a.label)
  const mcpLine = !mcp ? null : added.length ? t('Added to {apps}', { apps: added.join(', ') }) : t('Not added to an app yet')

  // Scheduled Routines: how many have a time to run at.
  const timed = (routines?.routines || []).filter((r) => r.when && r.auto && !r.paused).length
  const routineLine = !routines ? null : timed ? n(timed, tx('{n} routine on a schedule'), tx('{n} routines on a schedule')) : t('None on a schedule yet')
  // Meeting Insights: on, or on by itself once there are meetings to add up (unless you set it).
  const insightsLine = !features['meeting-insights'] && eff.meetings?.insights === undefined ? t('On by itself after 5 meetings') : t('Your meetings and people, added up')
  // Tidy What I Say: the model it tidies with, or that there's none yet.
  const tidyLine = !tidy ? null : tidy.model ? tidy.model.label : t("Not tidied: there's no model to tidy with yet.")

  const betaLine = { 'slack-bot': botLine, 'remote-screen': remoteLine, 'share-links': shareLine }
  const betas = TRIALS.filter((x) => !x.mac || mac)

  const setDictation = async (v) => { await save({ dictation: { on: v } }); settingsChanged(); window.bridgeApp?.dictateConfigure?.({ ...d, on: v }).catch(() => {}) }
  const turn = async (id, patch, v) => {
    setMine((m) => ({ ...m, [id]: v }))
    if (!(await save(patch))) setMine((m) => { const x = { ...m }; delete x[id]; return x })
  }
  const setTidy = async (v) => { await turn('dictation-cleanup', { dictation: { tidy: v } }, v); window.bridgeApp?.dictateConfigure?.({ ...d, tidy: v }).catch(() => {}) }

  return (
    <div className="st-sections ft">
      <ul className="ft-grid" aria-label={t('Your Features')}>
        <Card id="home" icon="home" name={t('Home')} on={features.home === true} onSwitch={(v) => turn('home', { home: { on: v } }, v)} status={t('Your day at a glance')} to="home" />
        <Card id="meetings" icon="mic" name={t('Meetings')} status={meetingLine} to="meetings" />
        <Card id="meeting-insights" icon="trend" name={t('Meeting Insights')} on={features['meeting-insights'] === true} onSwitch={(v) => turn('meeting-insights', { meetings: { insights: v } }, v)} status={insightsLine} to="meeting-insights" />
        <Card id="dictation" icon="keyboard" name={t('Dictation')} on={dictOn} onSwitch={setDictation} status={dictLine} to="dictation" />
        {fromApps && <Card id="tidy" icon="wand" name={t('Tidy What I Say')} on={features['dictation-cleanup'] === true} onSwitch={setTidy} status={features['dictation-cleanup'] ? tidyLine : t('Cleans up what you dictate in other apps')} to="tidy" />}
        <Card id="chief" icon="sparkle" name={t('Chief of Staff')} status={chiefLine} to="chief" />
        <Card id="routines" icon="repeat" name={t('Scheduled Routines')} on={features.routines === true} onSwitch={(v) => turn('routines', { routines: { on: v } }, v)} status={features.routines ? routineLine : t('Routines that run on a schedule')} to="scheduled-routines" />
        <Card id="phone" icon="phone" name={t('Phone')} status={phoneLine} to="phone" />
        {conf.mail && <Card id="mail" icon="mail" name={t('Mail & Calendar')} status={mailLine} to="mail" />}
        <Card id="notifications" icon="bell" name={t('Notifications')} status={noteLine} to="notifications" />
        <Card id="mcp-server" icon="link" name={t('Bridge AI as an MCP Server')} on={features['mcp-server'] === true} onSwitch={(v) => turn('mcp-server', { mcpServer: { on: v } }, v)} why={!here ? t('Turned on and off at the computer itself.') : null} status={features['mcp-server'] ? mcpLine : t('Your boards and files in other AI apps')} to="mcp-server" />
      </ul>
      <h4 className="ft-head">{t('Beta')}<span className="muted small">{t('New parts of Bridge AI, each off until you turn it on.')}</span></h4>
      <ul className="ft-grid" aria-label={t('Beta Features')}>
        {betas.map((x) => <BetaCard key={x.id} x={x} icon={BETA_ICON[x.id] || 'sparkle'} line={betaLine[x.id] || null} why={x.id === 'remote-screen' && !here ? t('Turned on and off at the computer itself.') : null} />)}
      </ul>
      <div data-setting="setup"><SetupAll onOpen={onOpenAgent} /></div>
    </div>
  )
}
