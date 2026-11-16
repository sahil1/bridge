import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import CopyButton from '../CopyButton.jsx'
import { api, onThisComputer } from '../../api.js'
import { ago } from '../Machines.jsx'
import { t } from '../../i18n/index.js'
import './slackbot.css'

// Settings › Slack Bot (a beta feature, off to start): your own Slack app, which people you name ask
// by mentioning it or messaging it, each question answered by a read-only agent Bridge AI picks
// (server/frontdesk.js) and the answer waiting in Needs You for you to send or discard. Here, in
// order: whether it's connected and, when it isn't, why; making the app (the manifest to paste, the
// two tokens) and connecting it; who may ask, picked from the workspace's people, and what anyone
// else gets; the folders opened to questions, each with what it's about; how answers go (Review each
// one, or Answer without asking where the limits hold), what answers when nothing fits, and which
// agent; and the log of what came in and what went out. Connecting and the settings only on the
// computer it runs on; elsewhere they're shown, not changed.

const STATE = {
  connected: 'ok', connecting: 'warn', reconnecting: 'warn', error: 'bad', 'no-tokens': 'warn', off: 'warn',
}
// Where a question was asked, as Slack shows it.
const placeOf = (q) => (q.place?.kind === 'dm' ? t('a direct message') : q.place?.name ? `#${q.place.name}` : t('a channel'))

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
      <p className="muted small">{t('Through Socket Mode, from this computer: Slack is never reached through Bold Bridge or your relay. While this computer sleeps or Bridge AI is closed, questions wait in Slack and are answered once it\'s back (a mention in a thread\'s replies meanwhile is missed).')}</p>
    </div>
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
    try { await api('/slack-bot/tokens', { method: 'POST', body: { appToken: app, botToken: bot } }); setApp(''); setBot(''); setChange(false); setMsg({ ok: true, text: t('Connected. Pick who can ask, below.') }) } catch (err) { setMsg({ text: err.message }) }
    setBusy(null)
    reload()
  }
  const forget = async () => {
    setBusy('forget')
    try { await api('/slack-bot/tokens', { method: 'DELETE' }); setMsg({ ok: true, text: t('Disconnected, and the tokens deleted from this computer.') }) } catch (err) { setMsg({ text: err.message }) }
    setBusy(null)
    reload()
  }
  // nested: inside How the app is made, where the manifest is only copied (no fold inside a fold).
  const stepsOf = (nested) => (
    <ol className="sb-steps">
      <li>
        <span>{t('Make the app: in Slack\'s app page, Create New App › From a manifest, pick your workspace and paste this manifest.')}</span>
        <div className="st-row">
          <a className="btn small" href={create} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> {t('Open Slack\'s app page')}</a>
          <CopyButton text={json} label={t('Copy the manifest')} className="btn small" />
        </div>
        {!nested && <details className="sb-manifest"><summary><Icon name="chevron" size={11} />{t('The manifest')}</summary><pre>{json}</pre></details>}
      </li>
      <li><span>{t('Give it an app-level token: Basic Information › App-Level Tokens › Generate Token and Scopes, add the scope connections:write, then copy the token (it starts with xapp-).')}</span></li>
      <li><span>{t('Install it: Install App › Install to Workspace › Allow, then copy the Bot User OAuth Token (it starts with xoxb-).')}</span></li>
      <li><span>{t('Paste both below and Connect.')}</span></li>
      <li><span>{t('Ask it: invite it to a channel (/invite @Bridge AI) and mention it there, or send it a direct message.')}</span></li>
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
      <p className="muted small">{t('Each person makes their own Slack app, in their own workspace: no app is shared, and its tokens stay on this computer, readable by you only.')}</p>
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
            <details className="sb-how"><summary><Icon name="chevron" size={11} />{t('How the app is made')}</summary>{stepsOf(true)}</details>
          </>
        )
        : <>{stepsOf(false)}{form}</>}
      {!here && <p className="muted small">{t('Connect it in Bridge AI on the computer it runs on.')}</p>}
      {msg && <p className={`small ${msg.ok ? 'muted' : 'error-text'}`} role="status">{msg.text}</p>}
    </section>
  )
}

// Who may ask: people picked from the workspace, by name; and what anyone else gets.
function Askers({ d, here, save }) {
  const [q, setQ] = useState('')
  const [people, setPeople] = useState(null)
  const [error, setError] = useState(null)
  const connected = !!d.tokens
  useEffect(() => {
    if (!connected) return
    api('/slack-bot/people').then((r) => { setPeople(r.people); setError(null) }, (e) => setError(e.message))
  }, [connected])
  const askers = d.settings.askers
  const have = new Set(askers.map((a) => a.id))
  const found = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? (people || []).filter((p) => !have.has(p.id) && `${p.name} ${p.detail || ''}`.toLowerCase().includes(s)).slice(0, 6) : []
  }, [q, people, d.settings.askers]) // eslint-disable-line react-hooks/exhaustive-deps
  const add = (p) => { setQ(''); save({ askers: [...askers, { id: p.id, name: p.name }] }) }
  const drop = (id) => save({ askers: askers.filter((a) => a.id !== id) })
  return (
    <section className="st-sec" data-setting="slack-askers">
      <h4>{t('Who Can Ask')}</h4>
      <p className="muted small">{t('Only the people you add here get answers. Messages from your own Slack account are treated the same way.')}</p>
      {askers.length > 0
        ? (
          <ul className="sb-askers">
            {askers.map((a) => (
              <li key={a.id}>
                <span className="sb-av" aria-hidden="true">{(a.name || '?').slice(0, 1).toUpperCase()}</span>
                <span className="sb-asker-name">{a.name || a.id}</span>
                {here && <button type="button" className="icon-btn" onClick={() => drop(a.id)} aria-label={t('Remove {name}', { name: a.name || a.id })}><Icon name="x" size={12} /></button>}
              </li>
            ))}
          </ul>
        )
        : <p className="small sb-none">{t('Nobody yet: until you add someone, every question gets what anyone else gets.')}</p>}
      {here && connected && (
        <div className="sb-pick">
          <label className="sb-search"><Icon name="search" size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Add someone from {team}', { team: d.team?.name || t('your workspace') })} aria-label={t('Add someone who can ask')} /></label>
          {found.length > 0 && (
            <ul className="sb-found" role="listbox" aria-label={t('People in your workspace')}>
              {found.map((p) => (
                <li key={p.id}><button type="button" role="option" aria-selected="false" onClick={() => add(p)}><span className="sb-av" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span><span className="sb-found-text"><b>{p.name}</b>{p.detail && <span className="muted small">{p.detail}</span>}</span><Icon name="plus" size={12} /></button></li>
              ))}
            </ul>
          )}
          {q.trim() && people && !found.length && <p className="muted small">{t('Nobody else by that name.')}</p>}
        </div>
      )}
      {!connected && <p className="muted small">{t('Connect the app first to pick from your workspace\'s people.')}</p>}
      {error && <p className="error-text small">{t('Couldn\'t list your workspace\'s people: {error}', { error })}</p>}
      <div className="st-row sb-others">
        <span className="small">{t('Anyone else who asks gets')}</span>
        <div className="seg" role="radiogroup" aria-label={t('Anyone else who asks gets')}>
          <button type="button" role="radio" aria-checked={d.settings.others === 'polite'} className={d.settings.others === 'polite' ? 'on' : ''} disabled={!here} onClick={() => save({ others: 'polite' })}>{t('A polite no')}</button>
          <button type="button" role="radio" aria-checked={d.settings.others === 'silent'} className={d.settings.others === 'silent' ? 'on' : ''} disabled={!here} onClick={() => save({ others: 'silent' })}>{t('No reply')}</button>
        </div>
      </div>
    </section>
  )
}

// The folders opened to questions, each with what it's about (its topics pick it).
function Folders({ d, here, save }) {
  const [where, setWhere] = useState('')
  const [topics, setTopics] = useState('')
  const [edits, setEdits] = useState({}) // path -> topics as typed, saved when you leave the field
  const pickFolder = window.bridgeApp?.pickFolder
  const list = d.folders || []
  const asSaved = (f) => ({ path: f.path, topics: edits[f.path] ?? f.topics })
  const add = async (e) => {
    e.preventDefault()
    const ok = await save({ folders: [...list.map(asSaved), { path: where.trim(), topics: topics.trim() }] })
    if (ok) { setWhere(''); setTopics('') }
  }
  const keep = (f) => { if (edits[f.path] !== undefined && edits[f.path] !== f.topics) save({ folders: list.map(asSaved) }) }
  const drop = (f) => save({ folders: list.filter((x) => x !== f).map(asSaved) })
  return (
    <section className="st-sec" data-setting="slack-folders">
      <h4>{t('Folders Opened to Questions')}</h4>
      <p className="muted small">{t('A question goes to the folder whose topics it mentions, or to an agent of yours working in one on that subject. What answers can only read that folder: it can\'t change files, run commands or send anything.')}</p>
      {list.length > 0 && (
        <ul className="sb-folders">
          {list.map((f) => (
            <li key={f.path} className={f.ok ? '' : 'bad'}>
              <Icon name="folder" size={14} />
              <div className="sb-folder-text">
                <code title={f.path}>{f.shown}</code>
                <input className="st-input" value={edits[f.path] ?? f.topics} onChange={(e) => setEdits((x) => ({ ...x, [f.path]: e.target.value }))} onBlur={() => keep(f)} disabled={!here} placeholder={t('What it\'s about: pricing, the launch, …')} aria-label={t('Topics for {folder}', { folder: f.name })} />
                {!f.ok && <span className="error-text small">{f.problem}</span>}
              </div>
              {here && <button type="button" className="icon-btn" onClick={() => drop(f)} aria-label={t('Close {folder} to questions', { folder: f.name })}><Icon name="x" size={12} /></button>}
            </li>
          ))}
        </ul>
      )}
      {!list.length && <p className="small sb-none">{t('None yet: only a throwaway agent answers, from what it knows.')}</p>}
      {here && (
        <form className="sb-add" onSubmit={add}>
          <input className="st-input mono" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="~/projects/pricing" aria-label={t('Folder')} spellCheck={false} />
          {pickFolder && <button type="button" className="btn small" onClick={async () => { const p = await pickFolder().catch(() => null); if (p) setWhere(p) }}>{t('Choose…')}</button>}
          <input className="st-input" value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={t('What it\'s about: pricing, the launch, …')} aria-label={t('What it\'s about')} />
          <button type="submit" className="btn small" disabled={!where.trim()}><Icon name="plus" size={12} /> {t('Open to questions')}</button>
        </form>
      )}
    </section>
  )
}

// How answers go, what answers when nothing fits, and which agent.
function Replies({ d, here, save }) {
  const s = d.settings
  const agents = d.agents.filter((a) => a.installed)
  const by = d.answerer
  return (
    <section className="st-sec" data-setting="slack-replies">
      <h4>{t('Answers')}</h4>
      <div className="sb-modes" role="radiogroup" aria-label={t('How answers go')}>
        <label className={`sb-mode ${!s.auto ? 'on' : ''}`}>
          <input type="radio" name="sb-auto" checked={!s.auto} disabled={!here} onChange={() => save({ auto: false })} />
          <span><b>{t('Review each one')}</b><span className="muted small">{t('Each answer waits in Needs You, to edit, send or discard. Nothing goes to Slack until you send it.')}</span></span>
        </label>
        <label className={`sb-mode ${s.auto ? 'on' : ''}`}>
          <input type="radio" name="sb-auto" checked={!!s.auto} disabled={!here} onChange={() => save({ auto: true })} />
          <span><b>{t('Answer without asking')}</b><span className="muted small">{t('An answer from a folder you opened, or from a throwaway agent, goes straight to Slack when the agent is held to its folder (Claude Code). An answer from a copy of an agent\'s conversation, or from Codex, which can read anywhere, still waits for you.')}</span></span>
        </label>
      </div>
      {s.auto && by && !by.confined && <p className="st-note warn"><Icon name="alert" size={13} />{t('{agent} answers here and isn\'t held to its folder, so every answer still waits for you.', { agent: agents.find((a) => a.kind === by.kind)?.label || by.kind })}</p>}
      <label className="st-check">
        <input type="checkbox" checked={s.throwaway} disabled={!here} onChange={(e) => save({ throwaway: e.target.checked })} />
        <span><b>{t('When no folder fits, a throwaway agent answers')}</b> <span className="muted small">{t('In an empty folder of its own, from what it knows. Off, those questions come to you to answer.')}</span></span>
      </label>
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
    </section>
  )
}

// What a question came to: answered and sent, waiting, discarded, refused, passed to you.
function outcome(q) {
  if (q.state === 'refused') return q.refused === 'empty' ? t('No question with the mention; told how to ask') : q.told ? t('Not someone you added: told so') : t('Not someone you added: no reply')
  if (q.state === 'sent') return q.auto ? t('Sent without asking: “{text}”', { text: q.sentText }) : q.edited ? t('Sent, as you edited it: “{text}”', { text: q.sentText }) : t('Sent: “{text}”', { text: q.sentText })
  if (q.state === 'discarded') return t('Discarded: nothing sent')
  if (q.state === 'sending') return q.problem ? t('Sending: {why}', { why: q.problem }) : t('Sending…')
  if (q.state === 'answering') return q.route?.to === 'folder' ? t('Being answered from {folder}', { folder: q.route.name }) : q.route?.to === 'agent' ? t('Being answered from a copy of {agent}\'s conversation', { agent: q.route.name }) : t('Being answered by a throwaway agent')
  if (q.needsOwner) return t('Waiting for your reply in Needs You ({why}); they were told it\'s passed on', { why: q.why })
  return q.problem ? t('Waiting in Needs You: {why}', { why: q.problem }) : t('Waiting in Needs You')
}
const EVENT = { connected: () => t('Connected'), dropped: (e) => t('Disconnected: {why}', { why: e.why }), stopped: (e) => t('Stopped: {why}', { why: e.why }), missed: (e) => (e.ok ? t('Caught up: {why}', { why: e.why }) : e.why), post: (e) => t('Couldn\'t post to Slack: {why}', { why: e.why }), question: (e) => e.why, event: (e) => e.why }

function Log({ d }) {
  const rows = [...(d.questions || []).map((q) => ({ at: q.heardAt || q.at, q })), ...(d.events || []).map((e) => ({ at: e.at, e }))]
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40)
  return (
    <section className="st-sec" data-setting="slack-log">
      <h4 className="sb-log-head">{t('What Came In and What Went Out')}{d.waiting > 0 && <span className="sb-tag">{t('{n} waiting in Needs You', { n: d.waiting })}</span>}</h4>
      {!rows.length
        ? <p className="muted small">{t('Nothing yet. Each question, who asked it and where, and what was sent back shows here.')}</p>
        : (
          <ul className="sb-log">
            {rows.map((r, i) => (r.q
              ? (
                <li key={r.q.id} className={`q s-${r.q.state}`}>
                  <Icon name={r.q.state === 'sent' ? 'send' : r.q.state === 'refused' ? 'blocked' : r.q.state === 'discarded' ? 'x' : 'chat'} size={12} />
                  <div className="sb-log-text">
                    <span className="small"><b>{r.q.from?.name || r.q.from?.id || t('Someone')}</b> <span className="muted">{t('in {place}', { place: placeOf(r.q) })}{r.q.late ? ` · ${t('asked while away')}` : ''}</span></span>
                    <span className="sb-log-q">{r.q.text}</span>
                    <span className="muted small sb-log-out">{outcome(r.q)}</span>
                  </div>
                  <time className="muted small" dateTime={r.at}>{ago(r.at)}</time>
                </li>
              )
              : (
                <li key={`e${i}`} className={`e ${r.e.ok ? '' : 'bad'}`}>
                  <Icon name={r.e.ok ? 'link' : 'alert'} size={12} />
                  <div className="sb-log-text"><span className="small">{(EVENT[r.e.what] || ((e) => e.why || e.what))(r.e)}</span></div>
                  <time className="muted small" dateTime={r.at}>{ago(r.at)}</time>
                </li>
              )))}
          </ul>
        )}
    </section>
  )
}

export default function SlackBot() {
  const here = onThisComputer()
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const alive = useRef(true)
  const load = () => api('/slack-bot').then((x) => { if (alive.current) { setD(x); setError(null) } }, (e) => alive.current && setError(e.message))
  useEffect(() => {
    alive.current = true
    load()
    const id = setInterval(() => { if (!document.hidden) load() }, 4000)
    return () => { alive.current = false; clearInterval(id) }
  }, [])
  // A change to its settings: saved, then shown as the server has it. False when it wasn't taken.
  const save = async (patch) => {
    try { await api('/slack-bot/settings', { method: 'POST', body: patch }); setNote(null); await load(); return true } catch (e) { setNote(e.message); return false }
  }
  const again = async () => { try { await api('/slack-bot/connect', { method: 'POST' }) } catch (e) { setNote(e.message) } load() }
  if (error && !d) return <p className="st-note bad"><Icon name="alert" size={13} /> {error}</p>
  if (!d) return <div className="skeleton-rows"><div /><div /><div /></div>
  return (
    <div className="st-sections sb">
      <Status d={d} here={here} onAgain={again} />
      {note && <p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {note}</p>}
      <Connect d={d} here={here} reload={load} />
      <Askers d={d} here={here} save={save} />
      <Folders d={d} here={here} save={save} />
      <Replies d={d} here={here} save={save} />
      <Log d={d} />
    </div>
  )
}
