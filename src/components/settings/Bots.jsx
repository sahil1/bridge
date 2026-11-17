import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import CopyButton from '../CopyButton.jsx'
import { api, apiUrl, onThisComputer } from '../../api.js'
import { ago } from '../Machines.jsx'
import { t } from '../../i18n/index.js'
import './bots.css'

// Settings › Bots (a beta feature, off to start; its id slack-bot): your own bots in Slack, each its
// own Slack app with the name you give it, which people you choose ask by mentioning it, messaging
// it, or replying in its threads, each question answered by an agent that can only read
// (server/frontdesk.js) and the answer waiting in Needs You for you to send or discard. At the top,
// your bots and New Bot. For the one picked, two tabs:
//   Set Up: whether it's connected and, when it isn't, why (and when its Slack app needs the new
//     manifest); its name and description, which are its name in Slack; making the app (the
//     manifest to paste, the two tokens) and connecting it; who may ask, and what anyone else gets;
//     its instructions (written here, or a file in one of its folders); the folders it reads from;
//     how answers go, which agent answers, and a note when that agent answers through a personal
//     plan.
//   Activity: its record (server/trace.js): every conversation it took part in, each as a timeline,
//     with search, filters and export, and whether the record holds.
// A bot deleted keeps its record, unless you tick that it goes too: it's there under its name,
// marked deleted, to look at and export until the time it's kept for runs out, or you delete it.
// What must hold (who may ask, the folders, read-only, which agent) are settings here, enforced by
// Bridge AI; the instructions only steer. Changes only on the computer it runs on; elsewhere
// they're shown, not changed.

const STATE = {
  connected: 'ok', connecting: 'warn', reconnecting: 'warn', error: 'bad', 'no-tokens': 'warn', off: 'warn',
}
// Where a question was asked, as Slack shows it.
const placeOf = (p) => (p?.kind === 'dm' ? t('a direct message') : p?.name ? `#${p.name}` : t('a channel'))
const saved = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v) } catch { /* private window */ } return null }

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

// An app made from an earlier manifest lacks scopes this one needs: which, and how to update it.
function UpdateApp({ d, here, onAgain }) {
  const lacks = d.scopes?.missing || []
  if (!d.tokens || !lacks.length) return null
  const json = JSON.stringify(d.manifest, null, 2)
  return (
    <section className="st-sec sb-update" data-setting="slack-update">
      <h4><Icon name="alert" size={13} /> {t('Update Your Slack App')}</h4>
      <p className="small">{t('Your Slack app was made from an earlier manifest: it lacks {scopes}. Until it\'s updated, {bot} can\'t follow replies in its threads, read the conversation it\'s called into or react to questions.', { scopes: lacks.join(', '), bot: d.name })}</p>
      <ol className="sb-steps">
        <li><span>{t('Copy the new manifest.')}</span><div className="st-row"><CopyButton text={json} label={t('Copy the manifest')} className="btn small" /></div></li>
        <li><span>{t('In your app\'s page on api.slack.com, open App Manifest, paste it over what\'s there, and Save Changes.')}</span></li>
        <li><span>{t('Reinstall it: Install App › Reinstall to Workspace › Allow. The tokens stay the same.')}</span></li>
        <li><span>{t('Then Connect again here.')}</span>{here && <div className="st-row"><button type="button" className="btn small" onClick={onAgain}><Icon name="refresh" size={12} /> {t('Connect again')}</button></div>}</li>
      </ol>
    </section>
  )
}

// Its name and description: its name in Slack, through the manifest. The icon is set in Slack.
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
  // nested: inside How the app is made, where the manifest is only copied (no fold inside a fold).
  const stepsOf = (nested) => (
    <ol className="sb-steps">
      <li>
        <span>{t('Make the app: in Slack\'s app page, Create New App › From a manifest, pick your workspace and paste this manifest. It carries the name {bot}.', { bot: d.name })}</span>
        <div className="st-row">
          <a className="btn small" href={create} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> {t('Open Slack\'s app page')}</a>
          <CopyButton text={json} label={t('Copy the manifest')} className="btn small" />
        </div>
        {!nested && <details className="sb-manifest"><summary><Icon name="chevron" size={11} />{t('The manifest')}</summary><pre>{json}</pre></details>}
      </li>
      <li><span>{t('Give it an app-level token: Basic Information › App-Level Tokens › Generate Token and Scopes, add the scope connections:write, then copy the token (it starts with xapp-).')}</span></li>
      <li><span>{t('Install it: Install App › Install to Workspace › Allow, then copy the Bot User OAuth Token (it starts with xoxb-).')}</span></li>
      <li><span>{t('Paste both below and Connect.')}</span></li>
      <li><span>{t('Ask it: invite it to a channel (/invite @{bot}) and mention it there, or send it a direct message. A reply in a thread it answered in needs no mention.', { bot: d.bot?.name || d.name })}</span></li>
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
            <details className="sb-how"><summary><Icon name="chevron" size={11} />{t('How the app is made')}</summary>{stepsOf(true)}</details>
          </>
        )
        : <>{stepsOf(false)}{form}</>}
      {!here && <p className="muted small">{t('Connect it in Bridge AI on the computer it runs on.')}</p>}
      {msg && <p className={`small ${msg.ok ? 'muted' : 'error-text'}`} role="status">{msg.text}</p>}
    </section>
  )
}

// Who may ask: people picked from the workspace by name, or everyone in the channels it's in; never
// guests or people from other companies. And what anyone else gets.
function Askers({ d, here, save }) {
  const [q, setQ] = useState('')
  const [people, setPeople] = useState(null)
  const [error, setError] = useState(null)
  const connected = !!d.tokens
  useEffect(() => {
    if (!connected) return
    api(`/bots/${d.id}/people`).then((r) => { setPeople(r.people); setError(null) }, (e) => setError(e.message))
  }, [connected, d.id])
  const s = d.settings
  const askers = s.askers
  const have = new Set(askers.map((a) => a.id))
  const found = useMemo(() => {
    const x = q.trim().toLowerCase()
    return x ? (people || []).filter((p) => !have.has(p.id) && `${p.name} ${p.detail || ''}`.toLowerCase().includes(x)).slice(0, 6) : []
  }, [q, people, s.askers]) // eslint-disable-line react-hooks/exhaustive-deps
  const add = (p) => { setQ(''); save({ askers: [...askers, { id: p.id, name: p.name }] }) }
  const drop = (id) => save({ askers: askers.filter((a) => a.id !== id) })
  return (
    <section className="st-sec" data-setting="slack-askers">
      <h4>{t('Who Can Ask')}</h4>
      <div className="sb-modes" role="radiogroup" aria-label={t('Who Can Ask')}>
        <label className={`sb-mode ${s.who === 'named' ? 'on' : ''}`}>
          <input type="radio" name={`sb-who-${d.id}`} checked={s.who === 'named'} disabled={!here} onChange={() => save({ who: 'named' })} />
          <span><b>{t('People you name')}</b><span className="muted small">{t('Only the people you add here get answers, wherever they ask.')}</span></span>
        </label>
        <label className={`sb-mode ${s.who === 'channels' ? 'on' : ''}`}>
          <input type="radio" name={`sb-who-${d.id}`} checked={s.who === 'channels'} disabled={!here} onChange={() => save({ who: 'channels' })} />
          <span><b>{t('Everyone in channels it\'s invited to')}</b><span className="muted small">{t('Anyone in your workspace who mentions it in a channel it\'s in, or messages it directly.')}</span></span>
        </label>
      </div>
      <p className="muted small">{t('Guests and people from other companies (in channels shared through Slack Connect) are never answered, either way.')}</p>
      {s.who === 'named' && (
        <>
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
        </>
      )}
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

// How answers go, which agent answers (and a note on its terms when it answers through a personal
// plan), copies of your agents' conversations, and how long its record is kept.
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
    </section>
  )
}

function SetUp({ d, here, save, reload, onDelete, again }) {
  return (
    <>
      <Status d={d} here={here} onAgain={again} />
      <UpdateApp d={d} here={here} onAgain={again} />
      <Identity d={d} here={here} save={save} onDelete={onDelete} />
      <Connect d={d} here={here} reload={reload} />
      <Askers d={d} here={here} save={save} />
      <Instructions d={d} here={here} save={save} />
      <ReadsFrom d={d} here={here} save={save} />
      <Replies d={d} here={here} save={save} />
    </>
  )
}

// ---------- Activity ----------
const OUTCOMES = () => [
  ['sent', t('Sent')], ['edited', t('Sent, as you edited it')], ['auto', t('Sent without asking')], ['waiting', t('Waiting for you')], ['passed-on', t('Passed on to you')],
  ['discarded', t('Discarded')], ['refused', t('Refused')], ['failed', t('Failed')], ['answering', t('Being answered')], ['skipped', t('Not for it')],
]
const REFUSED = () => ({ 'not-allowed': t('not someone it answers'), guest: t('a guest'), external: t('from another company'), unknown: t('Slack couldn\'t say who they are'), empty: t('no question with the mention') })
// One event of a conversation, as a line of its timeline.
function eventLine(e) {
  const who = e.person?.name || e.person?.id || t('Someone')
  switch (e.type) {
    case 'received': return e.how === 'follow-up' ? t('{name} replied in the thread: “{text}”', { name: who, text: e.text }) : e.how === 'dm' ? t('{name} messaged it: “{text}”', { name: who, text: e.text }) : t('{name} mentioned it: “{text}”', { name: who, text: e.text })
    case 'refused': return t('Refused: {why}', { why: REFUSED()[e.why] || e.why })
    case 'context': return e.problem ? t('Read the conversation: {why}', { why: e.problem }) : t('Read {n} earlier messages and {pins} pinned, as context', { n: e.messages?.length || 0, pins: e.pins?.length || 0 })
    case 'run.started': return t('{agent} started, reading {folders}{from}; instructions {version} from {source}', { agent: e.agent === 'codex' ? 'Codex' : 'Claude Code', folders: e.folders?.length ? e.folders.join(', ') : t('no folders'), from: e.from ? t(', going on from its earlier conversation') : '', version: e.instructions?.hash || '', source: e.instructions?.source === 'file' ? e.instructions.path : t('Settings') }) + (e.instructions?.problem ? ` (${e.instructions.problem})` : '')
    case 'run.read': return t('Opened {files}', { files: (e.files || []).map((f) => f.what).join(', ') })
    case 'run.finished': return e.end === 'finished' ? t('Finished in {s} s', { s: Math.round((e.took || 0) / 1000) }) : t('Ended: {why}', { why: e.error || e.end })
    case 'draft': return e.needsOwner ? t('Passed on to you: {why}', { why: e.why || '' }) : e.auto ? t('Answered: “{text}”', { text: e.text }) : t('Drafted for you to check: “{text}”', { text: e.text })
    case 'draft.edited': return t('You edited it: “{text}”', { text: e.after })
    case 'sent': return e.kind === 'answer' ? (e.how === 'auto' ? t('Sent without asking') : t('Sent by {name}', { name: e.by || t('you') })) : e.kind === 'hold' ? t('Told them it\'s passed on to you') : t('Told them: “{text}”', { text: e.text })
    case 'discarded': return t('Discarded: nothing sent')
    case 'skipped': return t('Not for it: no answer')
    case 'posted.failed': return t('Couldn\'t post to Slack: {why}', { why: e.error })
    case 'reaction': return e.ok ? (e.removed ? t('Took :{name}: off', { name: e.name }) : t('Reacted :{name}:', { name: e.name })) : t('Couldn\'t react :{name}:: {why}', { name: e.name, why: e.error })
    case 'message.changed': return t('{name} edited a message: “{text}”', { name: who, text: e.text })
    case 'message.deleted': return t('{name} deleted a message', { name: who })
    default: return e.type
  }
}

function Timeline({ d, conv, onClose }) {
  const [x, setX] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => { api(`/bots/${d.id}/activity/${encodeURIComponent(conv)}`).then(setX, (e) => setError(e.message)) }, [d.id, conv])
  const exp = (f) => apiUrl(`/bots/${d.id}/export?format=${f}&conv=${encodeURIComponent(conv)}`)
  return (
    <div className="sb-timeline" role="region" aria-label={t('One conversation')}>
      <div className="sb-tl-head">
        <b className="small">{t('Timeline')}</b>
        <span className="sb-grow" />
        <a className="ghost-btn small" href={exp('md')} download><Icon name="export" size={12} /> {t('Export as Markdown')}</a>
        <a className="ghost-btn small" href={exp('jsonl')} download>JSONL</a>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('Close')}><Icon name="x" size={12} /></button>
      </div>
      {error && <p className="error-text small">{error}</p>}
      {!x && !error && <div className="skeleton-rows"><div /><div /></div>}
      {x && (
        <ol className="sb-tl">
          {x.events.map((e, i) => (
            <li key={`${e.at}-${i}`} className={`ev-${e.type.replace('.', '-')} ${e.ok === false || e.type === 'posted.failed' || e.type === 'refused' ? 'bad' : ''}`}>
              <time className="muted small" dateTime={e.at}>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
              <span className="sb-tl-type mono">{e.type}</span>
              <span className="small sb-tl-text">{eventLine(e)}</span>
              {e.type === 'context' && (e.messages?.length > 0 || e.pins?.length > 0) && (
                <details className="sb-ctx"><summary><Icon name="chevron" size={11} />{t('What it read')}</summary><ul>{[...(e.messages || []), ...(e.pins || [])].map((m, k) => <li key={k} className="small"><b>{m.you ? d.name : m.person?.name || m.person?.id}</b>: {m.text}</li>)}</ul></details>
              )}
            </li>
          ))}
        </ol>
      )}
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
                <Icon name={['sent', 'edited', 'auto'].includes(c.outcome) ? 'send' : c.outcome === 'refused' ? 'blocked' : c.outcome === 'discarded' ? 'x' : 'chat'} size={12} />
                <span className="sb-log-text">
                  <span className="small"><b>{c.from?.name || c.from?.id || t('Someone')}</b> <span className="muted">{t('in {place}', { place: placeOf(c.place) })}{c.messages > 1 ? ` · ${t('{n} messages', { n: c.messages })}` : ''}</span></span>
                  <span className="sb-log-q">{c.asked}</span>
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

// ---------- One bot ----------
function Bot({ id, here, onGone, onChanged }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [tab, setTab] = useState(() => (saved('cc-bot-tab') === 'activity' ? 'activity' : 'setup'))
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
    const plain = Object.fromEntries(Object.entries(patch).filter(([k]) => !['readsFrom', 'instructions', 'name', 'description', 'instructionsFile'].includes(k)))
    asked.current++; unsaved.current++
    setD((x) => x && { ...x, settings: { ...x.settings, ...plain } })
    const done = saving.current.then(async () => {
      try { await api(`/bots/${id}/settings`, { method: 'POST', body: patch }); setNote(null); if (patch.name) onChanged(); return true } catch (e) { setNote(e.message); return false } finally { unsaved.current--; await load() }
    })
    saving.current = done
    return done
  }
  const again = async () => { try { await api(`/bots/${id}/connect`, { method: 'POST' }) } catch (e) { setNote(e.message) } load() }
  const remove = async (history) => { try { await api(`/bots/${id}${history ? '?history=1' : ''}`, { method: 'DELETE' }); onGone() } catch (e) { setNote(e.message) } }
  const pickTab = (x) => { setTab(x); saved('cc-bot-tab', x) }
  if (error && !d) return <p className="st-note bad"><Icon name="alert" size={13} /> {error}</p>
  if (!d) return <div className="skeleton-rows"><div /><div /><div /></div>
  return (
    <>
      <div className="seg sb-tabs" role="tablist" aria-label={d.name}>
        <button type="button" role="tab" aria-selected={tab === 'setup'} className={tab === 'setup' ? 'on' : ''} onClick={() => pickTab('setup')}>{t('Set Up')}</button>
        <button type="button" role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'on' : ''} onClick={() => pickTab('activity')}>{t('Activity')}{d.waiting > 0 && <span className="sb-tag">{t('{n} waiting in Needs You', { n: d.waiting })}</span>}</button>
      </div>
      {note && <p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {note}</p>}
      {tab === 'setup' ? <SetUp d={d} here={here} save={save} reload={load} onDelete={remove} again={again} />
        // (Its record never goes through the relay: it's looked at on the computer it's kept on.)
        : here ? <Activity d={d} here={here} save={save} /> : <p className="muted small" data-setting="slack-activity">{t('Its activity is shown in Bridge AI on the computer it runs on: its record never goes through your relay.')}</p>}
    </>
  )
}

// A new bot, by its name.
function NewBot({ here, onMade, first }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const make = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try { const b = await api('/bots', { method: 'POST', body: { name } }); setName(''); onMade(b.id) } catch (err) { setError(err.message) }
    setBusy(false)
  }
  return (
    <form className="sb-new" onSubmit={make} data-setting="slack-new">
      {first && <p className="small">{t('A bot is your own Slack app, with the name you give it: people you choose ask it in Slack, and an agent that can only read answers from the folders you give it, each answer waiting for you to send unless you say otherwise.')}</p>}
      <div className="sb-add">
        <input className="st-input" value={name} maxLength={35} onChange={(e) => setName(e.target.value)} placeholder={t('Its name, as Slack shows it: Atlas, Pricing Desk…')} aria-label={t('The new bot\'s name')} disabled={!here} />
        <button type="submit" className="btn small primary" disabled={!here || busy || !name.trim()}><Icon name="plus" size={12} /> {t('New Bot')}</button>
      </div>
      {error && <p className="error-text small" role="alert">{error}</p>}
      {!here && <p className="muted small">{t('Make one in Bridge AI on the computer it runs on.')}</p>}
    </form>
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
            <span className={`sb-dot ${b.state === 'connected' ? 'ok' : b.state === 'error' ? 'bad' : 'warn'}`} aria-hidden="true" />
            <span className="sb-chip-name">{b.name}</span>
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
      {((!list.length && !old) || adding) && <NewBot here={here} first={!list.length && !gone.length} onMade={(id) => { pick(id); load() }} />}
      {old && !adding && <DeletedBot key={`${old.id}-${old.cleared || ''}`} d={old} here={here} reload={load} />}
      {shown && !adding && !old && <Bot key={shown} id={shown} here={here} onChanged={load} onGone={left} />}
    </div>
  )
}
