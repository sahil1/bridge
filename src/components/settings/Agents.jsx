import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import AgentMark from './agentMark.jsx'
import { api } from '../../api.js'
import SignInButton from '../SignIn.jsx'
import { useRecheck } from '../PermissionFix.jsx'

// Settings › Agents: every agent CLI Bridge AI knows, whether it's installed and signed in,
// and one click to install it (in a terminal tab you can watch) or start it.
// Their own sign-in, from here (SignIn.jsx); the others sign in the first time they open.
const OWN_LOGIN = new Set(['claude', 'codex'])

export default function Agents({ onOpenAgent }) {
  const [list, setList] = useState(null)
  const [subs, setSubs] = useState({})
  const [consult, setConsult] = useState(null)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const load = () => {
    api('/agents/catalog').then(setList).catch((e) => setMsg({ error: e.message }))
    api('/consult').then(setConsult).catch(() => setConsult([]))
    api('/subscriptions').then((r) => setSubs(Object.fromEntries((r || []).map((x) => [x.kind, x])))).catch(() => {})
  }
  useEffect(load, [])
  // After Install or Sign in: look again while it runs and when you come back, so the list catches up.
  const recheck = () => {
    api('/agents/catalog').then(setList).catch(() => {})
    api('/subscriptions?refresh=1').then((r) => setSubs(Object.fromEntries((r || []).map((x) => [x.kind, x])))).catch(() => {})
  }
  useRecheck(recheck, msg?.paneId ? 8000 : 0)

  const install = async (a) => {
    setBusy(a.kind); setMsg(null)
    try {
      const r = await api(`/setup/install/${a.kind}`, { method: 'POST' })
      setMsg({ ok: `Installing ${a.label} in a terminal tab (Setup space). Answer anything it asks there; this list catches up when it's done.`, paneId: r.openId || r.paneId })
    } catch (e) { setMsg({ error: e.message }) }
    setBusy(null)
  }
  const start = async (a) => {
    setBusy(a.kind); setMsg(null)
    try { const r = await api('/chats', { method: 'POST', body: { kind: a.kind, title: `${a.label} chat` } }); onOpenAgent?.(r.paneId) } catch (e) { setMsg({ error: e.message }) }
    setBusy(null)
  }
  const copy = (t) => navigator.clipboard?.writeText(t).catch(() => {})

  if (!list) return <div className="skeleton-rows"><div /><div /><div /></div>
  const sorted = [...list].sort((a, b) => b.installed - a.installed)
  return (
    <div className="st-sections">
      <div className="st-row between">
        <p className="muted small">Bridge AI uses the agents' own sign-ins and subscriptions; it never sees your passwords or tokens.</p>
        <button type="button" className="ghost-btn" onClick={load}><Icon name="refresh" size={12} /> Refresh</button>
      </div>
      {msg?.error && <p className="st-note bad"><Icon name="alert" size={13} /> {msg.error}</p>}
      {msg?.ok && <p className="st-note ok"><Icon name="terminal" size={13} /> {msg.ok} {msg.paneId && <button className="link-btn" onClick={() => onOpenAgent?.(msg.paneId)}>Open it</button>}</p>}
      {consult && consult.length > 0 && (
        <section className="st-consult">
          <h4>Your chief of staff can consult</h4>
          <p className="muted small">One-off questions to other models for second opinions, live news or long documents (<code>bridge ask</code>). Most use the subscriptions you're already signed in with; others need a key under Model providers.</p>
          <div className="st-consult-list">
            {consult.map((c) => (
              <span key={c.id} className={`st-consult-chip ${c.available ? 'on' : ''}`} title={`${c.good}\n${c.available ? `Via ${c.route}` : `To set up: ${c.route}`}`}>
                <Icon name={c.available ? 'check' : 'dot'} size={11} />{c.label}
              </span>
            ))}
          </div>
        </section>
      )}
      <ul className="st-agents">
        {sorted.map((a) => {
          const sub = subs[a.kind]
          const state = !a.installed ? { t: 'Not installed', c: '' } : sub?.signedIn === true ? { t: `Signed in${sub.method ? ` · ${sub.method}` : ''}${sub.account ? ` · ${sub.account}` : ''}`, c: 'good' } : sub?.signedIn === false ? { t: 'Installed, not signed in', c: 'warn' } : { t: 'Installed', c: 'good' }
          return (
            <li key={a.kind} className={`st-agent-row ${a.installed ? '' : 'off'}`}>
              <AgentMark kind={a.kind} label={a.label} size={34} />
              <div className="st-agent-text">
                <b>{a.label}</b>
                <span className={`st-chip ${state.c}`}>{state.t}</span>
                {!a.installed && a.install && <code className="st-cmd" title="Install command">{a.install}</code>}
                {a.installed && sub?.signedIn === false && sub.hint && !OWN_LOGIN.has(a.kind) && <span className="muted small">{sub.hint}</span>}
                <span className="st-caps muted small">{a.caps?.chat ? 'Chat and terminal' : 'Terminal'}{a.caps?.subagents ? ' · subagents' : ''}{a.caps?.commands ? ' · slash commands' : ''}</span>
              </div>
              <div className="st-agent-acts">
                {a.installed && sub?.signedIn === false && OWN_LOGIN.has(a.kind)
                  ? <SignInButton kind={a.kind} onCheck={recheck} />
                  : a.installed
                  ? <button type="button" className="btn" disabled={busy === a.kind} onClick={() => start(a)}>{sub?.signedIn === false ? 'Open to sign in' : 'New chat'}</button>
                  : a.install
                    ? <>
                        <button type="button" className="ghost-btn" onClick={() => copy(a.install)} title="Copy the command"><Icon name="copy" size={12} /></button>
                        <button type="button" className="btn" disabled={busy === a.kind} onClick={() => install(a)}>{busy === a.kind ? 'Starting…' : 'Install'}</button>
                      </>
                    : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
