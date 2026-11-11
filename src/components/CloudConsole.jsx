// A cloud agent (Cursor, GitHub Copilot, Jules, Claude) opened from the sidebar: its conversation,
// a box for follow-ups, Stop, and the pull request or the provider's own page. It runs on the
// provider's computers, so there's no terminal, folder or changes view here.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon, { StatusDot } from './Icon.jsx'
import { PaneHeader } from './layout.jsx'
import { Menu } from './Rail.jsx'
import { CloudMark, linkOf, stateLabel, whereOf } from './cloudBits.jsx'
import { api, usePoll, fmtTime } from '../api.js'
import { t } from '../i18n/index.js'
import './cloud.css'

// Runs of tool steps fold into one line.
function group(messages) {
  const out = []
  for (const m of messages) {
    const last = out.at(-1)
    if (m.role === 'tool' && last?.role === 'tools') last.items.push(m)
    else if (m.role === 'tool') out.push({ role: 'tools', items: [m], id: m.id })
    else out.push(m)
  }
  return out
}
function Steps({ items }) {
  const [open, setOpen] = useState(false)
  const one = items.length === 1
  return (
    <div className="tool-group">
      <button className="tool-summary" onClick={() => setOpen(!open)} aria-expanded={open} disabled={one}>
        <Icon name="tool" size={12} />
        <span>{one ? `${items[0].tool}${items[0].hint ? ` · ${items[0].hint}` : ''}` : t('{n} steps · {names}', { n: items.length, names: items.at(-1).tool })}</span>
        {!one && <Icon name="chevron" size={11} className={open ? 'rot90' : ''} />}
      </button>
      {open && !one && <ul className="tool-list">{items.map((s) => <li key={s.id}><b>{s.tool}</b> {s.hint}</li>)}</ul>}
    </div>
  )
}

function CloudComposer({ placeholder, onSend, hint, disabled }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ta = useRef(null)
  useLayoutEffect(() => { const el = ta.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(200, el.scrollHeight)}px` } }, [text])
  const send = async () => {
    const msg = text.trim()
    if (!msg || busy) return
    setBusy(true)
    const ok = await onSend(msg)
    setBusy(false)
    if (ok !== false) setText('')
  }
  return (
    <div className="composer cloud-composer">
      <textarea ref={ta} value={text} rows={1} placeholder={placeholder} disabled={disabled} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send() } }} />
      <div className="comp-tools">
        <span className="comp-hint">{hint || <span className="hide-touch"><kbd>⏎</kbd> {t('send')} · <kbd>⇧⏎</kbd> {t('new line')}</span>}</span>
        <button className="send" onClick={send} disabled={!text.trim() || busy || disabled} aria-label={t('Send')} title={t('Send')}><Icon name="send" size={15} /></button>
      </div>
    </div>
  )
}

export default function CloudConsole({ agent, variant = 'focus', controls = {}, onBack, onPopOut, Rich }) {
  const c = agent.cloud
  const pid = encodeURIComponent(agent.paneId)
  const working = agent.status === 'working'
  const { data, error, refresh } = usePoll(`/cloud/agents/${pid}`, working ? 5000 : 15000)
  const [flash, setFlash] = useState(null)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(null)
  const scroll = useRef(null)
  const stick = useRef(true)
  const minimized = controls.minimized
  useEffect(() => { if (!flash) return; const timer = setTimeout(() => setFlash(null), flash.length > 60 ? 8000 : 3500); return () => clearTimeout(timer) }, [flash])
  // Opening it counts as having seen how it finished.
  useEffect(() => { api(`/cloud/agents/${pid}/seen`, { method: 'POST' }).catch(() => {}) }, [pid])
  useEffect(() => { refresh() }, [agent.status, agent.seq]) // eslint-disable-line react-hooks/exhaustive-deps
  const messages = group(data?.messages || [])
  const held = data?.held || []
  useLayoutEffect(() => { const el = scroll.current; if (el && stick.current) el.scrollTop = el.scrollHeight }, [data, working])

  const act = async (what, fn, note) => {
    setBusy(what)
    try { const r = await fn(); if (note) setFlash(typeof note === 'function' ? note(r) : note); refresh(); return r } catch (e) { setFlash(e.message); return false } finally { setBusy(null) }
  }
  const send = (text) => act('send', () => api(`/cloud/agents/${pid}/send`, { method: 'POST', body: { text } }), (r) => (r?.queued ? t('Held: {name} takes the next message once this run ends.', { name: c.label }) : null))
  const stop = () => act('stop', () => api(`/cloud/agents/${pid}/stop`, { method: 'POST' }), t('Asked it to stop'))
  const approve = () => act('approve', () => api(`/cloud/agents/${pid}/approve`, { method: 'POST' }), c.approveLabel === 'Allow' ? t('Allowed') : t('Plan approved'))
  const mute = (on) => act('mute', () => api(`/agents/${pid}/mute`, { method: 'POST', body: { muted: on } }), on ? t('Muted: no notifications from this agent until you unmute it') : t('Notifications are back on for this agent'))
  const remove = () => {
    if (!window.confirm(`${t('Stop following "{name}" in Bridge AI?', { name: agent.title })}\n\n${t('The agent stays in {where}, with its branch and any pull request.', { where: c.label })}`)) return
    act('remove', () => api(`/cloud/agents/${pid}`, { method: 'DELETE' }))
  }
  const link = linkOf(c)
  const where = whereOf(c)
  const cloudOf = t('{label} cloud', { label: c.label })
  const subtitle = <span className="cloud-sub" title={`${cloudOf}${where ? ` · ${where}` : ''}`}>{cloudOf}{where ? ` · ${where}` : ''}</span>
  const placeholder = agent.status === 'blocked' ? t('Answer {name}…', { name: c.label }) : t('Message {name}…', { name: agent.title || c.label })
  const hint = !c.canSend ? t('Follow-ups go through {name}', { name: c.label }) : working && c.holds ? t('Sends when this run ends') : null

  return (
    <section className={`pane console cloud-console v-${variant} ${minimized ? 'is-min' : ''}`} aria-label={t('{name} cloud agent', { name: agent.title })}>
      <PaneHeader icon="cloud" title={agent.title || t('Cloud agent')} subtitle={subtitle} {...controls}
        leading={onBack ? <button className="win-btn back" onClick={onBack} aria-label={t('Back')}><Icon name="chevron" size={16} className="flip" /></button> : <span className="pane-icon"><CloudMark provider={c.provider} label={c.label} size={18} /></span>}>
        <span className={`state-tag st-${agent.status} ${c.failed ? 'st-failed' : ''}`}><StatusDot status={agent.status} size={7} />{stateLabel(agent)}</span>
        {agent.muted && <span className="muted-tag" role="img" title={t('Notifications muted (⋯ to unmute)')} aria-label={t('Notifications muted')}><Icon name="bell-off" size={13} /></span>}
        {!minimized && link && <a className="btn small cloud-link" href={link.href} target="_blank" rel="noreferrer" title={link.href} aria-label={link.label}><Icon name="external" size={12} /><span>{link.label}</span></a>}
        {!minimized && working && c.canStop && <button className="btn small" onClick={stop} disabled={busy === 'stop'} title={t('Stop this run on {name}', { name: c.label })} aria-label={t('Stop')}><Icon name="stop" size={11} /><span>{busy === 'stop' ? t('Stopping…') : t('Stop')}</span></button>}
        {onPopOut && !minimized && <button className="win-btn" onClick={onPopOut} title={t('Open in its own window (bring it back from there)')} aria-label={t('Open in its own window')}><Icon name="popout" size={14} /></button>}
        {!minimized && (
          <span className="menu-anchor">
            <button className="win-btn" onClick={() => setMenu(!menu)} title={t('More')} aria-label={t('More actions')}><Icon name="more" size={14} /></button>
            {menu && <Menu onClose={() => setMenu(false)} items={[
              c.prUrl && c.url && { icon: 'external', label: c.urlLabel || t('Open in {name}', { name: c.label }), run: () => window.open(c.url, '_blank', 'noopener') },
              agent.muted ? { icon: 'bell', label: t('Unmute notifications'), run: () => mute(false) } : { icon: 'bell-off', label: t('Mute notifications'), run: () => mute(true) },
              { icon: 'refresh', label: t('Check now'), run: () => act('refresh', () => api(`/cloud/agents/${pid}?refresh=1`)) },
              '-',
              { icon: 'x', label: t('Remove from Bridge AI…'), danger: true, run: remove },
            ]} />}
          </span>
        )}
      </PaneHeader>

      {!minimized && (
        <>
          <div className="console-body">
            <div className="chat" ref={scroll} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
              <div className="chat-col">
                {!data && !error && <div className="skeleton-rows"><div /><div /><div /></div>}
                {error && !data && <div className="error-text">{error}</div>}
                {c.error && <div className="cloud-note warn" role="status"><Icon name="alert" size={12} /> {c.error}</div>}
                {data && !messages.length && !working && <div className="chat-empty"><Icon name="cloud" size={28} /><p>{t('Nothing from {name} yet.', { name: c.label })}</p></div>}
                {messages.map((m) => (
                  m.role === 'tools' ? <Steps key={m.id} items={m.items} />
                    : m.role === 'event' ? <div key={m.id} className={`chat-event ev-${m.status || 'info'}`}><span className="ev-dot" />{m.text}{m.ts && <time>{fmtTime(m.ts)}</time>}</div>
                    : (
                      <div key={m.id} className={`msg ${m.role === 'user' ? 'user' : 'assistant'}`}>
                        <div className="msg-text">{m.role === 'user' ? m.text : Rich ? <Rich text={m.text} /> : m.text}</div>
                        <div className="msg-time">{fmtTime(m.ts)}</div>
                      </div>
                    )
                ))}
                {working && (
                  <div className="live-activity" aria-live="polite" aria-label={t('Agent is working')}>
                    <span className="typing"><span /><span /><span /></span>
                    <span className="live-text">{t("Working on {name}'s computers", { name: c.label })}{c.state ? ` · ${c.state.toLowerCase().replace(/_/g, ' ')}` : ''}</span>
                  </div>
                )}
                {held.map((q) => (
                  <div key={q.id} className="msg user queued">
                    <div className="msg-text">{q.text}</div>
                    <div className="msg-time"><Icon name="clock" size={11} /> {t('Held, sends when this run ends')}
                      <button className="link" onClick={() => act('cancel', () => api(`/cloud/agents/${pid}/held/${q.id}`, { method: 'DELETE' }))}>{t('Cancel')}</button></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {agent.status === 'blocked' && (
            <div className="blocked-card" role="alert">
              <div className="blocked-head"><StatusDot status="blocked" /> {t('Waiting on you')}</div>
              <div className="cloud-ask">
                <p>{c.ask || t('{name} needs an answer. Reply below.', { name: c.label })}</p>
                {c.canApprove && <button className="btn primary small" onClick={approve} disabled={busy === 'approve'}>{busy === 'approve' ? t('Sending…') : c.approveLabel || t('Approve')}</button>}
              </div>
            </div>
          )}

          <div className="composer-wrap">
            {flash && <div className="comp-note" role="status">{flash}</div>}
            <CloudComposer placeholder={placeholder} onSend={send} hint={hint} disabled={!c.canSend} />
          </div>
        </>
      )}
    </section>
  )
}
