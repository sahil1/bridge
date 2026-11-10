import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { api, viaRelay } from '../api.js'
import { CodeSignIn, DeviceCode } from './SignIn.jsx'
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

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

export default function FirstRunCard({ agent, onOpenTerminal }) {
  const [busy, setBusy] = useState(false)
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
  // A code pasted at Claude Code's "Paste code here if prompted >", then Enter once it has it.
  const typeCode = async (code) => {
    await api(`/panes/${pane}/input`, { method: 'POST', body: { steps: [{ text: code }] } })
    await pause(150)
    await api(`/panes/${pane}/input`, { method: 'POST', body: { steps: [{ keys: ['enter'] }] } })
  }
  // Codex's way with a one-time code, from its browser screen: Esc back to how to sign in, then
  // its second way, Sign in with Device Code, once that screen is up.
  const withCode = async () => {
    setBusy(true); setErr(null)
    try {
      await api(`/panes/${pane}/input`, { method: 'POST', body: { steps: [{ keys: ['esc'] }], setup: 'browser' } })
      let r = null
      for (let i = 0; i < 10 && !r?.ok; i++) { await pause(400); r = await api(`/panes/${pane}/input`, { method: 'POST', body: { steps: [{ keys: ['down', 'enter'] }], setup: 'login' } }) }
      if (!r?.ok) setErr(t('Codex didn\'t go back to its ways to sign in. Open in Terminal, press Esc there and choose Sign in with Device Code.'))
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

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
        : <>{btn(t('Sign in with ChatGPT'), ['enter'])}{btn(t('Sign in with a code'), ['down', 'enter'], false)}<button type="button" className="ghost-btn" onClick={onOpenTerminal}>{t('Use an API key')}</button></>
      break
    case 'browser':
      // Claude Code: the browser comes back to it on localhost, or its other page shows a code to
      // paste here (on a phone, that's the way). Codex: the browser, or a one-time code instead.
      if (agent.setupCode) {
        text = t('Open the sign-in page, sign in, then enter this code there. This moves on by itself once you have.')
        acts = agent.setupUrl && <DeviceCode url={agent.setupUrl} code={agent.setupCode} />
      } else if (claude) {
        text = viaRelay ? t('Open the sign-in page here, sign in, then paste the code it shows.') : t("Your browser opened to sign in. This moves on by itself when you're done.")
        acts = agent.setupUrl ? <CodeSignIn url={agent.setupUrl} onCode={typeCode} open={viaRelay} busy={busy} /> : null
      } else {
        text = viaRelay ? t('Finish signing in with the browser on your computer.') : t("Your browser opened to sign in. This moves on by itself when you're done.")
        acts = <p className="muted small signin-out">{viaRelay ? t('Not at your computer?') : t('Browser says it can\'t connect to localhost, or nothing opened?')} <button type="button" className="link-btn small" disabled={busy} onClick={withCode}>{t('Sign in with a code instead')}</button></p>
      }
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
  return (
    <div className="blocked-card firstrun" role="status" aria-live="polite">
      <FirstRunAnswers agent={agent} />
      <div className="blocked-head"><Icon name="sparkle" size={13} /> {t('{name} needs a one-time setup on this computer', { name })} <button type="button" className="link" onClick={onOpenTerminal}>{t('Open in Terminal')}</button></div>
      <div className="firstrun-body">
        <p>{auto ? <span className="muted">{t('Setting it up…')} </span> : null}{text}</p>
        {acts && (agent.setup === 'browser' ? acts : <div className="perm-acts">{acts}</div>)}
        {err && <p className="error-text">{err}</p>}
      </div>
    </div>
  )
}
