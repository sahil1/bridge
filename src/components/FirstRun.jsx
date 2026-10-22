import { useState } from 'react'
import Icon from './Icon.jsx'
import { api, viaRelay } from '../api.js'

// A new agent's first-run screens (its look, signing in, safety notes, trusting its folder), as a
// card in Chat instead of a terminal you may not be looking at. The server reads which screen is up
// (server/firstrun.js, agent.setup); each gets one short line and one button that answers it, and
// the terminal is a click away for anything else. Chat picks up by itself once it's done.
const NAMES = { claude: 'Claude Code', codex: 'Codex' }

// Trusting a folder is an ordinary question for a project; it's part of setup for the chief of
// staff's own folder, which Bridge AI made.
export const showsFirstRun = (agent) => !!agent?.setup && (agent.setup !== 'trust' || !!agent.chief)

const darkNow = () => {
  const t = document.documentElement.dataset.theme
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
}

export default function FirstRunCard({ agent, onOpenTerminal }) {
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [err, setErr] = useState(null)
  const name = NAMES[agent.kind] || agent.kindLabel || agent.kind
  const pane = encodeURIComponent(agent.paneId)
  const send = async (steps) => {
    setBusy(true); setErr(null)
    try { await api(`/panes/${pane}/input`, { method: 'POST', body: { steps } }) } catch (e) { setErr(e.message) }
    setTimeout(() => setBusy(false), 700) // the next screen arrives with the next fleet update
  }
  const keys = (k) => send([{ keys: k }])
  const btn = (label, k, primary = true) => <button type="button" className={primary ? 'btn small primary' : 'ghost-btn'} disabled={busy} onClick={() => keys(k)}>{label}</button>
  const claude = agent.kind === 'claude'

  let text = null
  let acts = null
  switch (agent.setup) {
    case 'theme':
      text = 'First, how its terminal looks. Continue picks the one that matches Bridge AI.'
      acts = btn('Continue', darkNow() ? ['enter'] : ['down', 'enter'])
      break
    case 'login':
      text = claude
        ? 'Sign in with your Claude account (Pro, Max, Team or Enterprise). Your browser opens to finish.'
        : 'Sign in with your ChatGPT account. Your browser opens to finish.'
      acts = claude
        ? <>{btn('Sign in with Claude account', ['enter'])}{btn('Use an Anthropic Console account', ['down', 'enter'], false)}</>
        : <>{btn('Sign in with ChatGPT', ['enter'])}<button type="button" className="ghost-btn" onClick={onOpenTerminal}>Use an API key</button></>
      break
    case 'browser':
      text = viaRelay
        ? (claude ? 'Open the sign-in page here, sign in, then paste the code it shows.' : 'Finish signing in with the browser on your computer.')
        : 'Your browser opened to sign in. This moves on by itself when you\'re done.'
      acts = agent.setupUrl && (claude || !viaRelay) ? <a className={viaRelay ? 'btn small primary' : 'ghost-btn'} href={agent.setupUrl} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> Open the sign-in page</a> : null
      break
    case 'continue':
      text = claude
        ? 'Signed in. Next, a few notes on safety: it can make mistakes, so use it on code you trust.'
        : 'Signed in. Codex has a short welcome to get past.'
      acts = btn('Continue', ['enter'])
      break
    case 'terminal':
      text = 'It offers to change your terminal app\'s settings. Bridge AI doesn\'t need that.'
      acts = btn('Skip', ['esc'])
      break
    case 'trust':
      text = 'Last step: let it work in the chief of staff\'s own folder, which Bridge AI made for it.'
      acts = btn('Trust this folder', ['enter'])
      break
    default:
      return null
  }
  const paste = (e) => {
    e.preventDefault()
    if (code.trim()) { send([{ text: code.trim() }, { keys: ['enter'] }]); setCode('') }
  }
  return (
    <div className="blocked-card firstrun" role="status" aria-live="polite">
      <div className="blocked-head"><Icon name="sparkle" size={13} /> {name} needs a one-time setup on this computer <button type="button" className="link" onClick={onOpenTerminal}>Open in Terminal</button></div>
      <div className="firstrun-body">
        <p>{text}</p>
        {acts && <div className="perm-acts">{acts}</div>}
        {agent.setup === 'browser' && claude && (
          <form className="firstrun-code" onSubmit={paste}>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={viaRelay ? 'Paste the code' : 'Got a code instead? Paste it here'} aria-label="Sign-in code" autoComplete="off" spellCheck={false} />
            <button type="submit" className="btn small" disabled={!code.trim() || busy}>Send</button>
          </form>
        )}
        {err && <p className="error-text">{err}</p>}
      </div>
    </div>
  )
}
