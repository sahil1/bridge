import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'
import { ago } from '../Machines.jsx'
import { platName } from '../settings/Bots.jsx'
import { t } from '../../i18n/index.js'
import './bots-home.css'

// Test this connection (server/conncheck.js): every part of a connection checked end to end, from
// its tokens and scopes to an event coming back, you linked there, files, status and how fast Slack
// answers, and each bot on it able to answer. Each check is a line: passed, a warning, failed (with
// what to do) or skipped. The last result stays on the card (c.check) until it's run again. The
// checks' own words are the server's, in English. And Try a message: which bot a message would go
// to, and why, with nothing sent, answered or kept (connhub.js dry).

const ICON = { ok: 'check', warn: 'info', fail: 'alert', skip: 'minus' }
const listOf = (r) => (Array.isArray(r) ? r : Array.isArray(r?.checks) ? r.checks : Array.isArray(r?.results) ? r.results : [])
const atOf = (r) => (Array.isArray(r) ? null : r?.at || null)

export function checkSummary(list) {
  const fail = list.filter((x) => x.state === 'fail').length
  const warn = list.filter((x) => x.state === 'warn').length
  if (!list.length) return null
  if (fail) return { state: 'fail', text: fail === 1 ? t('1 check failed') : t('{n} checks failed', { n: fail }) }
  if (warn) return { state: 'warn', text: warn === 1 ? t('Working, with 1 warning') : t('Working, with {n} warnings', { n: warn }) }
  return { state: 'ok', text: t('Every check passed') }
}

export default function TestConnection({ c, onDone }) {
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState(null) // { list, at }
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState(null)
  const [all, setAll] = useState(false)
  const last = out || (c.check ? { list: listOf(c.check), at: atOf(c.check) } : null)
  // (What needs you first: the warnings and failures; every check a click away.)
  const shown = (last?.list || []).filter((x) => all || x.state === 'warn' || x.state === 'fail')
  const hidden = (last?.list?.length || 0) - shown.length
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api(`/connections/${c.id}/check`, { method: 'POST' })
      setOut({ list: listOf(r), at: atOf(r) || new Date().toISOString() })
      onDone?.()
    } catch (e) {
      if (e.status === 404) setMissing(true)
      else setError(e.message)
    }
    setBusy(false)
  }
  const sum = last ? checkSummary(last.list) : null
  return (
    <div className="bh-test" data-setting="connection-test">
      <div className="st-row bh-test-row">
        <button type="button" className="btn small" disabled={busy || missing} onClick={run} aria-busy={busy}><Icon name={busy ? 'refresh' : 'check'} size={12} className={busy ? 'spin' : ''} /> {busy ? t('Testing…') : t('Test this connection')}</button>
        {sum && !busy && <span className={`small bh-test-sum ${sum.state}`} role="status">{sum.text}{last.at ? <span className="muted"> · {ago(last.at)}</span> : null}</span>}
        {busy && <span className="muted small">{t('It sends itself a message and waits for it to come back: a few seconds.')}</span>}
      </div>
      {missing && <p className="muted small">{t('This Bridge AI can\'t test a connection yet: update it, then test again.')}</p>}
      {error && <p className="error-text small" role="alert">{error}</p>}
      {shown.length > 0 && (
        <ul className="bh-checks" aria-label={t('What was tested')}>
          {shown.map((x, i) => (
            <li key={x.id || i} className={`bh-check ${x.state}`} data-check={x.id || i} data-state={x.state}>
              <Icon name={ICON[x.state] || 'info'} size={12} />
              <span className="bh-check-text">
                <b className="small">{x.label}</b>
                {x.detail && <span className="muted small"> {x.detail}</span>}
                {x.fix && x.state !== 'ok' && <span className="small bh-fix">{x.fix}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {last?.list?.length > 0 && (hidden > 0 || all) && <button type="button" className="link-btn small bh-all-checks" onClick={() => setAll(!all)}>{all ? t('Only what needs you') : hidden === 1 ? t('1 more check, passed') : t('{n} more checks, passed or skipped', { n: hidden })}</button>}
      {c.shared && <TryMessage c={c} />}
    </div>
  )
}

// ---------- Try a message ----------
// Why it went where it did, in a sentence: a dry run's rule (connhub.js dry), each by its number in
// the connection's order.
function whySaid(r, c) {
  const bot = r.bot?.name || ''
  const app = c.platform === 'teams' ? c.name : `@${c.name}`
  const ai = r.detail === 'no-chief' ? t('There\'s no Chief on this connection.')
    : r.detail === 'not-chief' ? t('They may not ask its Chief.')
    : r.detail === 'no-model' ? t('There\'s no model for AI Assist, so it couldn\'t pick.')
    : r.detail === 'unsure' ? t('AI Assist couldn\'t tell which from their descriptions.')
      : r.detail === 'off' ? t('AI Assist doesn\'t pick on this connection.')
        : r.detail ? t('AI Assist couldn\'t answer: {why}', { why: r.detail }) : ''
  // (The last rule is the Chief's now; a connection from before had AI Assist's pick and the bot
  // for when nothing says which.)
  const n = (k) => (c.rules || []).indexOf(k) + 1 || (c.rules || []).indexOf(k === 'among' || k === 'unsure' ? 'chief' : k) + 1
  switch (r.rule) {
    case 'command': return t('Rule {n}, a command: {command} goes to {bot}.', { n: n('command'), command: r.detail || '', bot })
    case 'default': return t('Rule {n}, the channel\'s bot: everything asked in #{channel} goes to {bot}.', { n: n('default'), channel: r.detail || '', bot })
    case 'name': return t('Rule {n}, its name: the message names {bot}.', { n: n('name'), bot })
    case 'thread': return t('Rule {n}, a reply in a thread: {bot} answered there.', { n: n('thread'), bot })
    case 'last': return t('Rule {n}, a direct message: {bot} is the bot they asked last.', { n: n('last'), bot })
    case 'listen': return t('{bot} answers in that channel without a mention.', { bot })
    case 'limit': return t('Your answer about {bot}\'s run at its time limit: it goes to {bot}.', { bot })
    case 'only': return t('Rule {n}: {bot} is the only bot they may ask here.', { n: n('among'), bot })
    case 'chief': return t('Nothing named a bot, so {bot}, the Chief, takes it: it answers, or hands it to one of its specialists.', { bot })
    case 'router': return t('Rule {n}: AI Assist picked {bot} from the bots\' descriptions.', { n: n('among'), bot })
    case 'unsure': return `${ai} ${t('Rule {n}: it goes to {bot}, as you set.', { n: n('unsure'), bot })}`.trim()
    case 'asked': return `${ai} ${t('Rule {n}: it would ask them which: {bots}.', { n: n('unsure'), bots: (r.asks || []).map((x) => x.name).join(', ') })}`.trim()
    case 'none': return r.silent ? t('They may ask none of its bots, and each says nothing to anyone else: nothing would be said.') : t('They may ask none of its bots: they\'d get the polite no.')
    case 'help': return t('!help: it would list its bots, and how to ask each.')
    case 'own': return t('Its own connection: every question is {bot}\'s.', { bot })
    case 'nothing':
      if (r.detail === 'no-bots') return t('No bot is reached through {name} yet.', { name: c.name })
      if (r.detail === 'no-command') return t('{command} isn\'t one of {name}\'s commands, so Slack wouldn\'t send it.', { command: r.command || '', name: c.name })
      return t('Not for any bot: it doesn\'t mention {app}, isn\'t a reply in a thread a bot answered in, and no bot answers there without a mention.', { app })
    default: return r.rule || ''
  }
}
// And then: whether that bot's own rules let them ask it.
function thenSaid(r) {
  const bot = r.bot?.name || ''
  if (!r.bot || !r.then) return null
  if (r.then.paused) return { bad: true, text: t('{bot} is paused, so the question would come to you instead.', { bot }) }
  switch (r.then.may) {
    case null: case undefined: return { bad: false, text: t('They may ask {bot}, so it would answer.', { bot }) }
    case 'not-allowed': return { bad: true, text: t('But they may not ask {bot}: they\'d get its polite no, and nothing else.', { bot }) }
    case 'muted': return { bad: true, text: t('But {bot} is muted in that channel: it would answer nothing there.', { bot }) }
    case 'unknown': return { bad: true, text: t('But who\'s asking couldn\'t be told, so {bot} wouldn\'t answer.', { bot }) }
    default: return { bad: true, text: t('But {bot} never answers guests or people from other companies.', { bot }) }
  }
}
// And a change to files asked for (server/frontdesk.js writeVerdict): made without asking you,
// waiting for you, held before it starts, or refused; for a bot that only reads, the same for each
// bot it hands changes to, under that bot's own rules for whoever asked.
function writeSaid(v) {
  if (!v?.edits) return null
  const folders = (v.folders || []).join(', ')
  if (v.may === 'direct') return { bad: false, text: t('A change to files in {folders}: {bot} would make it without asking you, with Undo.', { folders, bot: v.name }) }
  if (v.may === 'ask') return { bad: false, text: t('A change to files in {folders}: {bot} would make it in its copy, and it would wait for you to approve the diff.', { folders, bot: v.name }) }
  if (v.may === 'screened') return { bad: true, text: t('{bot} wouldn\'t start on it: it would be held for you first, as {why}.', { bot: v.name, why: v.why || '' }) }
  return { bad: true, text: t('{bot} would refuse a change for them: they may not ask it.', { bot: v.name }) }
}
function writesSaid(r) {
  const w = r?.then?.write
  if (!w) return []
  const own = writeSaid(w)
  return [...(own ? [own] : []), ...(w.handsTo || []).map((h) => {
    const x = writeSaid(h)
    return x ? { ...x, text: `${t('Asked to change files, {bot} would hand it on to {other}.', { bot: w.name, other: h.name })} ${x.text}` } : null
  }).filter(Boolean)]
}

function TryMessage({ c: card }) {
  const [open, setOpen] = useState(false)
  const [c, setC] = useState(null) // the connection with its rules, in order (/routing)
  const [text, setText] = useState('')
  const [where, setWhere] = useState('') // '': a channel; 'dm'; 'c:<id>'; 'thread:<bot>'
  const [who, setWho] = useState('you') // 'you', 'someone', or a person's id there
  const [mention, setMention] = useState(true)
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState(null)
  const [error, setError] = useState(null)
  const [people, setPeople] = useState([])
  const [channels, setChannels] = useState([])
  const up = card.state === 'connected'
  useEffect(() => {
    if (!open) return undefined
    let live = true
    api(`/connections/${card.id}/routing`).then((r) => live && setC(r), () => live && setC(card))
    if (up) {
      api(`/connections/${card.id}/people`).then((r) => live && setPeople(r.people || []), () => {})
      api(`/connections/${card.id}/channels`).then((r) => live && setChannels(r.channels || []), () => {})
    }
    return () => { live = false }
  }, [open, card.id, up]) // eslint-disable-line react-hooks/exhaustive-deps
  const x = c || card
  const app = x.platform === 'teams' ? x.name : `@${x.name}`
  const dm = where === 'dm'
  const run = async (e) => {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    const ch = where.startsWith('c:') ? channels.find((y) => y.id === where.slice(2)) : null
    const p = who === 'you' ? 'you' : who === 'someone' ? null : people.find((y) => y.id === who) || null
    try {
      setOut(await api(`/connections/${x.id}/try`, { method: 'POST', body: { text, dm, channel: ch?.id || null, channelName: ch?.name || null, thread: where.startsWith('thread:') ? where.slice(7) : null, person: p && p !== 'you' ? { id: p.id, name: p.name } : p, mention: dm || mention } }))
    } catch (err) { setError(err.message); setOut(null) }
    setBusy(false)
  }
  const then = out ? thenSaid(out) : null
  const lead = out?.bot ? out.bot.name : out?.rule === 'asked' ? t('It would ask which') : out?.rule === 'none' ? t('No bot: the polite no') : out?.rule === 'help' ? t('Its bots, listed') : t('Not for any bot')
  return (
    <details className="sb-how ro-try" data-setting="routing-try" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><Icon name="chevron" size={11} />{t('Try a message')}</summary>
      <p className="muted small">{t('Type a message as someone would send it to {app}, and see which bot would take it, and why. A dry run: nothing is sent, answered or kept, and no bot runs.', { app })}</p>
      <form onSubmit={run} className="ro-try-form">
        <textarea className="st-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={x.platform === 'slack' ? t('Pricing Desk: what does the team plan cost? Or {command} pricing …', { command: x.command || '/' }) : t('Pricing Desk: what does the team plan cost?')} aria-label={t('The message to try')} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) run(e) }} />
        <div className="sb-sched-row">
          <label className="sb-field"><span>{t('Where')}</span>
            <select className="st-input" value={where} onChange={(e) => setWhere(e.target.value)} aria-label={t('Where it\'s asked')}>
              <option value="">{t('A channel')}</option>
              {channels.map((y) => <option key={y.id} value={`c:${y.id}`}>{x.platform === 'teams' ? y.name : `#${y.name}`}</option>)}
              <option value="dm">{t('A direct message')}</option>
              {(x.bots || []).map((b) => <option key={b.id} value={`thread:${b.id}`}>{t('A reply in a thread {bot} answered in', { bot: b.name })}</option>)}
            </select>
          </label>
          <label className="sb-field"><span>{t('From')}</span>
            <select className="st-input" value={who} onChange={(e) => setWho(e.target.value)} aria-label={t('Who asks')}>
              <option value="you">{x.owner?.name ? t('You ({name})', { name: x.owner.name }) : t('You')}</option>
              {people.filter((y) => y.id !== x.owner?.id).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              <option value="someone">{t('Someone you haven\'t named')}</option>
            </select>
          </label>
        </div>
        {!dm && <label className="st-check"><input type="checkbox" checked={mention} onChange={(e) => setMention(e.target.checked)} /><span className="small">{t('It mentions {app}', { app })}</span></label>}
        {!up && <p className="muted small">{t('Connect {name} to pick from its channels and people.', { name: x.name })}</p>}
        <div className="st-row"><button type="submit" className="btn small primary" disabled={busy || !text.trim()}><Icon name="branch" size={12} /> {busy ? t('Trying…') : t('Try It')}</button></div>
      </form>
      {error && <p className="error-text small" role="alert">{error}</p>}
      {out && (
        <div className={`ro-out${out.bot ? ' to' : ''}${then?.bad || !out.bot ? ' warn' : ''}`} data-rule={out.rule} data-bot={out.bot?.id || ''} role="status">
          <p className="ro-to">{out.bot ? <Icon name="bot" size={14} /> : <Icon name="info" size={14} />}<b>{lead}</b></p>
          <p className="small">{whySaid(out, x)}</p>
          {then && <p className={`small ${then.bad ? 'error-text' : ''}`}>{then.text}</p>}
          {!then?.bad && writesSaid(out).map((y, i) => <p key={i} className={`small ro-write ${y.bad ? 'error-text' : ''}`} data-write={i}>{y.text}</p>)}
          {out.bot && out.asked != null && out.asked.trim() !== text.trim() && <p className="muted small">{t('It would be asked: “{text}”', { text: out.asked })}</p>}
          {!out.connected && <p className="muted small">{t('{name} isn\'t connected now: nothing reaches its bots until it is.', { name: x.name })}</p>}
          <p className="muted small">{t('A dry run: nothing was sent, answered or kept.')}</p>
        </div>
      )}
      <p className="muted small">{t('{platform} rules, in order: a command, the channel\'s bot, a bot\'s name first, a reply in a thread, the bot last asked in a direct message; otherwise the Chief.', { platform: platName(x.platform) })}</p>
    </details>
  )
}
