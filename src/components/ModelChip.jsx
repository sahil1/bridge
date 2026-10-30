import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { AgentIcon } from './settings/ProviderIcon.jsx'
import { api, usePoll } from '../api.js'
import { HandoffSection, HandoffPanel, useHandoff, useHandedNote } from './Handoff.jsx'
import { AcctName, Left, nameOf } from './AccountMenu.jsx'
import { t, tx } from '../i18n/index.js'

// Why a message is held (server/promptsafe.js says it in English), in your language.
export function heldWhy(reason) {
  const s = String(reason || '')
  let m
  if (s === 'a question is waiting for your answer') return t('a question is waiting for your answer')
  if (s === 'a menu or dialog is open') return t('a menu or dialog is open')
  if ((m = /^"(.+)" is open$/.exec(s))) return t('"{title}" is open', { title: m[1] })
  if ((m = /^a menu is open \((.*)\)$/.exec(s))) return t('a menu is open ({hint})', { hint: m[1] })
  return s
}

// The model chip in the message box: which agent, model and account this is, and a menu to switch
// the model, continue the conversation on another account, or hand the work to another agent
// (Handoff.jsx). Claude Code switches model in place (its own
// /model, sent like a message); agents that can't, like Codex, restart on the new model with the
// same conversation. The server does the work (server/models.js, server/handoff.js); this shows
// it and says how it went.

// Short names: "Opus 5.5", "Sonnet", "Sonnet 1M"; anything else as the CLI names it.
const ALIAS = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', best: 'Best', opusplan: 'Opus Plan', default: 'Default' }
const HINT = { opus: tx('Latest Opus'), sonnet: tx('Latest Sonnet'), haiku: tx('Latest Haiku'), fable: tx('Latest Fable'), best: tx('The most capable model you have'), opusplan: tx('Opus to plan, Sonnet to build') }
const cap = (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()
// Names the server gives (a chat's "gpt-5 (OpenAI)"), by model id.
const NAMES = {}
export function modelLabel(m) {
  if (!m) return 'Default'
  if (NAMES[m]) return NAMES[m]
  const wide = /\[1m\]$/i.test(m) ? ' 1M' : ''
  const base = m.replace(/\[1m\]$/i, '')
  if (ALIAS[base.toLowerCase()]) return ALIAS[base.toLowerCase()] + wide
  let x = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i.exec(base)
  if (x) return `${cap(x[1])} ${x[2]}${x[3] ? `.${x[3]}` : ''}${wide}`
  x = /^claude-(\d+)(?:-(\d))?-(opus|sonnet|haiku)(?:-\d{8})?$/i.exec(base)
  if (x) return `${cap(x[3])} ${x[1]}${x[2] ? `.${x[2]}` : ''}${wide}`
  return m
}
const VALID = /^[A-Za-z0-9][\w.:/@[\]-]{0,99}$/
const told = new Set() // restarts already reported on this page: `${paneId} ${at}`

// onSent: the switch command went into the agent's input box (which it clears first).
// account: { label, current, list, onContinue } when it's worth showing (several accounts, or it's
// on one that isn't your usual login); list: the accounts to continue on, with their usage.
export default function ModelChip({ agent, onNote, onSent, account = null }) {
  const pid = encodeURIComponent(agent.paneId)
  const [fast, setFast] = useState(false)
  // Quick while a switch is under way (just over usePoll's 1.5 s sharing, so each one asks).
  const { data, refresh } = usePoll(`/agents/${pid}/model`, fast ? 1600 : 10000)
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState(null) // the agent picked to hand off to: its confirm panel shows
  const [sending, setSending] = useState(null) // the model being sent, until the server answers
  const wrap = useRef(null)
  const ho = useHandoff(agent, open)
  useHandedNote(agent, onNote)
  const close = () => { setOpen(false); setPanel(null) }
  const started = useRef(null) // a switch made from here: { model, t, said }, until it's reported
  const sw = data?.switching
  const live = !!sw && ['queued', 'sent', 'confirm'].includes(sw.state)
  useEffect(() => { setFast(live || !!sending) }, [live, sending])
  useEffect(() => { started.current = null; close() }, [agent.paneId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Say in the chat area how the switch went, once per change.
  useEffect(() => {
    const s = started.current
    if (!s || !sw || sw.model !== s.model || new Date(sw.at).getTime() < s.t - 5000 || s.said === sw.state) return
    s.said = sw.state
    const name = modelLabel(sw.model)
    if (sw.state === 'confirm') onNote?.(t('{agent} asks you to confirm the switch to {name}. Answer it in the card above.', { agent: data.label, name }))
    else if (sw.state === 'done') onNote?.(sw.said ? `${sw.said.replace(/\.$/, '')}.` : t('Now on {name}.', { name }))
    else if (sw.state === 'failed') onNote?.(t("Didn't switch to {name}: {why}", { name, why: sw.said || t('the agent said no') }))
    else if (sw.state === 'unconfirmed') onNote?.(t('Sent the switch to {name}, with no word back yet. Check the Terminal tab.', { name }))
    if (['done', 'failed', 'unconfirmed'].includes(sw.state)) started.current = null
  }, [sw?.state, sw?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  // Back after a restart on another model (a new pane): say so once.
  useEffect(() => {
    if (data?.mode !== 'restart' || sw?.state !== 'done' || Date.now() - new Date(sw.at).getTime() > 30000) return
    const key = `${agent.paneId} ${sw.at}`
    if (told.has(key)) return
    told.add(key)
    onNote?.(t('Restarted on {name}, with the same conversation.', { name: sw.model === 'default' ? t('its default model') : modelLabel(sw.model) }))
  }, [data?.mode, sw?.state, sw?.at, agent.paneId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || agent.kind === 'shell') return null
  if (data.labels) Object.assign(NAMES, data.labels)
  const switching = sending || (live ? sw.model : null)
  // No model to show (an agent with no model setting, or one that picks its own and hasn't said): the agent.
  const plainKind = !data.mode || (data.mode === 'fixed' && !data.current)
  const label = switching ? modelLabel(switching) : plainKind ? data.label : modelLabel(data.current)
  const where = data.source === 'agent' ? t('{agent} reports it', { agent: data.label }) : data.source === 'started' ? t('it started on it') : data.source === 'settings' ? t('your default in Settings') : data.source === 'picked' ? t('you picked it') : data.source === 'switch' ? t('switched from here') : null
  const vars = { agent: data.label, name: switching ? modelLabel(switching) : '', model: data.current || t("{agent}'s default", { agent: data.label }), where }
  const title = switching ? (sw?.state === 'queued' ? t('Switching to {name} (queued until the agent is free)', vars) : sw?.state === 'confirm' ? t('Switching to {name} (the agent asks you to confirm)', vars) : t('Switching to {name}', vars))
    : plainKind ? t('{agent}. Hand off to another agent', vars)
    : data.mode === 'fixed' ? (where ? t('{agent}, model: {model} ({where}). {agent} picks its model when it starts', vars) : t('{agent}, model: {model}. {agent} picks its model when it starts', vars))
    : where ? t('{agent}, model: {model} ({where})', vars) : t('{agent}, model: {model}', vars)

  const pick = async (model) => {
    close()
    if (data.mode === 'restart' && !window.confirm(t('Restart {agent} on {name}?\n\nThe agent stops and starts again on it, with the same conversation. Anything typed in its terminal and not sent is lost.', { agent: data.label, name: model === 'default' ? t('its default model') : modelLabel(model) }))) return
    setSending(model)
    if (data.mode === 'restart') onNote?.(t('Restarting on {name}…', { name: model === 'default' ? t('its default model') : modelLabel(model) }))
    try {
      const r = await api(`/agents/${pid}/model`, { method: 'POST', body: { model } })
      // Restarted: it's a new pane now, whose chip says so once it's open.
      if (r.restarted) setTimeout(() => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: r.paneId } })), 1200)
      else {
        started.current = { model, t: Date.now() }
        if (!r.queued) onSent?.()
        onNote?.(r.queued ? (r.reason && r.reason !== 'working' ? t('Queued {command}. It goes in when {agent} is free ({reason}).', { command: r.command, agent: data.label, reason: heldWhy(r.reason) }) : t('Queued {command}. It goes in when {agent} is free.', { command: r.command, agent: data.label })) : t('Sent {command}', { command: r.command }))
      }
      refresh()
    } catch (e) { onNote?.(e.message) } finally { setSending(null) }
  }

  return (
    <span className="model-wrap" ref={wrap}>
      <button type="button" className={`model-chip ${open ? 'on' : ''} ${switching ? 'busy' : ''}`} aria-haspopup="menu" aria-expanded={open}
        aria-label={plainKind ? (account ? t('{agent}, on {account}. Hand off to another agent', { agent: data.label, account: account.label }) : t('{agent}. Hand off to another agent', { agent: data.label }))
          : !account ? t('{agent}, model: {model}. Change model, or hand off', { agent: data.label, model: label })
          : account.list.length > 1 ? t('{agent}, model: {model}, on {account}. Change model or account, or hand off', { agent: data.label, model: label, account: account.label })
          : t('{agent}, model: {model}, on {account}. Change model, or hand off', { agent: data.label, model: label, account: account.label })} title={account ? t('{title}. On the {account} account', { title, account: account.label }) : title}
        onClick={() => (open ? close() : setOpen(true))} onKeyDown={(e) => {
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !open) { e.preventDefault(); setOpen(true) }
          if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close() }
        }}>
        {switching ? <Icon name="refresh" size={12} className="spin" /> : <AgentIcon kind={agent.kind} size={14} name={data.label} className="mc-mark" />}
        <span className="mc-name">{label}</span>
        {account && <span className="mc-acct"><Icon name="users" size={11} /><span>{account.label}</span></span>}
        <Icon name="down" size={11} className="mc-caret" />
      </button>
      {open && (panel
        ? <HandoffPanel agent={agent} view={ho.view} target={panel} anchor={wrap} onBack={() => setPanel(null)} onClose={close} onNote={onNote} />
        : <ModelMenu data={data} agent={agent} anchor={wrap} onPick={pick} onClose={close}
          account={account?.list.length > 1 ? account : null} onAccount={(a) => { close(); account.onContinue(a) }}
          handoff={<HandoffSection view={ho.view} error={ho.error} onPick={(t) => setPanel(t)} separate={!!data.mode || account?.list.length > 1} />} />)}
    </span>
  )
}

// The menu, in the style of the account switcher: Default first, the agent's models, Other…; then
// its accounts, to continue the conversation on another.
function ModelMenu({ data, agent, anchor, onPick, onClose, account = null, onAccount, handoff = null }) {
  const ref = useRef(null)
  const [other, setOther] = useState(null) // the typed name while "Other…" is open
  const restart = data.mode === 'restart'
  // Restarting waits for a quiet agent with a conversation to resume.
  const blocked = restart && (agent.status === 'working' ? t('It\'s working. Restarting waits until it\'s done (or press Stop).')
    : agent.status === 'blocked' ? t('It\'s waiting on you. Answer it first.')
    : !data.canResume ? t('It can restart on another model once it has a conversation to resume.') : null)
  const items = () => [...(ref.current?.querySelectorAll('[data-item]:not(:disabled)') || [])]
  const back = () => anchor?.current?.querySelector('[aria-haspopup]')?.focus()
  // As tall as there's room for above the message box, inside the agent's panel.
  useLayoutEffect(() => {
    const el = ref.current
    const box = el?.closest('.pane')
    if (!el || !box) return
    const room = el.getBoundingClientRect().bottom - Math.max(0, box.getBoundingClientRect().top) - 8
    el.style.maxHeight = `${Math.max(160, Math.min(460, room))}px`
  }, [])
  useEffect(() => {
    // The ticked item, else the first; with every item off (it's busy), the menu itself, so Esc still closes it.
    ;(ref.current?.querySelector('[data-item][aria-checked="true"]:not(:disabled)') || items()[0] || ref.current)?.focus()
    const down = (e) => { if (!ref.current?.contains(e.target) && !anchor?.current?.contains(e.target)) onClose() }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const onKeyDown = (e) => {
    if (e.target.tagName === 'INPUT' && e.key !== 'Escape') return
    const list = items()
    const i = list.indexOf(document.activeElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus()
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation()
      if (other != null) { setOther(null); requestAnimationFrame(() => ref.current?.focus()); return }
      onClose(); back()
    } else if (e.key === 'Tab') onClose()
  }
  const verb = restart ? t('Restart on') : null
  // One line each: the name, and what it is on the right. wide: the description goes under it.
  const row = (m, name, desc, key = m, wide = false) => (
    <button type="button" key={key} data-item role="menuitemradio" aria-checked={data.checked === m} className={`acct-item model-item ${wide ? 'auto' : ''}`} disabled={!!blocked} onClick={() => onPick(m)}
      title={restart ? t('Restart {agent} on {name}, with the same conversation', { agent: data.label, name }) : desc && !wide ? t('Switch to {name} ({desc})', { name, desc }) : t('Switch to {name}', { name })}>
      <span className="acct-check">{data.checked === m && <Icon name="check" size={13} />}</span>
      <span className="acct-main">
        <span className="acct-name">{verb ? <><span className="muted mc-verb">{verb}</span> {name}</> : name}</span>
        {wide && desc && <span className="acct-desc">{desc}</span>}
      </span>
      {!wide && desc ? <span className={`model-desc ${/\s/.test(desc) ? '' : 'id'}`}>{desc}</span> : <span />}
    </button>
  )
  const models = data.models.filter((m) => m !== 'default')
  // What it's on, when it isn't in the list (a restart would only start it again on the same one).
  const current = !restart && data.current && !models.includes(data.current) && data.current !== data.checked ? data.current : null
  const typed = (other || '').trim()
  const okName = VALID.test(typed)
  const switches = data.mode === 'switch' || data.mode === 'restart'
  return (
    <div className="acct-pop model-pop" ref={ref} role="menu" tabIndex={-1} aria-label={switches ? t('{agent} model', { agent: data.label }) : data.label} onKeyDown={onKeyDown}>
      {data.mode === 'fixed' && <>
        <div className="acct-sec" aria-hidden="true">{t('{agent} model', { agent: data.label })}</div>
        <p className="model-note muted">{data.current ? t('On {name}. {agent} picks its model when it starts.', { name: modelLabel(data.current), agent: data.label }) : t('{agent} picks its model when it starts.', { agent: data.label })}</p>
      </>}
      {switches && <>
      <div className="acct-sec" aria-hidden="true">{t('{agent} model', { agent: data.label })}</div>
      {blocked && <p className="model-note">{blocked}</p>}
      {data.canDefault && row('default', t('Default (recommended)'), restart ? t('{agent} picks, as when you start it yourself', { agent: data.label }) : t("{agent}'s default for your account", { agent: data.label }), 'default', true)}
      {models.map((m) => row(m, modelLabel(m), (HINT[m] && t(HINT[m])) || (modelLabel(m) !== m ? m : null)))}
      {current && row(current, modelLabel(current), modelLabel(current) !== current ? t('{model}, on now', { model: current }) : t('on now'), `now:${current}`)}
      {data.checked !== 'default' && !models.includes(data.checked) && data.checked !== current && row(data.checked, modelLabel(data.checked), modelLabel(data.checked) !== data.checked ? data.checked : null, `pick:${data.checked}`)}
      <div className="acct-sep" role="separator" />
      {other == null ? (
        <button type="button" data-item role="menuitem" className="acct-item plain" disabled={!!blocked} onClick={() => setOther('')}>
          <span className="acct-check"><Icon name="edit" size={13} /></span><span className="acct-main"><span className="acct-name">{t('Other…')}</span></span>
        </button>
      ) : (
        <form className="model-other" onSubmit={(e) => { e.preventDefault(); if (okName) onPick(typed) }}>
          <input autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder={data.kind === 'claude' ? t('A model name, like claude-sonnet-5-5') : t('A model name')} aria-label={t('Model name')} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
          <button className="btn small primary" disabled={!okName}>{restart ? t('Restart') : t('Switch')}</button>
        </form>
      )}
      {other != null && typed && !okName && <p className="model-note">{t('Letters, numbers and . _ - : / @ [ ] only.')}</p>}
      <p className="model-note muted">{restart
        ? t("{agent} can't switch while it runs, so it restarts on the model and picks up the same conversation.", { agent: data.label })
        : data.kind === 'claude' ? t('Sent as /model, like typing it in the terminal. Claude Code also keeps it as your default for new sessions.')
        : data.kind === 'aider' ? t('Sent as /model, like typing it in the terminal.') : t('Sent as its switch command, like typing it in the terminal.')}</p>
      </>}
      {account && <>
        {(switches || data.mode === 'fixed') && <div className="acct-sep" role="separator" />}
        <div className="acct-sec" aria-hidden="true">{t('{agent} account', { agent: data.label })}</div>
        {agent.status === 'working' && <p className="model-note">{t("It's working. Another account can pick it up once it's done (or press Stop).")}</p>}
        {account.list.map((a) => {
          const on = a.id === account.current
          return (
            <button type="button" key={a.id} data-item role="menuitemradio" aria-checked={on} className="acct-item" disabled={on || agent.status === 'working'} onClick={() => onAccount(a)}
              title={on ? t('This conversation is on {account}', { account: nameOf(a) }) : t('Continue this conversation on {account}', { account: nameOf(a) })}>
              <span className="acct-check">{on && <Icon name="check" size={13} />}</span>
              <span className="acct-main"><AcctName a={a} /></span>
              <Left a={a} />
            </button>
          )
        })}
        <p className="model-note muted">{t('Another account picks up this conversation where it is: {agent} starts again signed in as it.', { agent: data.label })}</p>
      </>}
      {handoff}
    </div>
  )
}
