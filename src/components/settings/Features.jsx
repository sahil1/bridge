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
// to its place in Settings. The beta features after the rest, each marked Beta: none of them is
// hidden here, on or off. Then Set up, what Bridge AI uses besides your agents (SetupAll).
// Each line is only what this computer already knows, asked once as the page opens; a part that
// can't be asked (Bots while it's off) just says Off.
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

// A beta feature's card: its switch, and On or Off, with more where there's more to say (line, or
// offLine while it's off: Remote Screen's password stays set).
function BetaCard({ x, icon, line = null, offLine = null, why = null }) {
  const { on, set } = useBeta(x.id)
  return <Card id={x.id} icon={icon} name={t(x.label)} beta on={on} onSwitch={set} why={why} status={on ? line || t('On') : [t('Off'), offLine].filter(Boolean).join(' · ')} to={x.setting} />
}

const BETA_ICON = { home: 'home', 'dictation-cleanup': 'wand', 'usage-everywhere': 'bar-chart', 'meeting-insights': 'trend', routines: 'repeat', 'meeting-board': 'shapes', 'assist-answers': 'sparkle', 'slack-bot': 'chat', 'mcp-server': 'link', 'remote-screen': 'screen', 'call-video': 'video' }

export default function Features({ onOpenAgent }) {
  const { s, save } = useSettings()
  const { data: conf } = usePoll('/config', 10 * 60 * 1000)
  const trials = conf?.trials || {}
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
  const mcp = useOnce('/mcp-server', trials['mcp-server'] === true)
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
  const dictLine = !dictOn ? t('Off') : touch ? t('The mic button in a message box') : t('Hold {key} and talk', { key: keyLabel(dictationKey(d), keysPlatform()) })

  // The Chief of Staff: its agent, and its helpers.
  const chiefAgent = (agents || []).find((a) => a.kind === (eff.chief?.kind || 'claude'))
  const chiefLine = chiefAgent ? n(Math.max(1, Math.min(10, Number(eff.chief?.helpers?.max) || 3)), tx('On {agent} · {n} helper at once'), tx('On {agent} · {n} helpers at once'), { agent: chiefAgent.label }) : null

  // Phone: your phones through your relay, or Tailscale.
  const phones = (relay?.devices || []).filter((x) => x.kind !== 'computer')
  const phoneLine = !relay ? null : phones.length ? n(phones.length, tx('{n} phone paired'), tx('{n} phones paired')) : relay.configured ? t('Relay on · no phone paired yet') : t('Not set up')

  // Share Links: how many are open now.
  const live = (shares?.shares || []).filter((x) => !x.ended)
  const shareLine = !shares ? null : live.length ? n(live.length, tx('{n} link open'), tx('{n} links open')) : t('None shared now')

  // Notifications: where they go, and the sound.
  const sounds = conf.alertSounds !== false
  const noteLine = [pushes ? (pushes.length ? n(pushes.length, tx('{n} device'), tx('{n} devices')) : t('This computer')) : null, sounds ? t('with sound') : t('silent')].filter(Boolean).join(' · ')

  // Mail: How You Write, learnt or not.
  const mailLine = !voice ? t('Read-only') : voice.learntAt ? t('Read-only · How You Write learnt {date}', { date: new Date(voice.learntAt).toLocaleDateString(locale(), { month: 'short', day: 'numeric' }) }) : t('Read-only · How You Write not learnt yet')

  // Remote Screen: the password, and control.
  const ac = remote?.access
  const remoteLine = [ac ? (ac.password ? t('password set') : t('no password')) : null, remote?.control?.on ? t('control on') : null].filter(Boolean).join(' · ')

  // Bots: how many, through how many connections.
  const botLine = bots ? [n((bots.bots || []).length, tx('{n} bot'), tx('{n} bots')), conns ? n((conns.connections || []).length, tx('{n} connection'), tx('{n} connections')) : null].filter(Boolean).join(' · ') : null

  // Bridge AI as an MCP Server: the apps it's added to.
  const added = (mcp?.apps || []).filter((a) => a.added).map((a) => a.label)
  const mcpLine = !mcp ? null : added.length ? t('Added to {apps}', { apps: added.join(', ') }) : t('Not added to an app yet')

  const betaLine = { 'slack-bot': botLine, 'mcp-server': mcpLine, 'remote-screen': remoteLine }
  const betas = TRIALS.filter((x) => !x.mac || mac)

  const setDictation = async (v) => { await save({ dictation: { on: v } }); settingsChanged(); window.bridgeApp?.dictateConfigure?.({ ...d, on: v }).catch(() => {}) }

  return (
    <div className="st-sections ft">
      <ul className="ft-grid" aria-label={t('Your Features')}>
        <Card id="meetings" icon="mic" name={t('Meetings')} status={meetingLine} to="meetings" />
        <Card id="dictation" icon="keyboard" name={t('Dictation')} on={dictOn} onSwitch={setDictation} status={dictLine} to="dictation" />
        <Card id="chief" icon="sparkle" name={t('Chief of Staff')} status={chiefLine} to="chief" />
        <Card id="phone" icon="phone" name={t('Phone')} status={phoneLine} to="phone" />
        <Card id="sharing" icon="link" name={t('Share Links')} status={shareLine} to="sharing" />
        {conf.mail && <Card id="mail" icon="mail" name={t('Mail & Calendar')} status={mailLine} to="mail" />}
        <Card id="notifications" icon="bell" name={t('Notifications')} status={noteLine} to="notifications" />
      </ul>
      <h4 className="ft-head">{t('Beta')}<span className="muted small">{t('New parts of Bridge AI, each off until you turn it on.')}</span></h4>
      <ul className="ft-grid" aria-label={t('Beta Features')}>
        {betas.map((x) => <BetaCard key={x.id} x={x} icon={BETA_ICON[x.id] || 'sparkle'} line={betaLine[x.id] || null} offLine={x.id === 'remote-screen' && ac?.password ? t('password set') : null} why={x.id === 'remote-screen' && !here ? t('Turned on and off at the computer itself.') : null} />)}
      </ul>
      <div data-setting="setup"><SetupAll onOpen={onOpenAgent} /></div>
    </div>
  )
}
