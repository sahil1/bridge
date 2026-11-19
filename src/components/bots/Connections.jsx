import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'
import { ago } from '../Machines.jsx'
import { Guide, Status, UpdateApp, Connect, Owner, DiscordSetup, TeamsSetup, PLATFORMS, platName } from '../settings/Bots.jsx'
import { openBot, refreshBots } from './bots.js'
import { t } from '../../i18n/index.js'

// Connections (server/connections.js): each one app on Slack, Discord or Microsoft Teams that your
// bots are reached through. A platform's shared connection reaches every bot that doesn't have its
// own, so its app is made once, by the name you give it, and a new bot needs nothing set up there;
// a bot can instead have its own (an app of its own, for an identity of its own). Settings › Bots ›
// Connections, the sidebar's Bots and the phone's More › Bots show them: a card each, with how it
// stands, the bots on it, the channels that each go to one bot (a shared one's), a slash command
// for each bot (Slack), you there, its app's steps, tokens and checklist (the same sections a bot
// had for its own app: settings/Bots.jsx, given the connection as kind 'connection'), and which bot
// each question went to, and why. A shared one's Routing (Routing.jsx) has its rules in order, with
// Try a Message. BotReach is a bot's own line about it, on its Set Up.

const STATE = { connected: 'ok', connecting: 'warn', reconnecting: 'warn', error: 'bad', 'no-tokens': 'warn', off: 'warn' }
// A connection as the platform sections take a bot: its state where each looks for it, and you there.
const asD = (c) => ({
  ...c, kind: 'connection',
  where: { slack: { state: c.state, why: c.why, channels: null }, ...(c.platform !== 'slack' ? { [c.platform]: c.status || { state: c.state } } : {}) },
  settings: { owner: c.platform === 'slack' ? c.owner : null, owners: c.platform !== 'slack' && c.owner ? { [c.platform]: c.owner } : {} },
  reached: { [c.platform]: c.reached || {} },
})
const said = (c) => (c.state === 'connected'
  ? (c.platform === 'discord' ? (c.status?.guild ? t('Connected to {server} as @{bot}.', { server: c.status.guild.name, bot: c.status.bot?.name || c.name }) : t('Connected as @{bot}, but not answering in a server yet: add it to yours with the link below.', { bot: c.status?.bot?.name || c.name }))
    : c.platform === 'teams' ? t('Signed in to Microsoft as its Azure Bot, and listening on this computer at port {port}.', { port: c.status?.port || 3978 })
      : t('Connected to {team} as @{bot}.', { team: c.team?.name || '', bot: c.bot?.name || c.name }))
  : c.state === 'no-tokens' ? t('Not set up yet: make its app with the steps below.')
    : c.state === 'error' ? t('Not connected: {why}.', { why: c.why || t('{platform} turned it down', { platform: platName(c.platform) }) })
      : c.state === 'off' ? t('Not connected: no bot on it is answering yet.')
        : t('Not connected: {why}. Trying again by itself.', { why: c.why || t('the connection closed') }))

// Which bot a question went to, and why, as its record says.
function routedSaid(e) {
  const bot = e.name || e.bot || ''
  if (e.event === 'settings') return e.what === 'moved' ? t('{bot} moved here', { bot: e.new || '' }) : t('Changed: {what}', { what: e.what === 'defaults' ? t('the channels\' bots') : e.what === 'perBot' ? t('a command for each bot') : e.what === 'owner' ? t('you there') : e.what === 'tokens' ? t('its tokens') : e.what === 'name' ? t('its name') : e.what || '' })
  if (e.event) return e.ok ? t('Connected') : `${e.event === 'dropped' ? t('Dropped') : t('Problem')}: ${e.why || ''}`
  switch (e.why) {
    case 'command': return t('to {bot}: its command', { bot })
    case 'default': return t('to {bot}: #{channel}\'s default', { bot, channel: e.detail || '' })
    case 'name': return t('to {bot}: named first', { bot })
    case 'thread': return t('to {bot}: its thread', { bot })
    case 'last': return t('to {bot}: the bot they asked last', { bot })
    case 'only': return t('to {bot}: the only one they may ask', { bot })
    case 'listen': return t('to {bot}: it answers there without a mention', { bot })
    case 'limit': return t('to {bot}: your answer about its run at its time limit', { bot })
    case 'router': return e.bot ? t('to {bot}: AI Assist picked it', { bot }) : e.detail === 'no-model' ? t('AI Assist couldn\'t pick: there\'s no model') : t('AI Assist couldn\'t tell which')
    case 'picked': return t('to {bot}: picked by whoever asked', { bot })
    case 'unsure': return t('to {bot}: the bot for when nothing says which', { bot })
    case 'asked': return t('Asked them which bot')
    case 'none': return t('Turned down: they may ask none of its bots')
    case 'help': return t('Listed its bots (!help)')
    default: return bot ? t('to {bot}', { bot }) : e.why || ''
  }
}

// A platform's shared connection, made: named as you like (your first name's, to start).
export function MakeShared({ platform, suggested = '', onMade, compact = false }) {
  const [name, setName] = useState(suggested)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { if (!name && suggested) setName(suggested) }, [suggested]) // eslint-disable-line react-hooks/exhaustive-deps
  const make = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try { const c = await api('/connections', { method: 'POST', body: { platform, name: name.trim() } }); refreshBots(); onMade?.(c) } catch (err) { setError(err.message) }
    setBusy(false)
  }
  return (
    <form className={`cn-make${compact ? ' compact' : ''}`} onSubmit={make} data-setting={`${platform}-make-shared`}>
      {!compact && <p className="small">{t('One {platform} app for all your bots: made once, and each new bot is reached through it with nothing more to set up there. Each answer shows which bot it\'s from.', { platform: platName(platform) })}</p>}
      <div className="sb-add">
        <input className="st-input" value={name} maxLength={35} onChange={(e) => setName(e.target.value)} placeholder={suggested || 'my_bot'} aria-label={t('The shared {platform} connection\'s name', { platform: platName(platform) })} />
        <button type="submit" className="btn small primary" disabled={busy || !name.trim()}><Icon name="plus" size={12} /> {t('Make the shared {platform} connection', { platform: platName(platform) })}</button>
      </div>
      <p className="muted small">{t('Its name is the app\'s name there, the one people mention.')}</p>
      {error && <p className="error-text small" role="alert">{error}</p>}
    </form>
  )
}

// The channels that each go to one bot, whatever's asked of the app there (a shared one's). bare:
// without its own heading and words, as the Routing page's rule has them (Routing.jsx).
export function Defaults({ c, reload, bare = false }) {
  const [channels, setChannels] = useState(null)
  const [chan, setChan] = useState('')
  const [bot, setBot] = useState('')
  const [error, setError] = useState(null)
  const up = c.state === 'connected'
  useEffect(() => {
    if (!up) return undefined
    let live = true
    api(`/connections/${c.id}/channels`).then((r) => live && setChannels(r.channels || []), (e) => live && setError(e.message))
    return () => { live = false }
  }, [c.id, up])
  const put = async (list) => {
    setError(null)
    try { await api(`/connections/${c.id}`, { method: 'PATCH', body: { defaults: list } }); reload() } catch (e) { setError(e.message) }
  }
  const free = (channels || []).filter((x) => !c.defaults.some((d) => d.id === x.id))
  const nameOf = (id) => c.bots.find((b) => b.id === id)?.name || id
  return (
    <div className="cn-part" data-setting="connection-defaults">
      {!bare && <b className="small">{t('Channels\' Bots')}</b>}
      {!bare && <p className="muted small">{t('In these channels, everything asked of {name} goes to one bot, whatever it names. Elsewhere it goes by the bot named first, the thread, or AI Assist\'s pick.', { name: c.name })}</p>}
      {c.defaults.length > 0
        ? (
          <ul className="sb-askers">
            {c.defaults.map((d) => (
              <li key={d.id}>
                <span className="sb-av" aria-hidden="true">#</span>
                <span className="sb-asker-name">#{d.name || d.id} → {nameOf(d.bot)}</span>
                <button type="button" className="icon-btn" onClick={() => put(c.defaults.filter((x) => x.id !== d.id))} aria-label={t('Remove {name}', { name: `#${d.name || d.id}` })}><Icon name="x" size={12} /></button>
              </li>
            ))}
          </ul>
        )
        : <p className="small sb-none">{t('None: it goes by what each question names.')}</p>}
      {up && c.bots.length > 0 && (
        <div className="sb-add cn-add-default">
          <select className="st-input" value={chan} onChange={(e) => setChan(e.target.value)} aria-label={t('A channel')}>
            <option value="">{t('A channel…')}</option>
            {free.map((x) => <option key={x.id} value={x.id}>#{x.name}</option>)}
          </select>
          <select className="st-input" value={bot} onChange={(e) => setBot(e.target.value)} aria-label={t('Its bot')}>
            <option value="">{t('Its bot…')}</option>
            {c.bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button type="button" className="btn small" disabled={!chan || !bot} onClick={() => { const x = free.find((y) => y.id === chan); put([...c.defaults, { id: chan, name: x?.name || null, bot }]); setChan(''); setBot('') }}><Icon name="plus" size={12} /> {t('Add')}</button>
        </div>
      )}
      {!up && <p className="muted small">{t('Connect it first to pick from the channels it\'s in.')}</p>}
      {error && <p className="error-text small" role="alert">{error}</p>}
    </div>
  )
}

// Which bot each question went to lately, and why.
export function Routed({ c }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    let live = true
    const load = () => api(`/connections/${c.id}/activity`).then((r) => live && setList(r.routed || []), () => live && setList([]))
    load()
    const every = setInterval(() => { if (!document.hidden) load() }, 6000)
    return () => { live = false; clearInterval(every) }
  }, [c.id])
  const shown = (list || []).filter((e) => !e.event || e.event === 'settings' || e.ok === false).slice(0, 8)
  return (
    <details className="sb-how cn-routed" data-setting="connection-activity">
      <summary><Icon name="chevron" size={11} />{t('Which Bot Answered')}</summary>
      {!list ? <div className="skeleton-rows"><div /></div> : shown.length ? (
        <ul className="cn-routed-list">
          {shown.map((e, i) => <li key={`${e.at}-${i}`} className="small"><span>{routedSaid(e)}</span><span className="muted">{[e.who, e.where === 'dm' ? t('a direct message') : e.where ? `#${e.where}` : null, ago(e.at)].filter(Boolean).join(' · ')}</span></li>)}
        </ul>
      ) : <p className="muted small">{t('Nothing asked through it yet.')}</p>}
    </details>
  )
}

// One connection: how it stands, its bots, its channels' bots, you there, its app's steps.
export function ConnectionCard({ c, reload, open = null }) {
  const [note, setNote] = useState(null)
  const [name, setName] = useState(c.name)
  const [sure, setSure] = useState(false)
  useEffect(() => { setName(c.name) }, [c.name])
  const d = asD(c)
  const patch = async (body) => { setNote(null); try { await api(`/connections/${c.id}`, { method: 'PATCH', body }); reload(); return true } catch (e) { setNote(e.message); return false } }
  // (You there, as the platform sections set it on a bot.)
  const save = (x) => (x.owner !== undefined ? patch({ owner: x.owner }) : x.owners?.[c.platform] !== undefined ? patch({ owner: x.owners[c.platform] }) : Promise.resolve(true))
  const again = async () => { try { await api(`/connections/${c.id}/connect`, { method: 'POST' }) } catch (e) { setNote(e.message) } reload() }
  const remove = async () => { try { await api(`/connections/${c.id}`, { method: 'DELETE' }); refreshBots(); reload() } catch (e) { setNote(e.message) } }
  const label = platName(c.platform)
  const set = c.state === 'connected' && !!c.owner
  return (
    <section className="st-sec cn-card" data-connection={c.id} data-platform={c.platform} data-setting={`connection-${c.platform}`}>
      <header className="cn-head">
        <span className={`sb-dot ${STATE[c.state] || 'warn'}`} aria-hidden="true" />
        <h4 className="cn-name">{c.name}</h4>
        <span className={`sb-plat p-${c.platform}`}>{label}</span>
        <span className="sb-tag cn-kind">{c.shared ? t('Shared') : t('{bot}\'s own', { bot: c.own?.name || '' })}</span>
      </header>
      <p className={`st-note ${STATE[c.state] || 'warn'} cn-state`} role="status"><Icon name={c.state === 'connected' ? 'check' : c.state === 'error' ? 'alert' : 'info'} size={13} /><span className="sb-status-text">{said(c)}</span>{['error', 'reconnecting'].includes(c.state) && <button type="button" className="link-btn" onClick={again}>{t('Connect again')}</button>}</p>
      <div className="cn-part">
        <b className="small">{c.shared ? t('Bots on It') : t('Its Bot')}</b>
        {c.bots.length
          ? <div className="cn-bots">{c.bots.map((b) => <button key={b.id} type="button" className="sb-chip" onClick={() => openBot(b.id)} title={b.description || b.name}><Icon name="bot" size={12} /><span className="sb-chip-name">{b.name}</span>{b.paused && <Icon name="pause" size={11} />}</button>)}</div>
          : <p className="small sb-none">{t('None yet: every new bot is reached through it unless it has its own.')}</p>}
        {c.shared && c.platform === 'slack' && c.bots.length > 0 && <p className="muted small">{t('People ask one with its name first ({example}), with {command} and its name, or in a channel that goes to it; a reply in a thread goes to the bot that answered there. Otherwise AI Assist picks from each bot\'s description, or asks them which.', { example: `@${c.name} ${c.bots[0].name}: …`, command: c.command || '' })}</p>}
        {c.shared && c.platform !== 'slack' && c.bots.length > 0 && <p className="muted small">{t('People ask one with its name first ({example}); a reply in a thread goes to the bot that answered there. Otherwise AI Assist picks from each bot\'s description, or asks them which.', { example: `${c.bots[0].name}: …` })}</p>}
        {c.shared && <div className="st-row"><button type="button" className="btn small" onClick={() => openBot(`routing:${c.id}`)} data-setting="connection-routing"><Icon name="branch" size={12} /> {t('Routing')}</button><span className="muted small">{t('Its rules in order, and Try a Message to see which bot takes one.')}</span></div>}
      </div>
      {c.shared && <Defaults c={c} reload={reload} />}
      {c.shared && c.platform === 'slack' && (
        <label className="st-check cn-part" data-setting="connection-perbot">
          <input type="checkbox" checked={!!c.perBot} onChange={(e) => patch({ perBot: e.target.checked })} />
          <span><b className="small">{t('A slash command for each bot too')}</b> <span className="muted small">{t('Like /pricing-desk, besides {command}. Update the app with its manifest after turning this on, and after adding a bot.', { command: c.command || '' })}</span></span>
        </label>
      )}
      <Guide key={`${c.id}-guide`} d={d} platform={c.platform} />
      <details className="sb-how cn-app" open={open ?? !set}>
        <summary><Icon name="chevron" size={11} />{t('Its App, Tokens and You There')}</summary>
        <label className="sb-field cn-rename"><span>{t('Name')}</span><input className="st-input" value={name} maxLength={35} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== c.name) patch({ name: name.trim() }); else setName(c.name) }} aria-label={t('Its name there')} /></label>
        {c.platform === 'slack' && (
          <>
            <Status d={d} onAgain={again} />
            <UpdateApp d={d} onAgain={again} />
            <Connect d={d} reload={reload} />
            <Owner d={d} save={save} />
          </>
        )}
        {c.platform === 'discord' && <DiscordSetup d={d} save={save} reload={reload} again={again} />}
        {c.platform === 'teams' && <TeamsSetup d={d} save={save} reload={reload} again={again} />}
      </details>
      {c.shared && <Routed c={c} />}
      {note && <p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {note}</p>}
      {sure
        ? (
          <div className="st-row sb-sure" role="alert">
            <span className="small">{c.shared ? t('Delete {name}? Its tokens are deleted here, and its bots aren\'t reached on {platform} until there\'s another (their own apps stay). The app stays on {platform} until you delete it there.', { name: c.name, platform: label }) : t('Delete {name}? Its tokens are deleted here, and {bot} is reached through the shared connection instead, if there is one. The app stays on {platform} until you delete it there.', { name: c.name, bot: c.own?.name || '', platform: label })}</span>
            <button type="button" className="btn small danger" onClick={remove}><Icon name="trash" size={12} /> {t('Delete {name}', { name: c.name })}</button>
            <button type="button" className="ghost-btn" onClick={() => setSure(false)}>{t('Cancel')}</button>
          </div>
        )
        : <div className="st-row"><button type="button" className="ghost-btn danger" onClick={() => setSure(true)}><Icon name="trash" size={12} /> {t('Delete this connection…')}</button></div>}
    </section>
  )
}

// Every connection, and a shared one to make for each platform that has none.
export function Connections({ page = false, phone = false }) {
  const [r, setR] = useState(null)
  const [error, setError] = useState(null)
  const load = () => api('/connections').then((x) => { setR(x); setError(null) }, (e) => setError(e.message))
  useEffect(() => {
    load()
    const every = setInterval(() => { if (!document.hidden) load() }, 5000)
    return () => clearInterval(every)
  }, [])
  if (error && !r) return <p className="st-note bad"><Icon name="alert" size={13} /> {error}</p>
  if (!r) return <div className="skeleton-rows"><div /><div /></div>
  const list = r.connections || []
  const missing = PLATFORMS.filter(([k]) => !list.some((c) => c.shared && c.platform === k))
  return (
    <div className={`cn sb${phone ? ' phone' : ''}`} data-setting="bots-connections">
      {page && <header className="bp-head"><Icon name="link" size={15} /><h2 className="bp-name">{t('Connections')}</h2></header>}
      <p className="muted small cn-about">{t('Each connection is one app on Slack, Discord or Microsoft Teams. A platform\'s shared connection reaches every bot that doesn\'t have its own, so it\'s made once; a bot can have its own instead, for an identity of its own. Tokens stay on this computer, shown only by their last four.')}</p>
      {list.filter((c) => c.shared).map((c) => <ConnectionCard key={c.id} c={c} reload={load} />)}
      {missing.length > 0 && (
        <section className="st-sec cn-new" data-setting="connections-new">
          <h4>{list.some((c) => c.shared) ? t('Another Platform') : t('Make Your First Connection')}</h4>
          {missing.map(([k, label]) => (
            <details key={k} className="sb-how cn-new-one" open={!list.length && k === 'slack'}>
              <summary><Icon name="chevron" size={11} />{label}</summary>
              <MakeShared platform={k} suggested={r.suggested} onMade={() => load()} />
            </details>
          ))}
        </section>
      )}
      {list.some((c) => !c.shared) && <h4 className="cn-own-head">{t('Bots\' Own Connections')}</h4>}
      {list.filter((c) => !c.shared).map((c) => <ConnectionCard key={c.id} c={c} reload={load} open={false} />)}
    </div>
  )
}

// A bot's line about where it answers on one platform (its Set Up): through the shared connection
// (with a way to give it its own), through its own (with Move to the shared one), or not yet (make
// the shared one here, or give it its own below).
export function BotReach({ d, platform, reload }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [moved, setMoved] = useState(null)
  const [suggested, setSuggested] = useState('')
  const via = d.connections?.[platform] || null
  const shared = d.shared?.[platform] || null
  const label = platName(platform)
  useEffect(() => { if (!via) api('/connections').then((x) => setSuggested(x.suggested || ''), () => {}) }, [via?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = async (path, after) => {
    setBusy(true)
    setNote(null)
    try { const x = await api(`/bots/${d.id}/${path}`, { method: 'POST', body: { platform } }); after?.(x); refreshBots(); reload() } catch (e) { setNote(e.message) }
    setBusy(false)
  }
  const s = platform === 'slack' ? { state: d.state } : d.where?.[platform] || {}
  const open = () => window.dispatchEvent(new CustomEvent('bridge-open-bot', { detail: { id: 'connections' } }))
  return (
    <section className="st-sec cn-reach" data-setting="bots-reach" data-platform={platform}>
      {via?.shared && (
        <>
          <p className="small"><Icon name="link" size={13} /> {t('Reached through {name}, your shared {platform} connection.', { name: via.name, platform: label })} <span className={`sb-dot ${STATE[s.state] || 'warn'}`} aria-hidden="true" /> <span className="muted">{s.state === 'connected' ? t('connected') : t('not connected')}</span></p>
          <p className="muted small">{platform === 'slack' ? t('People ask it with “{bot}: …” after @{name}, with {command}, or in a channel that goes to it. Its answers show its name.', { bot: d.name, name: via.name, command: d.command || '' }) : t('People ask it with “{bot}: …” after @{name}. Its answers show its name.', { bot: d.name, name: via.name })}</p>
          <div className="st-row">
            <button type="button" className="btn small" onClick={open}><Icon name="link" size={12} /> {t('Connections')}</button>
            <button type="button" className="ghost-btn" disabled={busy} onClick={() => go('own')}>{t('Give it its own connection')}</button>
          </div>
          <p className="muted small">{t('Its own connection is an app of its own on {platform}, for an identity of its own (a public support bot, say): you make that app once more, with the steps here.', { platform: label })}</p>
        </>
      )}
      {via && !via.shared && (
        <>
          <p className="small"><Icon name="link" size={13} /> {t('Its own {platform} connection: an app of its own, {name}.', { platform: label, name: via.name })}</p>
          {shared && (
            <div className="st-row">
              <button type="button" className="btn small" disabled={busy} onClick={() => { if (window.confirm(t('Move {bot} to {name}? Its own app\'s tokens are deleted here; delete that app on {platform} afterwards.', { bot: d.name, name: shared.name, platform: label }))) go('move', (x) => setMoved(x.moved)) }}>{t('Move to {name}', { name: shared.name })}</button>
              <span className="muted small">{t('Then it\'s reached through your shared connection, like your other bots.')}</span>
            </div>
          )}
        </>
      )}
      {!via && (
        <>
          <p className="small"><Icon name="info" size={13} /> {t('Not on {platform} yet.', { platform: label })}</p>
          <MakeShared platform={platform} suggested={suggested} onMade={() => reload()} />
          <p className="muted small">{t('Or give {bot} an app of its own on {platform}, with the steps below.', { bot: d.name, platform: label })}</p>
        </>
      )}
      {moved && <p className="st-note ok" role="status"><Icon name="check" size={13} /><span>{t('Moved to {to}. You can delete its old app, {from}, on {platform} now.', { to: moved.to, from: moved.from, platform: label })}</span></p>}
      {note && <p className="error-text small" role="alert">{note}</p>}
    </section>
  )
}
