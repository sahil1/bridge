import { useState } from 'react'
import Icon from './Icon.jsx'
import { api, viaRelay } from '../api.js'
import { useRecheck } from './PermissionFix.jsx'

// Sign in to an agent from wherever it's asked for. Claude Code and Codex: their own login, in a
// terminal tab you can watch (the same as Settings › Accounts › Sign in); the browser opens on this
// computer. Others: Settings › Model providers, which says how. onCheck runs while the sign-in is
// going and when you come back to the window, so what asked for it recovers by itself.
const OWN_LOGIN = new Set(['claude', 'codex'])
export const openSettings = (section) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section } }))

export default function SignInButton({ kind, label = 'Sign in', account, onCheck, className = 'btn small primary', terminalLink = true }) {
  const [state, setState] = useState(null) // { openId } | { error }
  useRecheck(() => onCheck?.(), state?.openId ? 8000 : 0, !!onCheck)
  const go = async () => {
    if (!OWN_LOGIN.has(kind)) return openSettings('providers')
    setState(null)
    try { setState({ openId: (await api(`/accounts/${encodeURIComponent(account || `${kind}-default`)}/login`, { method: 'POST' })).openId }) } catch (e) { setState({ error: e.message, code: e.code }) }
  }
  // Not installed here: install it first (then Sign in comes back by itself).
  if (state?.code?.startsWith('install:')) return <InstallAgentButton kind={kind} label={`Install ${state.error.replace(/ isn.t installed.*/, '')}`} onCheck={() => api('/agent-kinds').then((ks) => { if (ks.some((k) => k.kind === kind)) { setState(null); onCheck?.() } }).catch(() => {})} />
  const show = () => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: state.openId } }))
  return (
    <span className="signin">
      <button type="button" className={className} onClick={go}><Icon name="users" size={12} /> {label}</button>
      {state?.openId && <span className="muted small">{viaRelay ? 'Signing in, in a terminal tab.' : 'Your browser opens to sign in.'}{terminalLink && <> <button type="button" className="link-btn" onClick={show}>Show the terminal</button></>}</span>}
      {state?.error && <span className="error-text">{state.error}</span>}
    </span>
  )
}

// An agent that isn't installed, from wherever it's needed: its install command in a terminal tab
// you can watch (the same as setup's Install). onCheck runs while that goes and when you come back.
export function InstallAgentButton({ kind, label = 'Install', onCheck }) {
  const [state, setState] = useState(null) // { openId } | { error }
  useRecheck(() => onCheck?.(), state?.openId ? 8000 : 0, !!onCheck && !!state?.openId)
  const go = async () => {
    setState(null)
    try { setState({ openId: (await api(`/setup/install/${encodeURIComponent(kind)}`, { method: 'POST' })).openId }) } catch (e) { setState({ error: e.message }) }
  }
  const show = () => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: state.openId } }))
  return (
    <span className="signin">
      <button type="button" className="btn small primary" disabled={!!state?.openId} onClick={go}><Icon name="download" size={12} /> {label}</button>
      {state?.openId && <span className="muted small">Installing in a terminal tab. <button type="button" className="link-btn" onClick={show}>Show it</button></span>}
      {state?.error && <span className="error-text">{state.error}</span>}
    </span>
  )
}
