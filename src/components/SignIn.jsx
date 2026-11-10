import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { api, viaRelay, usePoll } from '../api.js'
import { useRecheck } from './PermissionFix.jsx'
import { t } from '../i18n/index.js'

// Sign in to an agent from wherever it's asked for: its own login, in a terminal tab you can watch;
// the browser opens on this computer. Claude Code and Codex sign in per account (Settings ›
// Accounts); the others with a login (agents.js) once. The rest: Settings › Model Providers, which
// says how. onCheck runs while the sign-in is going and when you come back to the window, so what
// asked for it recovers by itself. While it waits, SignInWait says for what, with the way through
// when the browser can't come back to the agent. auto: it starts by itself (the agent was just
// installed for this).
const OWN_LOGIN = new Set(['claude', 'codex'])
const LOGIN = new Set(['gemini', 'copilot', 'cursor', 'opencode', 'amp', 'goose', 'crush'])
export const canSignIn = (kind) => OWN_LOGIN.has(kind) || LOGIN.has(kind)
export const openSettings = (section) => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section } }))
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

export default function SignInButton({ kind, label = 'Sign in', account, onCheck, className = 'btn small primary', terminalLink = true, title, auto = false }) {
  const [state, setState] = useState(null) // { busy } | { openId, paneId, tabId, device } | { renewed } | { error, code }
  useRecheck(() => onCheck?.(), state?.openId ? 8000 : 0, !!onCheck)
  const going = useRef(false)
  const go = async ({ device = false } = {}) => {
    if (!canSignIn(kind)) return openSettings('providers')
    if (going.current) return
    going.current = true
    // Again: the last one's tab goes first (an account's, the server closes itself).
    if (state?.tabId && !OWN_LOGIN.has(kind)) api(`/tabs/${encodeURIComponent(state.tabId)}/close`, { method: 'POST' }).catch(() => {})
    setState({ busy: true })
    const url = OWN_LOGIN.has(kind) ? `/accounts/${encodeURIComponent(account || `${kind}-default`)}/login` : `/signin/${encodeURIComponent(kind)}`
    // renewed: an account whose sign-in ran out was renewed without the browser.
    try {
      const r = await api(url, { method: 'POST', body: device ? { device: true } : undefined })
      setState(r.renewed ? { renewed: true } : { openId: r.openId, paneId: r.paneId, tabId: r.tabId, device })
      if (r.renewed) onCheck?.()
    } catch (e) { setState({ error: e.message, code: e.code }) } finally { going.current = false }
  }
  useEffect(() => { if (auto) go() }, [auto]) // eslint-disable-line react-hooks/exhaustive-deps
  // Not installed here: install it first, and the sign-in starts by itself once it's in.
  const installedNow = useRef(false)
  if (state?.code?.startsWith('install:')) return <InstallAgentButton kind={kind} label={`Install ${state.error.replace(/ isn.t installed.*/, '')}`} onCheck={() => api('/agent-kinds').then((ks) => { if (ks.some((k) => k.kind === kind) && !installedNow.current) { installedNow.current = true; onCheck?.(); go() } }).catch(() => {})} />
  const show = () => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: state.openId } }))
  if (state?.paneId) {
    return (
      <span className="signin waiting">
        <SignInWait key={state.paneId} kind={kind} paneId={state.paneId} device={state.device} onDone={() => onCheck?.()} onAgain={go} onShow={terminalLink ? show : null} />
      </span>
    )
  }
  return (
    <span className="signin">
      <button type="button" className={className} onClick={() => go()} disabled={!!state?.busy} title={title}>{state?.busy ? <><Icon name="refresh" size={12} className="spin" /> {t('Signing in…')}</> : <><Icon name="users" size={12} /> {label}</>}</button>
      {state?.renewed && <span className="muted small">{t('Signed in again.')}</span>}
      {state?.error && <span className="error-text">{state.error}</span>}
    </span>
  )
}

// A sign-in under way in its terminal tab (server: GET /api/signins/:pane), followed here: what it's
// waiting for, in plain words; the way through when the browser can't come back to the agent on
// this computer (the browser says it can't connect to localhost: a work VPN or proxy, an account
// made on a phone, the agent stopped waiting while you made one): Claude Code's page that shows a
// code, pasted here and typed into its prompt, or Codex's one-time code; and when it ended without
// signing in, or its tab was closed, that it did, with Try again. onDone: signed in.
// onAgain({ device }): start it again (device: Codex with a one-time code).
function SignInWait({ kind, paneId, device, onDone, onAgain, onShow }) {
  const { data: s, error } = usePoll(`/signins/${encodeURIComponent(paneId)}`, 2000)
  const [sent, setSent] = useState(false) // a code went in: it's being checked
  const done = !!s?.done
  useEffect(() => { if (done) onDone?.() }, [done]) // eslint-disable-line react-hooks/exhaustive-deps
  // A code typed at the agent's prompt, then Enter once it has taken it in.
  const typeCode = async (code) => {
    const at = `/panes/${encodeURIComponent(paneId)}/input`
    await api(at, { method: 'POST', body: { steps: [{ text: code }] } })
    await pause(150)
    await api(at, { method: 'POST', body: { steps: [{ keys: ['enter'] }] } })
    setSent(true)
  }
  const terminal = onShow && <button type="button" className="link-btn small" onClick={onShow}>{t('Show the terminal')}</button>
  if (done) return <p className="signin-ok" role="status"><Icon name="check" size={12} /> {t('Signed in.')}</p>
  // Over without signing in: its tab closed, or the login ended (and why, when it said).
  const over = error && !s ? error : s && !s.open ? t('The sign-in was closed before you signed in.')
    : s?.ended ? (s.problem ? t('The sign-in ended before you signed in: {why}', { why: s.problem }) : t('The sign-in ended before you signed in.')) : null
  if (over) {
    return (
      <div className="signin-wait bad" role="status" aria-live="polite">
        <p className="signin-say"><Icon name="alert" size={13} /><span>{over}</span></p>
        <div className="signin-acts">
          <button type="button" className="btn small primary" onClick={() => onAgain({ device })}><Icon name="refresh" size={12} /> {t('Try again')}</button>
          {s?.open && terminal}
        </div>
      </div>
    )
  }
  // Codex with a one-time code: its page, and the code to enter there.
  if (device || s?.device) {
    return (
      <div className="signin-wait" role="status" aria-live="polite">
        <p className="signin-say"><span className="aa-spin" aria-hidden="true" /><span>{s?.device ? t('Open the sign-in page, sign in, then enter this code there. This moves on by itself once you have.') : t('Getting a one-time code…')}</span></p>
        {s?.device && <DeviceCode url={s.device.url} code={s.device.code} />}
        {terminal && <div className="signin-acts">{terminal}</div>}
      </div>
    )
  }
  const account = kind === 'claude' ? 'Claude' : kind === 'codex' ? 'ChatGPT' : null
  return (
    <div className="signin-wait" role="status" aria-live="polite">
      <p className="signin-say"><span className="aa-spin" aria-hidden="true" /><span>{sent ? t('Checking the code…')
        : viaRelay ? t('The browser on your computer opened to sign in. This moves on by itself once you have.')
          : account ? t('Your browser opened to sign in with your {name} account. This moves on by itself once you have.', { name: account }) : t('Your browser opened to sign in. This moves on by itself once you have.')}</span></p>
      {!sent && kind === 'claude' && s?.codeUrl && <CodeSignIn url={s.codeUrl} onCode={typeCode} open={viaRelay} />}
      {kind === 'codex' && (
        <p className="muted small signin-out">{viaRelay ? t('Not at your computer?') : t('Browser says it can\'t connect to localhost, or nothing opened?')} <button type="button" className="link-btn small" onClick={() => onAgain({ device: true })}>{t('Sign in with a code instead')}</button></p>
      )}
      {terminal && <div className="signin-acts">{terminal}</div>}
    </div>
  )
}

// Claude Code's way through when the browser can't come back to it: its other sign-in page (the
// link it prints), which shows a code once you've signed in, and that code pasted here. open: the
// box from the start (on a phone, where the browser that opened is the computer's).
export function CodeSignIn({ url, onCode, open: atStart = false, busy = false }) {
  const [open, setOpen] = useState(atStart)
  const [code, setCode] = useState('')
  const [err, setErr] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    const c = code.trim()
    if (!c) return
    setErr(null)
    try { await onCode(c); setCode('') } catch (x) { setErr(x.message) }
  }
  const link = (cls, words) => <a className={cls} href={url} target="_blank" rel="noreferrer" onClick={() => setOpen(true)}>{cls.startsWith('btn') && <><Icon name="external" size={12} />{' '}</>}{words}</a>
  if (!open) return <p className="muted small signin-out">{t('Browser says it can\'t connect to localhost, or nothing opened?')} {link('link-btn small', t('Sign in with a code'))}</p>
  return (
    <div className="signin-code">
      <p className="small">{atStart ? t('Open the sign-in page, sign in, then paste the code it shows here.') : t('Sign in on the page that opened, then paste the code it shows here.')}</p>
      {atStart && link('btn small primary', t('Open the sign-in page'))}
      <form className="signin-code-row" onSubmit={submit}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('Paste the code')} aria-label={t('Sign-in code')} autoComplete="off" spellCheck={false} />
        <button type="submit" className="btn small primary" disabled={!code.trim() || busy}>{t('Sign in')}</button>
      </form>
      {!atStart && <p className="muted small">{t('The page didn\'t open?')} {link('link-btn small', t('Open it again'))}</p>}
      {err && <p className="error-text small">{err}</p>}
    </div>
  )
}

// Codex's one-time code: its page, and the code to enter there, with Copy.
export function DeviceCode({ url, code }) {
  const [copied, setCopied] = useState(false)
  const copy = () => navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => {})
  return (
    <div className="signin-device">
      <a className="btn small primary" href={url} target="_blank" rel="noreferrer"><Icon name="external" size={12} /> {t('Open the sign-in page')}</a>
      <code className="signin-devcode" aria-label={t('One-time code')}>{code}</code>
      <button type="button" className="ghost-btn" onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? t('Copied') : t('Copy')}</button>
    </div>
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
