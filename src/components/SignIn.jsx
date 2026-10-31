import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { api, viaRelay, usePoll } from '../api.js'
import { useRecheck } from './PermissionFix.jsx'
import { t } from '../i18n/index.js'

// Sign in to an agent from wherever it's asked for: its own login, in a terminal tab you can watch;
// the browser opens on this computer. Claude Code and Codex sign in per account (Settings ›
// Accounts); the others with a login (agents.js) once. The rest: Settings › Model providers, which
// says how. onCheck runs while the sign-in is going and when you come back to the window, so what
// asked for it recovers by itself.
const OWN_LOGIN = new Set(['claude', 'codex'])
const LOGIN = new Set(['gemini', 'copilot', 'cursor', 'opencode', 'amp', 'goose', 'crush'])
export const canSignIn = (kind) => OWN_LOGIN.has(kind) || LOGIN.has(kind)
export const openSettings = (section) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section } }))

export default function SignInButton({ kind, label = 'Sign in', account, onCheck, className = 'btn small primary', terminalLink = true, title }) {
  const [state, setState] = useState(null) // { busy } | { openId } | { renewed } | { error }
  useRecheck(() => onCheck?.(), state?.openId ? 8000 : 0, !!onCheck)
  const go = async () => {
    if (!canSignIn(kind)) return openSettings('providers')
    setState({ busy: true })
    const url = OWN_LOGIN.has(kind) ? `/accounts/${encodeURIComponent(account || `${kind}-default`)}/login` : `/signin/${encodeURIComponent(kind)}`
    // renewed: an account whose sign-in ran out was renewed without the browser.
    try { const r = await api(url, { method: 'POST' }); setState(r.renewed ? { renewed: true } : { openId: r.openId }); if (r.renewed) onCheck?.() } catch (e) { setState({ error: e.message, code: e.code }) }
  }
  // Not installed here: install it first (then Sign in comes back by itself).
  if (state?.code?.startsWith('install:')) return <InstallAgentButton kind={kind} label={`Install ${state.error.replace(/ isn.t installed.*/, '')}`} onCheck={() => api('/agent-kinds').then((ks) => { if (ks.some((k) => k.kind === kind)) { setState(null); onCheck?.() } }).catch(() => {})} />
  const show = () => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: state.openId } }))
  return (
    <span className="signin">
      <button type="button" className={className} onClick={go} disabled={!!state?.busy} title={title}>{state?.busy ? <><Icon name="refresh" size={12} className="spin" /> Signing in…</> : <><Icon name="users" size={12} /> {label}</>}</button>
      {state?.renewed && <span className="muted small">Signed in again.</span>}
      {state?.openId && <span className="muted small">{viaRelay ? 'Signing in, in a terminal tab.' : 'Your browser opens to sign in.'}{terminalLink && <> <button type="button" className="link-btn" onClick={show}>Show the terminal</button></>}</span>}
      {state?.error && <span className="error-text">{state.error}</span>}
    </span>
  )
}

// Node.js, for what needs it on a computer that has none (server/nodejs.js): one button that
// installs the official version from nodejs.org just for Bridge AI, how it's going, then onDone.
// Where it can't (Windows), where to get it. forAgent: on an agent's card, whose own Install waits
// for it, so while it's going (setup started it, or you did) that's what the button says.
const NODE_PAGE = 'https://nodejs.org/en/download'
export function InstallNode({ onDone, why, forAgent = false }) {
  const [st, setSt] = useState(null)
  const [err, setErr] = useState(null)
  const going = !!st?.job && !st.job.error
  useEffect(() => { api('/tools/node').then(setSt).catch(() => {}) }, [])
  useEffect(() => {
    if (!going) return
    const t = setInterval(() => api('/tools/node').then((s) => {
      setSt(s)
      if (s.job) return
      clearInterval(t)
      if (s.have) onDone?.()
      else setErr('Node.js is installed, but Bridge AI can\'t find it. Restart Bridge AI and try again.')
    }).catch(() => {}), 1000)
    return () => clearInterval(t)
  }, [going]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    setErr(null)
    try { setSt(await api('/tools/node', { method: 'POST' })) } catch (e) { setErr(e.message) }
  }
  if (st && !st.canInstall) {
    return (
      <span className="signin">
        <a className="btn small" href={NODE_PAGE} target="_blank" rel="noreferrer"><Icon name="download" size={12} /> Get Node.js</a>
        <span className="muted small">{why ? `${why} ` : ''}Install it from nodejs.org, then come back and try again.</span>
      </span>
    )
  }
  const j = st?.job
  if (forAgent && going) {
    return (
      <span className="signin node-install waiting">
        <button type="button" className="btn small primary" disabled>
          <Icon name="refresh" size={12} className="spin" /> {j.step === 'download' ? t('Install · waiting for Node.js {n}%', { n: j.percent || 0 }) : t('Install · waiting for Node.js')}
        </button>
        <span className="muted small">{t('Node.js is installing for it now. This becomes Install by itself when it\'s done.')}</span>
      </span>
    )
  }
  return (
    <span className="signin node-install">
      <button type="button" className="btn small primary" disabled={going || !st} onClick={go}>
        {going ? <><Icon name="refresh" size={12} className="spin" /> {j.step === 'download' ? `Downloading Node.js${j.percent ? ` ${j.percent}%` : '…'}` : j.step === 'check' ? 'Checking it…' : 'Setting it up…'}</> : <><Icon name="download" size={12} /> Install Node.js</>}
      </button>
      {!going && <span className="muted small">{why ? `${why} ` : ''}One click: the official version from nodejs.org, just for Bridge AI. No password needed.</span>}
      {(err || j?.error) && <span className="error-text">{err || j.error}</span>}
    </span>
  )
}

// An agent that isn't installed, from wherever it's needed: its install command in a terminal tab
// you can watch (the same as setup's Install), with its last lines here as it goes. onCheck runs
// while that goes and when you come back. needs: what the install needs first (Node.js), from the
// agent catalog; then Node.js comes first, and the agent's Install once it's there.
export function InstallAgentButton({ kind, label = 'Install', onCheck, needs, showLink = true }) {
  const [state, setState] = useState(null) // { openId, paneId } | { error, code }
  useRecheck(() => onCheck?.(), state?.openId ? 5000 : 0, !!onCheck && !!state?.openId)
  const { data: screen } = usePoll(state?.paneId ? `/agents/${encodeURIComponent(state.paneId)}/screen?lines=40` : null, 1500)
  const go = async () => {
    setState(null)
    try { const r = await api(`/setup/install/${encodeURIComponent(kind)}`, { method: 'POST' }); setState({ openId: r.openId, paneId: r.paneId }) } catch (e) { setState({ error: e.message, code: e.code }) }
  }
  const show = () => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: state.openId } }))
  const need = needs || (state?.code === 'needs:node' ? 'Node.js' : null)
  if (need) return <InstallNode why="It needs Node.js first." forAgent onDone={() => { setState(null); onCheck?.() }} />
  // eslint-disable-next-line no-control-regex
  const tail = String(screen?.ansi || '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).filter(Boolean).slice(-3)
  return (
    <span className="signin">
      <button type="button" className="btn small primary" disabled={!!state?.openId} onClick={go}>{state?.openId ? <><Icon name="refresh" size={12} className="spin" /> Installing…</> : <><Icon name="download" size={12} /> {label}</>}</button>
      {state?.openId && <span className="muted small">Usually a minute or two; this moves on by itself when it's done.{showLink && <> <button type="button" className="link-btn" onClick={show}>Show the terminal</button></>}</span>}
      {state?.openId && tail.length > 0 && <pre className="inst-log" aria-live="polite">{tail.join('\n')}</pre>}
      {state?.error && <span className="error-text">{state.error}</span>}
    </span>
  )
}
