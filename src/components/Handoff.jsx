import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { AgentIcon } from './settings/ProviderIcon.jsx'
import { api } from '../api.js'
import { modelLabel } from './ModelChip.jsx'
import './handoff.css'

// Hand off to another agent, from the model chip's menu: the agents you could move this work to
// (installed, with whether each is signed in), and a small panel to confirm. Agent CLIs can't open
// each other's conversations, so the new one starts in the same folder with a handover the server
// builds (server/handoff.js), and this says so plainly.

const views = new Map() // paneId -> its last view, so the menu opens with it while it refreshes
const told = new Set() // hand-offs already announced on this page: `${paneId} ${at}`
const VALID = /^[A-Za-z0-9][\w.:/@[\]-]{0,99}$/
const comma = (list) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0] || '')

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
      onNote?.(`Handed over from ${h.label}. It started with a summary of that conversation, not the conversation itself.`)
    }).catch(() => {})
    return () => { gone = true }
  }, [agent.paneId]) // eslint-disable-line react-hooks/exhaustive-deps
}

const statusOf = (t) => (t.signedIn === true ? 'signed in' : t.signedIn === false ? 'not signed in' : '')

// The menu's section: one row per agent that could take over.
export function HandoffSection({ view, error, onPick, separate = true }) {
  const list = view?.targets || []
  return (
    <>
      {separate && <div className="acct-sep" role="separator" />}
      <div className="acct-sec" aria-hidden="true">Hand off to another agent</div>
      {!view && !error && <p className="model-note muted"><Icon name="refresh" size={11} className="spin" /> Checking which agents are signed in…</p>}
      {error && !view && <p className="model-note">{error}</p>}
      {list.map((t) => (
        <button type="button" key={t.kind} data-item role="menuitem" className="acct-item ho-item" disabled={t.signedIn === false} onClick={() => onPick(t)}
          title={t.signedIn === false ? `${t.label} isn't signed in. ${t.hint || 'Sign in to it first.'}` : `Hand this work to ${t.label}. It starts here with a summary of this conversation.`}>
          <span className="acct-check ho-mark"><AgentIcon kind={t.kind} size={16} name={t.label} /></span>
          <span className="acct-main"><span className="acct-name">{t.label}</span></span>
          <span className={`ho-status ${t.signedIn === false ? 'off' : ''}`}>{statusOf(t)}</span>
        </button>
      ))}
      {view && !list.length && <p className="model-note muted">No other agent is installed. Add one in Settings, under Agents.</p>}
    </>
  )
}

// The confirm panel: what goes over (with the handover itself to read), the account, the model,
// a message to start it on, and what happens to this agent.
export function HandoffPanel({ agent, view: first, target: t, anchor, onBack, onClose, onNote }) {
  const pid = encodeURIComponent(agent.paneId)
  const ref = useRef(null)
  const [view, setView] = useState(first)
  const from = view.from
  const chief = from.chief
  const [account, setAccount] = useState(() => (t.accounts ? t.setting || 'auto' : ''))
  const [model, setModel] = useState('')
  const [other, setOther] = useState(null) // the typed name while Other… is picked
  const [keep, setKeep] = useState(!chief && !from.resumable)
  const [note, setNote] = useState('')
  const [own, setOwn] = useState(view.asked?.to === t.kind && view.asked.state !== 'failed')
  const [pv, setPv] = useState(null) // the handover as it would go now
  const [pvErr, setPvErr] = useState(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState(null)
  const asked = view.asked?.to === t.kind ? view.asked : null
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
        const r = await api(`/agents/${pid}/handoff/preview?to=${encodeURIComponent(t.kind)}&summary=${ready ? 1 : 0}&keep=${keep ? 1 : 0}&note=${encodeURIComponent(note.slice(0, 2000))}`)
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
      await api(`/agents/${pid}/handoff/ask`, { method: 'POST', body: { to: t.kind } })
      setOwn(true)
      setView((v) => ({ ...v, asked: { to: t.kind, state: 'asking', at: new Date().toISOString() } }))
    } catch (e) { setErr(e.message) }
  }

  const blocked = !keep && (view.busy === 'working' ? `${from.label} is working. Hand off once it's done (or press Stop), or keep it open too.`
    : view.busy === 'blocked' ? `${from.label} is waiting on you. Answer it first, or keep it open too.`
    : view.tabMates ? 'This tab has other panes. Close them first, or keep it open too.' : null)
  const badModel = other != null && pick && !VALID.test(pick)
  const waiting = own && asked?.state === 'asking'
  const can = !sending && !blocked && !badModel && !waiting && !(own && !ready) && !(account && t.accounts?.find((x) => x.id === account)?.signedIn === false)

  const submit = async (e) => {
    e?.preventDefault()
    if (!can) return
    setSending(true)
    setErr(null)
    try {
      const r = await api(`/agents/${pid}/handoff`, { method: 'POST', body: { to: t.kind, account: account || undefined, model: pick || undefined, keep, note: note.trim() || undefined, summary: ready || undefined } })
      onClose()
      onNote?.(`Handing over to ${t.label}…`)
      setTimeout(() => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: r.paneId } })), 1200)
    } catch (x) { setErr(x.message); setSending(false) }
  }

  const p = pv?.parts
  const msgs = p && (p.messages ? `the last ${p.messages} message${p.messages === 1 ? '' : 's'}` : p.stopped && 'where it stopped')
  const carries = p && (chief
    ? [p.own && `${from.label}'s own summary`, msgs, p.queued ? `${p.queued} queued message${p.queued === 1 ? '' : 's'}` : null].filter(Boolean)
    : [p.goal && 'your goal', p.own && `${from.label}'s own summary`, p.compacted && 'its summary of earlier turns', msgs,
      p.files ? `${p.files} changed file${p.files === 1 ? '' : 's'}` : null, p.branch && `branch ${p.branch}`, p.todo ? `its to-do list (${p.todo} open)` : null,
      p.queued ? `${p.queued} queued message${p.queued === 1 ? '' : 's'}` : null, p.screen && 'its screen'].filter(Boolean))
  const nothing = chief ? 'There\'s no conversation to sum up yet.' : p?.branch ? 'Carries over the folder and its git state.' : 'Carries over the folder.'

  return (
    <form className="acct-pop model-pop ho-pop" ref={ref} role="dialog" aria-labelledby="ho-title" onSubmit={submit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onBack() } }}>
      <div className="ho-head">
        <button type="button" className="win-btn ho-back" onClick={onBack} aria-label="Back to the menu" title="Back"><Icon name="chevron" size={14} className="flip" /></button>
        <AgentIcon kind={t.kind} size={18} name={t.label} />
        <h4 id="ho-title">{chief ? `Chief of staff on ${t.label}` : `Hand off to ${t.label}`}</h4>
      </div>
      <p className="ho-lead">{chief
        ? `Your chief of staff restarts on ${t.label}. It reads its playbook, ledger and task list as usual, and starts with a summary of your recent conversation.`
        : `${t.label} can't open this conversation. It starts in this folder${p?.branch ? ` on ${p.branch}` : ''} with a summary of it.`}</p>

      <div className="ho-carry">
        <span>{carries ? (carries.length ? <>Carries over {comma(carries)}.</> : nothing) : pvErr || 'Putting the handover together…'}</span>
        {pv && (
          <details className="ho-preview">
            <summary>Preview the handover <span className="muted">({pv.chars.toLocaleString()} characters)</span></summary>
            <pre tabIndex={0} aria-label="The handover">{pv.text}</pre>
          </details>
        )}
        {(view.canAsk || asked) && (!asked || asked.state === 'failed' ? (
          <span className="ho-ask">
            <button type="button" className="link-btn" onClick={askNow} disabled={!view.canAsk} title={`${from.label} sums up its own work instead, which takes a minute. It sees the request in its chat.`}>
              <Icon name="sparkle" size={11} /> Ask {from.label} to write it instead
            </button>
            {asked?.state === 'failed' && <span className="ho-warn">Didn't work: {asked.error || 'no reply'}.</span>}
          </span>
        ) : (
          <label className="na-check ho-ask">
            <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
            <span>{asked.state === 'asking'
              ? <><Icon name="refresh" size={11} className="spin" /> Waiting for {from.label} to write it…</>
              : <>Use {from.label}'s own summary <span className="muted">(the preview shows it)</span></>}</span>
          </label>
        ))}
      </div>

      {(t.accounts || t.modelFlag) && (
        <div className={`ho-pick ${t.accounts && t.modelFlag ? 'two' : ''}`}>
          {t.accounts && (
            <label className="na-field">
              <span className="na-label">Account</span>
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="auto">Auto (most left)</option>
                {t.accounts.map((x) => <option key={x.id} value={x.id} disabled={x.signedIn === false}>{x.label}{x.signedIn === false ? ' (not signed in)' : ''}</option>)}
              </select>
            </label>
          )}
          {t.modelFlag && (
            <div className="na-field">
              <label className="na-label" htmlFor="ho-model">Model</label>
              <select id="ho-model" value={other != null ? '\u0000other' : model} onChange={(e) => { if (e.target.value === '\u0000other') setOther(''); else { setOther(null); setModel(e.target.value) } }}>
                <option value="">Default</option>
                {t.models.map((m) => <option key={m} value={m}>{modelLabel(m)}{modelLabel(m) !== m ? ` (${m})` : ''}</option>)}
                <option value={'\u0000other'}>Other…</option>
              </select>
            </div>
          )}
        </div>
      )}
      {other != null && (
        <div className="na-field">
          <input autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder="A model name" aria-label="Model name" spellCheck={false} autoCapitalize="off" autoCorrect="off" className="mono" />
          {badModel && <span className="ho-warn">Letters, numbers and . _ - : / @ [ ] only.</span>}
        </div>
      )}
      <label className="na-field">
        <span className="na-label">Message <i>optional</i></span>
        <textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder={chief ? 'Your next request, if you have one' : `What ${t.label} should do first`} />
      </label>

      <div className="ho-old">
        {chief ? <span>The {from.label} chief goes to Closed agents.</span> : (
          <label className="na-check">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            <span>Keep {from.label} open too
              <span className="ho-hint">{keep ? `It stays in its tab, next to ${t.label}.`
                : from.resumable ? 'Otherwise it goes to Closed agents, where you can reopen it.'
                : `Otherwise it closes, and ${from.label} can't be reopened from Closed agents.`}</span>
            </span>
          </label>
        )}
      </div>

      {blocked && <p className="ho-warn" role="status">{blocked}</p>}
      {err && <p className="ho-warn" role="alert">{err}</p>}
      <div className="ho-foot">
        <button type="button" className="btn small ghost" onClick={onBack}>Cancel</button>
        <button type="submit" className="btn small primary" disabled={!can}>{sending ? `Starting ${t.label}…` : chief ? `Switch to ${t.label}` : `Hand off to ${t.label}`}</button>
      </div>
    </form>
  )
}
