import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import AgentMark from './settings/agentMark.jsx'
import { AllowKeychain } from './AccountMenu.jsx'
import { api, refetch, viaRelay } from '../api.js'
import './addAccount.css'

// Another sign-in for Claude Code or Codex (a work and a personal account, side by side), in one
// dialog: pick the agent and name the account, sign in with the agent's own login (run for that
// account's folder in a terminal tab, followed here as it goes), then start an agent on it.
// Also signs in an account you already have (Settings' Sign in): account { id, kind, label }.
// Opened from anywhere with addAccount(); App shows it.
export const addAccount = (kind, account) => window.dispatchEvent(new CustomEvent('bridge-add-account', { detail: { kind, account } }))
// What lists accounts (New agent, Settings, the top bar) looks again.
const changed = (detail = {}) => { refetch('/quota'); window.dispatchEvent(new CustomEvent('bridge-accounts-changed', { detail })) }

const NAMES = { claude: 'Claude', codex: 'Codex' }
const SUGGEST = ['Work', 'Personal']
const POLL = 2500
const SLOW = 5 * 60000

// eslint-disable-next-line no-control-regex
const plain = (s) => String(s || '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b[()][A-Z0-9]/g, '').replace(/\r/g, '')
// The sign-in tab from the login line on (not the shell's greeting), without the empty lines
// below. A line as wide as the terminal went on in the next one (a long link, say): joined.
function tailOf(ansi, cols, n = 12) {
  const rows = plain(ansi).split('\n').map((x) => x.trimEnd())
  const out = []
  let open = false
  for (const r of rows) {
    if (open) out[out.length - 1] += r
    else out.push(r)
    open = !!cols && r.length >= cols
  }
  while (out.length && !out[out.length - 1]) out.pop()
  let from = out.length
  while (from > 0 && !(/\blogin\b/.test(out[from - 1]) && /\b(claude|codex)\b/.test(out[from - 1]))) from--
  return out.slice(from ? from - 1 : 0).slice(-n)
}
const URL_RE = /https?:\/\/[^\s'"<>]+/g
// After the login line: a line where it says it didn't work (links aside).
const FAILED = /\b(error|failed|failure|denied|invalid|timed out|aborted|cancell?ed)\b/i
const failure = (lines) => lines.slice(1).find((l) => FAILED.test(l.replace(URL_RE, ''))) || null
// ...or that it worked ("Login successful", "Successfully logged in").
const succeeded = (lines) => lines.slice(1).some((l) => /\b(successful|successfully)\b/i.test(l))

function Steps({ step }) {
  const at = { name: 0, signin: 1, done: 2 }[step]
  return (
    <ol className="aa-steps" aria-label="Steps">
      {['Name it', 'Sign in', 'Start an agent'].map((s, i) => (
        <li key={s} className={i < at ? 'did' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}>
          <span className="aa-num">{i < at ? <Icon name="check" size={11} /> : i + 1}</span><span className="aa-step-name">{s}</span>
        </li>
      ))}
    </ol>
  )
}

export default function AddAccount({ initial = {}, onClose, onStart, onOpenAgent }) {
  const given = initial.account?.id ? initial.account : null
  const [groups, setGroups] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [kind, setKind] = useState(given?.kind || initial.kind || 'claude')
  const [label, setLabel] = useState('')
  const [step, setStep] = useState(given ? 'signin' : 'name')
  const [acct, setAcct] = useState(given)
  const [made, setMade] = useState(false) // made here: Cancel takes it away again
  const [login, setLogin] = useState(null) // the sign-in tab: { paneId, tabId, openId, at }
  const [lines, setLines] = useState([])
  const [problem, setProblem] = useState(null)
  const [slow, setSlow] = useState(false)
  const [plan, setPlan] = useState(null)
  const [allow, setAllow] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const termRef = useRef(null)
  const wasIn = useRef(false) // already signed in before this sign-in began
  const seen = useRef([]) // the sign-in's lines, for the check below
  seen.current = lines
  // The newest lines in view, as in a terminal.
  useEffect(() => { const el = termRef.current; if (el) el.scrollTop = el.scrollHeight }, [lines])

  useEffect(() => {
    api('/accounts').then((g) => {
      setGroups(g)
      const ok = g.filter((x) => x.installed)
      if (!given && ok.length && !ok.some((x) => x.kind === kind)) setKind(ok[0].kind)
    }).catch((e) => setLoadErr(e.message))
    // Signing in again: it says signed in all along, so it's done when the login says so.
    if (given) api(`/accounts/${encodeURIComponent(given.id)}/status`).then((s) => { wasIn.current = !!s.signedIn }, () => {}).finally(() => startLogin(given))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const kinds = (groups || []).filter((g) => g.installed)
  const group = (groups || []).find((g) => g.kind === kind)
  const taken = new Set((group?.accounts || []).map((a) => a.label.toLowerCase()))
  const name = acct?.label || label.trim()
  const agentName = NAMES[acct?.kind || kind] || kind

  const closeTab = (tabId) => (tabId ? api(`/tabs/${encodeURIComponent(tabId)}/close`, { method: 'POST' }).catch(() => {}) : Promise.resolve())
  const startLogin = async (a = acct) => {
    setProblem(null); setLines([]); setSlow(false)
    if (login?.tabId) await closeTab(login.tabId)
    setLogin(null)
    try {
      const r = await api(`/accounts/${encodeURIComponent(a.id)}/login`, { method: 'POST' })
      setLogin({ ...r, at: Date.now() })
    } catch (x) { setProblem(x.message) }
  }

  const create = async (e) => {
    e?.preventDefault()
    if (!label.trim() || busy) return
    setBusy(true); setErr(null)
    try {
      const a = await api('/accounts', { method: 'POST', body: { kind, label: label.trim() } })
      setAcct(a); setMade(true); setStep('signin')
      changed({ kind, id: a.id })
      await startLogin(a)
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }

  // While you sign in: is it signed in yet, and what does the sign-in say. Its tab closing first,
  // or the login saying it failed, stops here with a way to try again.
  useEffect(() => {
    if (step !== 'signin' || !login || !acct) return
    let stop = false
    let timer = null
    const tick = async () => {
      try {
        const s = await api(`/accounts/${encodeURIComponent(acct.id)}/status`)
        if (stop) return
        if (s.signedIn && (!wasIn.current || succeeded(seen.current))) { setPlan(s.plan); setStep('done'); return }
      } catch { /* checked again next time */ }
      try {
        const scr = await api(`/agents/${encodeURIComponent(login.paneId)}/screen?lines=60`)
        if (stop) return
        const l = tailOf(scr.ansi, scr.cols)
        setLines(l)
        const bad = failure(l)
        if (bad) setProblem(`The sign-in stopped: ${bad.trim()}`)
      } catch {
        if (!stop) setProblem(`The sign-in tab closed before ${acct.label} signed in.`)
        return
      }
      if (Date.now() - login.at > SLOW) setSlow(true)
      timer = setTimeout(tick, POLL)
    }
    timer = setTimeout(tick, 900)
    return () => { stop = true; clearTimeout(timer) }
  }, [step, login, acct])

  // Signed in: tidy the sign-in tab away. With plan usage on, a second Claude account on a Mac
  // needs one Allow before its usage shows; off (the default), there's nothing to read.
  useEffect(() => {
    if (step !== 'done' || !acct) return
    changed({ kind: acct.kind, id: acct.id, ready: true })
    closeTab(login?.tabId)
    api('/quota').then((q) => {
      if (q.off) return
      setAllow(!!q.accounts?.find((g) => g.kind === acct.kind)?.accounts.find((a) => a.id === acct.id)?.allow)
    }).catch(() => {})
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (steps) => {
    try { await api(`/panes/${encodeURIComponent(login.paneId)}/input`, { method: 'POST', body: { steps } }) } catch (x) { setProblem(x.message) }
  }
  // Cancel: stop the sign-in, and take away an account made here that never signed in.
  const cancel = async () => {
    if (step === 'signin') {
      await closeTab(login?.tabId)
      if (made && acct) {
        try { await api(`/accounts/${encodeURIComponent(acct.id)}`, { method: 'DELETE' }) } catch { /* left in Settings, to remove there */ }
        changed({ kind: acct.kind })
      }
    }
    onClose()
  }
  const dismiss = () => {
    if (step === 'signin' && made && !window.confirm(`Stop signing in? ${acct?.label} isn't signed in yet, so it's removed.`)) return
    cancel()
  }
  // Only this dialog: not New agent or Settings under it.
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss() } }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })

  const link = [...lines.join('\n').matchAll(URL_RE)].map((m) => m[0]).pop()
  const openTab = () => { onOpenAgent?.(login.openId || login.paneId); onClose() }

  return (
    <div className="modal-backdrop aa-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss() }}>
      <div className="modal add-acct" role="dialog" aria-modal="true" aria-labelledby="aa-title">
        <header className="modal-head">
          <Icon name="users" size={16} />
          <h3 id="aa-title">{given ? `Sign in to ${given.label}` : step === 'name' ? 'Add another account' : `Add ${name}`}</h3>
          <button type="button" className="win-btn" onClick={dismiss} aria-label="Close"><Icon name="x" size={14} /></button>
        </header>
        {!given && <Steps step={step} />}

        {step === 'name' && (
          <form className="aa-body" onSubmit={create}>
            <p className="aa-lead">A work and a personal {agentName}, side by side. Each agent you start runs on one of them, with its own sign-in and plan. Settings, skills and history stay shared.</p>
            {loadErr && <p className="error-text">{loadErr}</p>}
            {groups && !kinds.length && <p className="na-warn">Install Claude Code or Codex first (Settings › Agents).</p>}
            {kinds.length > 1 && (
              <div className="na-field">
                <span className="na-label">Agent</span>
                <div className="na-kinds" role="radiogroup" aria-label="Agent">
                  {kinds.map((g) => (
                    <button type="button" key={g.kind} role="radio" aria-checked={kind === g.kind} className={`na-kind ${kind === g.kind ? 'on' : ''}`} onClick={() => setKind(g.kind)}>
                      <AgentMark kind={g.kind} label={g.label} size={20} />{g.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label className="na-field">
              <span className="na-label">Name</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Work, Personal…" maxLength={40} autoFocus autoComplete="off" spellCheck="false" />
            </label>
            <div className="aa-suggest">
              {SUGGEST.filter((s) => !taken.has(s.toLowerCase())).map((s) => <button type="button" key={s} className="fchip" onClick={() => setLabel(s)}>{s}</button>)}
              {group && <span className="muted small">You have: {group.accounts.map((a) => (a.isDefault ? 'Default (your usual login)' : a.label)).join(', ')}</span>}
            </div>
            {err && <p className="error-text" role="alert">{err}</p>}
            <footer className="modal-foot">
              <button type="button" className="btn" onClick={dismiss}>Cancel</button>
              <button type="submit" className="btn primary" disabled={!label.trim() || busy || (groups && !kinds.length)}>{busy ? 'Adding…' : 'Add and sign in'}</button>
            </footer>
          </form>
        )}

        {step === 'signin' && (
          <div className="aa-body">
            <div className={`aa-state ${problem ? 'bad' : ''}`} role="status" aria-live="polite">
              {problem ? <Icon name="alert" size={15} /> : <span className="aa-spin" aria-hidden="true" />}
              <div>
                <b>{problem ? 'Not signed in' : login ? `Waiting for ${name} to sign in…` : 'Opening the sign-in…'}</b>
                <span>{problem || (viaRelay
                  ? `${agentName}'s sign-in page opens on your computer, or open it here with the button below. Sign in with your ${name} account.`
                  : `Your browser opens ${agentName}'s sign-in page. Sign in there with your ${name} account: switch accounts in the browser first, or open the link in a private window.`)}</span>
                {slow && !problem && <span className="na-warn">Still waiting. If the sign-in page is gone, try again.</span>}
              </div>
            </div>
            {link && !problem && <a className="btn small aa-link" href={link} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> Open the sign-in page</a>}
            {login && (
              <div className="aa-term">
                <div className="aa-term-head"><Icon name="terminal" size={12} /><span>Sign in: {agentName} ({name})</span></div>
                <pre ref={termRef} aria-label="The sign-in, as it goes">{lines.length ? lines.join('\n') : '…'}</pre>
                <form className="aa-type" onSubmit={(e) => { e.preventDefault(); if (typed) send([{ text: typed }, { keys: ['enter'] }]); else send([{ keys: ['enter'] }]); setTyped('') }}>
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="If it asks, type or paste here (a code, say)" aria-label="Type into the sign-in" autoComplete="off" spellCheck="false" />
                  <button type="button" className="ghost-btn" onClick={() => send([{ keys: ['up'] }])} aria-label="Up">↑</button>
                  <button type="button" className="ghost-btn" onClick={() => send([{ keys: ['down'] }])} aria-label="Down">↓</button>
                  <button type="submit" className="btn small">Enter</button>
                </form>
              </div>
            )}
            <footer className="modal-foot">
              {login && <button type="button" className="link-btn small aa-open" onClick={openTab}>Open in a tab</button>}
              <button type="button" className="btn" onClick={cancel} title={made ? `Stops signing in and removes ${name}` : 'Stops signing in'}>Cancel</button>
              {problem && <button type="button" className="btn primary" onClick={() => startLogin()}><Icon name="refresh" size={12} /> Try again</button>}
            </footer>
          </div>
        )}

        {step === 'done' && (
          <div className="aa-body">
            <div className="aa-state good" role="status">
              <Icon name="check" size={15} />
              <div>
                <b>Signed in as {name}{plan && <span className="plan-tag">{plan}</span>}</b>
                <span>New {agentName} agents can start on {name} or your other {agentName} accounts, at the same time. Pick one in New agent, or switch from the usage chip in the top bar.</span>
              </div>
            </div>
            {allow && <AllowKeychain id={acct.id} onDone={() => setAllow(false)} />}
            <footer className="modal-foot">
              <button type="button" className="btn" onClick={onClose}>Done</button>
              <button type="button" className="btn primary" onClick={() => onStart?.(acct.kind, acct.id)} autoFocus><Icon name="plus" size={12} /> Start an agent on {name}</button>
            </footer>
          </div>
        )}
      </div>
    </div>
  )
}
