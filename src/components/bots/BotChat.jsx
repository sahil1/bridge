import { useEffect, useRef, useState } from 'react'
import Icon from '../Icon.jsx'
import { AssistHead } from '../AiAssist.jsx'
import { Guide, Connect, Owner, DiscordSetup, TeamsSetup, NewBot, AnswererList, PLATFORMS, platName } from '../settings/Bots.jsx'
import { api } from '../../api.js'
import { t } from '../../i18n/index.js'
import './bots-page.css'

// AI Assist's chat for a bot (server/botsetup.js): a new one (id null) asks what it should do and who
// it's for, and the first answer makes a draft, which opens as its page (onMade). A draft's chat ends
// with what AI Assist proposed, as one card whose every part you change in place, and Create (nothing
// of it applies until then). Once it's made, the same chat walks through connecting where it answers
// (the steps you do on Slack's, Discord's or Microsoft's own site, each ticked as it's done, with
// where to paste what they give you), says each step as it's done, offers the people and channels you
// named once it can find them, and takes changes in words, each shown as what would change and
// applied only when you say so. With no model to ask, it says so and offers the form.
// d, save, reload, again: the bot as it stands, for the steps (Bots.jsx Bot gives them).
const AGENT = { claude: 'Claude Code', codex: 'Codex' }
const LABEL = () => ({
  name: t('Name'), description: t('Description'), instructions: t('Instructions'), folders: t('Reads From'), who: t('Who Can Ask'), people: t('People who can ask'),
  channels: t('Answers without a mention in'), posts: t('Scheduled Posts'), answerers: t('What Answers'), fallback: t('When one can\'t answer, try the next'), limits: t('Limits'), auto: t('Answers'), mcp: t('MCP Servers'), platform: t('Where It Answers'),
})
const whoSaid = (w) => (w === 'channels' ? t('Everyone in channels it\'s invited to') : t('People you name'))
const limitsSaid = (l) => (l ? t('{day} a day, {atOnce} at once, {minutes} minutes a run', l) : '—')
const postOf = (x) => t('“{what}” in #{channel}, {when}', x)
const listSaid = (l, hash = false) => (l?.length ? l.map((x) => (hash ? `#${x}` : x)).join(', ') : '—')

// A note the app wrote in the chat, in your language.
function noteOf(m) {
  const v = m.vars || {}
  const names = (l) => (l || []).join(', ')
  switch (m.kind) {
    case 'no-model': return t('There\'s no model for AI Assist to set it up with: sign in to an agent like Claude Code, or add a model in Settings › Model Providers. Or set it up yourself with the form.')
    case 'failed': return t('AI Assist couldn\'t answer: {why}', { why: v.why || '' })
    case 'unreadable': return t('AI Assist\'s answer couldn\'t be read as a bot. Say it again in other words, or set it up with the form.')
    case 'left': return [v.folders?.length ? t('Left out {folders}: not among the folders Bridge AI knows. Add a folder by its path if you meant one.', { folders: names(v.folders) }) : null, v.mcp?.length ? t('Left out {servers}: not among your MCP servers in Claude Code.', { servers: names(v.mcp) }) : null].filter(Boolean).join(' ')
    case 'chief': return t('The Chief of Staff drafted this from what you asked it for. Look it over, change what you like, and Create.')
    case 'created': return `${t('{bot} is made. Next, connect it to {platform}: the steps are below, each ticked as it\'s done.', { bot: v.bot, platform: platName(v.platform) })}${v.people?.length || v.channels?.length ? ` ${t('Once it\'s connected, I\'ll find {names} there.', { names: [...(v.people || []), ...(v.channels || []).map((c) => `#${c}`)].join(', ') })}` : ''}`
    case 'tick':
      if (v.step === 'app') return t('Its app\'s tokens are in.')
      if (v.step === 'connected') return v.team ? t('Connected to {team} as @{bot}.', { team: v.team, bot: v.bot }) : t('Connected to {platform}.', { platform: platName(v.platform) })
      if (v.step === 'you') return t('You\'re set as you in {platform}: you can always ask it there.', { platform: platName(v.platform) })
      if (v.step === 'invited') return t('It\'s been invited, or asked something, in {platform}.', { platform: platName(v.platform) })
      if (v.step === 'answered') return t('Its first answer went out. It\'s set up in {platform}.', { platform: platName(v.platform) })
      return v.step
    case 'found': return t('Found them now that it\'s connected: {names}. Add them as below?', { names: [...(v.people || []), ...(v.channels || []).map((c) => `#${c}`)].join(', ') })
    case 'in': return t('It\'s in {channels} now.', { channels: (v.channels || []).map((c) => `#${c}`).join(', ') })
    case 'applied': return t('Done: {what}.', { what: (v.keys || []).map((k) => LABEL()[k] || k).join(', ') })
    case 'pending': return t('{names}: not found yet. I\'ll look again once it\'s connected, and offer them then.', { names: [...(v.people || []), ...(v.channels || []).map((c) => `#${c}`)].join(', ') })
    case 'posts': return t('Connected: the scheduled posts you asked for are below, to add.')
    case 'discarded': return t('Left as it was.')
    case 'nothing': return t('Nothing to change: it\'s set up that way already.')
    default: return m.kind
  }
}

// A setting as a line shows it.
function valueOf(key, v) {
  if (key === 'who') return whoSaid(v)
  if (key === 'limits') return limitsSaid(v)
  if (key === 'auto') return v ? t('Answer without asking') : t('Review each one')
  if (key === 'answerers') return v?.length ? v.map((id) => id.replace(/^agent:(\w+)(?::(.+))?$/, (_, k, m) => `${AGENT[k] || k}${m ? ` (${m})` : ''}`).replace(/^model:[\w-]+:/, '')).join(' → ') : t('Automatic')
  if (key === 'fallback') return v === false ? t('Off') : t('On')
  if (key === 'platform') return platName(v)
  if (key === 'channels') return listSaid(v, true)
  if (Array.isArray(v)) return listSaid(v)
  return v ? String(v) : '—'
}

// What a change would do, a line a setting, and Apply or Leave It.
function ChangeCard({ change, onApply, onDiscard, busy }) {
  const L = LABEL()
  return (
    <div className="bc-card bc-change" data-setting="bots-chat-change">
      <b className="small">{change.found ? t('Add them?') : t('This would change:')}</b>
      <ul className="bc-lines">
        {change.lines.map((l) => {
          if (l.key === 'posts') return <li key={l.key} className="small"><span className="bc-key">{L.posts}</span><span className="bc-diff">{l.after.map((x, i) => <span key={i} className="bc-add">+ {postOf(x)}</span>)}</span></li>
          const list = Array.isArray(l.before) && Array.isArray(l.after)
          const added = list ? l.after.filter((x) => !l.before.includes(x)) : []
          const gone = list ? l.before.filter((x) => !l.after.includes(x)) : []
          return (
            <li key={l.key} className="small">
              <span className="bc-key">{L[l.key] || l.key}</span>
              {l.key === 'instructions'
                ? <details className="sb-ctx"><summary><Icon name="chevron" size={11} />{t('New instructions')}</summary><pre className="sb-tpl-ins">{l.after}</pre></details>
                : list
                  ? <span className="bc-diff">{added.map((x) => <span key={`+${x}`} className="bc-add">+ {l.key === 'channels' ? `#${x}` : x}</span>)}{gone.map((x) => <span key={`-${x}`} className="bc-gone">− {l.key === 'channels' ? `#${x}` : x}</span>)}</span>
                  : <span className="bc-diff"><span className="bc-was">{valueOf(l.key, l.before)}</span> → <b>{valueOf(l.key, l.after)}</b></span>}
            </li>
          )
        })}
      </ul>
      <div className="st-row">
        <button type="button" className="btn small primary" disabled={busy} onClick={onApply}><Icon name="check" size={12} /> {t('Apply')}</button>
        <button type="button" className="ghost-btn" disabled={busy} onClick={onDiscard}>{t('Leave it as it is')}</button>
      </div>
    </div>
  )
}

// What Automatic would use, from what's here: the agents, the models a key reaches, then the ones on
// this computer (server/botanswer.js listOf).
const automaticOf = (opts) => [...opts.filter((o) => /^agent:\w+$/.test(o.id)), ...opts.filter((o) => o.id.startsWith('model:') && !o.local), ...opts.filter((o) => o.local)].map((o) => o.id)

// A list of names, each with a way to take it off.
function Names({ list, hash = false, onDrop, extra }) {
  return (
    <ul className="sb-askers">
      {list.map((x) => (
        <li key={typeof x === 'string' ? x : x.name}>
          <span className="sb-asker-name">{hash ? '#' : ''}{typeof x === 'string' ? x : x.name}</span>
          {extra?.(x)}
          <button type="button" className="icon-btn" onClick={() => onDrop(x)} aria-label={t('Remove {name}', { name: typeof x === 'string' ? x : x.name })}><Icon name="x" size={12} /></button>
        </li>
      ))}
    </ul>
  )
}
// One more, typed.
function AddOne({ placeholder, label, onAdd, children }) {
  const [v, setV] = useState('')
  return (
    <form className="sb-add" onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onAdd(v.trim()); setV('') } }}>
      <input className="st-input" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={label} />
      {children}
      <button type="submit" className="btn small" disabled={!v.trim()}><Icon name="plus" size={12} /> {t('Add')}</button>
    </form>
  )
}

// What AI Assist proposed, every part changeable here, and Create.
function ProposalCard({ p, options, onEdit, onCreate, onDiscard, busy, error }) {
  const [name, setName] = useState(p.name)
  const [about, setAbout] = useState(p.description || '')
  const [ins, setIns] = useState(p.instructions || '')
  const [lim, setLim] = useState(p.limits)
  const [listen, setListen] = useState(false)
  useEffect(() => { setName(p.name) }, [p.name])
  useEffect(() => { setAbout(p.description || '') }, [p.description])
  useEffect(() => { setIns(p.instructions || '') }, [p.instructions])
  useEffect(() => { setLim(p.limits) }, [p.limits?.day, p.limits?.atOnce, p.limits?.minutes]) // eslint-disable-line react-hooks/exhaustive-deps
  const folders = options?.folders || []
  const free = folders.filter((f) => !p.folders.includes(f.path))
  const tpl = (options?.templates || []).find((x) => x.id === p.template)
  return (
    <div className="bc-card bc-proposal" data-setting="bots-proposal">
      <div className="bc-card-head"><Icon name="wand" size={13} className="ai-head-wand" /><b className="small">{t('The bot AI Assist proposes')}</b></div>
      <p className="muted small">{t('Change anything here, or say it in the chat. Nothing is set up until you press Create.')}</p>
      <div className="sb-ident">
        <label className="sb-field"><span>{t('Name')}</span><input className="st-input" value={name} maxLength={35} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== p.name) onEdit({ name: name.trim() }); else setName(p.name) }} /></label>
        <label className="sb-field"><span>{t('Description')}</span><input className="st-input" value={about} maxLength={140} placeholder={t('What it answers, in a line')} onChange={(e) => setAbout(e.target.value)} onBlur={() => { if (about.trim() !== (p.description || '')) onEdit({ description: about.trim() }) }} /></label>
      </div>
      <div className="bc-part">
        <span className="bc-label">{t('Where It Answers')}</span>
        <div className="seg" role="radiogroup" aria-label={t('Where It Answers')}>
          {PLATFORMS.map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={p.platform === k} className={p.platform === k ? 'on' : ''} onClick={() => onEdit({ platform: k })}>{label}</button>)}
        </div>
      </div>
      <div className="bc-part">
        <span className="bc-label">{t('Reads From')}</span>
        {p.folders.length ? <Names list={p.folders} onDrop={(f) => onEdit({ folders: p.folders.filter((x) => x !== f) })} /> : <p className="small sb-none">{t('No folders: it answers from what the model knows.')}</p>}
        <div className="sb-add">
          {free.length > 0 && (
            <select className="st-input" value="" onChange={(e) => e.target.value && onEdit({ folders: [...p.folders, e.target.value] })} aria-label={t('Add a folder Bridge AI knows')}>
              <option value="">{t('Add a folder Bridge AI knows…')}</option>
              {free.map((f) => <option key={f.path} value={f.path}>{`${f.name} · ${f.path}`}</option>)}
            </select>
          )}
        </div>
        <AddOne placeholder="~/docs" label={t('Add a folder by its path')} onAdd={(f) => onEdit({ folders: [...p.folders, f] })} />
      </div>
      <div className="bc-part">
        <span className="bc-label">{t('Who Can Ask')}</span>
        <div className="seg" role="radiogroup" aria-label={t('Who Can Ask')}>
          {[['named', t('People you name')], ['channels', t('Everyone in its channels')]].map(([k, label]) => <button key={k} type="button" role="radio" aria-checked={p.who === k} className={p.who === k ? 'on' : ''} onClick={() => onEdit({ who: k })}>{label}</button>)}
        </div>
        {p.people.length > 0 && <Names list={p.people} onDrop={(n) => onEdit({ people: p.people.filter((x) => x !== n) })} />}
        <AddOne placeholder={t('A name, as they\'re called there')} label={t('Add someone who can ask')} onAdd={(n) => onEdit({ people: [...p.people, n] })} />
        <p className="muted small">{t('People are found by these names once it\'s connected, and offered to you then. You can always ask it.')}</p>
      </div>
      <div className="bc-part">
        <span className="bc-label">{t('Channels')}</span>
        {p.channels.length > 0
          ? <Names list={p.channels} hash onDrop={(c) => onEdit({ channels: p.channels.filter((x) => x.name !== c.name) })} extra={(c) => (c.listen ? <span className="sb-plat">{t('without a mention')}</span> : null)} />
          : <p className="small sb-none">{t('None named: it answers wherever it\'s invited, when it\'s mentioned or messaged.')}</p>}
        <AddOne placeholder="support" label={t('Add a channel')} onAdd={(c) => { onEdit({ channels: [...p.channels, { name: c.replace(/^#/, ''), listen }] }); setListen(false) }}>
          <label className="st-check bc-listen"><input type="checkbox" checked={listen} onChange={(e) => setListen(e.target.checked)} /><span className="small">{t('Every message, without a mention')}</span></label>
        </AddOne>
      </div>
      {p.posts?.length > 0 && (
        <div className="bc-part">
          <span className="bc-label">{t('Scheduled Posts')}</span>
          <Names list={p.posts.map((x, i) => ({ name: postOf(x), i }))} onDrop={(x) => onEdit({ posts: p.posts.filter((_, j) => j !== x.i) })} />
          <p className="muted small">{t('Added once it\'s connected and in those channels, with Scheduled Routines on.')}</p>
        </div>
      )}
      <div className="bc-part">
        <span className="bc-label">{t('Instructions')}</span>
        {(options?.templates || []).length > 0 && (
          <label className="sb-field"><span>{t('Template')}</span>
            <select className="st-input" value={p.template || ''} onChange={(e) => onEdit({ template: e.target.value || null })}>
              <option value="">{t('None')}</option>
              {options.templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
        <textarea className="st-input sb-ins" rows={Math.min(12, Math.max(4, ins.split('\n').length + 1))} value={ins} onChange={(e) => setIns(e.target.value)} onBlur={() => { if (ins !== (p.instructions || '')) onEdit({ instructions: ins }) }} placeholder={tpl ? t('Empty: the template\'s instructions') : t('What it\'s for, how it answers, what it declines')} aria-label={t('Its instructions')} />
        <p className="muted small">{t('They steer its answers; they can\'t widen what it may do, which its settings decide.')}</p>
      </div>
      <div className="bc-part">
        <span className="bc-label">{t('MCP Servers')}</span>
        {(options?.mcp || []).length
          ? <div className="bc-checks">{options.mcp.map((m) => <label key={m} className="st-check"><input type="checkbox" checked={p.mcp.includes(m)} onChange={(e) => onEdit({ mcp: e.target.checked ? [...p.mcp, m] : p.mcp.filter((x) => x !== m) })} /><span className="small">{m}</span></label>)}</div>
          : <p className="small sb-none">{t('None: Claude Code has no MCP servers of yours (Settings › MCP Servers).')}</p>}
        {p.mcp.length > 0 && <p className="muted small">{t('Tools that only read, for anyone who may ask; the others only when you, or someone you named, asks.')}</p>}
      </div>
      <div className="bc-part">
        <span className="bc-label">{t('What Answers')}</span>
        <AnswererList value={p.answerers} options={options?.answerers || []} automatic={automaticOf(options?.answerers || [])} fallback={p.fallback !== false} onChange={(v) => onEdit(v)} />
      </div>
      <div className="bc-part">
        <span className="bc-label">{t('Limits')}</span>
        <div className="sb-limits">
          {[['day', t('Questions a day'), 1, 1000], ['atOnce', t('At once'), 1, 5], ['minutes', t('Minutes a run'), 1, 60]].map(([k, label, min, max]) => (
            <label key={k} className="sb-field"><span>{label}</span><input className="st-input" type="number" inputMode="numeric" min={min} max={max} value={lim?.[k] ?? ''} onChange={(e) => setLim((x) => ({ ...x, [k]: e.target.value }))} onBlur={() => { const v = Math.round(Number(lim?.[k])); if (v && v !== p.limits[k]) onEdit({ limits: { ...p.limits, [k]: v } }); else setLim(p.limits) }} /></label>
          ))}
        </div>
      </div>
      <label className="st-check bc-part"><input type="checkbox" checked={!!p.auto} onChange={(e) => onEdit({ auto: e.target.checked })} /><span><b className="small">{t('Answer without asking')}</b> <span className="muted small">{t('Off: each answer waits for you to send it.')}</span></span></label>
      {error && <p className="error-text small" role="alert">{error}</p>}
      <div className="st-row bc-create">
        <button type="button" className="btn primary" disabled={busy} onClick={onCreate}><Icon name="check" size={13} /> {busy ? t('Creating…') : t('Create {bot}', { bot: p.name })}</button>
        <button type="button" className="ghost-btn danger" disabled={busy} onClick={onDiscard}><Icon name="trash" size={12} /> {t('Discard this draft')}</button>
      </div>
      <p className="muted small">{t('Who may ask, its folders, its MCP tools and its limits are settings Bridge AI holds it to; its instructions only steer it.')}</p>
    </div>
  )
}

// Connecting where it answers: the steps on that platform's own site, each ticked as it's done, and
// where to paste what it gives you.
function ConnectCard({ d, save, reload, again, platform }) {
  const [at, setAt] = useState(platform || 'slack')
  useEffect(() => { if (platform) setAt(platform) }, [platform])
  const s = at === 'slack' ? { state: d.state } : d.where?.[at] || {}
  return (
    <div className="bc-card bc-connect sb" data-setting="bots-chat-connect">
      <div className="seg" role="tablist" aria-label={t('Where It Answers')}>
        {PLATFORMS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={at === k} className={at === k ? 'on' : ''} onClick={() => setAt(k)}>{label}</button>)}
      </div>
      <Guide key={at} d={d} platform={at} />
      {s.state !== 'connected' && at === 'slack' && <Connect d={d} reload={reload} />}
      {at === 'slack' && d.state === 'connected' && !d.settings.owner && <Owner d={d} save={save} />}
      {at === 'discord' && (s.state !== 'connected' || !d.settings.owners?.discord) && <DiscordSetup d={d} save={save} reload={reload} again={again} />}
      {at === 'teams' && (s.state !== 'connected' || !d.settings.owners?.teams) && <TeamsSetup d={d} save={save} reload={reload} again={again} />}
    </div>
  )
}

const EXAMPLES = () => [
  t('Answer pricing questions for the sales team in Slack, from my pricing folder'),
  t('A Discord bot that answers questions about our docs, for anyone in the server'),
  t('Say where our launch stands, from the project folder, for my team in #launch'),
]

export default function BotChat({ id = null, draft = false, phone = false, d = null, save, reload, again, onClose, onMade, onCreated, onDiscarded }) {
  const [s, setS] = useState(null)
  const [error, setError] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(null) // 'ask' | 'edit' | 'create' | 'apply'
  const [form, setForm] = useState(false)
  const [mine, setMine] = useState([]) // a new chat's words, before there's a draft to keep them
  const end = useRef(null)
  const path = id ? `/bots/${id}/assist` : '/bots/assist'
  const load = () => api(path).then((r) => { setS((x) => (id ? r : { ...r, messages: x?.messages || [] })); setError(null) }, (e) => setError(e.message))
  useEffect(() => {
    load()
    if (!id) return undefined
    const every = setInterval(() => { if (!document.hidden) load() }, 4000)
    return () => clearInterval(every)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const n = (s?.messages?.length || 0) + mine.length
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }) }, [n, busy, s?.change?.id])

  const ask = async (words) => {
    const w = String(words || '').trim()
    if (!w || busy) return
    setBusy('ask')
    setError(null)
    setText('')
    try {
      if (!id) {
        setMine((x) => [...x, w])
        const r = await api('/bots/assist', { method: 'POST', body: { text: w } })
        if (r.bot) { onMade?.(r.bot.id); return }
        setMine([])
        setS((x) => ({ ...(x || {}), ...r.setup, messages: [...(x?.messages || []), ...r.setup.messages] }))
      } else setS(await api(path, { method: 'POST', body: { text: w } }))
    } catch (e) { setError(e.message); if (!id) setMine([]); setText(w) }
    setBusy(null)
  }
  const edit = async (fields) => {
    setBusy('edit')
    try { setS(await api(path, { method: 'PATCH', body: { proposal: fields } })); setError(null) } catch (e) { setError(e.message) }
    setBusy(null)
  }
  const create = async () => {
    setBusy('create')
    setError(null)
    try { await api(`/bots/${id}/create`, { method: 'POST' }); onCreated?.() } catch (e) { setError(e.message) }
    setBusy(null)
  }
  const discardDraft = async () => {
    if (!window.confirm(t('Discard this draft? Nothing of it was set up.'))) return
    try { await api(`/bots/${id}`, { method: 'DELETE' }); onDiscarded?.() } catch (e) { setError(e.message) }
  }
  const apply = async (yes) => {
    setBusy('apply')
    setError(null)
    try {
      if (yes) { const r = await api(`/bots/${id}/assist/apply`, { method: 'POST', body: { change: s.change.id } }); setS(r.setup); reload?.() } else setS(await api(`/bots/${id}/assist/discard`, { method: 'POST' }))
    } catch (e) { setError(e.message) }
    setBusy(null)
  }

  const live = !!id && !draft
  const name = d?.name || s?.proposal?.name || ''
  const noModel = s && !s.assist?.model
  const msgs = [...(s?.messages || []), ...mine.map((w, i) => ({ id: `mine-${i}`, who: 'you', text: w }))]
  const said = msgs.some((m) => m.who === 'you')
  const created = msgs.some((m) => m.kind === 'created')
  const showConnect = live && d && (created || !msgs.length || d.state !== 'connected')
  return (
    <div className={`bc${phone ? ' phone' : ''}`} data-setting="bots-chat">
      <AssistHead what={!id ? t('New bot') : t('Setting up {bot}', { bot: name })} onClose={onClose} closeLabel={t('Close AI Assist')}>
        {s?.assist?.model && <span className="muted small bc-model" title={t('AI Assist answers with {model}', { model: s.assist.model.label })}>{s.assist.model.label}</span>}
      </AssistHead>
      <ol className="bc-msgs" aria-live="polite">
        <li className="bc-msg bc-assist">
          <p>{live ? t('Say what to change in {bot}, in your own words: "also answer in #support", "read ~/docs too", "use the tracker MCP server". I show you what would change first.', { bot: name }) : t('What should the bot do, and who is it for? Say it in your own words: what it answers and from which folders, who may ask, and where (Slack, Discord or Microsoft Teams). I\'ll set the whole bot up for you to look over before anything is made.')}</p>
          {!id && !said && !noModel && (
            <div className="bc-examples">{EXAMPLES().map((x) => <button key={x} type="button" className="bc-example" onClick={() => setText(x)}>{x}</button>)}</div>
          )}
        </li>
        {noModel && !msgs.some((m) => m.kind === 'no-model') && (
          <li className="bc-msg bc-note bad" data-kind="no-model">
            <p>{!id ? t('There\'s no model for AI Assist to set it up with: sign in to an agent like Claude Code, or add a model in Settings › Model Providers. Or set it up yourself with the form.')
              : draft ? t('There\'s no model for AI Assist to answer with: sign in to an agent like Claude Code, or add a model in Settings › Model Providers. You can still set it up on the card below.')
                : t('There\'s no model for AI Assist to answer with: sign in to an agent like Claude Code, or add a model in Settings › Model Providers. Change it by hand under Set Up meanwhile.')}</p>
            {s.assist?.why && <p className="muted small">{s.assist.why}</p>}
          </li>
        )}
        {msgs.map((m) => (
          <li key={m.id} className={`bc-msg bc-${m.who}${m.kind ? ` k-${m.kind}` : ''}${['no-model', 'failed', 'unreadable'].includes(m.kind) ? ' bad' : ''}`} data-kind={m.kind || m.who}>
            <p>{m.who === 'note' ? noteOf(m) : m.text}</p>
            {['failed'].includes(m.kind) && m === msgs.at(-1) && <div className="st-row"><button type="button" className="btn small" onClick={() => ask([...msgs].reverse().find((x) => x.who === 'you')?.text)}><Icon name="refresh" size={12} /> {t('Try again')}</button></div>}
          </li>
        ))}
        {busy === 'ask' && <li className="bc-msg bc-assist bc-thinking" role="status"><p><Icon name="wand" size={12} /> {t('AI Assist is setting it up…')}</p></li>}
        {(noModel || msgs.some((m) => ['no-model', 'unreadable', 'failed'].includes(m.kind))) && (
          <li className="bc-msg bc-form" data-kind="form">
            <div className="st-row">
              <button type="button" className="btn small" onClick={() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))}><Icon name="layers" size={12} /> {t('Model Providers')}</button>
              {!id && !form && !noModel && <button type="button" className="btn small" onClick={() => setForm(true)}>{t('Set it up with the form')}</button>}
            </div>
            {!id && (form || noModel) && <NewBot form onMade={(bid) => onMade?.(bid)} />}
          </li>
        )}
        {draft && s?.proposal && <li className="bc-msg bc-card-row"><ProposalCard p={s.proposal} options={s.options} onEdit={edit} onCreate={create} onDiscard={discardDraft} busy={busy === 'create'} error={busy !== 'ask' ? error : null} /></li>}
        {showConnect && <li className="bc-msg bc-card-row"><ConnectCard d={d} save={save} reload={reload} again={again} platform={s?.platform} /></li>}
        {live && s?.change && <li className="bc-msg bc-card-row"><ChangeCard change={s.change} busy={busy === 'apply'} onApply={() => apply(true)} onDiscard={() => apply(false)} /></li>}
        <li ref={end} className="bc-end" aria-hidden="true" />
      </ol>
      {error && !(draft && s?.proposal) && <p className="error-text small bc-error" role="alert">{error}</p>}
      <form className="bc-say" onSubmit={(e) => { e.preventDefault(); ask(text) }}>
        <textarea className="st-input" rows={phone ? 2 : 3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(text) } }}
          placeholder={live ? t('Say what to change') : draft ? t('Say what to change in it') : t('What should it do, and who is it for?')} aria-label={live || draft ? t('Say what to change') : t('What should it do, and who is it for?')} disabled={busy === 'ask'} />
        <button type="submit" className="btn small primary" disabled={!text.trim() || !!busy} aria-label={t('Send')}><Icon name="send" size={13} /></button>
      </form>
    </div>
  )
}
