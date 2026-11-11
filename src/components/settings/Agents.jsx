import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import CopyButton from '../CopyButton.jsx'
import AgentMark from './agentMark.jsx'
import { api } from '../../api.js'
import SignInButton, { canSignIn } from '../SignIn.jsx'
import { useRecheck } from '../PermissionFix.jsx'
import { Advanced } from './Advanced.jsx'
import { RecommendCard, StartsWith, useRecommended } from '../Recommended.jsx'
import { t } from '../../i18n/index.js'

// Settings › Agents: every agent CLI Bridge AI knows, whether it's installed and signed in,
// and one click to install it (in a terminal tab you can watch) or start it.
// Their own sign-in, from here (SignIn.jsx); the others sign in the first time they open. Under
// Advanced: the models the Chief of Staff can consult. With Recommended Settings on (a beta
// feature), under Claude Code: what's recommended for your plan, and what it starts with.

export default function Agents({ onOpenAgent }) {
  const [list, setList] = useState(null)
  const [subs, setSubs] = useState({})
  const [consult, setConsult] = useState(null)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const rec = useRecommended()
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
    if (rec.on) rec.reload(true) // signed in meanwhile: its plan's recommendation
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

  if (!list) return <div className="skeleton-rows"><div /><div /><div /></div>
  const sorted = [...list].sort((a, b) => b.installed - a.installed)
  return (
    <div className="st-sections">
      <div className="st-row between">
        <p className="muted small">{t("Bridge AI uses the agents' own sign-ins and subscriptions; it never sees your passwords or tokens.")}</p>
        <button type="button" className="ghost-btn" onClick={() => { load(); if (rec.on) rec.reload(true) }}><Icon name="refresh" size={12} /> Refresh</button>
      </div>
      {msg?.error && <p className="st-note bad"><Icon name="alert" size={13} /> {msg.error}</p>}
      {rec.error && <p className="st-note bad"><Icon name="alert" size={13} /> {t("Couldn't look up the settings recommended for your plan: {error}", { error: rec.error })}</p>}
      {msg?.ok && <p className="st-note ok"><Icon name="terminal" size={13} /> {msg.ok} {msg.paneId && <button className="link-btn" onClick={() => onOpenAgent?.(msg.paneId)}>Open it</button>}</p>}
      {consult && consult.length > 0 && (
        <Advanced order={10}>
        <section className="st-consult" data-setting="consult">
          <h4>{t('Your Chief of Staff can consult')}</h4>
          <p className="muted small" title={t("One-off questions to other models for second opinions, live news or long documents (bridge ask). Most use the subscriptions you're already signed in with; others need a key under Model Providers.")}>{t('Other models, for second opinions, live news or long documents.')}</p>
          <div className="st-consult-list">
            {consult.map((c) => (
              <span key={c.id} className={`st-consult-chip ${c.available ? 'on' : ''}`} title={`${c.good}\n${c.available ? `Via ${c.route}` : `To set up: ${c.route}`}`}>
                <Icon name={c.available ? 'check' : 'dot'} size={11} />{c.label}
              </span>
            ))}
          </div>
        </section>
        </Advanced>
      )}
      <ul className="st-agents" data-setting="agent-list">
        {sorted.map((a) => {
          const sub = subs[a.kind]
          const state = !a.installed ? { t: 'Not installed', c: '' } : sub?.signedIn === true ? { t: `Signed in${sub.method ? ` · ${sub.method}` : ''}${sub.account ? ` · ${sub.account}` : ''}`, c: 'good' } : sub?.signedIn === false ? { t: 'Installed, not signed in', c: 'warn' } : { t: 'Installed', c: 'good' }
          const r = a.installed && rec.data?.agents.find((x) => x.kind === a.kind)
          return (
            <li key={a.kind} className={`st-agent-row ${a.installed ? '' : 'off'} ${r ? 'has-rec' : ''}`} data-setting={`agent-${a.kind}`}>
              <AgentMark kind={a.kind} label={a.label} size={34} />
              <div className="st-agent-text">
                <b>{a.label}</b>
                <span className={`st-chip ${state.c}`}>{state.t}</span>
                {!a.installed && a.install && <code className="st-cmd" title="Install command">{a.install}</code>}
                {a.installed && sub?.signedIn === false && sub.hint && !canSignIn(a.kind) && <span className="muted small">{sub.hint}</span>}
                <span className="st-caps muted small" title={[a.caps?.subagents && 'subagents', a.caps?.commands && 'slash commands'].filter(Boolean).join(' · ') || undefined}>{a.caps?.chat ? 'Chat and terminal' : 'Terminal'}</span>
              </div>
              <div className="st-agent-acts">
                {a.installed && sub?.signedIn === false && canSignIn(a.kind)
                  ? <SignInButton kind={a.kind} onCheck={recheck} />
                  : a.installed
                  ? <button type="button" className="btn" disabled={busy === a.kind} onClick={() => start(a)}>{sub?.signedIn === false ? 'Open to sign in' : 'New chat'}</button>
                  : a.install
                    ? <>
                        <CopyButton text={a.install} label={null} title="Copy the command" />
                        <button type="button" className="btn" disabled={busy === a.kind} onClick={() => install(a)}>{busy === a.kind ? 'Starting…' : 'Install'}</button>
                      </>
                    : null}
              </div>
              {r && (
                <div className="rec-below">
                  <RecommendCard r={r} onAnswer={rec.answer} />
                  <StartsWith r={r} runtime={rec.data.runtime} onSave={rec.save} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
