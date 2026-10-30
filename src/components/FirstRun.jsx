import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { api, viaRelay } from '../api.js'
import { t } from '../i18n/index.js'

// A new agent's first-run screens (its look, signing in, safety notes, trusting its folder), as a
// card in Chat instead of a terminal you may not be looking at. The server reads which screen is up
// (server/firstrun.js, agent.setup); each gets one short line and one button that answers it, and
// the terminal is a click away for anything else. Chat picks up by itself once it's done.
const NAMES = { claude: 'Claude Code', codex: 'Codex' }

// Trusting a folder is an ordinary question for a project; it's part of setup for the folders
// Bridge AI made itself: the chief of staff's, and the one plain chats share.
export const showsFirstRun = (agent) => !!agent?.setup && (agent.setup !== 'trust' || !!agent.chief || !!agent.plainChat)

const darkNow = () => {
  const t = document.documentElement.dataset.theme
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
}

// The screens with one sensible answer are answered without asking: the look (the one matching
// Bridge AI), the offer to change your terminal app (no), the notes after signing in, and trusting
// a folder Bridge AI made itself. Signing in, and trusting your own folders, stay yours.
const AUTO = {
  theme: () => (darkNow() ? ['enter'] : ['down', 'enter']),
  terminal: () => ['esc'],
  continue: () => ['enter'],
  trust: (a) => (a.chief || a.plainChat ? a.setupKeys || ['enter'] : null),
}

// Those answers, whether or not the card is on screen: the chief of staff starts in the background
// while setup lands on Home, so the app shell answers its screens too (App.jsx). The server sends
// each once, and only while that screen is up, however many windows ask.
export function FirstRunAnswers({ agent }) {
  const auto = AUTO[agent.setup]?.(agent)
  useEffect(() => {
    if (!auto) return
    const t = setTimeout(() => api(`/panes/${encodeURIComponent(agent.paneId)}/input`, { method: 'POST', body: { steps: [{ keys: auto }], setup: agent.setup } }).catch(() => {}), 600)
    return () => clearTimeout(t)
  }, [agent.paneId, agent.setup]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function FirstRunCard({ agent, onOpenTerminal }) {
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [err, setErr] = useState(null)
  const name = NAMES[agent.kind] || agent.kindLabel || agent.kind
  const pane = encodeURIComponent(agent.paneId)
  const send = async (steps, setup) => {
    setBusy(true); setErr(null)
    try { await api(`/panes/${pane}/input`, { method: 'POST', body: { steps, setup } }) } catch (e) { setErr(e.message) }
    setTimeout(() => setBusy(false), 700) // the next screen arrives with the next fleet update
  }
  const keys = (k) => send([{ keys: k }], agent.setup)
  const auto = AUTO[agent.setup]?.(agent)
  const btn = (label, k, primary = true) => <button type="button" className={primary ? 'btn small primary' : 'ghost-btn'} disabled={busy} onClick={() => keys(k)}>{label}</button>
  const claude = agent.kind === 'claude'

  let text = null
  let acts = null
  switch (agent.setup) {
    case 'theme':
      text = t('First, how its terminal looks. Continue picks the one that matches Bridge AI.')
      acts = btn(t('Continue'), darkNow() ? ['enter'] : ['down', 'enter'])
      break
    case 'login':
      text = claude
        ? t('Sign in with your Claude account (Pro, Max, Team or Enterprise). Your browser opens to finish.')
        : t('Sign in with your ChatGPT account. Your browser opens to finish.')
      acts = claude
        ? <>{btn(t('Sign in with Claude account'), ['enter'])}{btn(t('Use an Anthropic Console account'), ['down', 'enter'], false)}</>
        : <>{btn(t('Sign in with ChatGPT'), ['enter'])}<button type="button" className="ghost-btn" onClick={onOpenTerminal}>{t('Use an API key')}</button></>
      break
    case 'browser':
      text = viaRelay
        ? (claude ? t('Open the sign-in page here, sign in, then paste the code it shows.') : t('Finish signing in with the browser on your computer.'))
        : t("Your browser opened to sign in. This moves on by itself when you're done.")
      acts = agent.setupUrl && (claude || !viaRelay) ? <a className={viaRelay ? 'btn small primary' : 'ghost-btn'} href={agent.setupUrl} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> {t('Open the sign-in page')}</a> : null
      break
    case 'continue':
      text = claude
        ? t('Signed in. Next, a few notes on safety: it can make mistakes, so use it on code you trust.')
        : t('Signed in. Codex has a short welcome to get past.')
      acts = btn(t('Continue'), ['enter'])
      break
    case 'terminal':
      text = t("It offers to change your terminal app's settings. Bridge AI doesn't need that.")
      acts = btn(t('Skip'), ['esc'])
      break
    case 'trust':
      text = agent.chief ? t("Last step: let it work in the chief of staff's own folder, which Bridge AI made for it.") : t('Last step: let it work in the folder Bridge AI made for your chats. Nothing else is in it.')
      acts = btn(t('Trust this folder'), agent.setupKeys || ['enter'])
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
      <FirstRunAnswers agent={agent} />
      <div className="blocked-head"><Icon name="sparkle" size={13} /> {t('{name} needs a one-time setup on this computer', { name })} <button type="button" className="link" onClick={onOpenTerminal}>{t('Open in Terminal')}</button></div>
      <div className="firstrun-body">
        <p>{auto ? <span className="muted">{t('Setting it up…')} </span> : null}{text}</p>
        {acts && <div className="perm-acts">{acts}</div>}
        {agent.setup === 'browser' && claude && (
          <form className="firstrun-code" onSubmit={paste}>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={viaRelay ? t('Paste the code') : t('Got a code instead? Paste it here')} aria-label={t('Sign-in code')} autoComplete="off" spellCheck={false} />
            <button type="submit" className="btn small" disabled={!code.trim() || busy}>{t('Send')}</button>
          </form>
        )}
        {err && <p className="error-text">{err}</p>}
      </div>
    </div>
  )
}
