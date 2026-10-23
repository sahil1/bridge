import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { AgentIcon } from './settings/ProviderIcon.jsx'
import { api, usePoll } from '../api.js'
import { HandoffSection, HandoffPanel, useHandoff, useHandedNote } from './Handoff.jsx'

// The model chip in the message box: which agent and model this is, and a menu to switch the model
// or hand the work to another agent (Handoff.jsx). Claude Code switches model in place (its own
// /model, sent like a message); agents that can't, like Codex, restart on the new model with the
// same conversation. The server does the work (server/models.js, server/handoff.js); this shows
// it and says how it went.

// Short names: "Opus 5.5", "Sonnet", "Sonnet 1M"; anything else as the CLI names it.
const ALIAS = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', best: 'Best', opusplan: 'Opus Plan', default: 'Default' }
const HINT = { opus: 'Latest Opus', sonnet: 'Latest Sonnet', haiku: 'Latest Haiku', fable: 'Latest Fable', best: 'The most capable model you have', opusplan: 'Opus to plan, Sonnet to build' }
const cap = (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()
export function modelLabel(m) {
  if (!m) return 'Default'
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
export default function ModelChip({ agent, onNote, onSent }) {
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
    if (sw.state === 'confirm') onNote?.(`${data.label} asks you to confirm the switch to ${name}. Answer it in the card above.`)
    else if (sw.state === 'done') onNote?.(sw.said ? `${sw.said.replace(/\.$/, '')}.` : `Now on ${name}.`)
    else if (sw.state === 'failed') onNote?.(`Didn't switch to ${name}: ${sw.said || 'the agent said no'}`)
    else if (sw.state === 'unconfirmed') onNote?.(`Sent the switch to ${name}, with no word back yet. Check the Terminal tab.`)
    if (['done', 'failed', 'unconfirmed'].includes(sw.state)) started.current = null
  }, [sw?.state, sw?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  // Back after a restart on another model (a new pane): say so once.
  useEffect(() => {
    if (data?.mode !== 'restart' || sw?.state !== 'done' || Date.now() - new Date(sw.at).getTime() > 30000) return
    const key = `${agent.paneId} ${sw.at}`
    if (told.has(key)) return
    told.add(key)
    onNote?.(`Restarted on ${sw.model === 'default' ? 'its default model' : modelLabel(sw.model)}, with the same conversation.`)
  }, [data?.mode, sw?.state, sw?.at, agent.paneId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || agent.kind === 'shell') return null
  const switching = sending || (live ? sw.model : null)
  // No model to show (an agent with no model setting, or one that picks its own and hasn't said): the agent.
  const plainKind = !data.mode || (data.mode === 'fixed' && !data.current)
  const label = switching ? modelLabel(switching) : plainKind ? data.label : modelLabel(data.current)
  const where = data.source === 'agent' ? `${data.label} reports it` : data.source === 'started' ? 'it started on it' : data.source === 'settings' ? 'your default in Settings' : data.source === 'picked' ? 'you picked it' : data.source === 'switch' ? 'switched from here' : null
  const title = switching ? `Switching to ${modelLabel(switching)}${sw?.state === 'queued' ? ' (queued until the agent is free)' : sw?.state === 'confirm' ? ' (the agent asks you to confirm)' : ''}`
    : plainKind ? `${data.label}. Hand off to another agent`
    : `${data.label}, model: ${data.current || `${data.label}'s default`}${where ? ` (${where})` : ''}${data.mode === 'fixed' ? `. ${data.label} picks its model when it starts` : ''}`

  const pick = async (model) => {
    close()
    if (data.mode === 'restart' && !window.confirm(`Restart ${data.label} on ${model === 'default' ? 'its default model' : modelLabel(model)}?\n\nThe agent stops and starts again on it, with the same conversation. Anything typed in its terminal and not sent is lost.`)) return
    setSending(model)
    if (data.mode === 'restart') onNote?.(`Restarting on ${model === 'default' ? 'its default model' : modelLabel(model)}…`)
    try {
      const r = await api(`/agents/${pid}/model`, { method: 'POST', body: { model } })
      // Restarted: it's a new pane now, whose chip says so once it's open.
      if (r.restarted) setTimeout(() => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: r.paneId } })), 1200)
      else {
        started.current = { model, t: Date.now() }
        if (!r.queued) onSent?.()
        onNote?.(r.queued ? `Queued ${r.command}. It goes in when ${data.label} is free${r.reason && r.reason !== 'working' ? ` (${r.reason})` : ''}.` : `Sent ${r.command}`)
      }
      refresh()
    } catch (e) { onNote?.(e.message) } finally { setSending(null) }
  }

  return (
    <span className="model-wrap" ref={wrap}>
      <button type="button" className={`model-chip ${open ? 'on' : ''} ${switching ? 'busy' : ''}`} aria-haspopup="menu" aria-expanded={open}
        aria-label={plainKind ? `${data.label}. Hand off to another agent` : `${data.label}, model: ${label}. Change model or hand off`} title={title}
        onClick={() => (open ? close() : setOpen(true))} onKeyDown={(e) => {
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !open) { e.preventDefault(); setOpen(true) }
          if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); close() }
        }}>
        {switching ? <Icon name="refresh" size={12} className="spin" /> : <AgentIcon kind={agent.kind} size={14} name={data.label} className="mc-mark" />}
        <span className="mc-name">{label}</span>
        <Icon name="down" size={11} className="mc-caret" />
      </button>
      {open && (panel
        ? <HandoffPanel agent={agent} view={ho.view} target={panel} anchor={wrap} onBack={() => setPanel(null)} onClose={close} onNote={onNote} />
        : <ModelMenu data={data} agent={agent} anchor={wrap} onPick={pick} onClose={close}
          handoff={<HandoffSection view={ho.view} error={ho.error} onPick={(t) => setPanel(t)} separate={!!data.mode} />} />)}
    </span>
  )
}

// The menu, in the style of the account switcher: Default first, the agent's models, Other….
function ModelMenu({ data, agent, anchor, onPick, onClose, handoff = null }) {
  const ref = useRef(null)
  const [other, setOther] = useState(null) // the typed name while "Other…" is open
  const restart = data.mode === 'restart'
  // Restarting waits for a quiet agent with a conversation to resume.
  const blocked = restart && (agent.status === 'working' ? 'It\'s working. Restarting waits until it\'s done (or press Stop).'
    : agent.status === 'blocked' ? 'It\'s waiting on you. Answer it first.'
    : !data.canResume ? 'It can restart on another model once it has a conversation to resume.' : null)
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
  const verb = restart ? 'Restart on' : null
  // One line each: the name, and what it is on the right. wide: the description goes under it.
  const row = (m, name, desc, key = m, wide = false) => (
    <button type="button" key={key} data-item role="menuitemradio" aria-checked={data.checked === m} className={`acct-item model-item ${wide ? 'auto' : ''}`} disabled={!!blocked} onClick={() => onPick(m)}
      title={restart ? `Restart ${data.label} on ${name}, with the same conversation` : `Switch to ${name}${desc && !wide ? ` (${desc})` : ''}`}>
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
    <div className="acct-pop model-pop" ref={ref} role="menu" tabIndex={-1} aria-label={switches ? `${data.label} model` : data.label} onKeyDown={onKeyDown}>
      {data.mode === 'fixed' && <>
        <div className="acct-sec" aria-hidden="true">{data.label} model</div>
        <p className="model-note muted">{data.current ? `On ${modelLabel(data.current)}. ` : ''}{data.label} picks its model when it starts.</p>
      </>}
      {switches && <>
      <div className="acct-sec" aria-hidden="true">{data.label} model</div>
      {blocked && <p className="model-note">{blocked}</p>}
      {data.canDefault && row('default', 'Default (recommended)', restart ? `${data.label} picks, as when you start it yourself` : `${data.label}'s default for your account`, 'default', true)}
      {models.map((m) => row(m, modelLabel(m), HINT[m] || (modelLabel(m) !== m ? m : null)))}
      {current && row(current, modelLabel(current), modelLabel(current) !== current ? `${current}, on now` : 'on now', `now:${current}`)}
      {data.checked !== 'default' && !models.includes(data.checked) && data.checked !== current && row(data.checked, modelLabel(data.checked), modelLabel(data.checked) !== data.checked ? data.checked : null, `pick:${data.checked}`)}
      <div className="acct-sep" role="separator" />
      {other == null ? (
        <button type="button" data-item role="menuitem" className="acct-item plain" disabled={!!blocked} onClick={() => setOther('')}>
          <span className="acct-check"><Icon name="edit" size={13} /></span><span className="acct-main"><span className="acct-name">Other…</span></span>
        </button>
      ) : (
        <form className="model-other" onSubmit={(e) => { e.preventDefault(); if (okName) onPick(typed) }}>
          <input autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder={data.kind === 'claude' ? 'A model name, like claude-sonnet-5-5' : 'A model name'} aria-label="Model name" spellCheck={false} autoCapitalize="off" autoCorrect="off" />
          <button className="btn small primary" disabled={!okName}>{restart ? 'Restart' : 'Switch'}</button>
        </form>
      )}
      {other != null && typed && !okName && <p className="model-note">Letters, numbers and . _ - : / @ [ ] only.</p>}
      <p className="model-note muted">{restart
        ? `${data.label} can't switch while it runs, so it restarts on the model and picks up the same conversation.`
        : data.kind === 'claude' ? 'Sent as /model, like typing it in the terminal. Claude Code also keeps it as your default for new sessions.'
        : `Sent as ${data.kind === 'aider' ? '/model' : 'its switch command'}, like typing it in the terminal.`}</p>
      </>}
      {handoff}
    </div>
  )
}
