import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { AgentIcon } from './settings/ProviderIcon.jsx'
import { api } from '../api.js'
import { modelLabel } from './ModelChip.jsx'
import { nameOf } from './AccountMenu.jsx'
import { t } from '../i18n/index.js'
import './handoff.css'

// Hand off to another agent, from the model chip's menu: the agents you could move this work to
// (installed, with whether each is signed in), and a small panel to confirm. Agent CLIs can't open
// each other's conversations, so the new one starts in the same folder with a handover the server
// builds (server/handoff.js), and this says so plainly.

const views = new Map() // paneId -> its last view, so the menu opens with it while it refreshes
const told = new Set() // hand-offs already announced on this page: `${paneId} ${at}`
const VALID = /^[A-Za-z0-9][\w.:/@[\]-]{0,99}$/
const comma = (list) => (list.length > 1 ? t('{list} and {last}', { list: list.slice(0, -1).join(', '), last: list.at(-1) }) : list[0] || '')

// The agents to hand off to, for the menu: fetched when it opens.
export function useHandoff(agent, open) {
  const pid = encodeURIComponent(agent.paneId)
  const [view, setView] = useState(() => views.get(agent.paneId) || null)
  const [error, setError] = useState(null)
  const load = async () => {
    try { const v = await api(`/agents/${pid}/handoff`); views.set(agent.paneId, v); setView(v); setError(null); return v } catch (e) { setError(e.message); return null }
  }
  useEffect(() => { if (open) load() }, [open, agent.paneId, agent.status]) // eslint-disable-line react-hooks/exhaustive-deps
  return { view, error, reload: load }
}

// Started by a hand-off: say so once in its message box (Chat shows it too, for agents with one).
export function useHandedNote(agent, onNote) {
  useEffect(() => {
    let gone = false
    api(`/agents/${encodeURIComponent(agent.paneId)}/handoff?lite=1`).then((v) => {
      const h = v?.handedFrom
      const key = h && `${agent.paneId} ${h.at}`
      if (gone || !h || told.has(key) || Date.now() - new Date(h.at).getTime() > 120000) return
      told.add(key)
      onNote?.(t('Handed over from {name}. It started with a summary of that conversation, not the conversation itself.', { name: h.label }))
    }).catch(() => {})
    return () => { gone = true }
  }, [agent.paneId]) // eslint-disable-line react-hooks/exhaustive-deps
}

const statusOf = (target) => (target.signedIn === true ? t('signed in') : target.signedIn === false ? t('not signed in') : '')

// The menu's section: one row per agent that could take over.
export function HandoffSection({ view, error, onPick, separate = true }) {
  const list = view?.targets || []
  return (
    <>
      {separate && <div className="acct-sep" role="separator" />}
      <div className="acct-sec" aria-hidden="true">{t('Hand off to another agent')}</div>
      {!view && !error && <p className="model-note muted"><Icon name="refresh" size={11} className="spin" /> {t('Checking which agents are signed in…')}</p>}
      {error && !view && <p className="model-note">{error}</p>}
      {list.map((target) => (
        <button type="button" key={target.kind} data-item role="menuitem" className="acct-item ho-item" disabled={target.signedIn === false} onClick={() => onPick(target)}
          title={target.signedIn === false ? `${t("{name} isn't signed in.", { name: target.label })} ${target.hint || t('Sign in to it first.')}` : t('Hand this work to {name}. It starts here with a summary of this conversation.', { name: target.label })}>
          <span className="acct-check ho-mark"><AgentIcon kind={target.kind} size={16} name={target.label} /></span>
          <span className="acct-main"><span className="acct-name">{target.label}</span></span>
          <span className={`ho-status ${target.signedIn === false ? 'off' : ''}`}>{statusOf(target)}</span>
        </button>
      ))}
      {view && !list.length && <p className="model-note muted">{t('No other agent is installed. Add one in Settings, under Agents.')}</p>}
    </>
  )
}

// The confirm panel: what goes over (with the handover itself to read), the account, the model,
// a message to start it on, and what happens to this agent.
export function HandoffPanel({ agent, view: first, target, anchor, onBack, onClose, onNote }) {
  const pid = encodeURIComponent(agent.paneId)
  const ref = useRef(null)
  const [view, setView] = useState(first)
  const from = view.from
  const chief = from.chief
  const [account, setAccount] = useState(() => (target.accounts ? target.setting || 'auto' : ''))
  const [model, setModel] = useState('')
  const [other, setOther] = useState(null) // the typed name while Other… is picked
  const [keep, setKeep] = useState(!chief && !from.resumable)
  const [note, setNote] = useState('')
  const [own, setOwn] = useState(view.asked?.to === target.kind && view.asked.state !== 'failed')
  const [pv, setPv] = useState(null) // the handover as it would go now
  const [pvErr, setPvErr] = useState(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState(null)
  const asked = view.asked?.to === target.kind ? view.asked : null
  const ready = own && asked?.state === 'ready'
  const pick = other != null ? other.trim() : model

  // As tall as there's room for above the message box, inside the agent's panel.
  useLayoutEffect(() => {
    const el = ref.current
    const box = el?.closest('.pane')
    if (!el || !box) return
    const room = el.getBoundingClientRect().bottom - Math.max(0, box.getBoundingClientRect().top) - 8
    el.style.maxHeight = `${Math.max(220, Math.min(620, room))}px`
  }, [])
  useEffect(() => {
    ref.current?.querySelector('.ho-back')?.focus()
    const down = (e) => { if (!ref.current?.contains(e.target) && !anchor?.current?.contains(e.target)) onClose() }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The handover, again when what goes in it changes (the message after a pause in typing).
  useEffect(() => {
    let gone = false
    const go = setTimeout(async () => {
      try {
        const r = await api(`/agents/${pid}/handoff/preview?to=${encodeURIComponent(target.kind)}&summary=${ready ? 1 : 0}&keep=${keep ? 1 : 0}&note=${encodeURIComponent(note.slice(0, 2000))}`)
        if (!gone) { setPv(r); setPvErr(null) }
      } catch (e) { if (!gone) setPvErr(e.message) }
    }, pv ? 450 : 0)
    return () => { gone = true; clearTimeout(go) }
  }, [ready, keep, note]) // eslint-disable-line react-hooks/exhaustive-deps

  // While the agent writes its own handover: ask how it's going every couple of seconds.
  useEffect(() => {
    if (asked?.state !== 'asking') return
    const id = setInterval(async () => { try { const v = await api(`/agents/${pid}/handoff`); views.set(agent.paneId, v); setView(v) } catch { /* next time */ } }, 2000)
    return () => clearInterval(id)
  }, [asked?.state]) // eslint-disable-line react-hooks/exhaustive-deps

  const askNow = async () => {
    setErr(null)
    try {
      await api(`/agents/${pid}/handoff/ask`, { method: 'POST', body: { to: target.kind } })
      setOwn(true)
      setView((v) => ({ ...v, asked: { to: target.kind, state: 'asking', at: new Date().toISOString() } }))
    } catch (e) { setErr(e.message) }
  }

  const blocked = !keep && (view.busy === 'working' ? t("{name} is working. Hand off once it's done (or press Stop), or keep it open too.", { name: from.label })
    : view.busy === 'blocked' ? t('{name} is waiting on you. Answer it first, or keep it open too.', { name: from.label })
    : view.tabMates ? t('This tab has other panes. Close them first, or keep it open too.') : null)
  const badModel = other != null && pick && !VALID.test(pick)
  const waiting = own && asked?.state === 'asking'
  const can = !sending && !blocked && !badModel && !waiting && !(own && !ready) && !(account && target.accounts?.find((x) => x.id === account)?.signedIn === false)

  const submit = async (e) => {
    e?.preventDefault()
    if (!can) return
    setSending(true)
    setErr(null)
    try {
      const r = await api(`/agents/${pid}/handoff`, { method: 'POST', body: { to: target.kind, account: account || undefined, model: pick || undefined, keep, note: note.trim() || undefined, summary: ready || undefined } })
      onClose()
      onNote?.(t('Handing over to {name}…', { name: target.label }))
      setTimeout(() => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: r.paneId } })), 1200)
    } catch (x) { setErr(x.message); setSending(false) }
  }

  const p = pv?.parts
  const msgs = p && (p.messages ? (p.messages === 1 ? t('the last {n} message', { n: p.messages }) : t('the last {n} messages', { n: p.messages })) : p.stopped && t('where it stopped'))
  const queued = p?.queued ? (p.queued === 1 ? t('{n} queued message', { n: p.queued }) : t('{n} queued messages', { n: p.queued })) : null
  const carries = p && (chief
    ? [p.own && t("{name}'s own summary", { name: from.label }), msgs, queued].filter(Boolean)
    : [p.goal && t('your goal'), p.own && t("{name}'s own summary", { name: from.label }), p.compacted && t('its summary of earlier turns'), msgs,
      p.files ? (p.files === 1 ? t('{n} changed file', { n: p.files }) : t('{n} changed files', { n: p.files })) : null, p.branch && t('branch {name}', { name: p.branch }), p.todo ? t('its to-do list ({n} open)', { n: p.todo }) : null,
      queued, p.screen && t('its screen')].filter(Boolean))
  const nothing = chief ? t("There's no conversation to sum up yet.") : p?.branch ? t('Carries over the folder and its git state.') : t('Carries over the folder.')

  return (
    <form className="acct-pop model-pop ho-pop" ref={ref} role="dialog" aria-labelledby="ho-title" onSubmit={submit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onBack() } }}>
      <div className="ho-head">
        <button type="button" className="win-btn ho-back" onClick={onBack} aria-label={t('Back to the menu')} title={t('Back')}><Icon name="chevron" size={14} className="flip" /></button>
        <AgentIcon kind={target.kind} size={18} name={target.label} />
        <h4 id="ho-title">{chief ? t('Chief of Staff on {name}', { name: target.label }) : t('Hand off to {name}', { name: target.label })}</h4>
      </div>
      <p className="ho-lead">{chief
        ? t('Your chief of staff restarts on {name}. It reads its playbook, ledger and task list as usual, and starts with a summary of your recent conversation.', { name: target.label })
        : p?.branch ? t("{name} can't open this conversation. It starts in this folder on {branch} with a summary of it.", { name: target.label, branch: p.branch })
          : t("{name} can't open this conversation. It starts in this folder with a summary of it.", { name: target.label })}</p>

      <div className="ho-carry">
        <span>{carries ? (carries.length ? t('Carries over {list}.', { list: comma(carries) }) : nothing) : pvErr || t('Putting the handover together…')}</span>
        {pv && (
          <details className="ho-preview">
            <summary>{t('Preview the handover')} <span className="muted">{t('({n} characters)', { n: pv.chars.toLocaleString() })}</span></summary>
            <pre tabIndex={0} aria-label={t('The handover')}>{pv.text}</pre>
          </details>
        )}
        {(view.canAsk || asked) && (!asked || asked.state === 'failed' ? (
          <span className="ho-ask">
            <button type="button" className="link-btn" onClick={askNow} disabled={!view.canAsk} title={t('{name} sums up its own work instead, which takes a minute. It sees the request in its chat.', { name: from.label })}>
              <Icon name="sparkle" size={11} /> {t('Ask {name} to write it instead', { name: from.label })}
            </button>
            {asked?.state === 'failed' && <span className="ho-warn">{t("Didn't work: {error}.", { error: asked.error || t('no reply') })}</span>}
          </span>
        ) : (
          <label className="na-check ho-ask">
            <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
            <span>{asked.state === 'asking'
              ? <><Icon name="refresh" size={11} className="spin" /> {t('Waiting for {name} to write it…', { name: from.label })}</>
              : <>{t("Use {name}'s own summary", { name: from.label })} <span className="muted">{t('(the preview shows it)')}</span></>}</span>
          </label>
        ))}
      </div>

      {(target.accounts || target.modelFlag) && (
        <div className={`ho-pick ${target.accounts && target.modelFlag ? 'two' : ''}`}>
          {target.accounts && (
            <label className="na-field">
              <span className="na-label">{t('Account')}</span>
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="auto">{t('Auto (most left)')}</option>
                {target.accounts.map((x) => <option key={x.id} value={x.id} disabled={x.signedIn === false}>{x.signedIn === false ? t('{name} (not signed in)', { name: nameOf(x) }) : nameOf(x)}</option>)}
              </select>
            </label>
          )}
          {target.modelFlag && (
            <div className="na-field">
              <label className="na-label" htmlFor="ho-model">{t('Model')}</label>
              <select id="ho-model" value={other != null ? '\u0000other' : model} onChange={(e) => { if (e.target.value === '\u0000other') setOther(''); else { setOther(null); setModel(e.target.value) } }}>
                <option value="">{t('Default')}</option>
                {target.models.map((m) => <option key={m} value={m}>{modelLabel(m)}{modelLabel(m) !== m ? ` (${m})` : ''}</option>)}
                <option value={'\u0000other'}>{t('Other…')}</option>
              </select>
            </div>
          )}
        </div>
      )}
      {other != null && (
        <div className="na-field">
          <input autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder={t('A model name')} aria-label={t('Model name')} spellCheck={false} autoCapitalize="off" autoCorrect="off" className="mono" />
          {badModel && <span className="ho-warn">{t('Letters, numbers and . _ - : / @ [ ] only.')}</span>}
        </div>
      )}
      <label className="na-field">
        <span className="na-label">{t('Message')} <i>{t('optional')}</i></span>
        <textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder={chief ? t('Your next request, if you have one') : t('What {name} should do first', { name: target.label })} />
      </label>

      <div className="ho-old">
        {chief ? <span>{t('The {name} chief goes to Closed agents.', { name: from.label })}</span> : (
          <label className="na-check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            <span>{t('Keep {name} open too', { name: from.label })}
              <span className="ho-hint">{keep ? t('It stays in its tab, next to {name}.', { name: target.label })
                : from.resumable ? t('Otherwise it goes to Closed agents, where you can reopen it.')
                : t("Otherwise it closes, and {name} can't be reopened from Closed agents.", { name: from.label })}</span>
            </span>
          </label>
        )}
      </div>

      {blocked && <p className="ho-warn" role="status">{blocked}</p>}
      {err && <p className="ho-warn" role="alert">{err}</p>}
      <div className="ho-foot">
        <button type="button" className="btn small ghost" onClick={onBack}>{t('Cancel')}</button>
        <button type="submit" className="btn small primary" disabled={!can}>{sending ? t('Starting {name}…', { name: target.label }) : chief ? t('Switch to {name}', { name: target.label }) : t('Hand off to {name}', { name: target.label })}</button>
      </div>
    </form>
  )
}
