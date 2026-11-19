import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { api } from '../../api.js'
import { platName } from '../settings/Bots.jsx'
import { Defaults, Routed } from './Connections.jsx'
import { openBot, refreshBots } from './bots.js'
import { t } from '../../i18n/index.js'
import './bots-page.css'

// A shared connection's Routing, a page of its own (view:bot:routing:<connection>, from the Bots
// overview, Connections, a bot's Access, and the phone's More › Bots): in Slack you call the app;
// it hands each question to one of its bots, by connhub.js's rules in their order, shown as the
// rules they are. Where one is a setting it's changed right there: a slash command for each bot,
// the channels that each go to one bot, each bot's description (what AI Assist picks it by),
// whether AI Assist picks at all, and where a question goes when nothing says which (ask them, or
// one bot). Then Try a Message: a message you make up, from someone and somewhere you pick, and
// which bot would take it and why (connhub.js dry): nothing is sent, answered or kept, and no bot
// runs. When it can't decide (AI Assist has no model, say), it says so, and what happens instead.
// Last, which bot each question went to lately. Yours only, as every setting is: it's the app's
// own page, never anything a bot's askers reach. A bot's own connection has no routing: every
// question on it is that bot's, said so.
export default function Routing({ cid, phone = false }) {
  const [c, setC] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const load = () => api(`/connections/${cid}/routing`).then((x) => { setC(x); setError(null) }, (e) => setError(e.message))
  useEffect(() => {
    setC(null)
    load()
    const every = setInterval(() => { if (!document.hidden) load() }, 8000)
    return () => clearInterval(every)
  }, [cid]) // eslint-disable-line react-hooks/exhaustive-deps
  const patch = async (body) => {
    setNote(null)
    try { await api(`/connections/${cid}`, { method: 'PATCH', body }); await load(); return true } catch (e) { setNote(e.message); return false }
  }
  if (error && !c) return <div className={`ro sb${phone ? ' phone' : ''}`}><p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {error}</p></div>
  if (!c) return <div className="skeleton-rows"><div /><div /><div /></div>
  const plat = platName(c.platform)
  const app = c.platform === 'teams' ? c.name : `@${c.name}`
  return (
    <div className={`ro sb${phone ? ' phone' : ''}`} data-setting="bots-routing" data-connection={c.id}>
      <header className="bp-head">
        <Icon name="branch" size={15} />
        <h2 className="bp-name">{t('Routing')}</h2>
        <span className="muted small">{c.name}</span>
        <span className={`sb-plat p-${c.platform}`}>{plat}</span>
      </header>
      <p className="ro-lead">{c.shared
        ? t('In {platform} you call {app}; it hands each question to one of these bots.', { platform: plat, app })
        : t('{app} is {bot}\'s own connection: every question asked of it is {bot}\'s.', { app, bot: c.own?.name || '' })}</p>
      {c.bots.length > 0
        ? <div className="ro-bots">{c.bots.map((b) => <button key={b.id} type="button" className="sb-chip" onClick={() => openBot(b.id)} title={b.description || b.name}><Icon name="bot" size={12} /><span className="sb-chip-name">{b.name}</span>{b.paused && <Icon name="pause" size={11} />}</button>)}</div>
        : <p className="small sb-none">{t('No bot is reached through {name} yet: every bot without a connection of its own will be.', { name: c.name })}</p>}
      {c.state !== 'connected' && <p className="st-note warn" role="status"><Icon name="info" size={13} /><span>{t('{name} isn\'t connected now, so nothing reaches its bots until it is. The rules here hold once it is.', { name: c.name })}</span></p>}
      {c.shared && <Rules c={c} patch={patch} reload={load} />}
      {note && <p className="st-note bad" role="alert"><Icon name="alert" size={13} /> {note}</p>}
      {c.shared && <TryMessage c={c} />}
      {c.shared && <Routed c={c} />}
    </div>
  )
}

// A bot's description, changed in place: what AI Assist picks it by.
function Description({ b, onSaved }) {
  const [v, setV] = useState(b.description || '')
  const [error, setError] = useState(null)
  useEffect(() => { setV(b.description || '') }, [b.description])
  const keep = async () => {
    if (v.trim() === (b.description || '')) return
    setError(null)
    try { await api(`/bots/${b.id}/settings`, { method: 'POST', body: { description: v.trim() } }); refreshBots(); onSaved() } catch (e) { setError(e.message) }
  }
  return (
    <li className="ro-desc" data-bot={b.id}>
      <label className="sb-field">
        <span>{b.name}</span>
        <input className="st-input" value={v} maxLength={140} onChange={(e) => setV(e.target.value)} onBlur={keep} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }} placeholder={t('What it answers, in a line')} aria-label={t('What {bot} answers', { bot: b.name })} />
      </label>
      {!b.description && !v.trim() && <span className="error-text small">{t('No description yet: AI Assist has only its name to pick it by.')}</span>}
      {error && <span className="error-text small" role="alert">{error}</span>}
    </li>
  )
}

// The rules, in connhub.js's order (the server says it), each changed here where it's a setting.
function Rules({ c, patch, reload }) {
  const slack = c.platform === 'slack'
  const word = (name) => String(name || '').toLowerCase().split(/\s+/)[0]
  // (Its examples by a bot of more than one word where there is one, so a word of its name shows.)
  const eg = c.bots.find((b) => /\s/.test(b.name)) || c.bots[0]
  const model = c.assistModel?.model
  const RULE = {
    command: {
      title: t('A Command'),
      body: slack
        ? (
          <>
            <p className="small">{t('{command} with a bot\'s name goes to that bot: “{command} {word} your question”.', { command: c.command || '', word: word(eg?.name || 'pricing') })}</p>
            <label className="st-check" data-setting="routing-perbot">
              <input type="checkbox" checked={!!c.perBot} onChange={(e) => patch({ perBot: e.target.checked })} />
              <span><b className="small">{t('A slash command for each bot too')}</b> <span className="muted small">{t('Like /pricing-desk, besides {command}. Update the app with its manifest after turning this on, and after adding a bot.', { command: c.command || '' })}</span></span>
            </label>
          </>
        )
        : <p className="muted small">{t('Not on {platform}: commands are Slack\'s.', { platform: platName(c.platform) })}</p>,
    },
    default: {
      title: t('The Channel\'s Bot'),
      body: (
        <>
          <p className="small">{t('In these channels, everything asked of {name} goes to one bot, whatever it names.', { name: c.name })}</p>
          <Defaults c={c} reload={reload} bare />
        </>
      ),
    },
    name: {
      title: t('A Bot\'s Name First'),
      body: <p className="small">{t('“{bot}: …”, or a word of its name only it has: “{word}: …”. Each bot\'s name is set on its page.', { bot: eg?.name || 'Pricing Desk', word: word(eg?.name || 'pricing') })}</p>,
    },
    thread: { title: t('A Reply in a Thread'), body: <p className="small">{t('Goes to the bot that answered in that thread.')}</p> },
    last: { title: t('A Direct Message'), body: <p className="small">{t('Goes to the bot that person asked last, unless it names another.')}</p> },
    among: {
      title: t('Among the Bots They May Ask'),
      body: (
        <>
          <p className="small">{t('With one, that one. With more, AI Assist picks one from their descriptions, sent to its model with nothing else: never who asked, never a setting.')}</p>
          <label className="st-check" data-setting="routing-assist">
            <input type="checkbox" checked={c.assist !== false} onChange={(e) => patch({ assist: e.target.checked })} />
            <span className="small">{t('AI Assist picks')}</span>
          </label>
          {c.assist !== false && (model
            ? <p className="muted small">{t('AI Assist picks with {model}.', { model: model.label })}</p>
            : <p className="st-note warn" data-setting="routing-no-model"><Icon name="info" size={13} /><span>{t('There\'s no model for AI Assist, so it can\'t pick: the next rule decides. Add one in Settings › Model Providers.')}{c.assistModel?.why ? ` ${c.assistModel.why}` : ''}</span></p>)}
          {c.assist === false && <p className="muted small">{t('Off: a question that fits more than one bot isn\'t sent to any model; the next rule decides.')}</p>}
          {c.bots.length > 0 && <ul className="ro-descs" data-setting="routing-descriptions">{c.bots.map((b) => <Description key={b.id} b={b} onSaved={reload} />)}</ul>}
        </>
      ),
    },
    unsure: {
      title: t('When Nothing Says Which'),
      body: (
        <>
          <label className="sb-field" data-setting="routing-unsure">
            <span>{t('When AI Assist can\'t tell, is off, or has no model')}</span>
            <select className="st-input" value={c.unsure || ''} onChange={(e) => patch({ unsure: e.target.value || null })}>
              <option value="">{t('Ask them which bot')}</option>
              {c.bots.map((b) => <option key={b.id} value={b.id}>{t('Hand it to {bot}', { bot: b.name })}</option>)}
            </select>
          </label>
          <p className="muted small">{c.unsure ? t('Only when they may ask {bot}; otherwise they\'re asked which.', { bot: c.bots.find((b) => b.id === c.unsure)?.name || '' }) : slack ? t('In Slack, with a button for each bot; only whoever asked can pick.') : t('In words: they answer with its name first.')}</p>
        </>
      ),
    },
  }
  return (
    <section className="st-sec" data-setting="routing-rules">
      <h4>{t('Rules, in Order')}</h4>
      <p className="muted small">{t('The first rule that fits a question decides which bot takes it.')}</p>
      <ol className="ro-rules">
        {(c.rules || []).filter((k) => RULE[k]).map((k, i) => (
          <li key={k} data-rule={k}>
            <span className="ro-n" aria-hidden="true">{i + 1}</span>
            <div className="ro-rule"><b className="small">{RULE[k].title}</b>{RULE[k].body}</div>
          </li>
        ))}
      </ol>
      <p className="muted small">{t('Whatever a question names, the bot it reaches still holds to its own Access: who may ask, its folders, its limits. Someone who may not ask that bot gets its polite no.')}</p>
    </section>
  )
}

// Why it went where it did, in a sentence: a dry run's rule (connhub.js dry).
function whySaid(r, c) {
  const bot = r.bot?.name || ''
  const app = c.platform === 'teams' ? c.name : `@${c.name}`
  const ai = r.detail === 'no-model' ? t('There\'s no model for AI Assist, so it couldn\'t pick.')
    : r.detail === 'unsure' ? t('AI Assist couldn\'t tell which from their descriptions.')
      : r.detail === 'off' ? t('AI Assist doesn\'t pick on this connection.')
        : r.detail ? t('AI Assist couldn\'t answer: {why}', { why: r.detail }) : ''
  // (Each rule by its number in the order shown above it.)
  const n = (k) => (c.rules || []).indexOf(k) + 1
  switch (r.rule) {
    case 'command': return t('Rule {n}, a command: {command} goes to {bot}.', { n: n('command'), command: r.detail || '', bot })
    case 'default': return t('Rule {n}, the channel\'s bot: everything asked in #{channel} goes to {bot}.', { n: n('default'), channel: r.detail || '', bot })
    case 'name': return t('Rule {n}, its name: the message names {bot}.', { n: n('name'), bot })
    case 'thread': return t('Rule {n}, a reply in a thread: {bot} answered there.', { n: n('thread'), bot })
    case 'last': return t('Rule {n}, a direct message: {bot} is the bot they asked last.', { n: n('last'), bot })
    case 'listen': return t('{bot} answers in that channel without a mention.', { bot })
    case 'limit': return t('Your answer about {bot}\'s run at its time limit: it goes to {bot}.', { bot })
    case 'only': return t('Rule {n}: {bot} is the only bot they may ask here.', { n: n('among'), bot })
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

// And a change to files asked for (server/frontdesk.js writeVerdict): made without asking you, waiting
// for you, held before it starts, or refused; for a bot that only reads, the same for each bot it
// hands changes to, under that bot's own rules for whoever asked.
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

// Try a Message: which bot a message would go to, and why, with nothing sent, answered or kept.
function TryMessage({ c }) {
  const [text, setText] = useState('')
  const [where, setWhere] = useState('') // '': a channel; 'dm'; 'c:<id>'; 'thread:<bot>'
  const [who, setWho] = useState('you') // 'you', 'someone', or a person's id there
  const [mention, setMention] = useState(true)
  const [busy, setBusy] = useState(false)
  const [out, setOut] = useState(null)
  const [error, setError] = useState(null)
  const [people, setPeople] = useState([])
  const [channels, setChannels] = useState([])
  const up = c.state === 'connected'
  useEffect(() => {
    if (!up) return undefined
    let live = true
    api(`/connections/${c.id}/people`).then((r) => live && setPeople(r.people || []), () => {})
    api(`/connections/${c.id}/channels`).then((r) => live && setChannels(r.channels || []), () => {})
    return () => { live = false }
  }, [c.id, up])
  const app = c.platform === 'teams' ? c.name : `@${c.name}`
  const dm = where === 'dm'
  const run = async (e) => {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    const ch = where.startsWith('c:') ? channels.find((x) => x.id === where.slice(2)) : null
    const p = who === 'you' ? 'you' : who === 'someone' ? null : people.find((x) => x.id === who) || null
    try {
      setOut(await api(`/connections/${c.id}/try`, { method: 'POST', body: { text, dm, channel: ch?.id || null, channelName: ch?.name || null, thread: where.startsWith('thread:') ? where.slice(7) : null, person: p && p !== 'you' ? { id: p.id, name: p.name } : p, mention: dm || mention } }))
    } catch (err) { setError(err.message); setOut(null) }
    setBusy(false)
  }
  const then = out ? thenSaid(out) : null
  const lead = out?.bot ? out.bot.name : out?.rule === 'asked' ? t('It would ask which') : out?.rule === 'none' ? t('No bot: the polite no') : out?.rule === 'help' ? t('Its bots, listed') : t('Not for any bot')
  return (
    <section className="st-sec ro-try" data-setting="routing-try">
      <h4>{t('Try a Message')}</h4>
      <p className="muted small">{t('Type a message as someone would send it to {app}, and see which bot would take it, and why. A dry run: nothing is sent, answered or kept, and no bot runs.', { app })}</p>
      <form onSubmit={run} className="ro-try-form">
        <textarea className="st-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={c.platform === 'slack' ? t('Pricing Desk: what does the team plan cost? Or {command} pricing …', { command: c.command || '/' }) : t('Pricing Desk: what does the team plan cost?')} aria-label={t('The message to try')} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) run(e) }} />
        <div className="sb-sched-row">
          <label className="sb-field"><span>{t('Where')}</span>
            <select className="st-input" value={where} onChange={(e) => setWhere(e.target.value)} aria-label={t('Where it\'s asked')}>
              <option value="">{t('A channel')}</option>
              {channels.map((x) => <option key={x.id} value={`c:${x.id}`}>{c.platform === 'teams' ? x.name : `#${x.name}`}</option>)}
              <option value="dm">{t('A direct message')}</option>
              {c.bots.map((b) => <option key={b.id} value={`thread:${b.id}`}>{t('A reply in a thread {bot} answered in', { bot: b.name })}</option>)}
            </select>
          </label>
          <label className="sb-field"><span>{t('From')}</span>
            <select className="st-input" value={who} onChange={(e) => setWho(e.target.value)} aria-label={t('Who asks')}>
              <option value="you">{c.owner?.name ? t('You ({name})', { name: c.owner.name }) : t('You')}</option>
              {people.filter((x) => x.id !== c.owner?.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              <option value="someone">{t('Someone you haven\'t named')}</option>
            </select>
          </label>
        </div>
        {!dm && <label className="st-check"><input type="checkbox" checked={mention} onChange={(e) => setMention(e.target.checked)} /><span className="small">{t('It mentions {app}', { app })}</span></label>}
        {!up && <p className="muted small">{t('Connect {name} to pick from its channels and people.', { name: c.name })}</p>}
        <div className="st-row"><button type="submit" className="btn small primary" disabled={busy || !text.trim()}><Icon name="branch" size={12} /> {busy ? t('Trying…') : t('Try It')}</button></div>
      </form>
      {error && <p className="error-text small" role="alert">{error}</p>}
      {out && (
        <div className={`ro-out${out.bot ? ' to' : ''}${then?.bad || !out.bot ? ' warn' : ''}`} data-rule={out.rule} data-bot={out.bot?.id || ''} role="status">
          <p className="ro-to">{out.bot ? <Icon name="bot" size={14} /> : <Icon name="info" size={14} />}<b>{lead}</b></p>
          <p className="small">{whySaid(out, c)}</p>
          {then && <p className={`small ${then.bad ? 'error-text' : ''}`}>{then.text}</p>}
          {!then?.bad && writesSaid(out).map((x, i) => <p key={i} className={`small ro-write ${x.bad ? 'error-text' : ''}`} data-write={i}>{x.text}</p>)}
          {out.bot && out.asked != null && out.asked.trim() !== text.trim() && <p className="muted small">{t('It would be asked: “{text}”', { text: out.asked })}</p>}
          {!out.connected && <p className="muted small">{t('{name} isn\'t connected now: nothing reaches its bots until it is.', { name: c.name })}</p>}
          <p className="muted small">{t('A dry run: nothing was sent, answered or kept.')}</p>
        </div>
      )}
    </section>
  )
}
