import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import CopyButton from '../CopyButton.jsx'
import { api } from '../../api.js'
import { Guide, guideDone, UpdateApp, Connect, DiscordSetup, TeamsSetup, PLATFORMS, platName } from '../settings/Bots.jsx'
import { STATE, asD, said, MakeShared, Defaults, Routed } from './Connections.jsx'
import TestConnection from './TestConnection.jsx'
import { openBot, refreshBots, chiefIdOf, takeFocus, useBots } from './bots.js'
import { t } from '../../i18n/index.js'
import './bots-home.css'

// Bots › Connections: every app your bots are reached through (a Slack app, a Discord bot, a Teams
// app), the shared ones and each bot's own, grouped by platform, each a card of the same kind. A card
// says how it stands and why, with what fixes it right there (its tokens, Update Your Slack App,
// Connect again, Test this connection, end to end); you linked there (You Here: a code you send the
// app in a direct message); a shared one's Chief, which takes every question that names no bot and
// answers it or calls one of its specialists, and the specialists it reaches (each also asked
// directly by name), and the channels that each go to one bot; a bot's own, that bot, and Use it for
// all your bots (it becomes the shared one, in place: one app for every bot), or Move to the shared
// one where that works; and the rest under Advanced: its name, tokens and manifest, a slash command
// for each bot, which bot each question went to, an app of its own for one bot, and deleting it. One
// not set up yet shows its app's steps first. Then a shared connection to make on each platform that
// has none.

const appName = (c) => (c.platform === 'teams' ? c.name : `@${c.name}`)
const works = (c) => c?.state === 'connected' && !c.paused
const listOf = (names) => (names.length < 2 ? names.join('') : t('{names} and {last}', { names: names.slice(0, -1).join(', '), last: names.at(-1) }))

export function ConnectionCard({ c, reload, open = null, where = null, all = null, onDone = null, onMade = null }) {
  const [note, setNote] = useState(null)
  const [done, setDone] = useState(null)
  const [name, setName] = useState(c.name)
  const [sure, setSure] = useState(false)
  useEffect(() => { setName(c.name) }, [c.name])
  const d = asD(c)
  const patch = async (body) => { setNote(null); try { await api(`/connections/${c.id}`, { method: 'PATCH', body }); reload(); refreshBots(); return true } catch (e) { setNote(e.message); return false } }
  // (You there, as the platform sections set it on a bot.)
  const save = (x) => (x.owner !== undefined ? patch({ owner: x.owner }) : x.owners?.[c.platform] !== undefined ? patch({ owner: x.owners[c.platform] }) : Promise.resolve(true))
  const again = async () => { try { await api(`/connections/${c.id}/connect`, { method: 'POST' }) } catch (e) { setNote(e.message) } reload() }
  const remove = async () => { try { await api(`/connections/${c.id}`, { method: 'DELETE' }); refreshBots(); reload() } catch (e) { setNote(e.message) } }
  const finished = (text) => { if (onDone) onDone(text); else setDone(text) }
  const label = platName(c.platform)
  const setUp = c.state !== 'no-tokens'
  const up = c.state === 'connected'
  const n = (c.bots || []).length
  const lacks = c.platform === 'slack' && !!c.tokens && (c.updateApp?.missing || c.scopes?.missing || []).length > 0
  // (Its checklist, on the card until every step's done.)
  const guided = setUp && !guideDone(d, c.platform)
  // (What it needs before it works, in place: its tokens, turned down or stopped on an error; a
  // Discord bot's server, where it's in more than one; a Teams app until Teams has reached it.)
  const fixHere = setUp && (c.state === 'error' || (up && c.platform === 'discord' && !c.status?.guild) || (up && c.platform === 'teams' && !c.status?.lastEvent))
  const tokens = (
    <>
      {c.platform === 'slack' && <Connect d={d} reload={reload} />}
      {c.platform === 'discord' && <DiscordSetup d={d} save={save} reload={reload} again={again} owner={false} />}
      {c.platform === 'teams' && <TeamsSetup d={d} save={save} reload={reload} again={again} owner={false} />}
    </>
  )
  // (The other apps on its platform: a shared one to move to, or a bot's own to use for all.)
  const peers = (all || []).filter((x) => x.platform === c.platform && x.id !== c.id)
  const shared = peers.find((x) => x.shared) || null
  // (A bot's own app that's connected, to use instead of a shared one that isn't: the first, where
  // there are more; each one's own card offers it too.)
  const ownsUp = c.shared && !works(c) ? peers.filter((x) => !x.shared && works(x)).slice(0, 1) : []
  const setup = (
    <div className="bh-setup" data-setting="connection-setup">
      <Guide key={`${c.id}-guide`} d={d} platform={c.platform} where={where} />
      {tokens}
    </div>
  )
  return (
    <section className="st-sec cn-card bh-card" data-connection={c.id} data-platform={c.platform} data-kind={c.shared ? 'shared' : 'own'} data-setting={`connection-${c.platform}`}>
      <header className="cn-head">
        <span className={`sb-dot ${STATE[c.state] || 'warn'}`} aria-hidden="true" />
        <h4 className="cn-name">{appName(c)}</h4>
        {!all && <span className={`sb-plat p-${c.platform}`}>{label}</span>}
        <span className="sb-plat cn-kind" data-setting="connection-kind">{c.shared ? (n === 1 ? t('Shared · 1 bot') : t('Shared · {n} bots', { n })) : t('{bot}\'s own app', { bot: c.own?.name || '' })}</span>
      </header>
      {done && <p className="st-note ok" role="status" data-setting="connection-done"><Icon name="check" size={13} /><span>{done}</span></p>}
      {!setUp && <p className={`st-note ${STATE[c.state] || 'warn'} cn-state`} role="status"><Icon name="info" size={13} /><span className="sb-status-text">{ownsUp.length && n ? (n === 1 ? t('Not set up yet, so {bot} isn\'t reached.', { bot: c.bots[0].name }) : t('Not set up yet, so {bots} aren\'t reached.', { bots: listOf(c.bots.map((b) => b.name)) })) : said(c)}</span></p>}
      {setUp && <TestConnection c={c} onDone={reload} tone={STATE[c.state] || 'warn'} status={<><Icon name={up ? 'check' : c.state === 'error' ? 'alert' : 'info'} size={13} /><span className="sb-status-text">{said(c)}</span>{['error', 'reconnecting'].includes(c.state) && <button type="button" className="link-btn" onClick={again}>{t('Connect again')}</button>}</>} />}
      {/* (Another copy is the server's others; its numConnections counts Test this connection's own
          look at Slack's hello too, so it isn't one by itself.) */}
      {c.others && <p className="st-note warn" role="status" data-setting="connection-copies"><Icon name="alert" size={13} /><span>{t('Another copy of Bridge AI is connected to this app too ({n} in all), so each message reaches only one of them. Disconnect the other copy, or give it an app of its own.', { n: (c.others?.n || 1) + 1 })}</span></p>}
      {c.limited && <p className="st-note warn" role="status" data-setting="connection-limited"><Icon name="clock" size={13} /><span>{t('{platform} is making it wait before it reads more ({n} s): answers that need the thread come a little later.', { platform: label, n: Math.round(Number(c.limited.wait) || 0) })}</span></p>}
      {c.catchingUp && <p className="st-note" role="status" data-setting="connection-catching-up"><Icon name="refresh" size={13} /><span>{t('Catching up on what was asked while it was away: {done} of {of}.', { done: c.catchingUp.done || 0, of: c.catchingUp.of || 0 })}</span></p>}
      {ownsUp.map((o) => <UseForAll key={o.id} own={o} shared={c} reload={reload} onDone={finished} from="shared" />)}
      {/* (Its app's steps; folded where a bot's own app that's connected can be used instead.) */}
      {!setUp && !ownsUp.length && setup}
      {!setUp && ownsUp.length > 0 && <details className="sb-how bh-adv" data-setting="connection-setup-folded"><summary><Icon name="chevron" size={11} />{t('Or set up {app} itself', { app: appName(c) })}</summary>{setup}</details>}
      {lacks && <UpdateApp d={d} onAgain={again} />}
      {fixHere && <div className="bh-setup" data-setting="connection-fix">{tokens}</div>}
      {/* (Its checklist on the card until every step's done: then a line under Advanced.) */}
      {guided && <Guide key={`${c.id}-guide`} d={d} platform={c.platform} where={where} compact />}
      {setUp && <YouHere c={c} reload={reload} patch={patch} again={again} />}
      <Reach c={c} patch={patch} />
      {!c.shared && setUp && all && <UseForAll own={c} shared={shared} reload={reload} onDone={finished} from="own" />}
      {c.shared && (up || c.defaults.length > 0) && <Defaults c={c} reload={reload} />}
      <details className="sb-how bh-adv" data-setting="connection-advanced" open={open ?? undefined}>
        <summary><Icon name="chevron" size={11} />{t('Advanced')}</summary>
        <label className="sb-field cn-rename"><span>{t('Name')}</span><input className="st-input" value={name} maxLength={35} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== c.name) patch({ name: name.trim() }); else setName(c.name) }} aria-label={t('Its name there')} /></label>
        {setUp && !fixHere && tokens}
        {setUp && !guided && <Guide key={`${c.id}-guide`} d={d} platform={c.platform} where={where} />}
        {c.platform === 'slack' && <ManifestLink c={c} />}
        {c.shared && c.platform === 'slack' && (
          <div className="cn-part" data-setting="connection-perbot">
            <label className="st-check bs-switch">
              <input type="checkbox" role="switch" checked={!!c.perBot} onChange={(e) => patch({ perBot: e.target.checked })} />
              <span><b className="small">{t('A slash command for each bot too')}</b> <span className="muted small">{t('Like /pricing-desk, besides {command}. Update the app with its manifest after turning this on, and after adding a bot.', { command: c.command || '' })}</span></span>
            </label>
          </div>
        )}
        {c.shared && <Routed c={c} />}
        {c.shared && <OwnApp platform={c.platform} bots={c.bots || []} reload={reload} onMade={onMade} />}
        {sure
          ? (
            <div className="st-row sb-sure" role="alert">
              <span className="small">{c.shared ? t('Delete {name}? Its tokens are deleted here, and its bots aren\'t reached on {platform} until there\'s another (their own apps stay). The app stays on {platform} until you delete it there.', { name: c.name, platform: label }) : t('Delete {name}? Its tokens are deleted here, and {bot} is reached through the shared connection instead, if there is one. The app stays on {platform} until you delete it there.', { name: c.name, bot: c.own?.name || '', platform: label })}</span>
              <button type="button" className="btn small danger" onClick={remove}><Icon name="trash" size={12} /> {t('Delete {name}', { name: c.name })}</button>
              <button type="button" className="ghost-btn" onClick={() => setSure(false)}>{t('Cancel')}</button>
            </div>
          )
          : <div className="st-row"><button type="button" className="ghost-btn danger" onClick={() => setSure(true)}><Icon name="trash" size={12} /> {t('Delete this connection…')}</button></div>}
      </details>
      {note && <p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {note}</p>}
    </section>
  )
}

// One app for all your bots, from a bot's own (own): it becomes the shared one on its platform, in
// place, its tokens where they were (POST /connections/:id/share); a shared one there that doesn't
// work is replaced, its bots coming here. Where the shared one works, the bot moves onto it instead
// (POST /bots/:id/move). Each asks first, saying what happens. from: the card it's on, the bot's own
// app's ("own") or the shared one's that doesn't work ("shared").
function UseForAll({ own, shared, reload, onDone, from = 'own' }) {
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const label = platName(own.platform)
  const bot = own.own?.name || own.name
  const app = appName(own)
  const moving = (shared?.bots || []).map((b) => b.name)
  const move = !!shared && works(shared)
  // (The Chief the shared one had stays theirs; with none, this bot is.)
  const keeps = shared && !move ? shared.bots?.find((b) => b.id === chiefIdOf(shared))?.name || null : null
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      if (move) {
        const x = await api(`/bots/${own.own?.id}/move`, { method: 'POST', body: { platform: own.platform } })
        onDone?.(t('Moved {bot} to {to}. You can delete its old app, {from}, on {platform} now.', { bot, to: appName(shared), from: app, platform: label }), x)
      } else {
        const x = await api(`/connections/${own.id}/share`, { method: 'POST', body: shared ? { replace: shared.id } : {} })
        const n = x?.bots?.length || 0
        onDone?.(n === 1 ? t('{app} is your shared {platform} connection now, for your one bot.', { app, platform: label }) : t('{app} is your shared {platform} connection now, for all {n} bots, with {chief} as their Chief.', { app, platform: label, n, chief: x?.took?.chief || bot }), x)
      }
      refreshBots()
      reload()
    } catch (e) { setError(e.message) }
    setBusy(false)
    setSure(false)
  }
  const why = shared && !move ? (shared.paused ? t('it\'s paused on this computer') : shared.state === 'no-tokens' ? t('not set up yet') : shared.why || t('not connected')) : null
  const lead = move
    ? t('Your shared {platform} connection, {name}, reaches your other bots: {bot} can be reached through it too.', { platform: label, name: appName(shared), bot })
    : from === 'shared'
      ? t('{app}, {bot}\'s own app, is connected: use it for all your bots instead.', { app, bot })
      : shared
        ? (moving.length ? t('{name}, your shared {platform} connection, isn\'t working ({why}): use {app} for {bots} too.', { name: appName(shared), platform: label, why, bots: listOf(moving), app }) : t('{name}, your shared {platform} connection, isn\'t working ({why}): use {app} for all your bots instead.', { name: appName(shared), platform: label, why, app }))
        : t('Use {app} for all your bots: each is reached through it by its name, with {bot} as their Chief.', { app, bot })
  const then = own.platform === 'slack' ? ` ${t('Slack then asks you to update the app once, so each answer shows its bot\'s name.')}` : ''
  const ask = move
    ? t('Move {bot} to {name}? Its own app\'s tokens are deleted here; delete that app on {platform} afterwards.', { bot, name: appName(shared), platform: label })
    : shared
      ? `${shared.tokens ? t('{name} is removed, its tokens deleted here (its app stays on {platform} until you delete it there).', { name: appName(shared), platform: label }) : t('{name}, never set up, is removed.', { name: appName(shared) })} ${moving.length > 1 ? (keeps ? t('{bots} move to {app}, each reached by its name, and {chief} stays their Chief.', { bots: listOf(moving), app, chief: keeps }) : t('{bots} move to {app}, each reached by its name, with {bot} as their Chief.', { bots: listOf(moving), app, bot })) : moving.length ? (keeps ? t('{one} moves to {app}, reached by its name, and {chief} stays its Chief.', { one: moving[0], app, chief: keeps }) : t('{one} moves to {app}, reached by its name, with {bot} as its Chief.', { one: moving[0], app, bot })) : t('{bot} becomes the Chief of every bot reached through it.', { bot })}${then}`
      : `${t('Every bot without an app of its own is reached through {app} by its name, and {bot} becomes their Chief: it takes what names no bot. Its tokens stay as they are.', { app, bot })}${then}`
  const strong = !move && (from === 'shared' || !!shared)
  return (
    <div className={`cn-part bh-share${strong ? ' strong' : ''}`} data-setting="connection-share" data-move={move ? 'true' : 'false'}>
      <span className="small">{lead}</span>
      {sure
        ? (
          <div className="st-row sb-sure bh-share-sure" role="alert">
            <span className="small">{ask}</span>
            <button type="button" className="btn small primary" disabled={busy} onClick={go}>{move ? t('Move {bot}', { bot }) : t('Use {app} for all', { app })}</button>
            <button type="button" className="ghost-btn" onClick={() => setSure(false)}>{t('Cancel')}</button>
          </div>
        )
        : <div className="st-row"><button type="button" className={`btn small${strong ? ' primary' : ''}`} onClick={() => setSure(true)}><Icon name={move ? 'link' : 'bot'} size={12} /> {move ? t('Move {bot} to {name}', { bot, name: appName(shared) }) : from === 'shared' ? t('Use {app} instead', { app }) : t('Use it for all your bots')}</button></div>}
      {error && <p className="error-text small" role="alert">{error}</p>}
    </div>
  )
}

// You here: you, linked on this connection, so your own questions are answered at once and what
// waits for you comes to your direct messages. Linking is a code you send the app in a direct
// message (it knows it's you from that); one it can name as you already (someone there with your
// name) is a click. Not connected, it says so, with Connect again where that's what's needed.
function YouHere({ c, reload, patch, again }) {
  const [code, setCode] = useState(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const app = appName(c)
  const linked = !!c.owner
  const up = c.state === 'connected'
  // (Waiting for the code to come in: the card is looked at again every few seconds until it has you.)
  useEffect(() => {
    if (!code || linked) return undefined
    const every = setInterval(() => { if (!document.hidden) reload() }, 3000)
    return () => clearInterval(every)
  }, [code, linked]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (linked) setCode(null) }, [linked])
  const [until, setUntil] = useState(null)
  const link = async () => {
    setBusy(true)
    setError(null)
    try { const r = await api(`/connections/${c.id}/link`, { method: 'POST' }); setCode(r.code || null); setUntil(r.expiresAt || null) } catch (e) { if (e.status === 404) setMissing(true); else setError(e.message) }
    setBusy(false)
  }
  const at = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const guess = !linked && up ? c.ownerGuess : null
  return (
    <div className="cn-part bh-you" data-setting="connection-you">
      <div className="st-row">
        <b className="small">{t('You Here')}</b>
        {linked
          ? <span className="small bh-you-name"><Icon name="check" size={12} /> {c.owner.name || c.owner.id}</span>
          : up
            ? <span className="small error-text">{t('Not linked yet: your own questions may be turned down or wait for you.')}</span>
            : <span className="small muted">{t('Not linked yet: once {app} is connected, Link me gives you a code to send it.', { app })}</span>}
        <span className="sb-grow" />
        {linked && !c.ownerFrom && <button type="button" className="ghost-btn" onClick={() => patch({ owner: null })}>{t('That isn\'t me')}</button>}
        {(linked || up) && !missing && <button type="button" className={`btn small${linked ? '' : ' primary'}`} disabled={busy} onClick={link}><Icon name="link" size={12} /> {linked ? t('Link again') : t('Link me')}</button>}
        {!linked && !up && ['error', 'reconnecting'].includes(c.state) && <button type="button" className="btn small" onClick={again}><Icon name="refresh" size={12} /> {t('Connect again')}</button>}
      </div>
      {guess && !code && (
        <div className="st-row sb-guess">
          <span className="small">{t('Is this you: {name}?', { name: guess.name })}</span>
          <button type="button" className="btn small" onClick={() => patch({ owner: { id: guess.id, name: guess.name } })}><Icon name="check" size={12} /> {t('Yes, that\'s me')}</button>
        </div>
      )}
      {code && !linked && (
        <div className="bh-code" role="status">
          <p className="small">{t('Send this code to {app} in a direct message:', { app })}</p>
          <div className="st-row"><code className="bh-code-text" data-setting="connection-link-code">{code}</code><CopyButton text={code} label={t('Copy the code')} className="btn small" size={12} /></div>
          <p className="muted small">{t('Waiting for it… this card ticks itself once the app has it.')}{until ? ` ${t('The code works until {time}.', { time: at(until) })}` : ''}</p>
        </div>
      )}
      {!code && !linked && up && c.linking?.expiresAt && <p className="muted small">{t('A code is waiting for you to send it, until {time}. Lost it? Link me gives you a new one.', { time: at(c.linking.expiresAt) })}</p>}
      {missing && !linked && !guess && <p className="muted small">{t('This Bridge AI can\'t link you by a code yet: update it on that computer, then Link me.')}</p>}
      {error && <p className="error-text small" role="alert">{error}</p>}
    </div>
  )
}

// Its Chief and its specialists: a question that names no bot goes to the Chief, which answers it
// or calls a specialist (it hands the thread over, or asks it and answers itself); anyone may still
// ask a specialist by its name. A bot's own connection has one bot, and every question is its.
function Reach({ c, patch }) {
  if (!c.shared) {
    const b = (c.bots || [])[0]
    return (
      <div className="cn-part" data-setting="connection-bots">
        <div className="st-row cn-its">
          <b className="small">{t('Its Bot')}</b>
          <div className="cn-bots">{(c.bots || []).map((x) => <BotChip key={x.id} b={x} />)}</div>
        </div>
        {b && <p className="muted small">{t('Every question to {app} is {bot}\'s.', { app: appName(c), bot: b.name })}</p>}
      </div>
    )
  }
  const bots = c.bots || []
  const chiefs = c.chief !== undefined
  const chief = chiefs ? bots.find((b) => b.id === chiefIdOf(c)) || null : null
  const specialists = bots.filter((b) => b.id !== chief?.id)
  return (
    <div className="cn-part bh-reach" data-setting="connection-bots">
      {chiefs && bots.length > 0 && (
        <label className="sb-field bh-chief" data-setting="connection-chief">
          <span>{t('Chief')}</span>
          <select className="st-input" value={chiefIdOf(c) || ''} onChange={(e) => patch({ chief: e.target.value || null })}>
            <option value="">{t('None: it asks them which bot')}</option>
            {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {chiefs && bots.length > 0 && <p className="muted small">{chief ? t('A question that names no bot goes to {bot}: it answers, or calls one of its specialists.', { bot: chief.name }) : t('With no Chief, a question that names no bot is asked back: which bot?')}</p>}
      <b className="small">{chiefs ? t('Specialists') : t('Bots on It')}</b>
      {specialists.length
        ? <div className="cn-bots">{specialists.map((b) => <BotChip key={b.id} b={b} />)}</div>
        : <p className="small sb-none">{bots.length ? t('Only its Chief so far.') : t('None yet: every new bot is reached through it unless it has its own.')}</p>}
      {specialists.length > 0 && <p className="muted small">{c.platform === 'slack' ? t('Anyone may ask one by name: {example}, or {command} and its name.', { example: `@${c.name} ${specialists[0].name}: …`, command: c.command || '' }) : t('Anyone may ask one by name: {example}.', { example: `${specialists[0].name}: …` })}</p>}
    </div>
  )
}
const BotChip = ({ b }) => <button type="button" className="sb-chip" onClick={() => openBot(b.id)} title={b.description || b.name} data-bot={b.id}><Icon name="bot" size={12} /><span className="sb-chip-name">{b.name}</span>{b.paused && <Icon name="pause" size={11} />}</button>

// An app of its own for one bot (bots: those it may be), for an identity of its own there (a public
// support bot, say): its card then shows the steps to make that app, and is scrolled to.
function OwnApp({ platform, bots, reload, onMade = null }) {
  const [bot, setBot] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const label = platName(platform)
  const give = async () => {
    setBusy(true)
    setError(null)
    try { const x = await api(`/bots/${bot}/own`, { method: 'POST', body: { platform } }); setBot(''); refreshBots(); reload(); onMade?.(x?.connections?.[platform]?.id || null) } catch (e) { setError(e.message) }
    setBusy(false)
  }
  if (!bots.length) return null
  return (
    <div className="cn-part" data-setting="connection-own" data-platform={platform}>
      <b className="small">{t('An App of Its Own')}</b>
      <p className="muted small">{t('For a bot that needs a name and icon of its own on {platform} (a public support bot, say): you make one more app there, for it alone.', { platform: label })}</p>
      <div className="sb-add cn-add-default">
        <select className="st-input" value={bot} onChange={(e) => setBot(e.target.value)} aria-label={t('Which bot')}>
          <option value="">{t('Which bot…')}</option>
          {bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button type="button" className="btn small" disabled={!bot || busy} onClick={give}>{t('Give it its own app')}</button>
      </div>
      {error && <p className="error-text small" role="alert">{error}</p>}
    </div>
  )
}

// Every connection, by platform: on each, its shared one first, then the bots' own; then a shared
// one to make on each platform that has none. A card asked for (Open in Connections, on a bot's
// page) is scrolled to.
export function ConnectionsList({ phone = false }) {
  const [r, setR] = useState(null)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [focus, setFocus] = useState(() => takeFocus())
  const { list: bots } = useBots()
  const root = useRef(null)
  const load = () => api('/connections').then((x) => { setR(x); setError(null) }, (e) => setError(e.message))
  useEffect(() => {
    load()
    const every = setInterval(() => { if (!document.hidden) load() }, 5000)
    const on = () => setFocus(takeFocus())
    window.addEventListener('bridge-focus-connection', on)
    return () => { clearInterval(every); window.removeEventListener('bridge-focus-connection', on) }
  }, [])
  // (Scrolled to once, as soon as the list has it; picked out for a moment.)
  useEffect(() => {
    if (!focus || !r) return undefined
    const el = root.current?.querySelector(`[data-connection="${focus}"]`)
    if (!el) return undefined
    el.scrollIntoView({ block: 'start', behavior: 'smooth' })
    el.classList.add('cn-focus')
    setFocus(null)
    setTimeout(() => el.classList.remove('cn-focus'), 2400)
    return undefined
  }, [focus, r])
  if (error && !r) return <p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {error}</p>
  if (!r) return <div className="skeleton-rows"><div /><div /></div>
  const list = r.connections || []
  const groups = PLATFORMS.map(([k, label]) => [k, label, list.filter((c) => c.platform === k).sort((a, b) => Number(b.shared) - Number(a.shared))]).filter(([, , l]) => l.length)
  const missing = PLATFORMS.filter(([k]) => !list.some((c) => c.shared && c.platform === k))
  return (
    <div className={`cn sb bh-conns${phone ? ' phone' : ''}`} data-setting="bots-connections" ref={root}>
      {done && <p className="st-note ok" role="status" data-setting="connections-done"><Icon name="check" size={13} /><span>{done}</span><button type="button" className="icon-btn" onClick={() => setDone(null)} aria-label={t('Close')}><Icon name="x" size={12} /></button></p>}
      {groups.map(([k, label, l]) => (
        <section key={k} className="bh-group bh-plat" data-platform={k} data-setting={`connections-${k}`}>
          <h4 className="bh-group-head">{label}</h4>
          {l.map((c) => <ConnectionCard key={c.id} c={c} reload={load} all={list} onDone={(text) => setDone(text)} onMade={(id) => setFocus(id)} />)}
        </section>
      ))}
      {missing.length > 0 && (
        <section className="st-sec cn-new" data-setting="connections-new">
          <h4>{list.some((c) => c.shared) ? t('Add a Connection') : t('Make Your First Connection')}</h4>
          {!list.length && <p className="muted small">{t('One app on Slack, Discord or Microsoft Teams for all your bots: made once, and each new bot is reached through it.')}</p>}
          {missing.map(([k, label]) => (
            <details key={k} className="sb-how cn-new-one" data-platform={k} open={!list.length && k === 'slack'}>
              <summary><Icon name="chevron" size={11} />{label}</summary>
              <MakeShared platform={k} suggested={r.suggested} onMade={() => load()} />
              <OwnApp platform={k} bots={(bots || []).filter((b) => !b.draft && !b.deleted && !(b.connections?.[k] && !b.connections[k].shared))} reload={load} onMade={(id) => setFocus(id)} />
            </details>
          ))}
        </section>
      )}
    </div>
  )
}

// Its app's App Manifest page on Slack, where the manifest is pasted to update the app (the server
// knows it once it has the app's id); nothing when it doesn't, or can't say.
function ManifestLink({ c }) {
  const [x, setX] = useState(null)
  useEffect(() => {
    let live = true
    api(`/connections/${c.id}/manifest-url`).then((r) => live && setX(r), () => {})
    return () => { live = false }
  }, [c.id])
  if (!x?.url) return null
  return (
    <div className="st-row" data-setting="connection-manifest">
      <a className="btn small" href={x.url} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> {t('Its App Manifest page')}</a>
      {x.missing?.length > 0 && <span className="muted small">{t('It lacks {scopes}: paste the manifest there, then reinstall.', { scopes: x.missing.join(', ') })}</span>}
    </div>
  )
}
