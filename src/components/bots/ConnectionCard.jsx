import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import CopyButton from '../CopyButton.jsx'
import { api } from '../../api.js'
import { Guide, Status, UpdateApp, Connect, Owner, DiscordSetup, TeamsSetup, PLATFORMS, platName } from '../settings/Bots.jsx'
import { STATE, asD, said, MakeShared, Defaults, Routed } from './Connections.jsx'
import TestConnection from './TestConnection.jsx'
import { openBot, refreshBots } from './bots.js'
import { t } from '../../i18n/index.js'
import './bots-home.css'

// Bots › Connections: a card for each app your bots are reached through (a Slack app, a Discord bot,
// a Teams app), saying how it stands and why; Test this connection, end to end; you linked there
// (You here: a code you send the app in a direct message); its Chief, which takes every question
// that names no bot and answers it or calls one of its specialists, and the specialists it reaches
// (each also asked directly by name); the channels that each go to one bot; and the rest under
// Advanced: its name, tokens and manifest, you picked by hand, a slash command for each bot, which
// bot each question went to, and deleting it. One not set up yet shows its app's steps first.
// Then a shared connection to make on each platform that has none, and Telegram, coming.

export function ConnectionCard({ c, reload, open = null }) {
  const [note, setNote] = useState(null)
  const [name, setName] = useState(c.name)
  const [sure, setSure] = useState(false)
  useEffect(() => { setName(c.name) }, [c.name])
  const d = asD(c)
  const patch = async (body) => { setNote(null); try { await api(`/connections/${c.id}`, { method: 'PATCH', body }); reload(); refreshBots(); return true } catch (e) { setNote(e.message); return false } }
  // (You there, as the platform sections set it on a bot.)
  const save = (x) => (x.owner !== undefined ? patch({ owner: x.owner }) : x.owners?.[c.platform] !== undefined ? patch({ owner: x.owners[c.platform] }) : Promise.resolve(true))
  const again = async () => { try { await api(`/connections/${c.id}/connect`, { method: 'POST' }) } catch (e) { setNote(e.message) } reload() }
  const remove = async () => { try { await api(`/connections/${c.id}`, { method: 'DELETE' }); refreshBots(); reload() } catch (e) { setNote(e.message) } }
  const label = platName(c.platform)
  const setUp = c.state !== 'no-tokens'
  const appSteps = (
    <>
      {c.platform === 'slack' && (
        <>
          <Status d={d} onAgain={again} />
          <UpdateApp d={d} onAgain={again} />
          <Connect d={d} reload={reload} />
        </>
      )}
      {c.platform === 'discord' && <DiscordSetup d={d} save={save} reload={reload} again={again} />}
      {c.platform === 'teams' && <TeamsSetup d={d} save={save} reload={reload} again={again} />}
    </>
  )
  return (
    <section className="st-sec cn-card bh-card" data-connection={c.id} data-platform={c.platform} data-setting={`connection-${c.platform}`}>
      <header className="cn-head">
        <span className={`sb-dot ${STATE[c.state] || 'warn'}`} aria-hidden="true" />
        <h4 className="cn-name">{c.platform === 'teams' ? c.name : `@${c.name}`}</h4>
        <span className={`sb-plat p-${c.platform}`}>{label}</span>
        <span className="sb-tag cn-kind">{c.shared ? t('Shared') : t('{bot}\'s own', { bot: c.own?.name || '' })}</span>
      </header>
      <p className={`st-note ${STATE[c.state] || 'warn'} cn-state`} role="status"><Icon name={c.state === 'connected' ? 'check' : c.state === 'error' ? 'alert' : 'info'} size={13} /><span className="sb-status-text">{said(c)}</span>{['error', 'reconnecting'].includes(c.state) && <button type="button" className="link-btn" onClick={again}>{t('Connect again')}</button>}</p>
      {c.numConnections > 1 && <p className="st-note warn" role="status" data-setting="connection-copies"><Icon name="alert" size={13} /><span>{t('Another copy of Bridge AI is connected to this app too ({n} in all), so each message reaches only one of them. Disconnect the other copy, or give it an app of its own.', { n: c.numConnections })}</span></p>}
      {!setUp && (
        <div className="bh-setup" data-setting="connection-setup">
          <Guide key={`${c.id}-guide`} d={d} platform={c.platform} />
          {appSteps}
        </div>
      )}
      {setUp && <TestConnection c={c} onDone={reload} />}
      {setUp && <YouHere c={c} reload={reload} />}
      <Reach c={c} patch={patch} />
      {c.shared && <Defaults c={c} reload={reload} />}
      <details className="sb-how bh-adv" data-setting="connection-advanced" open={open ?? undefined}>
        <summary><Icon name="chevron" size={11} />{t('Advanced')}</summary>
        <label className="sb-field cn-rename"><span>{t('Name')}</span><input className="st-input" value={name} maxLength={35} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== c.name) patch({ name: name.trim() }); else setName(c.name) }} aria-label={t('Its name there')} /></label>
        {setUp && appSteps}
        {setUp && <Guide key={`${c.id}-guide`} d={d} platform={c.platform} />}
        {c.platform === 'slack' && <Owner d={d} save={save} />}
        {c.shared && c.platform === 'slack' && (
          <label className="st-check cn-part" data-setting="connection-perbot">
            <input type="checkbox" checked={!!c.perBot} onChange={(e) => patch({ perBot: e.target.checked })} />
            <span><b className="small">{t('A slash command for each bot too')}</b> <span className="muted small">{t('Like /pricing-desk, besides {command}. Update the app with its manifest after turning this on, and after adding a bot.', { command: c.command || '' })}</span></span>
          </label>
        )}
        {c.shared && <Routed c={c} />}
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

// You here: you, linked on this connection, so your own questions are answered at once and what
// waits for you comes to your direct messages. Linking is a code you send the app in a direct
// message (it knows it's you from that); a Bridge AI that can't link that way has you picked from
// its people, under Advanced.
function YouHere({ c, reload }) {
  const [code, setCode] = useState(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const app = c.platform === 'teams' ? c.name : `@${c.name}`
  const linked = !!c.owner
  // (Waiting for the code to come in: the card is looked at again every few seconds until it has you.)
  useEffect(() => {
    if (!code || linked) return undefined
    const every = setInterval(() => { if (!document.hidden) reload() }, 3000)
    return () => clearInterval(every)
  }, [code, linked]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (linked) setCode(null) }, [linked])
  const link = async () => {
    setBusy(true)
    setError(null)
    try { const r = await api(`/connections/${c.id}/link`, { method: 'POST' }); setCode(r.code || null) } catch (e) { if (e.status === 404) setMissing(true); else setError(e.message) }
    setBusy(false)
  }
  return (
    <div className="cn-part bh-you" data-setting="connection-you">
      <div className="st-row">
        <b className="small">{t('You Here')}</b>
        {linked
          ? <span className="small bh-you-name"><Icon name="check" size={12} /> {c.owner.name || c.owner.id}</span>
          : <span className="small error-text">{t('Not linked yet: your own questions may be turned down or wait for you.')}</span>}
        <span className="sb-grow" />
        {!missing && <button type="button" className={`btn small${linked ? '' : ' primary'}`} disabled={busy} onClick={link}><Icon name="link" size={12} /> {linked ? t('Link again') : t('Link me')}</button>}
      </div>
      {code && !linked && (
        <div className="bh-code" role="status">
          <p className="small">{t('Send this code to {app} in a direct message:', { app })}</p>
          <div className="st-row"><code className="bh-code-text" data-setting="connection-link-code">{code}</code><CopyButton text={code} label={t('Copy the code')} className="btn small" size={12} /></div>
          <p className="muted small">{t('Waiting for it… this card ticks itself once the app has it.')}</p>
        </div>
      )}
      {missing && !linked && <p className="muted small">{t('Pick yourself from its people under Advanced.')}</p>}
      {error && <p className="error-text small" role="alert">{error}</p>}
    </div>
  )
}

// Its Chief and its specialists: a question that names no bot goes to the Chief, which answers it
// or calls a specialist (it hands the thread over, or asks it and answers itself); anyone may still
// ask a specialist by its name. A bot's own connection has one bot, and it's that bot's.
function Reach({ c, patch }) {
  if (!c.shared) {
    return (
      <div className="cn-part" data-setting="connection-bots">
        <b className="small">{t('Its Bot')}</b>
        <div className="cn-bots">{(c.bots || []).map((b) => <BotChip key={b.id} b={b} />)}</div>
      </div>
    )
  }
  const bots = c.bots || []
  const chiefs = c.chief !== undefined
  const chief = chiefs ? bots.find((b) => b.id === c.chief) || null : null
  const specialists = bots.filter((b) => b.id !== chief?.id)
  return (
    <div className="cn-part bh-reach" data-setting="connection-bots">
      {chiefs && bots.length > 0 && (
        <label className="sb-field bh-chief" data-setting="connection-chief">
          <span>{t('Chief')}</span>
          <select className="st-input" value={c.chief || ''} onChange={(e) => patch({ chief: e.target.value || null })}>
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

// Every connection: the shared ones, a shared one to make on each platform that has none (Telegram
// coming), then the bots' own.
export function ConnectionsList({ phone = false }) {
  const [r, setR] = useState(null)
  const [error, setError] = useState(null)
  const load = () => api('/connections').then((x) => { setR(x); setError(null) }, (e) => setError(e.message))
  useEffect(() => {
    load()
    const every = setInterval(() => { if (!document.hidden) load() }, 5000)
    return () => clearInterval(every)
  }, [])
  if (error && !r) return <p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {error}</p>
  if (!r) return <div className="skeleton-rows"><div /><div /></div>
  const list = r.connections || []
  const missing = PLATFORMS.filter(([k]) => !list.some((c) => c.shared && c.platform === k))
  return (
    <div className={`cn sb bh-conns${phone ? ' phone' : ''}`} data-setting="bots-connections">
      {list.filter((c) => c.shared).map((c) => <ConnectionCard key={c.id} c={c} reload={load} />)}
      {(missing.length > 0 || true) && (
        <section className="st-sec cn-new" data-setting="connections-new">
          <h4>{list.some((c) => c.shared) ? t('Add a Connection') : t('Make Your First Connection')}</h4>
          {!list.length && <p className="muted small">{t('One app on Slack, Discord or Microsoft Teams for all your bots: made once, and each new bot is reached through it.')}</p>}
          {missing.map(([k, label]) => (
            <details key={k} className="sb-how cn-new-one" open={!list.length && k === 'slack'}>
              <summary><Icon name="chevron" size={11} />{label}</summary>
              <MakeShared platform={k} suggested={r.suggested} onMade={() => load()} />
            </details>
          ))}
          <p className="muted small bh-soon" data-platform="telegram"><Icon name="clock" size={12} /> {t('Telegram: coming')}</p>
        </section>
      )}
      {list.some((c) => !c.shared) && <h4 className="cn-own-head">{t('Bots\' Own Connections')}</h4>}
      {list.filter((c) => !c.shared).map((c) => <ConnectionCard key={c.id} c={c} reload={load} />)}
    </div>
  )
}
