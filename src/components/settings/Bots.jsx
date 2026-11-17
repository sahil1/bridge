import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import CopyButton from '../CopyButton.jsx'
import { api, apiUrl, onThisComputer } from '../../api.js'
import { ago } from '../Machines.jsx'
import { t } from '../../i18n/index.js'
import './bots.css'

// Settings › Bots (a beta feature, off to start; its id slack-bot): your own bots in Slack, Discord
// and Microsoft Teams (Where It Answers: each its own app there, with the name you give it, and the
// steps to make it). People you choose ask one by mentioning it, messaging
// it, replying in its threads, with its /command or the message shortcut, each question answered by
// an agent that can only read (server/frontdesk.js) and the answer waiting in Needs You, and in your
// Slack direct messages, for you to send, edit or discard. At the top, your bots and New Bot (from
// a template, or a bot exported elsewhere). For the one picked, four tabs:
//   Set Up: whether it's connected and, when it isn't, why (and when its Slack app needs the new
//     manifest); pausing it; its name and description, which are its name in Slack, and its export;
//     making the app (the manifest to paste, the two tokens) and connecting it; you in Slack (whose
//     direct messages its drafts go to); who may ask, and what anyone else gets; its instructions
//     (written here, or a file in one of its folders); the folders it reads from; changes (a draft
//     pull request, after you approve the diff or at once); the limits for each person; the channels
//     it answers in without a mention, and those it's muted in; how answers go, which agent answers,
//     and a note when that agent answers through a personal plan; and its scheduled posts.
//   Try It: a question asked here as someone would in Slack, its draft, what it read and its record,
//     with nothing sent to Slack.
//   Memory: what it has learned, about itself, each channel and each person, the learnings waiting
//     for you to keep, and whether they're kept straight away.
//   Activity: its record (server/trace.js): every conversation it took part in, each as a timeline,
//     with search, filters and export, and whether the record holds.
// A bot deleted keeps its record, unless you tick that it goes too: it's there under its name,
// marked deleted, to look at and export until the time it's kept for runs out, or you delete it.
// What must hold (who may ask, the folders, read-only, which agent, changes, limits) are settings
// here, enforced by Bridge AI; the instructions only steer. Changes only on the computer it runs on;
// elsewhere they're shown, not changed.

const STATE = {
  connected: 'ok', connecting: 'warn', reconnecting: 'warn', error: 'bad', 'no-tokens': 'warn', off: 'warn',
}
// Where a question was asked, as Slack shows it.
const placeOf = (p) => (p?.kind === 'dm' ? t('a direct message') : p?.kind === 'try' ? t('Try It') : p?.name ? `#${p.name}` : t('a channel'))
const saved = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v) } catch { /* private window */ } return null }
// A file's size, as people read it.
const sizeOf = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`)
// A bot's name as a branch's part: bot/pricing-desk/…
const slugOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bot'
// Words someone asked it to forget (!forget me): the record keeps that they said something.
const wordsOf = (s) => (s == null ? t('(their words were forgotten)') : s)

// ---------- What several sections pick from ----------
// The workspace's people, asked at most once a minute for each bot (Who Can Ask, You in Slack and
// Memory all pick from them); and the channels it's in (Channels, Scheduled Posts, Memory).
const cache = new Map() // `${kind}:${bot}` -> { at, p }
function cached(kind, id, ask, ttl = 60000) {
  const k = `${kind}:${id}`
  const hit = cache.get(k)
  if (hit && Date.now() - hit.at < ttl) return hit.p
  const p = ask()
  p.catch(() => cache.delete(k))
  cache.set(k, { at: Date.now(), p })
  return p
}
// (Connected anywhere: its Slack app, Discord bot or Teams app.)
const anyTokens = (d) => !!(d.tokens || d.where?.discord?.tokens || d.where?.teams?.tokens)
function usePeople(d) {
  const connected = anyTokens(d)
  const [people, setPeople] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!connected) return undefined
    let live = true
    cached('people', d.id, () => api(`/bots/${d.id}/people`).then((r) => r.people || [])).then((x) => { if (live) { setPeople(x); setError(null) } }, (e) => live && setError(e.message))
    return () => { live = false }
  }, [connected, d.id])
  return { people, error, connected }
}
function useChannels(d) {
  const connected = anyTokens(d)
  const [channels, setChannels] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    if (!connected) return undefined
    let live = true
    cached('channels', d.id, () => api(`/bots/${d.id}/channels`).then((r) => r.channels || []), 30000).then((x) => { if (live) { setChannels(x); setError(null) } }, (e) => live && setError(e.message))
    return () => { live = false }
  }, [connected, d.id])
  return { channels, error, connected }
}

// Someone from the workspace, by a word of their name: Who Can Ask, You in Slack.
function PeoplePicker({ people, skip = [], onPick, label, placeholder }) {
  const [q, setQ] = useState('')
  const found = useMemo(() => {
    const x = q.trim().toLowerCase()
    const have = new Set(skip)
    return x ? (people || []).filter((p) => !have.has(p.id) && `${p.name} ${p.detail || ''}`.toLowerCase().includes(x)).slice(0, 6) : []
  }, [q, people, skip.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="sb-pick">
      <label className="sb-search"><Icon name="search" size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={label} /></label>
      {found.length > 0 && (
        <ul className="sb-found" role="listbox" aria-label={t('People in your workspace')}>
          {found.map((p) => (
            <li key={p.id}><button type="button" role="option" aria-selected="false" onClick={() => { setQ(''); onPick(p) }}><span className="sb-av" aria-hidden="true">{(p.name || '?').slice(0, 1).toUpperCase()}</span><span className="sb-found-text"><b>{p.name} <PlatTag platform={p.platform} /></b>{p.detail && <span className="muted small">{p.detail}</span>}</span><Icon name="plus" size={12} /></button></li>
          ))}
        </ul>
      )}
      {q.trim() && people && !found.length && <p className="muted small">{t('Nobody else by that name.')}</p>}
    </div>
  )
}

// A row of names (people, channels), each with a way to take it off.
function Chips({ list, here, onDrop, dropLabel, hash = false }) {
  return (
    <ul className="sb-askers">
      {list.map((a) => (
        <li key={a.id}>
          <span className="sb-av" aria-hidden="true">{hash ? '#' : (a.name || '?').slice(0, 1).toUpperCase()}</span>
          <span className="sb-asker-name">{a.name || a.id} <PlatTag id={a.id} /></span>
          {here && <button type="button" className="icon-btn" onClick={() => onDrop(a)} aria-label={dropLabel(a)}><Icon name="x" size={12} /></button>}
        </li>
      ))}
    </ul>
  )
}

// ---------- Set Up ----------
function Status({ d, here, onAgain }) {
  const s = d.state
  const line = s === 'connected' ? t('Connected to {team} as @{bot}.', { team: d.team?.name || '', bot: d.bot?.name || '' })
    : s === 'connecting' ? t('Connecting to Slack…')
      : s === 'reconnecting' ? t('Not connected: {why}. Trying again by itself.', { why: d.why || t('the connection closed') })
        : s === 'error' ? t('Not connected: {why}.', { why: d.why || t('Slack turned it down') })
          : t('Not connected: your Slack app\'s two tokens aren\'t here yet. Make the app below, then paste them.')
  return (
    <div className="sb-status" data-setting="slack-status">
      <p className={`st-note ${STATE[s] || 'warn'}`} role="status">
        <Icon name={s === 'connected' ? 'check' : s === 'error' ? 'alert' : s === 'no-tokens' ? 'info' : 'refresh'} size={13} />
        <span className="sb-status-text">{line}</span>
        {(s === 'error' || s === 'reconnecting') && here && <button type="button" className="link-btn" onClick={onAgain}>{t('Connect again')}</button>}
      </p>
      <p className="muted small">{t('Through Socket Mode, from this computer: Slack is never reached through Bold Bridge or your relay. While this computer sleeps or Bridge AI is closed, questions wait in Slack and are answered once it\'s back, replies in its threads included.')}</p>
    </div>
  )
}

// Paused: nothing answers, and each question comes to you. Pausing stops what's running at once.
function Pause({ d, here, save }) {
  if (d.settings.paused) {
    return (
      <p className="st-note warn sb-paused" role="status" data-setting="slack-pause">
        <Icon name="pause" size={13} />
        <span>{t('Paused: nothing answers; each question goes to you, and the asker is told it\'s passed on.')}</span>
        {here && <button type="button" className="btn small" onClick={() => save({ paused: false })}><Icon name="play" size={12} /> {t('Resume')}</button>}
      </p>
    )
  }
  if (!here) return null
  return (
    <div className="st-row sb-pause" data-setting="slack-pause">
      <button type="button" className="ghost-btn" onClick={() => save({ paused: true })}><Icon name="pause" size={12} /> {t('Pause {bot}', { bot: d.name })}</button>
      <span className="muted small">{t('Stops any answer running now; questions come to you until you resume it.')}</span>
    </div>
  )
}

// What each scope a Slack app can lack lets the bot do (the server says it too, in English).
const SCOPE_FOR = () => ({
  'im:write': t('send you its drafts in a direct message'),
  'reactions:write': t('react to questions (👀, ✅, ⏳)'),
  'pins:read': t('read what\'s pinned in a channel'),
  'files:read': t('read files attached to a question'),
  'files:write': t('send files and long answers'),
  commands: t('answer its /command'),
  'assistant:write': t('show Slack\'s working status and Stop button'),
  'channels:history': t('follow replies in its threads'),
  'groups:history': t('follow replies in its threads in private channels'),
  'chat:write': t('post its answers'),
})

// An app made from an earlier manifest lacks scopes this one needs: which, what each is for, and how
// to update it.
function UpdateApp({ d, here, onAgain }) {
  const lacks = d.updateApp?.missing || d.scopes?.missing || []
  if (!d.tokens || !lacks.length) return null
  const json = JSON.stringify(d.manifest, null, 2)
  const said = new Map((d.updateApp?.needs || []).map((n) => [n.scope, n.for]))
  const why = SCOPE_FOR()
  return (
    <section className="st-sec sb-update" data-setting="slack-update">
      <h4><Icon name="alert" size={13} /> {t('Update Your Slack App')}</h4>
      <p className="small">{t('Your Slack app was made from an earlier manifest: it lacks {scopes}. Until it\'s updated, {bot} can\'t:', { scopes: lacks.join(', '), bot: d.name })}</p>
      <ul className="sb-needs small">
        {lacks.map((s) => <li key={s}>{why[s] || said.get(s) || s} <code>{s}</code></li>)}
      </ul>
      <p className="small">{t('The new manifest also turns on the Send, Edit and Discard buttons in your direct messages, {command}, the message shortcut and its Home tab.', { command: d.command || t('its /command') })}</p>
      <ol className="sb-steps">
        <li><span>{t('Copy the new manifest.')}</span><div className="st-row"><CopyButton text={json} label={t('Copy the manifest')} className="btn small" /></div></li>
        <li><span>{t('In your app\'s page on api.slack.com, open App Manifest, paste it over what\'s there, and Save Changes.')}</span></li>
        <li><span>{t('Reinstall it: Install App › Reinstall to Workspace › Allow. The tokens stay the same.')}</span></li>
        <li><span>{t('Then Connect again here.')}</span>{here && <div className="st-row"><button type="button" className="btn small" onClick={onAgain}><Icon name="refresh" size={12} /> {t('Connect again')}</button></div>}</li>
      </ol>
    </section>
  )
}

// Its name and description: its name in Slack, through the manifest. The icon is set in Slack. Its
// export, and deleting it.
function Identity({ d, here, save, onDelete }) {
  const [name, setName] = useState(d.name)
  const [about, setAbout] = useState(d.description || '')
  const [sure, setSure] = useState(false)
  const [history, setHistory] = useState(false) // its activity deleted too: only when you tick it
  useEffect(() => { setName(d.name) }, [d.name])
  useEffect(() => { setAbout(d.description || '') }, [d.description])
  return (
    <section className="st-sec" data-setting="slack-identity">
      <h4>{t('Name and Description')}</h4>
      <div className="sb-ident">
        <label className="sb-field"><span>{t('Name')}</span><input className="st-input" value={name} maxLength={35} disabled={!here} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== d.name) save({ name: name.trim() }); else setName(d.name) }} aria-label={t('Its name in Slack')} /></label>
        <label className="sb-field"><span>{t('Description')}</span><input className="st-input" value={about} maxLength={140} disabled={!here} placeholder={t('What it answers, in a line')} onChange={(e) => setAbout(e.target.value)} onBlur={() => { if (about.trim() !== (d.description || '')) save({ description: about.trim() }) }} /></label>
      </div>
      <p className="muted small">{t('Its name in Slack, from the manifest. An app made before a rename keeps its old name until you paste the new manifest under App Manifest. Slack\'s manifest can\'t carry an icon: add one in your app\'s page, Basic Information › Display Information › App icon.')}</p>
      {d.appId && <div className="st-row"><a className="btn small" href={`https://api.slack.com/apps/${encodeURIComponent(d.appId)}/general`} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> {t('Add an icon in Slack')}</a></div>}
      {here && (
        <div className="st-row sb-export-bot" data-setting="slack-export">
          <a className="ghost-btn" href={apiUrl(`/bots/${d.id}/bundle`)} download><Icon name="export" size={12} /> {t('Export {bot}', { bot: d.name })}</a>
          <span className="muted small">{t('A file with its instructions, memory and settings, to import on another computer (or in Docker); never its tokens.')}</span>
        </div>
      )}
      {here && (sure
        ? (
          <div className="st-row sb-sure" role="alert">
            <span className="small">{t('Delete {bot}: its tokens, settings and instructions? Its activity stays, to look at and export here, until the time its record is kept for runs out. Its Slack app stays in Slack until you delete it there.', { bot: d.name })}</span>
            <label className="st-check sb-full"><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /><span className="small">{t('Also delete its activity history')}</span></label>
            <button type="button" className="btn small danger" onClick={() => onDelete(history)}><Icon name="trash" size={12} /> {t('Delete {bot}', { bot: d.name })}</button>
            <button type="button" className="ghost-btn" onClick={() => { setSure(false); setHistory(false) }}>{t('Cancel')}</button>
          </div>
        )
        : <div className="st-row"><button type="button" className="ghost-btn danger" onClick={() => setSure(true)}><Icon name="trash" size={12} /> {t('Delete this bot…')}</button></div>)}
    </section>
  )
}

// Making the app and connecting it: the steps, the manifest, the two tokens.
function Connect({ d, here, reload }) {
  const [app, setApp] = useState('')
  const [bot, setBot] = useState('')
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [change, setChange] = useState(false)
  const json = JSON.stringify(d.manifest, null, 2)
  const create = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(d.manifest))}`
  const connect = async (e) => {
    e.preventDefault()
    setBusy('connect')
    setMsg(null)
    try { await api(`/bots/${d.id}/tokens`, { method: 'POST', body: { appToken: app, botToken: bot } }); setApp(''); setBot(''); setChange(false); setMsg({ ok: true, text: t('Connected. Pick who can ask, below.') }) } catch (err) { setMsg({ text: err.message }) }
    setBusy(null)
    reload()
  }
  const forget = async () => {
    setBusy('forget')
    try { await api(`/bots/${d.id}/tokens`, { method: 'DELETE' }); setMsg({ ok: true, text: t('Disconnected, and the tokens deleted from this computer.') }) } catch (err) { setMsg({ text: err.message }) }
    setBusy(null)
    reload()
  }
  // (Folded under How the app is made: the checklist above has the steps, a click at a time.)
  const steps = (
    <ol className="sb-steps">
      <li>
        <span>{t('Make the app: in Slack\'s app page, Create New App › From a manifest, pick your workspace and paste this manifest. It carries the name {bot}.', { bot: d.name })}</span>
        <div className="st-row">
          <a className="btn small" href={create} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> {t('Open Slack\'s app page')}</a>
          <CopyButton text={json} label={t('Copy the manifest')} className="btn small" />
        </div>
      </li>
      <li><span>{t('Give it an app-level token: Basic Information › App-Level Tokens › Generate Token and Scopes, add the scope connections:write, then copy the token (it starts with xapp-).')}</span></li>
      <li><span>{t('Install it: Install App › Install to Workspace › Allow, then copy the Bot User OAuth Token (it starts with xoxb-).')}</span></li>
      <li><span>{t('Paste both below and Connect.')}</span></li>
      <li><span>{t('Ask it: invite it to a channel (/invite @{bot}) and mention it there, send it a direct message, type {command}, or pick “{shortcut}” in a message\'s menu. A reply in a thread it answered in needs no mention.', { bot: d.bot?.name || d.name, command: d.command || t('its /command'), shortcut: d.shortcut || t('Ask about this') })}</span></li>
    </ol>
  )
  const form = (
    <form className="sb-tokens" onSubmit={connect} autoComplete="off">
      <label className="sb-field"><span>{t('App-level token')}</span><input className="st-input mono" type="password" value={app} onChange={(e) => setApp(e.target.value)} placeholder="xapp-…" disabled={!here} autoComplete="new-password" spellCheck={false} /></label>
      <label className="sb-field"><span>{t('Bot token')}</span><input className="st-input mono" type="password" value={bot} onChange={(e) => setBot(e.target.value)} placeholder="xoxb-…" disabled={!here} autoComplete="new-password" spellCheck={false} /></label>
      <div className="st-row">
        <button type="submit" className="btn small primary" disabled={!here || busy === 'connect' || !app.trim() || !bot.trim()}>{busy === 'connect' ? t('Connecting…') : t('Connect')}</button>
        {change && <button type="button" className="ghost-btn" onClick={() => setChange(false)}>{t('Cancel')}</button>}
      </div>
    </form>
  )
  return (
    <section className="st-sec" data-setting="slack-connect">
      <h4>{t('Your Slack App')}</h4>
      <p className="muted small">{t('Each bot is its own Slack app, made by you in your own workspace: no app is shared, and its tokens stay on this computer, readable by you only.')}</p>
      {d.tokens
        ? (
          <>
            <div className="sb-have">
              <span className="small"><span className="muted">{t('App-level token')}</span> <code>{d.tokens.app}</code></span>
              <span className="small"><span className="muted">{t('Bot token')}</span> <code>{d.tokens.bot}</code></span>
              {here && !change && <button type="button" className="ghost-btn" onClick={() => setChange(true)}>{t('Change tokens')}</button>}
              {here && <button type="button" className="ghost-btn danger" onClick={forget} disabled={busy === 'forget'}><Icon name="x" size={12} /> {t('Disconnect')}</button>}
            </div>
            {change && form}
          </>
        )
        : form}
      <details className="sb-manifest"><summary><Icon name="chevron" size={11} />{t('The manifest')}</summary><div className="st-row"><CopyButton text={json} label={t('Copy the manifest')} className="btn small" /></div><pre>{json}</pre></details>
      <details className="sb-how"><summary><Icon name="chevron" size={11} />{t('How the app is made')}</summary>{steps}</details>
      {!here && <p className="muted small">{t('Connect it in Bridge AI on the computer it runs on.')}</p>}
      {msg && <p className={`small ${msg.ok ? 'muted' : 'error-text'}`} role="status">{msg.text}</p>}
    </section>
  )
}

// You in Slack: which of the workspace's people is you, so its drafts and what it would like to
// remember come to your direct messages, with buttons to act on them from your phone; and so it
// knows you may always ask.
function Owner({ d, here, save }) {
  const { people, error, connected } = usePeople(d)
  const o = d.settings.owner
  const guess = !o && d.ownerGuess
  return (
    <section className="st-sec" data-setting="slack-owner">
      <h4>{t('You in Slack')}</h4>
      <p className="muted small">{t('Which person in {team} is you. {bot} sends you its drafts, and what it would like to remember, in a direct message with Send, Edit and Discard, so you can answer from your phone. You can always ask it, whatever Who Can Ask says.', { team: d.team?.name || t('your workspace'), bot: d.name })}</p>
      {o
        ? <Chips list={[o]} here={here} onDrop={() => save({ owner: null })} dropLabel={() => t('That isn\'t me')} />
        : <p className="small sb-none">{t('Not set: its drafts wait in Needs You only.')}</p>}
      {guess && here && (
        <div className="st-row sb-guess">
          <span className="small">{t('Is this you: {name}?', { name: guess.name })}</span>
          <button type="button" className="btn small" onClick={() => save({ owner: { id: guess.id, name: guess.name } })}><Icon name="check" size={12} /> {t('Yes, that\'s me')}</button>
        </div>
      )}
      {here && connected && !o && <PeoplePicker people={people} onPick={(p) => save({ owner: { id: p.id, name: p.name } })} label={t('Pick yourself')} placeholder={t('Find yourself in {team}', { team: d.team?.name || t('your workspace') })} />}
      {!connected && <p className="muted small">{t('Connect the app first to pick yourself from your workspace\'s people.')}</p>}
      {error && connected && !o && <p className="error-text small">{t('Couldn\'t list your workspace\'s people: {error}', { error })}</p>}
    </section>
  )
}

// ---------- Where it answers ----------
// Slack, Discord and Microsoft Teams: a bot answers in any of them at once, each through an app you
// make there. The names are the services' own (not translated).
const PLATFORMS = [['slack', 'Slack'], ['discord', 'Discord'], ['teams', 'Microsoft Teams']]
const platOfId = (id) => (/^discord:/.test(String(id || '')) ? 'discord' : /^teams:/.test(String(id || '')) ? 'teams' : 'slack')
const platName = (p) => (PLATFORMS.find(([k]) => k === p) || [])[1] || 'Slack'
// A small tag saying which a person or place is in, for those not in Slack.
const PlatTag = ({ id, platform }) => { const p = platform || platOfId(id); return p === 'slack' ? null : <span className={`sb-plat p-${p}`}>{platName(p)}</span> }
const stateOf = (d, p) => (p === 'slack' ? { state: d.state, why: d.why } : d.where?.[p] || { state: 'no-tokens' })

function Where({ d, at, pick }) {
  return (
    <section className="st-sec sb-where" data-setting="bots-where">
      <h4>{t('Where It Answers')}</h4>
      <p className="muted small">{t('{bot} can answer in Slack, Discord and Microsoft Teams at once, each through an app you make there. Who can ask, what it reads, its limits, memory and record are the same in all three.', { bot: d.name })}</p>
      <div className="seg sb-where-tabs" role="tablist" aria-label={t('Where It Answers')}>
        {PLATFORMS.map(([k, label]) => {
          const s = stateOf(d, k).state
          return (
            <button key={k} type="button" role="tab" aria-selected={at === k} className={at === k ? 'on' : ''} onClick={() => pick(k)} data-platform={k}>
              <span className={`sb-dot ${STATE[s] || 'warn'}`} aria-hidden="true" />
              {label}
              <span className="sb-sr">{s === 'connected' ? t('connected') : s === 'no-tokens' ? t('not set up') : t('not connected')}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

// A connection's line: connected to what, or why not, and a way to try again.
function PlatformStatus({ s, here, onAgain, connected, setUp, label }) {
  const st = s?.state || 'no-tokens'
  const line = st === 'connected' ? connected
    : st === 'connecting' ? t('Connecting to {platform}…', { platform: label })
      : st === 'reconnecting' ? t('Not connected: {why}. Trying again by itself.', { why: s.why || t('the connection closed') })
        : st === 'error' ? t('Not connected: {why}.', { why: s.why || t('{platform} turned it down', { platform: label }) })
          : setUp
  return (
    <p className={`st-note ${STATE[st] || 'warn'}`} role="status">
      <Icon name={st === 'connected' ? 'check' : st === 'error' ? 'alert' : st === 'no-tokens' ? 'info' : 'refresh'} size={13} />
      <span className="sb-status-text">{line}</span>
      {(st === 'error' || st === 'reconnecting') && here && <button type="button" className="link-btn" onClick={onAgain}>{t('Connect again')}</button>}
    </p>
  )
}

// You in Discord, or in Teams: which person there is you, so you may always ask there too.
function PlatformOwner({ d, here, save, platform }) {
  const { people, connected } = usePeople(d)
  const label = platName(platform)
  const o = d.settings.owners?.[platform] || null
  const mine = (people || []).filter((p) => p.platform === platform)
  return (
    <section className="st-sec" data-setting={`${platform}-owner`}>
      <h4>{platform === 'discord' ? t('You in Discord') : t('You in Teams')}</h4>
      <p className="muted small">{t('Which person in {platform} is you, so you can always ask {bot} there, whatever Who Can Ask says. Its drafts wait for you in Needs You.', { platform: label, bot: d.name })}</p>
      {o
        ? <Chips list={[o]} here={here} onDrop={() => save({ owners: { [platform]: null } })} dropLabel={() => t('That isn\'t me')} />
        : <p className="small sb-none">{t('Not set.')}</p>}
      {here && connected && !o && stateOf(d, platform).state === 'connected' && <PeoplePicker people={mine} onPick={(p) => save({ owners: { [platform]: { id: p.id, name: p.name } } })} label={t('Pick yourself')} placeholder={t('Find yourself in {platform}', { platform: label })} />}
    </section>
  )
}

// Discord: a bot of its own, made in Discord's Developer Portal, connecting from this computer.
function DiscordSetup({ d, here, save, reload, again }) {
  const s = d.where?.discord || { state: 'no-tokens' }
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [change, setChange] = useState(false)
  const run = async (key, fn, ok) => {
    setBusy(key)
    setMsg(null)
    try { await fn(); if (ok) setMsg({ ok: true, text: ok }) } catch (err) { setMsg({ text: err.message }) }
    setBusy(null)
    reload()
  }
  const connect = (e) => { e.preventDefault(); run('connect', async () => { await api(`/bots/${d.id}/discord`, { method: 'POST', body: { token } }); setToken(''); setChange(false) }, t('Connected. Add it to your server with the link below, then pick who can ask.')) }
  const forget = () => run('forget', () => api(`/bots/${d.id}/discord`, { method: 'DELETE' }), t('Disconnected, and its token deleted from this computer.'))
  const server = (gid) => run('server', () => api(`/bots/${d.id}/discord/server`, { method: 'POST', body: { guild: gid } }))
  const intents = s.intents || {}
  const steps = (
    <ol className="sb-steps">
      <li>
        <span>{t('Make the app: in Discord\'s Developer Portal, New Application, name it {bot}, then Create.', { bot: d.name })}</span>
        <div className="st-row"><a className="btn small" href="https://discord.com/developers/applications" target="_blank" rel="noreferrer"><Icon name="external" size={12} /> {t('Open the Developer Portal')}</a></div>
      </li>
      <li><span>{t('Give it a token: Bot › Reset Token › Yes, do it!, then copy the token.')}</span></li>
      <li><span>{t('On the same page, under Privileged Gateway Intents, turn on Message Content Intent (it can\'t read questions without it) and Server Members Intent (to pick people from your server), then Save Changes.')}</span></li>
      <li><span>{t('Paste the token below and Connect.')}</span></li>
      <li>
        <span>{t('Add it to your server: Add to Server, pick your server, then Authorize. It asks only to see channels and read their history, send messages, start threads and write in them, and react.')}</span>
        {s.invite ? <div className="st-row"><a className="btn small" href={s.invite} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> {t('Add to Server')}</a></div> : <span className="muted small">{t('(The link is here once it\'s connected.)')}</span>}
      </li>
      <li><span>{t('Ask it: mention @{bot} in a channel it can see, or send it a direct message. It answers in a thread it starts from the question; a reply in that thread needs no mention.', { bot: s.bot?.name || d.name })}</span></li>
    </ol>
  )
  const form = (
    <form className="sb-tokens" onSubmit={connect} autoComplete="off">
      <label className="sb-field"><span>{t('Bot token')}</span><input className="st-input mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={t('From Bot › Reset Token')} disabled={!here} autoComplete="new-password" spellCheck={false} /></label>
      <div className="st-row">
        <button type="submit" className="btn small primary" disabled={!here || busy === 'connect' || !token.trim()}>{busy === 'connect' ? t('Connecting…') : t('Connect')}</button>
        {change && <button type="button" className="ghost-btn" onClick={() => setChange(false)}>{t('Cancel')}</button>}
      </div>
    </form>
  )
  return (
    <>
      <section className="st-sec" data-setting="discord-connect">
        <h4>{t('Your Discord Bot')}</h4>
        <PlatformStatus s={s} here={here} onAgain={again} label="Discord"
          connected={s.guild ? t('Connected to {server} as @{bot}.', { server: s.guild.name, bot: s.bot?.name || '' }) : t('Connected as @{bot}, but not answering in a server yet: add it to yours with the link below.', { bot: s.bot?.name || '' })}
          setUp={t('Not connected: its Discord bot\'s token isn\'t here yet. Make the bot below, then paste it.')} />
        <p className="muted small">{t('It connects from this computer to Discord: nothing reaches this computer from the internet, and nothing goes through Bold Bridge or your relay. While this computer sleeps or Bridge AI is closed, nothing answers; once it\'s back, it reads what was asked in the last three days.')}</p>
        {intents.content === false && <p className="st-note bad"><Icon name="alert" size={13} /><span>{t('Message Content Intent is off, so it can\'t read questions: turn it on in the Developer Portal (your app › Bot › Privileged Gateway Intents), then Connect again.')}</span></p>}
        {intents.content && intents.members === false && <p className="st-note warn"><Icon name="info" size={13} /><span>{t('Server Members Intent is off, so only people who\'ve written to it can be picked under Who Can Ask. Turn it on in the same place to pick from everyone in your server.')}</span></p>}
        {(s.guilds || []).length > 1 && (
          <label className="sb-field sb-server"><span>{t('Answers in')}</span>
            <select className="st-input" value={s.guild?.id || ''} disabled={!here || busy === 'server'} onChange={(e) => e.target.value && server(e.target.value)}>
              {!s.guild && <option value="">{t('Pick its server…')}</option>}
              {s.guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}
        {s.guild && <p className="muted small">{t('Members of {server} are its people: anyone writing from another server, or directly without being in {server}, is from outside and never answered; nor is anyone still to pass the server\'s membership screening.', { server: s.guild.name })}</p>}
        {s.tokens
          ? (
            <>
              <div className="sb-have">
                <span className="small"><span className="muted">{t('Bot token')}</span> <code>{s.tokens.bot}</code></span>
                {here && !change && <button type="button" className="ghost-btn" onClick={() => setChange(true)}>{t('Change token')}</button>}
                {here && <button type="button" className="ghost-btn danger" onClick={forget} disabled={busy === 'forget'}><Icon name="x" size={12} /> {t('Disconnect')}</button>}
              </div>
              {change && form}
            </>
          )
          : form}
        <details className="sb-how"><summary><Icon name="chevron" size={11} />{t('How the bot is made')}</summary>{steps}</details>
        {!here && <p className="muted small">{t('Connect it in Bridge AI on the computer it runs on.')}</p>}
        {msg && <p className={`small ${msg.ok ? 'muted' : 'error-text'}`} role="status">{msg.text}</p>}
      </section>
      <PlatformOwner d={d} here={here} save={save} platform="discord" />
    </>
  )
}

// Microsoft Teams: an Azure Bot of yours, reached through a tunnel of yours to this computer, and the
// Teams app made here to upload.
function TeamsSetup({ d, here, save, reload, again }) {
  const s = d.where?.teams || { state: 'no-tokens' }
  const [app, setApp] = useState('')
  const [tenant, setTenant] = useState('')
  const [secret, setSecret] = useState('')
  const [tunnel, setTunnel] = useState(s.endpoint?.url ? s.endpoint.url.replace(/\/api\/messages$/, '') : '')
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [change, setChange] = useState(false)
  useEffect(() => { if (s.endpoint?.url) setTunnel(s.endpoint.url.replace(/\/api\/messages$/, '')) }, [s.endpoint?.url])
  const run = async (key, fn, ok) => {
    setBusy(key)
    setMsg(null)
    try { await fn(); if (ok) setMsg({ key, ok: true, text: ok }) } catch (err) { setMsg({ key, text: err.message }) }
    setBusy(null)
    reload()
  }
  const port = s.port || 3978
  const endpoint = s.endpoint?.url || null
  const connect = (e) => { e.preventDefault(); run('connect', async () => { await api(`/bots/${d.id}/teams`, { method: 'POST', body: { appId: app, tenantId: tenant, password: secret } }); setSecret(''); setChange(false) }, t('Connected: signed in to Microsoft as its Azure Bot. Now the tunnel, below.')) }
  const keepTunnel = (e) => { e.preventDefault(); run('tunnel', () => api(`/bots/${d.id}/teams/endpoint`, { method: 'POST', body: { publicUrl: tunnel } })) }
  const check = () => run('check', () => api(`/bots/${d.id}/teams/check`, { method: 'POST' }))
  const forget = () => run('forget', () => api(`/bots/${d.id}/teams`, { method: 'DELETE' }), t('Disconnected, and its client secret deleted from this computer.'))
  const cloudflared = `cloudflared tunnel --url http://localhost:${port}`
  const devtunnel = `devtunnel host -p ${port} --allow-anonymous`
  const form = (
    <form className="sb-tokens" onSubmit={connect} autoComplete="off">
      <label className="sb-field"><span>{t('Microsoft App ID')}</span><input className="st-input mono" value={app} onChange={(e) => setApp(e.target.value)} placeholder="1a2b3c4d-…" disabled={!here} spellCheck={false} /></label>
      <label className="sb-field"><span>{t('App Tenant ID')}</span><input className="st-input mono" value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="5e6f7a8b-…" disabled={!here} spellCheck={false} /></label>
      <label className="sb-field"><span>{t('Client secret')}</span><input className="st-input mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t('Its Value, not its Secret ID')} disabled={!here} autoComplete="new-password" spellCheck={false} /></label>
      <div className="st-row">
        <button type="submit" className="btn small primary" disabled={!here || busy === 'connect' || !app.trim() || !tenant.trim() || !secret.trim()}>{busy === 'connect' ? t('Connecting…') : t('Connect')}</button>
        {change && <button type="button" className="ghost-btn" onClick={() => setChange(false)}>{t('Cancel')}</button>}
      </div>
    </form>
  )
  const steps = (
    <ol className="sb-steps">
      <li>
        <span>{t('Make an Azure Bot: in the Azure portal, Create a resource › Azure Bot. Name it {bot}, pick Single Tenant and Create new Microsoft App ID, then Create.', { bot: d.name })}</span>
        <div className="st-row"><a className="btn small" href="https://portal.azure.com/#create/Microsoft.AzureBot" target="_blank" rel="noreferrer"><Icon name="external" size={12} /> {t('Open the Azure portal')}</a></div>
      </li>
      <li><span>{t('On the bot\'s Configuration page, copy the Microsoft App ID and the App Tenant ID. Then Manage Password › Certificates & secrets › New client secret › Add, and copy its Value (not its Secret ID).')}</span></li>
      <li><span>{t('Paste the three below and Connect.')}</span>{!s.tokens && form}</li>
      <li>
        <span>{t('Make this computer reachable for Teams with a tunnel of your own, to port {port}: with Cloudflare, or with Microsoft\'s dev tunnels. Run one of these on this computer, paste the https address it shows below, and Check.', { port })}</span>
        <div className="sb-cmds">
          <span className="sb-cmd"><code>{cloudflared}</code><CopyButton text={cloudflared} label={t('Copy')} className="ghost-btn" /></span>
          <span className="sb-cmd"><code>{devtunnel}</code><CopyButton text={devtunnel} label={t('Copy')} className="ghost-btn" /></span>
        </div>
        <span className="muted small">{t('A quick tunnel\'s address changes each time it starts: paste the new one here, and in Azure. A named tunnel keeps its address.')}</span>
        <form className="sb-tunnel" onSubmit={keepTunnel}>
          <label className="sb-field"><span>{t('Your tunnel\'s address')}</span><input className="st-input mono" value={tunnel} onChange={(e) => setTunnel(e.target.value)} placeholder="https://…trycloudflare.com" disabled={!here} spellCheck={false} /></label>
          <div className="st-row">
            <button type="submit" className="btn small" disabled={!here || busy === 'tunnel' || !tunnel.trim() || `${tunnel.trim().replace(/\/+$/, '')}/api/messages` === endpoint}>{t('Save')}</button>
            <button type="button" className="btn small" disabled={!here || busy === 'check' || !endpoint || s.state !== 'connected'} onClick={check}>{busy === 'check' ? t('Checking…') : t('Check')}</button>
          </div>
        </form>
        {s.endpoint?.at && (s.endpoint.ok
          ? <p className="st-note ok sb-endpoint" role="status"><Icon name="check" size={13} /><span>{t('Your tunnel reaches it.')}</span></p>
          : <p className="st-note bad sb-endpoint" role="status"><Icon name="alert" size={13} /><span>{s.endpoint.why}</span></p>)}
      </li>
      <li>
        <span>{t('Back on the Azure Bot\'s Configuration page, set Messaging endpoint to this address and Apply. Then Channels › Microsoft Teams › Apply.')}</span>
        {endpoint ? <span className="sb-cmd"><code>{endpoint}</code><CopyButton text={endpoint} label={t('Copy')} className="ghost-btn" /></span> : <span className="muted small">{t('(Your tunnel\'s address, with /api/messages after it, once it\'s saved above.)')}</span>}
      </li>
      <li>
        <span>{t('Download its Teams app and add it to Teams: Apps › Manage your apps › Upload an app › Upload a custom app. Your Teams admin may need to allow custom apps first.')}</span>
        {s.app && here ? <div className="st-row"><a className="btn small" href={apiUrl(`/bots/${d.id}/teams/app.zip`)} download><Icon name="download" size={12} /> {t('Download the Teams app')}</a></div> : <span className="muted small">{t('(Once it\'s connected.)')}</span>}
      </li>
      <li><span>{t('Ask it: add it to a team or a group chat and mention @{bot}, or message it directly. A reply in a thread it answered in needs no mention.', { bot: d.name })}</span></li>
    </ol>
  )
  return (
    <>
      <section className="st-sec" data-setting="teams-connect">
        <h4>{t('Your Teams App')}</h4>
        <PlatformStatus s={s} here={here} onAgain={again} label="Microsoft Teams"
          connected={t('Signed in to Microsoft as its Azure Bot, and listening on this computer at port {port}.', { port })}
          setUp={t('Not connected: its Azure Bot\'s app ID, tenant and client secret aren\'t here yet. Make the bot below, then paste them.')} />
        {s.state === 'connected' && <p className="small muted sb-heard">{s.lastEvent ? t('Last heard from Teams {when}.', { when: ago(s.lastEvent) }) : t('Nothing from Teams yet: once your tunnel runs and the messaging endpoint is set in Azure, mention it in Teams.')}</p>}
        {s.rejected?.n > 0 && <p className="st-note warn sb-rejected"><Icon name="alert" size={13} /><span>{t('{n} messages to it were turned away, not signed by Microsoft for this bot. The last: {why}.', { n: s.rejected.n, why: s.rejected.why })}</span></p>}
        <p className="muted small">{t('Teams reaches a bot only from the internet, so it listens on this computer at one address, with nothing else of Bridge AI behind it, and you make that reachable with a tunnel of your own; never through Bold Bridge or your relay. Each message is checked as signed by Microsoft for this bot before anything else. Teams reaches it only while Bridge AI runs and your tunnel is up: what\'s asked meanwhile doesn\'t reach it.')}</p>
        {s.tokens && (
          <div className="sb-have">
            <span className="small"><span className="muted">{t('Microsoft App ID')}</span> <code>{s.app?.id}</code></span>
            <span className="small"><span className="muted">{t('Client secret')}</span> <code>{s.tokens.secret}</code></span>
            {here && !change && <button type="button" className="ghost-btn" onClick={() => setChange(true)}>{t('Change')}</button>}
            {here && <button type="button" className="ghost-btn danger" onClick={forget} disabled={busy === 'forget'}><Icon name="x" size={12} /> {t('Disconnect')}</button>}
          </div>
        )}
        {s.tokens && change && form}
        {s.tokens ? <details className="sb-how" open={!s.lastEvent}><summary><Icon name="chevron" size={11} />{t('How the bot is made')}</summary>{steps}</details> : steps}
        {!here && <p className="muted small">{t('Connect it in Bridge AI on the computer it runs on.')}</p>}
        {msg && <p className={`small ${msg.ok ? 'muted' : 'error-text'}`} role="status">{msg.text}</p>}
      </section>
      <PlatformOwner d={d} here={here} save={save} platform="teams" />
    </>
  )
}

// ---------- Set up, step by step ----------
// For each place it answers, the steps from a new bot to its first answer, each ticked by itself
// from how things stand (its tokens, its connection, you there, where it's been asked, an answer
// sent): the clicks on the platform's own site, a button to the page where there is one, and what
// to do when a step doesn't work. Once every step is done it folds away to a line, with How to set
// up to see it again.
const slackCreate = (d) => `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(d.manifest || {}))}`
function stepsFor(d, p) {
  const bot = d.bot?.name || d.name
  const reached = d.reached?.[p] || {}
  const made = { title: t('Make the bot'), done: true }
  const answered = { title: t('Its first answer'), done: !!reached.answered, body: t('Mention @{bot} with a question. Its draft waits in Needs You: send it, and this step is done.', { bot }), fails: t('Nothing came? Activity says what happened to each question, and why.') }
  const connected = (done, fails) => ({ title: t('Connected'), done, body: t('It connects by itself once it has what it needs, and says so below.'), fails })
  if (p === 'slack') {
    return [
      made,
      { title: t('Create its Slack app'), done: !!(d.tokens || d.appId), body: t('Open Slack\'s app page: the manifest comes filled in with the name {bot}. Pick your workspace, then Create.', { bot: d.name }), button: { label: t('Open Slack\'s app page'), href: slackCreate(d) }, fails: t('Slack says the manifest isn\'t valid? Copy it from The manifest, under Your Slack App, and paste it under Create New App › From a manifest.') },
      { title: t('Paste its two tokens'), done: !!d.tokens, body: t('In your app\'s page: Basic Information › App-Level Tokens › Generate Token and Scopes, add the scope connections:write, and copy the token (xapp-…). Then Install App › Install to Workspace › Allow, and copy the Bot User OAuth Token (xoxb-…). Paste both under Your Slack App, below, and Connect.'), fails: t('A token turned down is said under Your Slack App, with Slack\'s reason: copy it again, whole. The app-level token needs the scope connections:write.') },
      connected(d.state === 'connected', t('It says why it isn\'t connected: do what it says (turn on Socket Mode for the app, or reinstall it), then Connect again.')),
      { title: t('You in Slack'), done: !!d.settings.owner, body: t('Under You in Slack, pick yourself: its drafts come to your Slack direct messages, and you can always ask it.'), fails: t('Nobody to pick? It lists your workspace\'s people once it\'s connected.') },
      { title: t('Invite it to a channel, or message it'), done: !!(d.where?.slack?.channels || reached.asked), body: t('In a channel, type /invite @{bot}; or send it a direct message.', { bot }), fails: t('Slack won\'t add it? The app has to be installed in that workspace (step 3).') },
      answered,
    ]
  }
  if (p === 'discord') {
    const s = d.where?.discord || {}
    return [
      made,
      { title: t('Create its Discord app'), done: !!s.tokens, body: t('In Discord\'s Developer Portal: New Application, name it {bot}, then Create.', { bot: d.name }), button: { label: t('Open the Developer Portal'), href: 'https://discord.com/developers/applications' }, fails: t('Sign in to the Developer Portal with your Discord account first.') },
      { title: t('Paste its token'), done: !!s.tokens, body: t('Bot › Reset Token › Yes, do it!, and copy the token. On the same page, under Privileged Gateway Intents, turn on Message Content Intent and Server Members Intent, then Save Changes. Paste the token under Your Discord Bot, below, and Connect.'), fails: t('Turned down? Reset the token again and paste the new one, whole: Discord shows each token only once.') },
      connected(s.state === 'connected', t('Message Content Intent off, or a token turned down, is said below: put it right in the Developer Portal, then Connect again.')),
      { title: t('You in Discord'), done: !!d.settings.owners?.discord, body: t('Under You in Discord, pick yourself, so you can always ask it there.'), fails: t('Nobody to pick? It lists your server\'s people once it\'s in your server.') },
      { title: t('Add it to your server'), done: !!(s.guild || reached.asked), body: t('Add to Server, pick your server, then Authorize. Then mention it in a channel it can see, or message it directly.'), ...(s.invite ? { button: { label: t('Add to Server'), href: s.invite } } : {}), fails: t('Your server isn\'t in the list? You need Manage Server there, or someone who has it can add it with the same link.') },
      answered,
    ]
  }
  const s = d.where?.teams || {}
  return [
    made,
    { title: t('Create its Azure Bot'), done: !!s.tokens, body: t('Make an Azure Bot: in the Azure portal, Create a resource › Azure Bot. Name it {bot}, pick Single Tenant and Create new Microsoft App ID, then Create.', { bot: d.name }), button: { label: t('Open the Azure portal'), href: 'https://portal.azure.com/#create/Microsoft.AzureBot' }, fails: t('Azure asks for a subscription first; the Azure Bot\'s free tier (F0) is enough.') },
    { title: t('Paste its IDs and secret'), done: !!s.tokens, body: `${t('On the bot\'s Configuration page, copy the Microsoft App ID and the App Tenant ID. Then Manage Password › Certificates & secrets › New client secret › Add, and copy its Value (not its Secret ID).')} ${t('Paste the three below and Connect.')}`, fails: t('Turned down? Copy the secret\'s Value, not its Secret ID; an expired secret needs a new one.') },
    { title: t('Reachable from Teams'), done: s.state === 'connected' && !!(s.endpoint?.ok || s.lastEvent), body: t('Run a tunnel of your own to port {port}, paste its address under Your Teams App and Check. Then set the Azure Bot\'s Messaging endpoint to the address shown there, and Channels › Microsoft Teams › Apply.', { port: s.port || 3978 }), fails: t('Check says it isn\'t reached? Start the tunnel again (a quick tunnel\'s address changes each time), then paste the new address here and in Azure.') },
    { title: t('You in Teams'), done: !!d.settings.owners?.teams, body: t('Under You in Teams, pick yourself, so you can always ask it there.'), fails: t('Nobody to pick? It lists the people of the teams and chats it\'s in, once it\'s been added to one.') },
    { title: t('Add it to Teams'), done: !!(s.lastEvent || reached.asked), body: t('Download its Teams app and add it to Teams: Apps › Manage your apps › Upload an app › Upload a custom app. Your Teams admin may need to allow custom apps first.'), ...(s.app ? { button: { label: t('Download the Teams app'), href: apiUrl(`/bots/${d.id}/teams/app.zip`), download: true } } : {}), fails: t('No Upload a custom app? Your Teams admin allows custom apps in the Teams admin center (Teams apps › Setup policies).') },
    answered,
  ]
}
function Guide({ d, platform, here }) {
  const steps = stepsFor(d, platform)
  const n = steps.filter((s) => s.done).length
  const all = n === steps.length
  const key = `cc-bot-guide-${d.id}-${platform}`
  const [open, setOpen] = useState(() => saved(key) === 'open')
  const label = platName(platform)
  if (all && !open) {
    return (
      <p className="small sb-guide-done" data-setting={`${platform}-guide`}>
        <Icon name="check" size={13} />
        <span>{t('{bot} is set up in {platform}.', { bot: d.name, platform: label })}</span>
        <button type="button" className="link-btn" onClick={() => { setOpen(true); saved(key, 'open') }}>{t('How to set up')}</button>
      </p>
    )
  }
  return (
    <section className="st-sec sb-guide" data-setting={`${platform}-guide`}>
      <h4>{t('Set Up in {platform}', { platform: label })}</h4>
      <p className="muted small">{t('{n} of {total} done. Each step ticks itself once it\'s done.', { n, total: steps.length })}</p>
      <ol className="sb-guide-list">
        {steps.map((s, i) => (
          <li key={i} className={s.done ? 'g-done' : ''}>
            <span className="sb-tick" aria-hidden="true">{s.done ? <Icon name="check" size={11} /> : i + 1}</span>
            <div className="sb-guide-step">
              <b className="small">{s.title}{s.done && <span className="sb-sr"> ({t('done')})</span>}</b>
              {!s.done && s.body && <span className="small">{s.body}</span>}
              {!s.done && s.button && here && (
                <div className="st-row">
                  <a className="btn small" href={s.button.href} {...(s.button.download ? { download: true } : { target: '_blank', rel: 'noreferrer' })}><Icon name={s.button.download ? 'download' : 'external'} size={12} /> {s.button.label}</a>
                </div>
              )}
              {!s.done && s.fails && <span className="muted small sb-guide-fail">{t('If it doesn\'t work: {what}', { what: s.fails })}</span>}
            </div>
          </li>
        ))}
      </ol>
      {all && <button type="button" className="link-btn" onClick={() => { setOpen(false); saved(key, '') }}>{t('Fold it away')}</button>}
    </section>
  )
}

// Settings › Bots before there's a bot: what one is, in two lines, and where to start.
function FirstBot({ here, onStart }) {
  return (
    <div className="sb-first" data-setting="bots-first">
      <p className="small">{t('A bot answers people for you in Slack, Discord or Microsoft Teams, with the name you give it, from folders on this computer that you choose.')}</p>
      <p className="muted small">{t('Each answer waits for you to send unless you say otherwise, and everything it does is kept here, in its Activity.')}</p>
      {here
        ? <div className="st-row"><button type="button" className="btn small primary" onClick={onStart}><Icon name="plus" size={12} /> {t('Set up your first bot')}</button></div>
        : <p className="muted small">{t('Make one in Bridge AI on the computer it runs on.')}</p>}
    </div>
  )
}

// Who may ask: people picked from the workspace by name, or everyone in the channels it's in; never
// guests or people from other companies. The people named are also the only ones (with you) who may
// ask for a change. And what anyone else gets.
function Askers({ d, here, save }) {
  const { people, error, connected } = usePeople(d)
  const s = d.settings
  const askers = s.askers
  const add = (p) => save({ askers: [...askers, { id: p.id, name: p.name }] })
  const drop = (a) => save({ askers: askers.filter((x) => x.id !== a.id) })
  const everyone = s.who === 'channels'
  return (
    <section className="st-sec" data-setting="slack-askers">
      <h4>{t('Who Can Ask')}</h4>
      <div className="sb-modes" role="radiogroup" aria-label={t('Who Can Ask')}>
        <label className={`sb-mode ${s.who === 'named' ? 'on' : ''}`}>
          <input type="radio" name={`sb-who-${d.id}`} checked={s.who === 'named'} disabled={!here} onChange={() => save({ who: 'named' })} />
          <span><b>{t('People you name')}</b><span className="muted small">{t('Only the people you add here get answers, wherever they ask.')}</span></span>
        </label>
        <label className={`sb-mode ${everyone ? 'on' : ''}`}>
          <input type="radio" name={`sb-who-${d.id}`} checked={everyone} disabled={!here} onChange={() => save({ who: 'channels' })} />
          <span><b>{t('Everyone in channels it\'s invited to')}</b><span className="muted small">{t('Anyone in your workspace who mentions it in a channel it\'s in, or messages it directly.')}</span></span>
        </label>
      </div>
      <p className="muted small">{t('Guests and people from other companies (in channels shared through Slack Connect) are never answered, either way.')} {t('Nor, in Discord, anyone outside its server or still to pass its screening, or, in Teams, guests and people from other organizations.')}</p>
      {everyone
        ? <p className="small"><b>{t('People you name')}</b> <span className="muted">{t('Anyone in its channels can ask; only the people named here, and you, can ask it for a change.')}</span></p>
        : s.changes && s.changes !== 'none' && <p className="muted small">{t('The people named here, and you, can also ask it for a change.')}</p>}
      {askers.length > 0
        ? <Chips list={askers} here={here} onDrop={drop} dropLabel={(a) => t('Remove {name}', { name: a.name || a.id })} />
        : <p className="small sb-none">{everyone ? t('Nobody named: only you can ask it for a change.') : t('Nobody yet: until you add someone, every question gets what anyone else gets.')}</p>}
      {here && connected && <PeoplePicker people={people} skip={askers.map((a) => a.id)} onPick={add} label={t('Add someone who can ask')} placeholder={t('Add someone from {team}', { team: d.team?.name || t('your workspace') })} />}
      {!connected && <p className="muted small">{t('Connect the app first to pick from your workspace\'s people.')}</p>}
      {error && <p className="error-text small">{t('Couldn\'t list your workspace\'s people: {error}', { error })}</p>}
      <div className="st-row sb-others">
        <span className="small">{t('Anyone else who asks gets')}</span>
        <div className="seg" role="radiogroup" aria-label={t('Anyone else who asks gets')}>
          <button type="button" role="radio" aria-checked={s.others === 'polite'} className={s.others === 'polite' ? 'on' : ''} disabled={!here} onClick={() => save({ others: 'polite' })}>{t('A polite no')}</button>
          <button type="button" role="radio" aria-checked={s.others === 'silent'} className={s.others === 'silent' ? 'on' : ''} disabled={!here} onClick={() => save({ others: 'silent' })}>{t('No reply')}</button>
        </div>
      </div>
    </section>
  )
}

// Its instructions: what it's for, how it answers, what it declines. Written here (saved as a file in
// Bridge AI's folder), or a file in one of its folders, read fresh for each question.
function Instructions({ d, here, save }) {
  const [text, setText] = useState(d.instructions.text)
  const [file, setFile] = useState(d.settings.instructionsFile || '')
  const [useFile, setUseFile] = useState(!!d.settings.instructionsFile)
  const typed = useRef(false)
  useEffect(() => { if (!typed.current) setText(d.instructions.text) }, [d.instructions.text])
  useEffect(() => { setFile(d.settings.instructionsFile || ''); setUseFile(!!d.settings.instructionsFile) }, [d.settings.instructionsFile])
  const keep = async () => { if (text !== d.instructions.text) await save({ instructions: text }); typed.current = false }
  return (
    <section className="st-sec" data-setting="slack-instructions">
      <h4>{t('Instructions')}</h4>
      <p className="muted small">{t('What it\'s for, how it answers and what it declines, in plain words (Markdown). They steer its answers; they can\'t widen what it may do, which the settings here decide.')}</p>
      <div className="sb-modes" role="radiogroup" aria-label={t('Instructions')}>
        <label className={`sb-mode ${!useFile ? 'on' : ''}`}>
          <input type="radio" name={`sb-ins-${d.id}`} checked={!useFile} disabled={!here} onChange={() => { setUseFile(false); if (d.settings.instructionsFile) save({ instructionsFile: null }) }} />
          <span><b>{t('Written here')}</b></span>
        </label>
        <label className={`sb-mode ${useFile ? 'on' : ''}`}>
          <input type="radio" name={`sb-ins-${d.id}`} checked={useFile} disabled={!here} onChange={() => setUseFile(true)} />
          <span><b>{t('Use this file instead')}</b><span className="muted small">{t('A file in one of the folders it reads from, such as BOT.md, read fresh for each question. Anyone who can change that file changes how it answers, not what it may do.')}</span></span>
        </label>
      </div>
      {useFile
        ? (
          <form className="sb-add" onSubmit={(e) => { e.preventDefault(); save({ instructionsFile: file.trim() }) }}>
            <input className="st-input mono" value={file} onChange={(e) => setFile(e.target.value)} placeholder="~/code/BOT.md" aria-label={t('The instructions file')} disabled={!here} spellCheck={false} />
            {here && <button type="submit" className="btn small" disabled={!file.trim() || file.trim() === d.settings.instructionsFile}>{t('Use it')}</button>}
            {d.instructions.file && !d.instructions.file.ok && <p className="error-text small sb-full">{d.instructions.file.problem}</p>}
          </form>
        )
        : <textarea className="st-input sb-ins" value={text} rows={Math.min(14, Math.max(5, text.split('\n').length + 1))} disabled={!here} onChange={(e) => { typed.current = true; setText(e.target.value) }} onBlur={keep} aria-label={t('Its instructions')} spellCheck />}
    </section>
  )
}

// The folders it reads from: an agent that can only read, kept to them (with Claude Code).
function ReadsFrom({ d, here, save }) {
  const [where, setWhere] = useState('')
  const pickFolder = window.bridgeApp?.pickFolder
  const list = d.folders || []
  const add = async (e) => {
    e.preventDefault()
    const ok = await save({ readsFrom: [...d.settings.readsFrom, where.trim()] })
    if (ok) setWhere('')
  }
  const drop = (f) => save({ readsFrom: d.settings.readsFrom.filter((x, i) => list[i] !== f) })
  return (
    <section className="st-sec" data-setting="slack-folders">
      <h4>{t('Reads From')}</h4>
      <p className="muted small">{t('Every question is answered by one agent that can read all of these, and only these: it can\'t change files, run commands or send anything.')}</p>
      {list.length > 0 && (
        <ul className="sb-folders">
          {list.map((f) => (
            <li key={f.path} className={f.ok ? '' : 'bad'}>
              <Icon name="folder" size={14} />
              <div className="sb-folder-text">
                <code title={f.path}>{f.shown}</code>
                {!f.ok && <span className="error-text small">{f.problem}</span>}
              </div>
              {here && <button type="button" className="icon-btn" onClick={() => drop(f)} aria-label={t('Stop reading from {folder}', { folder: f.name })}><Icon name="x" size={12} /></button>}
            </li>
          ))}
        </ul>
      )}
      {!list.length && <p className="small sb-none">{t('None yet: it answers from what the model knows, in an empty folder of its own.')}</p>}
      {here && (
        <form className="sb-add" onSubmit={add}>
          <input className="st-input mono" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="~/code" aria-label={t('Folder')} spellCheck={false} />
          {pickFolder && <button type="button" className="btn small" onClick={async () => { const p = await pickFolder().catch(() => null); if (p) setWhere(p) }}>{t('Choose…')}</button>}
          <button type="submit" className="btn small" disabled={!where.trim()}><Icon name="plus" size={12} /> {t('Read from it')}</button>
        </form>
      )}
    </section>
  )
}

// Changes: none, a diff you approve before a draft pull request opens, or a draft pull request at
// once. The agent edits only its own copy (a git worktree), and Bridge AI does the git and GitHub
// part with your own gh. Only the people named, and you, may ask for one.
function Changes({ d, here, save }) {
  const s = d.settings
  const c = d.changes || {}
  const repos = c.repos || []
  const can = c.agentOk !== false && repos.some((r) => r.ok)
  const modes = [
    ['none', t('No changes'), t('It only answers.')],
    ['suggest', t('Suggest a change'), t('You approve the diff first, then a draft pull request opens.')],
    ['pr', t('Open a draft pull request'), t('A draft pull request opens at once, for you to review on GitHub.')],
  ]
  const on = s.changes && s.changes !== 'none'
  return (
    <section className="st-sec" data-setting="slack-changes">
      <h4>{t('Changes')}</h4>
      <p className="muted small">{t('When someone asks for a change, its agent edits only its own copy of the repository (a git worktree), with no commands and no network. Bridge AI, not the agent, commits, pushes a branch named bot/{bot}/… and opens a draft pull request with your own gh sign-in. It never merges, and never writes to the default branch.', { bot: slugOf(d.name) })}</p>
      <div className="sb-modes" role="radiogroup" aria-label={t('Changes')}>
        {modes.map(([k, label, about]) => (
          <label key={k} className={`sb-mode ${(s.changes || 'none') === k ? 'on' : ''}`}>
            <input type="radio" name={`sb-changes-${d.id}`} checked={(s.changes || 'none') === k} disabled={!here || (k !== 'none' && !can)} onChange={() => save({ changes: k })} />
            <span><b>{label}</b><span className="muted small">{about}</span></span>
          </label>
        ))}
      </div>
      {repos.length > 1 && (
        <label className="sb-field sb-repo">
          <span>{t('In the repository')}</span>
          <select className="st-input" value={c.repo || ''} disabled={!here} onChange={(e) => save({ repo: e.target.value || null })}>
            {repos.map((r) => <option key={r.path} value={r.path} disabled={!r.ok}>{r.shown || r.path}</option>)}
          </select>
        </label>
      )}
      {repos.length === 1 && <p className="small">{t('In the repository {repo}.', { repo: repos[0].shown || repos[0].path })}</p>}
      {c.problem && <p className={`small ${on ? 'error-text' : 'muted'}`}>{c.problem}</p>}
      {on && c.gh === false && <p className="error-text small">{t('GitHub\'s gh isn\'t installed here, so no pull request can open: install it, and sign in with gh auth login.')}</p>}
      <p className="muted small">{t('Only the people you named under Who Can Ask, and you, can ask for one; anyone else gets an answer only.')}</p>
    </section>
  )
}

// The limits for each person who asks: questions a day, at once, and how long a run may take. You
// aren't limited.
const LIMITS = () => [['day', t('Questions a day'), 1, 1000], ['atOnce', t('At once'), 1, 5], ['minutes', t('Minutes a run'), 1, 60]]
function Limits({ d, here, save }) {
  const l = d.settings.limits || { day: 30, atOnce: 2, minutes: 10 }
  const [v, setV] = useState(l)
  useEffect(() => { setV(l) }, [l.day, l.atOnce, l.minutes]) // eslint-disable-line react-hooks/exhaustive-deps
  const keep = () => {
    const next = Object.fromEntries(LIMITS().map(([k]) => [k, Math.round(Number(v[k])) || l[k]]))
    if (LIMITS().some(([k]) => next[k] !== l[k])) save({ limits: next })
    else setV(l)
  }
  return (
    <section className="st-sec" data-setting="slack-limits">
      <h4>{t('Limits')}</h4>
      <p className="muted small">{t('For each person who asks. A question over the day\'s limit gets a polite no; one over the at-once limit waits its turn; a run that goes past its minutes is stopped, and the question comes to you. You aren\'t limited.')}</p>
      <div className="sb-limits">
        {LIMITS().map(([k, label, min, max]) => (
          <label key={k} className="sb-field">
            <span>{label}</span>
            <input className="st-input" type="number" inputMode="numeric" min={min} max={max} value={v[k] ?? ''} disabled={!here} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} onBlur={keep} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); keep() } }} />
          </label>
        ))}
      </div>
    </section>
  )
}

// The channels it answers in without a mention (none until you add one), and those it's been muted
// in (!mute), each to turn back on.
function Channels({ d, here, save }) {
  const { channels, error, connected } = useChannels(d)
  const s = d.settings
  const listen = s.listen || []
  const muted = s.muted || []
  const free = (channels || []).filter((c) => !listen.some((x) => x.id === c.id))
  return (
    <section className="st-sec" data-setting="slack-channels">
      <h4>{t('Channels')}</h4>
      <p className="small sb-sub"><b>{t('Answer without a mention')}</b></p>
      <p className="muted small">{t('In these channels it takes each new message from someone who may ask as a question, without being mentioned, and stays quiet when a message isn\'t for it. Off in every channel until you add one.')}</p>
      {listen.length > 0
        ? <Chips list={listen} hash here={here} onDrop={(c) => save({ listen: listen.filter((x) => x.id !== c.id) })} dropLabel={(c) => t('Stop answering without a mention in #{channel}', { channel: c.name || c.id })} />
        : <p className="small sb-none">{t('None: it answers only when it\'s mentioned, messaged or asked in its threads.')}</p>}
      {here && connected && channels && (
        free.length
          ? (
            <select className="st-input sb-pick-channel" value="" onChange={(e) => { const c = free.find((x) => x.id === e.target.value); if (c) save({ listen: [...listen, { id: c.id, name: c.name }] }) }} aria-label={t('Answer without a mention in')}>
              <option value="">{t('Add a channel…')}</option>
              {free.map((c) => <option key={c.id} value={c.id}>{`#${c.name || c.id}`}</option>)}
            </select>
          )
          : <p className="muted small">{t('Invite it to a channel first: /invite @{bot}.', { bot: d.bot?.name || d.name })}</p>
      )}
      {!connected && <p className="muted small">{t('Connect the app first to pick from its channels.')}</p>}
      {error && <p className="error-text small">{t('Couldn\'t list its channels: {error}', { error })}</p>}
      <p className="small sb-sub"><b>{t('Muted')}</b></p>
      <p className="muted small">{t('Anyone who may ask can mute it in a channel with “@{bot} !mute”, and turn it back on with “!unmute”. While it\'s muted there, it answers nothing in that channel.', { bot: d.bot?.name || d.name })}</p>
      {muted.length > 0
        ? (
          <ul className="sb-muted">
            {muted.map((c) => (
              <li key={c.id}>
                <span className="small">{`#${c.name || c.id}`}</span>
                {here && <button type="button" className="ghost-btn" onClick={() => save({ muted: muted.filter((x) => x.id !== c.id) })}><Icon name="volume" size={12} /> {t('Unmute')}</button>}
              </li>
            ))}
          </ul>
        )
        : <p className="small sb-none">{t('Not muted anywhere.')}</p>}
    </section>
  )
}

// How answers go, which agent answers (and a note on its terms when it answers through a personal
// plan), copies of your agents' conversations, what your agents are doing, and approvals in Slack.
function Replies({ d, here, save }) {
  const s = d.settings
  const agents = d.agents.filter((a) => a.installed)
  const by = d.answerer
  const label = agents.find((a) => a.kind === by?.kind)?.label || by?.kind
  const sign = d.signIn
  const terms = !sign ? null
    : sign.kind === 'subscription' ? t('{bot} answers other people through your {account} account{plan}. If that\'s a personal plan, check {provider}\'s terms allow it; an API key is the usual choice for a shared bot.', { bot: d.name, account: sign.account, provider: sign.provider, plan: sign.plan ? ` (${sign.plan})` : '' })
      : sign.kind === 'unknown' ? t('Bridge AI can\'t tell how {agent} is signed in here. If it\'s through a personal plan, check {provider}\'s terms allow {bot} to answer other people with it; an API key is the usual choice for a shared bot.', { agent: label, provider: sign.provider, bot: d.name })
        : sign.kind === 'none' ? t('{agent} isn\'t signed in here, so {bot} can\'t answer yet: sign it in under Settings › Agents.', { agent: label, bot: d.name }) : null
  return (
    <section className="st-sec" data-setting="slack-replies">
      <h4>{t('Answers')}</h4>
      <div className="sb-modes" role="radiogroup" aria-label={t('How answers go')}>
        <label className={`sb-mode ${!s.auto ? 'on' : ''}`}>
          <input type="radio" name={`sb-auto-${d.id}`} checked={!s.auto} disabled={!here} onChange={() => save({ auto: false })} />
          <span><b>{t('Review each one')}</b><span className="muted small">{t('Each answer waits in Needs You, to edit, send or discard. Nothing goes to Slack until you send it.')}</span></span>
        </label>
        <label className={`sb-mode ${s.auto ? 'on' : ''}`}>
          <input type="radio" name={`sb-auto-${d.id}`} checked={!!s.auto} disabled={!here} onChange={() => save({ auto: true })} />
          <span><b>{t('Answer without asking')}</b><span className="muted small">{t('An answer goes straight to Slack when the agent is held to its folders (Claude Code). An answer from a copy of an agent\'s conversation, or from Codex, which can read anywhere, still waits for you.')}</span></span>
        </label>
      </div>
      {s.auto && by && !by.confined && <p className="st-note warn"><Icon name="alert" size={13} />{t('{agent} answers here and isn\'t held to its folder, so every answer still waits for you.', { agent: label })}</p>}
      {s.auto && <p className="muted small">{t('Answers sent without asking are streamed into Slack as they\'re posted. One for a public channel that quotes a file it read waits for you all the same.')}</p>}
      <p className="muted small sb-approvals">{s.owner ? t('Drafts also come to your Slack direct messages, to send, edit or discard from your phone.') : t('Set You in Slack, above, to approve its drafts from Slack too.')}</p>
      <div className="st-row">
        <span className="small">{t('Answered by')}</span>
        {agents.length
          ? (
            <div className="seg" role="radiogroup" aria-label={t('Answered by')}>
              {agents.map((a) => <button key={a.kind} type="button" role="radio" aria-checked={by?.kind === a.kind} className={by?.kind === a.kind ? 'on' : ''} disabled={!here} onClick={() => save({ agent: a.kind })}>{a.label}</button>)}
            </div>
          )
          : <span className="error-text small">{t('No agent here can answer read-only: install Claude Code or Codex (Settings › Agents).')}</span>}
      </div>
      {terms && <p className="st-note warn sb-terms" data-setting="slack-terms"><Icon name="info" size={13} /><span>{terms}</span></p>}
      <label className="st-check">
        <input type="checkbox" checked={!!s.agentCopies} disabled={!here} onChange={(e) => save({ agentCopies: e.target.checked })} />
        <span><b>{t('Answer from a copy of an agent\'s conversation')}</b> <span className="muted small">{t('A question that names what one of your agents in its folders is working on is answered by a read-only copy of that agent\'s conversation; the agent itself gets nothing. It knows what that agent read anywhere, so its answers always wait for you.')}</span></span>
      </label>
      <label className="st-check">
        <input type="checkbox" checked={!!s.agentsStatus} disabled={!here} onChange={(e) => save({ agentsStatus: e.target.checked })} />
        <span><b>{t('Say what your agents are doing')}</b> <span className="muted small">{t('It\'s told the names of your agents in its folders and whether each is working, waiting on you or done, so it can answer “is that done yet?”. Never their conversations.')}</span></span>
      </label>
    </section>
  )
}

// Scheduled posts: a question it answers on a schedule, posted in a channel, through Scheduled
// Routines (server/routines.js). Each goes through its usual approvals.
function Scheduled({ d, here, reload }) {
  const { channels, connected } = useChannels(d)
  const [what, setWhat] = useState('')
  const [ch, setCh] = useState('')
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const list = d.scheduled || []
  const act = async (key, fn) => {
    setBusy(key)
    setMsg(null)
    try { await fn(); reload() } catch (e) { setMsg({ key, text: e.message }) }
    setBusy(null)
  }
  const add = (e) => {
    e.preventDefault()
    const c = (channels || []).find((x) => x.id === ch)
    if (!c) return setMsg({ key: 'add', text: t('Pick the channel it posts in.') })
    const words = what.trim()
    return act('add', async () => {
      await api('/routines', { method: 'POST', body: { name: words.length > 60 ? `${words.slice(0, 59)}…` : words, command: words, to: 'bot', bot: d.id, channel: { id: c.id, name: c.name }, schedule: when.trim() } })
      setWhat(''); setWhen('')
    })
  }
  return (
    <section className="st-sec" data-setting="slack-scheduled">
      <h4>{t('Scheduled Posts')}</h4>
      <p className="muted small">{t('A question it answers on a schedule and posts in a channel: a weekly status, a Monday summary. Each goes through its usual approvals: a draft for you, unless it answers without asking.')}</p>
      {!d.routinesOn && <p className="st-note warn"><Icon name="info" size={13} /><span>{t('Scheduled posts need Scheduled Routines: turn it on in Settings › About & Updates › Beta Features.')}</span></p>}
      {list.length > 0 && (
        <ul className="sb-sched">
          {list.map((r) => {
            const paused = r.paused === true || r.state === 'paused'
            const bad = ['error', 'missed'].includes(r.state)
            return (
              <li key={r.id} className={bad ? 'bad' : ''}>
                <div className="sb-sched-text">
                  <span className="small"><b>{r.command || r.name}</b></span>
                  <span className="muted small">{[r.channel?.name ? `#${r.channel.name}` : null, r.says || r.schedule, paused ? t('Paused') : r.next?.[0] ? t('next {when}', { when: new Date(r.next[0]).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) }) : null].filter(Boolean).join(' · ')}</span>
                  {r.note && <span className={`small ${bad ? 'error-text' : 'muted'}`}>{r.note}</span>}
                  {msg?.key === r.id && <span className="error-text small">{msg.text}</span>}
                </div>
                {here && d.routinesOn && (
                  <div className="st-row">
                    <button type="button" className="ghost-btn" disabled={busy === r.id} onClick={() => act(r.id, () => api(`/routines/${encodeURIComponent(r.id)}`, { method: 'PATCH', body: { paused: !paused } }))}><Icon name={paused ? 'play' : 'pause'} size={12} /> {paused ? t('Resume') : t('Pause')}</button>
                    <button type="button" className="ghost-btn danger" disabled={busy === r.id} onClick={() => act(r.id, () => api(`/routines/${encodeURIComponent(r.id)}`, { method: 'DELETE' }))}><Icon name="trash" size={12} /> {t('Delete')}</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!list.length && <p className="small sb-none">{t('None yet.')}</p>}
      {here && d.routinesOn && (connected
        ? (
          <form className="sb-sched-add" onSubmit={add}>
            <label className="sb-field"><span>{t('What to post, as a question to it')}</span><input className="st-input" value={what} onChange={(e) => setWhat(e.target.value)} placeholder={t('What changed in the launch checklist this week?')} /></label>
            <div className="sb-sched-row">
              <label className="sb-field"><span>{t('In')}</span>
                <select className="st-input" value={ch} onChange={(e) => setCh(e.target.value)}>
                  <option value="">{t('Pick a channel…')}</option>
                  {(channels || []).map((c) => <option key={c.id} value={c.id}>{`#${c.name || c.id}`}</option>)}
                </select>
              </label>
              <label className="sb-field"><span>{t('When')}</span><input className="st-input" value={when} onChange={(e) => setWhen(e.target.value)} placeholder={t('every weekday at 9')} /></label>
            </div>
            <div className="st-row"><button type="submit" className="btn small" disabled={busy === 'add' || !what.trim() || !when.trim()}><Icon name="plus" size={12} /> {t('Add the post')}</button></div>
            {msg?.key === 'add' && <p className="error-text small" role="alert">{msg.text}</p>}
          </form>
        )
        : <p className="muted small">{t('Connect the app first to pick the channel it posts in.')}</p>)}
    </section>
  )
}

function SetUp({ d, here, save, reload, onDelete, again }) {
  // (Where it answers: the one you looked at last for this bot, else the first set up, else Slack.)
  const [at, setAt] = useState(() => { const x = saved(`cc-bot-where-${d.id}`); return PLATFORMS.some(([k]) => k === x) ? x : (PLATFORMS.find(([k]) => stateOf(d, k).state !== 'no-tokens') || ['slack'])[0] })
  const pick = (k) => { setAt(k); saved(`cc-bot-where-${d.id}`, k) }
  return (
    <>
      <Where d={d} at={at} pick={pick} />
      <Guide key={at} d={d} platform={at} here={here} />
      {at === 'slack' && (
        <>
          <Status d={d} here={here} onAgain={again} />
          <UpdateApp d={d} here={here} onAgain={again} />
          <Connect d={d} here={here} reload={reload} />
          <Owner d={d} here={here} save={save} />
        </>
      )}
      {at === 'discord' && <DiscordSetup d={d} here={here} save={save} reload={reload} again={again} />}
      {at === 'teams' && <TeamsSetup d={d} here={here} save={save} reload={reload} again={again} />}
      <Pause d={d} here={here} save={save} />
      <Identity d={d} here={here} save={save} onDelete={onDelete} />
      <Askers d={d} here={here} save={save} />
      <Instructions d={d} here={here} save={save} />
      <ReadsFrom d={d} here={here} save={save} />
      <Changes d={d} here={here} save={save} />
      <Limits d={d} here={here} save={save} />
      <Channels d={d} here={here} save={save} />
      <Replies d={d} here={here} save={save} />
      <Scheduled d={d} here={here} reload={reload} />
    </>
  )
}

// ---------- Activity ----------
const OUTCOMES = () => [
  ['sent', t('Sent')], ['edited', t('Sent, as you edited it')], ['auto', t('Sent without asking')], ['waiting', t('Waiting for you')], ['passed-on', t('Passed on to you')],
  ['discarded', t('Discarded')], ['refused', t('Refused')], ['failed', t('Failed')], ['answering', t('Being answered')], ['skipped', t('Not for it')],
  ['stopped', t('Stopped')], ['queued', t('Waiting its turn')], ['try', t('Try It')],
]
const REFUSED = () => ({
  'not-allowed': t('not someone it answers'), guest: t('a guest'), external: t('from another company'), unknown: t('Slack couldn\'t say who they are'), empty: t('no question with the mention'),
  muted: t('it\'s muted in that channel'), paused: t('it\'s paused'), 'over-limit': t('over their limit for the day'),
})
// A setting's value, short, for the record's line.
const valueOf = (v) => { const s = v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v); return s.length > 80 ? `${s.slice(0, 79)}…` : s }
// One event of a conversation, as a line of its timeline.
function eventLine(e) {
  const who = e.person?.name || e.person?.id || t('Someone')
  const by = e.by || t('you')
  switch (e.type) {
    case 'received': {
      const text = wordsOf(e.text)
      const line = e.how === 'follow-up' ? t('{name} replied in the thread: “{text}”', { name: who, text })
        : e.how === 'dm' ? t('{name} messaged it: “{text}”', { name: who, text })
          : e.how === 'slash' ? t('{name} asked with its slash command: “{text}”', { name: who, text })
            : e.how === 'shortcut' ? t('{name} asked it about a message: “{text}”', { name: who, text })
              : e.how === 'listen' ? t('{name} wrote in the channel, without a mention: “{text}”', { name: who, text })
                : e.how === 'scheduled' ? t('A scheduled post: “{text}”', { text })
                  : e.how === 'try' ? t('{name} asked in Try It: “{text}”', { name: who, text })
                    : e.how === 'command' ? t('{name} gave it a command: {text}', { name: who, text })
                      : t('{name} mentioned it: “{text}”', { name: who, text })
      return e.files?.length ? `${line} ${t('(with {files})', { files: e.files.map((f) => f.name).join(', ') })}` : line
    }
    case 'refused': return t('Refused: {why}', { why: REFUSED()[e.why] || e.why })
    case 'queued': return t('Waiting its turn, behind {n} of their questions', { n: e.ahead ?? 1 })
    case 'context': return e.problem ? t('Read the conversation: {why}', { why: e.problem }) : t('Read {n} earlier messages and {pins} pinned, as context', { n: e.messages?.length || 0, pins: e.pins?.length || 0 })
    case 'run.started': return t('{agent} started, reading {folders}{from}; instructions {version} from {source}', { agent: e.agent === 'codex' ? 'Codex' : 'Claude Code', folders: e.folders?.length ? e.folders.join(', ') : t('no folders'), from: e.from ? t(', going on from its earlier conversation') : '', version: e.instructions?.hash || '', source: e.instructions?.source === 'file' ? e.instructions.path : t('Settings') }) + (e.instructions?.problem ? ` (${e.instructions.problem})` : '')
    case 'run.read': return t('Opened {files}', { files: (e.files || []).map((f) => f.what).join(', ') })
    case 'run.finished':
      if (e.end === 'finished') return t('Finished in {s} s', { s: Math.round((e.took || 0) / 1000) })
      if (e.end === 'timeout') return t('Stopped after {n} minutes, its longest run', { n: e.minutes ?? '' })
      if (e.end === 'stopped' && (e.by || e.why)) return e.by ? t('Stopped by {name}', { name: e.by }) + (e.why ? ` (${e.why})` : '') : t('Stopped: {why}', { why: e.why })
      return t('Ended: {why}', { why: e.error || e.end })
    case 'draft': {
      const base = e.needsOwner ? t('Passed on to you: {why}', { why: e.why || '' }) : e.auto ? t('Answered: “{text}”', { text: e.text }) : t('Drafted for you to check: “{text}”', { text: e.text })
      const more = [e.files?.length ? t('with {files}', { files: e.files.map((f) => f.name).join(', ') }) : null, e.warn || null].filter(Boolean)
      return more.length ? `${base} (${more.join('; ')})` : base
    }
    case 'draft.edited': return e.via === 'slack' ? t('{name} edited it in Slack: “{text}”', { name: by, text: e.after }) : t('You edited it: “{text}”', { text: e.after })
    case 'sent':
      if (e.kind === 'answer') {
        if (e.how === 'auto') return e.streamed ? t('Sent without asking, streamed') : t('Sent without asking')
        return e.via === 'slack' ? t('Sent by {name} from Slack', { name: e.by || t('you') }) : t('Sent by {name}', { name: e.by || t('you') })
      }
      if (e.kind === 'hold') return t('Told them it\'s passed on to you')
      if (e.kind === 'checking') return t('Told them it\'s being checked with you')
      return t('Told them: “{text}”', { text: e.text })
    case 'discarded': return e.via === 'slack' ? t('Discarded by {name} from Slack: nothing sent', { name: by }) : t('Discarded: nothing sent')
    case 'skipped': return t('Not for it: no answer')
    case 'posted.failed': return t('Couldn\'t post to Slack: {why}', { why: e.error })
    case 'reaction': return e.ok ? (e.removed ? t('Took :{name}: off', { name: e.name }) : t('Reacted :{name}:', { name: e.name })) : t('Couldn\'t react :{name}:: {why}', { name: e.name, why: e.error })
    case 'message.changed': return t('{name} edited a message: “{text}”', { name: who, text: wordsOf(e.text) })
    case 'message.deleted': return t('{name} deleted a message', { name: who })
    case 'approval.asked': return e.memory ? t('Asked you in your Slack direct messages whether to keep it') : t('Sent to your Slack direct messages, to send, edit or discard')
    case 'approval.failed': return t('Couldn\'t send it to your Slack direct messages: {why}', { why: e.error })
    case 'memory.proposed': return t('Would like to remember: “{text}”', { text: wordsOf(e.item?.text) })
    case 'memory.kept': return t('{name} kept in its memory: “{text}”', { name: by, text: wordsOf(e.item?.text) })
    case 'memory.edited': return t('{name} changed what it remembers to: “{text}”', { name: by, text: wordsOf(e.item?.text) })
    case 'memory.deleted': return t('{name} deleted from its memory: “{text}”', { name: by, text: wordsOf(e.item?.text) })
    case 'change.proposed': return t('Changed {n} files on {branch}', { n: e.files?.length || 0, branch: e.branch || '' })
    case 'change.approved': return e.via === 'slack' ? t('{name} approved the change from Slack', { name: by }) : t('{name} approved the change', { name: by })
    case 'change.failed': return t('The change couldn\'t go through ({step}): {why}', { step: e.step || '', why: e.error || '' })
    case 'pr.opened': return t('Opened a draft pull request')
    case 'file.uploaded': return e.ok === false ? t('Couldn\'t send the file {name}: {why}', { name: e.name, why: e.error || '' }) : t('Sent the file {name} ({size})', { name: e.name, size: sizeOf(e.size) })
    case 'forgotten': return t('{name} asked it to forget them: {memory} things it remembered deleted, their words blanked in {events} events', { name: who, memory: e.memory ?? 0, events: e.events ?? 0 })
    case 'status': return e.ok === false ? t('Couldn\'t set Slack\'s working status: {why}', { why: e.error || '' }) : e.on ? t('Showed Slack\'s working status') : t('Cleared Slack\'s working status')
    case 'trace.deleted': return e.all ? t('Its activity history was deleted') : t('Months deleted for their age: {months}', { months: (e.months || []).join(', ') })
    case 'settings.changed': return t('{name} changed {setting}: {before} → {after}', { name: by, setting: e.setting, before: valueOf(e.old), after: valueOf(e.new) })
    default: return e.type
  }
}
const isBad = (e) => e.ok === false || ['posted.failed', 'refused', 'approval.failed', 'change.failed'].includes(e.type) || (e.type === 'run.finished' && e.end === 'timeout')

// A conversation's events, in order, as kept.
function Events({ d, events }) {
  return (
    <ol className="sb-tl">
      {events.map((e, i) => (
        <li key={`${e.at}-${i}`} className={`ev-${e.type.replace(/\./g, '-')} ${isBad(e) ? 'bad' : ''}`}>
          <time className="muted small" dateTime={e.at}>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
          <span className="sb-tl-type mono">{e.type}</span>
          <span className="small sb-tl-text">{eventLine(e)}{e.type === 'pr.opened' && e.url && <> <a className="sb-link" href={e.url} target="_blank" rel="noreferrer">{e.url}</a></>}</span>
          {e.type === 'context' && (e.messages?.length > 0 || e.pins?.length > 0) && (
            <details className="sb-ctx"><summary><Icon name="chevron" size={11} />{t('What it read')}</summary><ul>{[...(e.messages || []), ...(e.pins || [])].map((m, k) => <li key={k} className="small"><b>{m.you ? d.name : m.person?.name || m.person?.id}</b>: {wordsOf(m.text)}</li>)}</ul></details>
          )}
          {e.type === 'change.proposed' && (e.stat || e.diff) && (
            <details className="sb-ctx"><summary><Icon name="chevron" size={11} />{t('The diff')}</summary>{e.stat && <p className="small mono sb-stat">{e.stat}</p>}{e.diff && <pre className="sb-diff">{e.diff}</pre>}</details>
          )}
        </li>
      ))}
    </ol>
  )
}

function Timeline({ d, conv, onClose }) {
  const [x, setX] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { api(`/bots/${d.id}/activity/${encodeURIComponent(conv)}`).then(setX, (e) => setError(e.message)) }, [d.id, conv])
  const exp = (f) => apiUrl(`/bots/${d.id}/export?format=${f}&conv=${encodeURIComponent(conv)}`)
  // The thread in Slack itself (its workspace's address, the channel and the thread's ts).
  const [channel, thread] = String(conv).split(':')
  const inSlack = d.team?.url && /^[CGD][A-Z0-9]+$/.test(channel) && /^\d+\.\d+$/.test(thread || '') ? `${String(d.team.url).replace(/\/?$/, '/')}archives/${channel}/p${thread.replace('.', '')}` : null
  return (
    <div className="sb-timeline" role="region" aria-label={t('One conversation')}>
      <div className="sb-tl-head">
        <b className="small">{t('Timeline')}</b>
        <span className="sb-grow" />
        {inSlack && <a className="ghost-btn small" href={inSlack} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> {t('Open in Slack')}</a>}
        <a className="ghost-btn small" href={exp('md')} download><Icon name="export" size={12} /> {t('Export as Markdown')}</a>
        <a className="ghost-btn small" href={exp('jsonl')} download>JSONL</a>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={12} /></button>
      </div>
      {error && <p className="error-text small">{error}</p>}
      {!x && !error && <div className="skeleton-rows"><div /><div /></div>}
      {x && <Events d={d} events={x.events} />}
    </div>
  )
}

function Activity({ d, here, save }) {
  const [f, setF] = useState({ q: '', person: '', channel: '', outcome: '', from: '', to: '' })
  const [x, setX] = useState(null)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(null)
  const [fmt, setFmt] = useState('csv')
  const query = new URLSearchParams(Object.entries({ ...f, from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : '', to: f.to ? new Date(`${f.to}T23:59:59.999`).toISOString() : '' }).filter(([, v]) => v)).toString()
  useEffect(() => {
    let live = true
    const load = () => api(`/bots/${d.id}/activity${query ? `?${query}` : ''}`).then((r) => { if (live) { setX(r); setError(null) } }, (e) => live && setError(e.message))
    const id = setTimeout(load, f.q ? 250 : 0)
    const every = setInterval(() => { if (!document.hidden) load() }, 6000)
    return () => { live = false; clearTimeout(id); clearInterval(every) }
  }, [d.id, query]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF((y) => ({ ...y, [k]: e.target.value }))
  const range = new URLSearchParams(Object.entries({ format: fmt, from: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : '', to: f.to ? new Date(`${f.to}T23:59:59.999`).toISOString() : '' }).filter(([, v]) => v)).toString()
  const g = x?.integrity
  const out = Object.fromEntries(OUTCOMES())
  return (
    <section className="st-sec" data-setting="slack-activity">
      <h4>{t('Activity')}</h4>
      <p className="muted small">{t('Everything {bot} sees and does, kept on this computer as it happens: each message it read, each run of an agent and the files it opened, each draft, edit and answer. Only added to, never changed.', { bot: d.name })}</p>
      {g && (
        <p className={`st-note ${g.ok ? 'ok' : 'bad'} sb-integrity`} role="status">
          <Icon name={g.ok ? 'check' : 'alert'} size={13} />
          <span>{g.ok ? (g.events ? t('The record holds: {n} events since {date}, none changed or taken out.', { n: g.events, date: new Date(g.since).toLocaleDateString() }) : t('Nothing in the record yet.')) : t('The record was changed: {why}, at line {line} of {file}.', { why: g.broken.why, line: g.broken.line, file: g.broken.file })}</span>
        </p>
      )}
      {!d.deleted && (
        <div className="st-row sb-keep">
          <span className="small">{t('Keep the record for')}</span>
          <div className="seg" role="radiogroup" aria-label={t('Keep the record for')}>
            {[['90d', t('90 days')], ['1y', t('1 year')], ['forever', t('Always')]].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={d.settings.retention === k} className={d.settings.retention === k ? 'on' : ''} disabled={!here} onClick={() => save({ retention: k })}>{l}</button>)}
          </div>
        </div>
      )}
      <div className="sb-filters">
        <label className="sb-search"><Icon name="search" size={13} /><input value={f.q} onChange={set('q')} placeholder={t('A word in a question or answer')} aria-label={t('Search its activity')} /></label>
        <select className="st-input" value={f.person} onChange={set('person')} aria-label={t('Person')}>
          <option value="">{t('Anyone')}</option>
          {(x?.people || []).map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
        </select>
        <select className="st-input" value={f.channel} onChange={set('channel')} aria-label={t('Where')}>
          <option value="">{t('Anywhere')}</option>
          {(x?.places || []).map((p) => <option key={p.id} value={p.id}>{placeOf(p)}</option>)}
        </select>
        <select className="st-input" value={f.outcome} onChange={set('outcome')} aria-label={t('Outcome')}>
          <option value="">{t('Any outcome')}</option>
          {OUTCOMES().map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="sb-date"><span className="small muted">{t('From')}</span><input type="date" className="st-input" value={f.from} onChange={set('from')} /></label>
        <label className="sb-date"><span className="small muted">{t('To')}</span><input type="date" className="st-input" value={f.to} onChange={set('to')} /></label>
      </div>
      <div className="st-row sb-export">
        <span className="small">{t('Export these dates as')}</span>
        <select className="st-input" value={fmt} onChange={(e) => setFmt(e.target.value)} aria-label={t('Export format')}>
          <option value="csv">CSV</option><option value="jsonl">JSON Lines</option><option value="md">Markdown</option>
        </select>
        <a className="btn small" href={apiUrl(`/bots/${d.id}/export?${range}`)} download><Icon name="export" size={12} /> {t('Export')}</a>
      </div>
      {error && <p className="error-text small">{error}</p>}
      {!x && !error && <div className="skeleton-rows"><div /><div /><div /></div>}
      {x && !x.conversations.length && <p className="muted small">{x.total === 0 && !query ? t('Nothing yet. Each conversation it takes part in shows here: who asked, where, what it read and what was sent back.') : t('No conversation matches.')}</p>}
      {x && x.conversations.length > 0 && (
        <ul className="sb-log sb-convs">
          {x.conversations.map((c) => (
            <li key={c.id} className={`q o-${c.outcome} ${open === c.id ? 'open' : ''}`}>
              <button type="button" className="sb-conv" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                <Icon name={['sent', 'edited', 'auto'].includes(c.outcome) ? 'send' : c.outcome === 'refused' ? 'blocked' : c.outcome === 'discarded' ? 'x' : c.outcome === 'stopped' ? 'stop' : 'chat'} size={12} />
                <span className="sb-log-text">
                  <span className="small"><b>{c.from?.name || c.from?.id || t('Someone')}</b> <span className="muted">{t('in {place}', { place: placeOf(c.place) })}{c.messages > 1 ? ` · ${t('{n} messages', { n: c.messages })}` : ''}</span></span>
                  <span className="sb-log-q">{wordsOf(c.asked)}</span>
                  <span className="muted small sb-log-out">{out[c.outcome] || c.outcome}{c.refused ? `: ${REFUSED()[c.refused] || c.refused}` : ''}{c.took != null ? ` · ${t('{s} s', { s: Math.round(c.took / 1000) })}` : ''}{c.answer && c.outcome !== 'refused' ? ` · “${c.answer}”` : ''}</span>
                </span>
                <time className="muted small" dateTime={c.last}>{ago(c.last)}</time>
              </button>
              {open === c.id && <Timeline d={d} conv={c.id} onClose={() => setOpen(null)} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------- What an answer brings: its files, its change ----------
function ChangeOf({ c }) {
  if (!c) return null
  return (
    <div className="sb-change">
      <p className="small">
        <Icon name="branch" size={12} /> {c.pr?.url ? t('A draft pull request on {branch}:', { branch: c.branch || '' }) : c.mode === 'suggest' ? t('A change on {branch}, waiting for you to approve the diff', { branch: c.branch || '' }) : t('A change on {branch}', { branch: c.branch || '' })}
        {c.pr?.url && <> <a className="sb-link" href={c.pr.url} target="_blank" rel="noreferrer">{c.pr.url}</a></>}
      </p>
      {c.stat && <p className="small mono sb-stat">{c.stat}</p>}
      {c.diff && <details className="sb-ctx"><summary><Icon name="chevron" size={11} />{t('The diff')}</summary><pre className="sb-diff">{c.diff}</pre></details>}
    </div>
  )
}
const FilesOf = ({ files }) => (files?.length ? <p className="muted small sb-files"><Icon name="paperclip" size={12} /> {t('With {files}', { files: files.map((f) => `${f.name}${f.size != null ? ` (${sizeOf(f.size)})` : ''}`).join(', ') })}</p> : null)

// ---------- Try It ----------
// A question asked here as someone would in Slack: the same agent, folders, instructions and memory,
// its draft, what it read and its record, and nothing sent to Slack.
const WORKING = new Set(['received', 'answering', 'queued'])
function TryIt({ d }) {
  const key = `cc-bot-try-${d.id}`
  const [as, setAs] = useState('')
  const [text, setText] = useState('')
  const [q, setQ] = useState(() => saved(key) || null)
  const [x, setX] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const ask = async (e) => {
    e?.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await api(`/bots/${d.id}/try`, { method: 'POST', body: { text: text.trim(), as: as || null } })
      setX(null)
      setQ(r.q)
      saved(key, r.q)
    } catch (err) { setError(err.message) }
    setBusy(false)
  }
  // Looked at every moment and a half while it's being answered, then twice more for what follows.
  useEffect(() => {
    if (!q) return undefined
    let live = true
    let timer = null
    let after = 2
    const load = () => api(`/bots/${d.id}/try/${encodeURIComponent(q)}`).then((r) => {
      if (!live) return
      setX(r)
      setError(null)
      if (WORKING.has(r.item?.state) || after-- > 0) timer = setTimeout(load, 1500)
    }, (err) => {
      if (!live) return
      if (err.status === 404) { setQ(null); saved(key, '') } else setError(err.message)
    })
    load()
    return () => { live = false; clearTimeout(timer) }
  }, [d.id, q]) // eslint-disable-line react-hooks/exhaustive-deps
  const me = d.settings.owner?.name ? t('{name} (you)', { name: d.settings.owner.name }) : t('You')
  const it = x?.item
  return (
    <section className="st-sec" data-setting="slack-try">
      <h4>{t('Try It')}</h4>
      <p className="muted small">{t('Ask {bot} here as someone would in Slack: the same agent, folders, instructions and memory. You see its draft, the files it read and its record. Nothing goes to Slack.', { bot: d.name })}</p>
      <form className="sb-try" onSubmit={ask}>
        <label className="sb-field">
          <span>{t('Ask as')}</span>
          <select className="st-input" value={as} onChange={(e) => setAs(e.target.value)}>
            <option value="">{me}</option>
            {d.settings.askers.filter((a) => a.id !== d.settings.owner?.id).map((a) => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
          </select>
        </label>
        <textarea className="st-input sb-try-q" value={text} rows={3} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) ask(e) }} placeholder={t('A question, as it would be asked in Slack')} aria-label={t('The question')} />
        <div className="st-row"><button type="submit" className="btn small primary" disabled={busy || !text.trim()}><Icon name="send" size={12} /> {busy ? t('Asking…') : t('Ask {bot}', { bot: d.name })}</button></div>
      </form>
      {error && <p className="error-text small" role="alert">{error}</p>}
      {it && (
        <div className="sb-try-out" role="region" aria-label={t('Its answer')}>
          <p className="small"><b>{it.from?.name || me}</b> <span className="muted">{t('asked')}</span> “{it.text}”</p>
          {it.state === 'queued' && <p className="muted small"><Icon name="clock" size={12} /> {t('Waiting its turn: they have as many questions running as their limit allows.')}</p>}
          {(it.state === 'received' || it.state === 'answering') && <p className="muted small sb-working"><Icon name="working" size={12} /> {t('Its agent is reading and answering…')}</p>}
          {it.state === 'refused' && <p className="st-note warn"><Icon name="blocked" size={13} /><span>{t('It wouldn\'t answer: {why}', { why: REFUSED()[it.refused] || it.refused || '' })}</span></p>}
          {it.state === 'stopped' && <p className="st-note warn"><Icon name="stop" size={13} /><span>{t('Stopped before it answered.')}</span></p>}
          {it.needsOwner && it.state !== 'answering' && <p className="st-note warn"><Icon name="info" size={13} /><span>{t('It would pass this to you: {why}', { why: it.why || '' })}</span></p>}
          {!it.needsOwner && it.draft != null && it.draft !== '' && (
            <>
              <p className="small muted">{it.auto ? t('Would be sent without asking:') : t('Its draft, for you to check before it\'s sent:')}</p>
              <blockquote className="sb-try-draft">{it.draft}</blockquote>
            </>
          )}
          {it.warn && <p className="st-note warn"><Icon name="alert" size={13} /><span>{it.warn}</span></p>}
          {it.sources?.length > 0 && <p className="muted small">{t('It read {files}', { files: it.sources.slice(0, 8).join(', ') })}</p>}
          <FilesOf files={it.files} />
          <ChangeOf c={it.change} />
          {x.events?.length > 0 && (
            <details className="sb-ctx sb-try-tl" open>
              <summary><Icon name="chevron" size={11} />{t('Its record')}</summary>
              <Events d={d} events={x.events} />
            </details>
          )}
        </div>
      )}
    </section>
  )
}

// ---------- Memory ----------
// What it has learned: about itself in general, each channel, each person. Learnings come from
// REMEMBER lines in its answers, your edits to its drafts and people saying "remember that…"; each
// is kept only once you keep it, unless you said straight away. You see, edit and delete each one.
const SOURCE = () => ({ remember: t('from one of its answers'), edit: t('from your edit to a draft'), asked: t('someone asked it to remember'), owner: t('added by you'), import: t('imported') })
function MemItem({ it, here, onSave, onDelete, onKeep, about = null }) {
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const run = async (fn) => { setBusy(true); setError(null); try { await fn(); setEdit(null) } catch (e) { setError(e.message) } setBusy(false) }
  return (
    <li className={`sb-mem-item ${it.state === 'proposed' ? 'new' : ''}`}>
      {edit != null
        ? (
          <form className="sb-add" onSubmit={(e) => { e.preventDefault(); if (edit.trim()) run(() => onSave(edit.trim())) }}>
            <input className="st-input" value={edit} maxLength={500} onChange={(e) => setEdit(e.target.value)} aria-label={t('What it remembers')} />
            <button type="submit" className="btn small" disabled={busy || !edit.trim()}>{t('Save')}</button>
            <button type="button" className="ghost-btn" onClick={() => setEdit(null)}>{t('Cancel')}</button>
          </form>
        )
        : (
          <div className="sb-mem-text">
            <span className="small">{about && <b>{about}: </b>}{it.text}</span>
            <span className="muted small">{[SOURCE()[it.source] || it.source, it.by && it.source !== 'owner' ? it.by : null, it.at ? ago(it.at) : null].filter(Boolean).join(' · ')}</span>
          </div>
        )}
      {here && edit == null && (
        <div className="st-row sb-mem-acts">
          {onKeep && <button type="button" className="btn small" disabled={busy} onClick={() => run(onKeep)}><Icon name="check" size={12} /> {t('Keep')}</button>}
          <button type="button" className="ghost-btn" disabled={busy} onClick={() => setEdit(it.text)}><Icon name="edit" size={12} /> {t('Edit')}</button>
          <button type="button" className="ghost-btn danger" disabled={busy} onClick={() => run(onDelete)}><Icon name="trash" size={12} /> {it.state === 'proposed' ? t('Discard') : t('Delete')}</button>
        </div>
      )}
      {error && <p className="error-text small sb-full" role="alert">{error}</p>}
    </li>
  )
}

function Memory({ d, here, save, reload }) {
  const [x, setX] = useState(null)
  const [error, setError] = useState(null)
  const [kind, setKind] = useState('bot')
  const [of, setOf] = useState('')
  const [text, setText] = useState('')
  const [msg, setMsg] = useState(null)
  const { channels } = useChannels(d)
  const { people } = usePeople(d)
  const load = () => api(`/bots/${d.id}/memory`).then((r) => { setX(r); setError(null) }, (e) => setError(e.message))
  useEffect(() => {
    load()
    const every = setInterval(() => { if (!document.hidden) load() }, 6000)
    return () => clearInterval(every)
  }, [d.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const items = x?.items || []
  const mode = x?.mode || d.settings.memory || 'approve'
  const done = async (fn) => { await fn(); await load(); reload() }
  const edit = (it) => (words) => done(() => api(`/bots/${d.id}/memory/${encodeURIComponent(it.id)}`, { method: 'PATCH', body: { text: words } }))
  const drop = (it) => () => done(() => api(`/bots/${d.id}/memory/${encodeURIComponent(it.id)}`, { method: 'DELETE' }))
  const keep = (it) => () => done(() => api(`/bots/${d.id}/memory/${encodeURIComponent(it.id)}`, { method: 'PATCH', body: { keep: true } }))
  const proposed = items.filter((i) => i.state === 'proposed')
  const kept = items.filter((i) => i.state !== 'proposed')
  // Kept items in groups: about it in general, about each channel, about each person.
  const groups = []
  const general = kept.filter((i) => i.kind === 'bot')
  if (general.length) groups.push({ key: 'bot', title: t('About {bot} in general', { bot: d.name }), list: general })
  for (const k of ['channel', 'person']) {
    const by = new Map()
    for (const i of kept.filter((y) => y.kind === k)) { if (!by.has(i.of)) by.set(i.of, []); by.get(i.of).push(i) }
    for (const [id, list] of by) {
      const name = list.find((i) => i.ofName)?.ofName || id
      groups.push({ key: `${k}:${id}`, title: k === 'channel' ? t('About #{channel}', { channel: name }) : t('About {name}', { name }), list })
    }
  }
  // Whom a new item can be about: its channels, and the people it knows (those named, you, and the
  // workspace's).
  const chans = channels || []
  const folks = [...new Map([...(d.settings.owner ? [d.settings.owner] : []), ...d.settings.askers, ...(people || [])].map((p) => [p.id, { id: p.id, name: p.name }])).values()]
  const add = async (e) => {
    e.preventDefault()
    setMsg(null)
    const target = kind === 'channel' ? chans.find((c) => c.id === of) : kind === 'person' ? folks.find((p) => p.id === of) : null
    if (kind !== 'bot' && !target) { setMsg(kind === 'channel' ? t('Pick the channel it\'s about.') : t('Pick the person it\'s about.')); return }
    try {
      await done(() => api(`/bots/${d.id}/memory`, { method: 'POST', body: { kind, of: target?.id || null, ofName: target?.name || null, text: text.trim() } }))
      setText('')
    } catch (err) { setMsg(err.message) }
  }
  const modes = [['approve', t('Ask me first')], ['auto', t('Keep straight away')], ['off', t('Off')]]
  return (
    <section className="st-sec" data-setting="slack-memory">
      <h4>{t('Memory')}</h4>
      <p className="muted small">{t('What {bot} learns: from REMEMBER lines in its answers, your edits to its drafts, and people saying “remember that…”. Each is used in other conversations only once it\'s kept. Anyone can ask it “!what do you know about me”, and “!forget me” deletes what it knows about them and blanks their words in its record.', { bot: d.name })}</p>
      <div className="st-row sb-mem-mode">
        <span className="small">{t('Learnings')}</span>
        <div className="seg" role="radiogroup" aria-label={t('Learnings')}>
          {modes.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? 'on' : ''} disabled={!here} onClick={async () => { await save({ memory: k }); load() }}>{l}</button>)}
        </div>
      </div>
      {mode === 'off' && <p className="muted small">{t('Off: it learns nothing new, and is given nothing it kept before.')}</p>}
      {error && <p className="error-text small">{error}</p>}
      {!x && !error && <div className="skeleton-rows"><div /><div /></div>}
      {proposed.length > 0 && (
        <>
          <p className="small sb-sub"><b>{t('Waiting for you')}</b></p>
          <ul className="sb-mem">
            {proposed.map((it) => (
              <MemItem key={it.id} it={it} about={it.kind === 'channel' ? `#${it.ofName || it.of}` : it.kind === 'person' ? it.ofName || it.of : null} here={here} onSave={edit(it)} onDelete={drop(it)} onKeep={keep(it)} />
            ))}
          </ul>
        </>
      )}
      {groups.map((g) => (
        <div key={g.key} className="sb-mem-group">
          <p className="small sb-sub"><b>{g.title}</b></p>
          <ul className="sb-mem">{g.list.map((it) => <MemItem key={it.id} it={it} here={here} onSave={edit(it)} onDelete={drop(it)} />)}</ul>
        </div>
      ))}
      {x && !items.length && <p className="small sb-none">{t('Nothing yet.')}</p>}
      {here && (
        <form className="sb-mem-add" onSubmit={add}>
          <p className="small sb-sub"><b>{t('Teach it something')}</b></p>
          <div className="sb-sched-row">
            <label className="sb-field"><span>{t('About')}</span>
              <select className="st-input" value={kind} onChange={(e) => { setKind(e.target.value); setOf('') }}>
                <option value="bot">{t('Anything')}</option>
                <option value="channel">{t('A channel')}</option>
                <option value="person">{t('A person')}</option>
              </select>
            </label>
            {kind === 'channel' && (
              <label className="sb-field"><span>{t('Which channel')}</span>
                <select className="st-input" value={of} onChange={(e) => setOf(e.target.value)}>
                  <option value="">{t('Pick a channel…')}</option>
                  {chans.map((c) => <option key={c.id} value={c.id}>{`#${c.name || c.id}`}</option>)}
                </select>
              </label>
            )}
            {kind === 'person' && (
              <label className="sb-field"><span>{t('Who')}</span>
                <select className="st-input" value={of} onChange={(e) => setOf(e.target.value)}>
                  <option value="">{t('Pick someone…')}</option>
                  {folks.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="sb-add">
            <input className="st-input" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder={t('Dana leads sales for the west coast')} aria-label={t('What it should remember')} />
            <button type="submit" className="btn small" disabled={!text.trim()}><Icon name="plus" size={12} /> {t('Remember it')}</button>
          </div>
          {msg && <p className="error-text small" role="alert">{msg}</p>}
        </form>
      )}
    </section>
  )
}

// ---------- One bot ----------
const TABS = ['setup', 'try', 'memory', 'activity']
function Bot({ id, here, onGone, onChanged, notice }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [tab, setTab] = useState(() => { const x = saved('cc-bot-tab'); return TABS.includes(x) ? x : 'setup' })
  const alive = useRef(true)
  // Each look is numbered: one overtaken by a newer look or a change, or back while a change is
  // still being saved (what it brings is from before), is dropped.
  const asked = useRef(0)
  const unsaved = useRef(0)
  const saving = useRef(Promise.resolve())
  const load = () => { const n = ++asked.current; return api(`/bots/${id}`).then((x) => { if (alive.current && n === asked.current && !unsaved.current) { setD(x); setError(null) } }, (e) => alive.current && n === asked.current && setError(e.message)) }
  useEffect(() => {
    alive.current = true
    setD(null)
    load()
    const every = setInterval(() => { if (!document.hidden) load() }, 4000)
    return () => { alive.current = false; clearInterval(every) }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  // A change to its settings: shown at once (the folders once the server has checked them), so a
  // second pick before the first is saved builds on it (Dana, then Sam, keeps both); saved in the
  // order made; then shown as the server has it. False when it wasn't taken.
  const save = (patch) => {
    const plain = Object.fromEntries(Object.entries(patch).filter(([k]) => !['readsFrom', 'instructions', 'name', 'description', 'instructionsFile', 'repo'].includes(k)))
    asked.current++; unsaved.current++
    setD((x) => x && { ...x, settings: { ...x.settings, ...plain } })
    const done = saving.current.then(async () => {
      try { await api(`/bots/${id}/settings`, { method: 'POST', body: patch }); setNote(null); if (patch.name || patch.paused !== undefined) onChanged(); return true } catch (e) { setNote(e.message); return false } finally { unsaved.current--; await load() }
    })
    saving.current = done
    return done
  }
  const again = async () => { try { await api(`/bots/${id}/connect`, { method: 'POST' }) } catch (e) { setNote(e.message) } load() }
  const remove = async (history) => { try { await api(`/bots/${id}${history ? '?history=1' : ''}`, { method: 'DELETE' }); onGone() } catch (e) { setNote(e.message) } }
  const pickTab = (x) => { setTab(x); saved('cc-bot-tab', x) }
  if (error && !d) return <p className="st-note bad"><Icon name="alert" size={13} /> {error}</p>
  if (!d) return <div className="skeleton-rows"><div /><div /><div /></div>
  const proposed = d.memoryCount?.proposed || 0
  // (Its record, Try It and its memory are looked at on the computer it's kept on: none of them goes
  // through the relay.)
  const away = (what) => <p className="muted small" data-setting={what}>{t('This is shown in Bridge AI on the computer it runs on: it never goes through your relay.')}</p>
  return (
    <>
      <div className="seg sb-tabs" role="tablist" aria-label={d.name}>
        <button type="button" role="tab" aria-selected={tab === 'setup'} className={tab === 'setup' ? 'on' : ''} onClick={() => pickTab('setup')}>{t('Set Up')}</button>
        <button type="button" role="tab" aria-selected={tab === 'try'} className={tab === 'try' ? 'on' : ''} onClick={() => pickTab('try')}>{t('Try It')}</button>
        <button type="button" role="tab" aria-selected={tab === 'memory'} className={tab === 'memory' ? 'on' : ''} onClick={() => pickTab('memory')}>{t('Memory')}{proposed > 0 && <span className="sb-tag">{t('{n} to keep', { n: proposed })}</span>}</button>
        <button type="button" role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'on' : ''} onClick={() => pickTab('activity')}>{t('Activity')}{d.waiting > 0 && <span className="sb-tag">{t('{n} waiting in Needs You', { n: d.waiting })}</span>}</button>
      </div>
      {notice?.length > 0 && <div className="st-note warn" role="status"><Icon name="info" size={13} /><span>{t('Imported. Check these here:')} {notice.join(' · ')}</span></div>}
      {note && <p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {note}</p>}
      {tab === 'setup' && <SetUp d={d} here={here} save={save} reload={load} onDelete={remove} again={again} />}
      {tab === 'try' && (here ? <TryIt d={d} /> : away('slack-try'))}
      {tab === 'memory' && (here ? <Memory d={d} here={here} save={save} reload={load} /> : away('slack-memory'))}
      {tab === 'activity' && (here ? <Activity d={d} here={here} save={save} /> : <p className="muted small" data-setting="slack-activity">{t('Its activity is shown in Bridge AI on the computer it runs on: its record never goes through your relay.')}</p>)}
    </>
  )
}

// A new bot, by its name, from a template or blank; or one exported from another computer.
function NewBot({ here, onMade }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [templates, setTemplates] = useState(null)
  const [tplError, setTplError] = useState(null)
  const [tpl, setTpl] = useState('')
  const file = useRef(null)
  useEffect(() => { api('/bots/templates').then((r) => setTemplates(r.templates || []), (e) => { setTemplates([]); setTplError(e.message) }) }, [])
  const make = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try { const b = await api('/bots', { method: 'POST', body: { name, ...(tpl ? { template: tpl } : {}) } }); setName(''); onMade(b.id) } catch (err) { setError(err.message) }
    setBusy(false)
  }
  const bring = async (f) => {
    if (!f) return
    setBusy(true)
    setError(null)
    try {
      let bundle
      try { bundle = JSON.parse(await f.text()) } catch { throw new Error(t('That file isn\'t a bot exported from Bridge AI.')) }
      const b = await api('/bots/import', { method: 'POST', body: { bundle } })
      onMade(b.id, b.problems || [])
    } catch (err) { setError(err.message) }
    if (file.current) file.current.value = ''
    setBusy(false)
  }
  const picked = (templates || []).find((x) => x.id === tpl) || null
  const cards = [{ id: '', name: t('Start blank'), description: t('Write its instructions yourself.') }, ...(templates || [])]
  return (
    <div className="sb-newbot">
      {here && (
        <div className="sb-templates" role="radiogroup" aria-label={t('What it does')}>
          {cards.map((c) => (
            <button key={c.id || 'blank'} type="button" role="radio" aria-checked={tpl === c.id} className={`sb-tpl ${tpl === c.id ? 'on' : ''}`} onClick={() => setTpl(c.id)}>
              <b className="small">{c.name}</b>
              {c.description && <span className="muted small">{c.description}</span>}
            </button>
          ))}
        </div>
      )}
      {tplError && <p className="muted small">{t('The templates couldn\'t be loaded ({error}): you can still start blank.', { error: tplError })}</p>}
      {picked?.hint && <p className="muted small">{picked.hint}</p>}
      {picked?.instructions && <details className="sb-how"><summary><Icon name="chevron" size={11} />{t('Its instructions, to change after')}</summary><pre className="sb-tpl-ins">{picked.instructions}</pre></details>}
      <form className="sb-new" onSubmit={make} data-setting="slack-new">
        <div className="sb-add">
          <input className="st-input" value={name} maxLength={35} onChange={(e) => setName(e.target.value)} placeholder={t('Its name, as Slack shows it: Atlas, Pricing Desk…')} aria-label={t('The new bot\'s name')} disabled={!here} />
          <button type="submit" className="btn small primary" disabled={!here || busy || !name.trim()}><Icon name="plus" size={12} /> {t('New Bot')}</button>
        </div>
        {error && <p className="error-text small" role="alert">{error}</p>}
        {!here && <p className="muted small">{t('Make one in Bridge AI on the computer it runs on.')}</p>}
      </form>
      {here && (
        <div className="st-row sb-import" data-setting="slack-import">
          <button type="button" className="ghost-btn" disabled={busy} onClick={() => file.current?.click()}><Icon name="upload" size={12} /> {t('Import a bot…')}</button>
          <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => bring(e.target.files?.[0])} />
          <span className="muted small">{t('From a file exported in Bridge AI on another computer: its instructions, memory and settings. You connect its Slack app again here.')}</span>
        </div>
      )}
    </div>
  )
}

// A deleted bot: its record, kept to look at and export until the time it's kept for runs out, and
// deleted now if you say so.
function DeletedBot({ d, here, reload }) {
  const [sure, setSure] = useState(false)
  const [note, setNote] = useState(null)
  const forget = async () => { try { await api(`/bots/${d.id}/history`, { method: 'DELETE' }); setSure(false); reload() } catch (e) { setNote(e.message) } }
  return (
    <>
      <p className="st-note warn sb-deleted" role="status"><Icon name="info" size={13} /><span>{d.cleared
        ? t('{bot} was deleted on {date}, and its activity history with it. Its record keeps only that, until the time it\'s kept for runs out.', { bot: d.name, date: new Date(d.cleared).toLocaleDateString() })
        : t('{bot} was deleted on {date}. Its record stays here, to look at and export, until the time it\'s kept for runs out, or you delete it.', { bot: d.name, date: d.deletedAt ? new Date(d.deletedAt).toLocaleDateString() : '' })}</span></p>
      {note && <p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {note}</p>}
      {here ? <Activity d={{ ...d, settings: { retention: d.retention } }} here={here} save={async () => false} /> : <p className="muted small">{t('Its activity is shown in Bridge AI on the computer it runs on: its record never goes through your relay.')}</p>}
      {here && !d.cleared && (sure
        ? (
          <div className="st-row sb-sure" role="alert">
            <span className="small">{t('Delete {bot}\'s activity history? It can\'t be brought back.', { bot: d.name })}</span>
            <button type="button" className="btn small danger" onClick={forget}><Icon name="trash" size={12} /> {t('Delete the history')}</button>
            <button type="button" className="ghost-btn" onClick={() => setSure(false)}>{t('Cancel')}</button>
          </div>
        )
        : <div className="st-row"><button type="button" className="ghost-btn danger" onClick={() => setSure(true)}><Icon name="trash" size={12} /> {t('Delete its activity history…')}</button></div>)}
    </>
  )
}

export default function Bots() {
  const here = onThisComputer()
  const [list, setList] = useState(null)
  const [gone, setGone] = useState([]) // bots deleted whose record is kept
  const [error, setError] = useState(null)
  const [at, setAt] = useState(() => saved('cc-bot'))
  const [adding, setAdding] = useState(false)
  const [imported, setImported] = useState(null) // { id, problems }: what to check on a bot just imported
  const load = () => api('/bots').then((r) => { setList(r.bots); setGone(r.deleted || []); setError(null) }, (e) => setError(e.message))
  useEffect(() => {
    load()
    const every = setInterval(() => { if (!document.hidden) load() }, 8000)
    return () => clearInterval(every)
  }, [])
  const pick = (id) => { setAt(id); saved('cc-bot', id); setAdding(false) }
  if (error && !list) return <p className="st-note bad"><Icon name="alert" size={13} /> {error}</p>
  if (!list) return <div className="skeleton-rows"><div /><div /><div /></div>
  const old = gone.find((b) => b.id === at) || null
  const shown = old ? null : list.find((b) => b.id === at) ? at : list[0]?.id || null
  const left = () => { setAt(null); saved('cc-bot', ''); load() }
  return (
    <div className="st-sections sb">
      <div className="sb-bots" role="tablist" aria-label={t('Your bots')}>
        {list.map((b) => (
          <button key={b.id} type="button" role="tab" aria-selected={b.id === shown && !adding} className={`sb-chip ${b.id === shown && !adding ? 'on' : ''}`} onClick={() => pick(b.id)}>
            <span className={`sb-dot ${b.paused ? 'warn' : b.connected || b.state === 'connected' ? 'ok' : b.state === 'error' ? 'bad' : 'warn'}`} aria-hidden="true" />
            <span className="sb-chip-name">{b.name}</span>
            {b.paused && <Icon name="pause" size={11} />}
            {b.waiting > 0 && <span className="sb-count" aria-label={t('{n} waiting in Needs You', { n: b.waiting })}>{b.waiting}</span>}
          </button>
        ))}
        {gone.map((b) => (
          <button key={b.id} type="button" role="tab" aria-selected={b.id === old?.id && !adding} className={`sb-chip gone ${b.id === old?.id && !adding ? 'on' : ''}`} onClick={() => pick(b.id)}>
            <Icon name="archive" size={12} />
            <span className="sb-chip-name">{t('{name} (deleted)', { name: b.name })}</span>
          </button>
        ))}
        {(list.length > 0 || gone.length > 0) && here && <button type="button" className={`sb-chip add ${adding ? 'on' : ''}`} onClick={() => setAdding(true)}><Icon name="plus" size={12} /> {t('New Bot')}</button>}
      </div>
      {!list.length && !gone.length && !adding && <FirstBot here={here} onStart={() => setAdding(true)} />}
      {((!list.length && gone.length > 0 && !old) || adding) && <NewBot here={here} onMade={(id, problems) => { setImported(problems?.length ? { id, problems } : null); pick(id); load() }} />}
      {old && !adding && <DeletedBot key={`${old.id}-${old.cleared || ''}`} d={old} here={here} reload={load} />}
      {shown && !adding && !old && <Bot key={shown} id={shown} here={here} onChanged={load} onGone={left} notice={imported?.id === shown ? imported.problems : null} />}
    </div>
  )
}
