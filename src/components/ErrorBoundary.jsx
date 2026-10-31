import { Component, useEffect, useState } from 'react'
import { api } from '../api.js'
import { t } from '../i18n/index.js'

// One broken view shouldn't blank the whole app: show what failed, in place, with a way out. full:
// the whole window broke (the boundary around the app), so the way out is in the middle of the
// window, with more ways to get going again. quiet: a small extra (a top-bar chip, your devices in
// the sidebar) that steps aside when it breaks, and tries again by itself a little later, while the
// rest of the window carries on. Every crash is written down on your computer
// (<data>/logs/ui-errors.log) and Copy details gives what's needed to fix it.
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, stack: '' }; this.tries = 0 }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    const message = String(error?.message || error)
    const stack = `${error?.stack || ''}\n${info?.componentStack || ''}`.trim()
    if (this.props.quiet) {
      // 5 seconds, then 10, 20 and so on up to 5 minutes; written down once, not every try.
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.setState({ error: null, stack: '' }), Math.min(QUIET_MS * 2 ** this.tries++, QUIET_MAX))
      if (this.logged === message) return
      this.logged = message
    }
    console.error(`[${this.props.name || 'view'}]`, error, info?.componentStack)
    if (!this.props.quiet) this.setState({ stack })
    api('/ui-error', { method: 'POST', body: { where: this.props.name || 'view', message, stack: stack.slice(0, 6000), url: location.pathname + location.search } }).catch(() => {})
  }
  componentDidUpdate(prev) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }) }
  componentWillUnmount() { clearTimeout(this.timer) }
  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children
    if (this.props.quiet) return null
    const retry = () => this.setState({ error: null, stack: '' })
    if (this.props.full) return <CrashScreen name={this.props.name} error={error} stack={stack} onRetry={retry} />
    return (
      <div className="crash">
        <b>{this.props.name ? t('{name} hit an error', { name: this.props.name }) : t('Something broke here')}</b>
        <code>{String(error.message || error)}</code>
        <div className="crash-actions">
          <button className="btn" onClick={retry}>{t('Try again')}</button>
          <button className="ghost-btn" onClick={() => location.reload()}>{t('Reload')}</button>
          <CopyDetails error={error} stack={stack} where={this.props.name} />
        </div>
      </div>
    )
  }
}

const QUIET_MS = 5000
const QUIET_MAX = 5 * 60000
// A small extra that steps aside if it breaks (see quiet above).
export const Quiet = ({ name, children }) => <ErrorBoundary quiet name={name}>{children}</ErrorBoundary>

// Just after the window opened (an update restarting it, its server still starting), a crash is
// often gone a moment later: it tries again by itself, twice at most and only in its first minute,
// before it asks you. Counted for the page, so a crash that stays doesn't go round and round.
let autoTries = 0
const AUTO_MS = 3000
const KEEP = new Set(['cc-appearance', 'cc-theme', 'cc-toured', 'cc-lang'])
const CRASHED = 'bridge-crash' // this tab's last crash, to notice the same one after a reload
// What this window remembers about how it was laid out (open tabs, panel sizes, what's expanded):
// a crash right after an update is most often one of these, saved by the version before. Your look
// stays; your settings, agents and meetings are on your computer, not here.
function resetLayout() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('cc-') && !KEEP.has(k)) localStorage.removeItem(k)
  } catch { /* no storage */ }
  location.reload()
}

function CopyDetails({ error, stack, where, version }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    const text = [`Bridge AI ${version || ''} · ${where || 'view'} hit an error`, String(error?.message || error), stack, `${navigator.userAgent}`, location.pathname + location.search].filter(Boolean).join('\n\n')
    try { await navigator.clipboard.writeText(text); setDone(true) } catch { setDone(false) }
  }
  return <button type="button" className="ghost-btn" onClick={copy}>{done ? t('Copied') : t('Copy details')}</button>
}

// The whole window: what happened in plain words, then the ways back, the likeliest first.
function CrashScreen({ name, error, stack, onRetry }) {
  const [ver, setVer] = useState(null)
  const [upd, setUpd] = useState(null) // null | 'checking' | { available, latest, current, how } | { error }
  const [installing, setInstalling] = useState(false)
  // The same crash straight after a reload: the window's saved layout is the likely cause, so
  // resetting it goes first. Read while drawing, written down once it shows (React draws a crash
  // twice before it shows it, and the first draw would count as the time before).
  const msg = String(error?.message || error)
  const [retrying] = useState(() => autoTries < 2 && performance.now() < 60000)
  const [again] = useState(() => {
    try {
      const was = JSON.parse(sessionStorage.getItem(CRASHED) || 'null')
      return !!was && was.msg === msg && Date.now() - was.at < 120000
    } catch { return false }
  })
  useEffect(() => {
    if (retrying) { autoTries++; const t = setTimeout(onRetry, AUTO_MS); return () => clearTimeout(t) }
    try { sessionStorage.setItem(CRASHED, JSON.stringify({ msg, at: Date.now() })) } catch { /* no storage */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // A newer version, looked for straight away: the fix may already be out, and Update is the way to it.
  useEffect(() => {
    api('/version').then((v) => setVer(v.version), () => {})
    api('/updates').then((u) => setUpd((x) => x ?? u), () => {})
  }, [])
  const check = async () => {
    setUpd('checking')
    try { setUpd(await api('/updates?refresh=1')) } catch (e) { setUpd({ error: e.message }) }
  }
  const install = async () => {
    setInstalling(true)
    try { await api('/updates/install', { method: 'POST' }) } catch (e) { setInstalling(false); setUpd({ error: e.message }) }
  }
  const reset = <button type="button" className={again ? 'btn primary' : 'btn'} onClick={resetLayout}>{t("Reset this window's layout")}</button>
  return (
    <div className="crash-screen" role="alert">
      <div className={`crash-card${retrying ? ' retrying' : ''}`}>
        <img src={`${import.meta.env.BASE_URL}mark.svg`} alt="" width="36" height="36" />
        <h1>{name ? t('{name} hit an error', { name }) : t('Something broke')}</h1>
        <p className="muted">{t('This window stopped drawing. Your agents and their work keep running on your computer, and nothing is lost.')}{retrying ? ` ${t('Trying again in a moment…')}` : again ? ` ${t("It happened again after a reload, so start with Reset this window's layout: it forgets which tabs were open and how panels were sized, which a new version can trip over.")}` : ''}</p>
        <code className="crash-msg">{String(error?.message || error)}</code>
        <div className="crash-acts">
          {again ? reset : <button type="button" className="btn primary" onClick={onRetry}>{t('Try again')}</button>}
          <button type="button" className="btn" onClick={() => location.reload()}>{t('Reload')}</button>
          {again ? <button type="button" className="btn" onClick={onRetry}>{t('Try again')}</button> : reset}
        </div>
        <div className="crash-update">
          {upd === null && <button type="button" className="ghost-btn" onClick={check}>{t('Check for an update')}</button>}
          {upd === 'checking' && <span className="muted small">{t('Checking for an update…')}</span>}
          {upd?.error && <span className="small">{t("Couldn't check: {error}", { error: upd.error })}</span>}
          {upd?.disabled && <span className="muted small">{t('Checking for updates is turned off.')}</span>}
          {upd && upd !== 'checking' && !upd.error && !upd.disabled && (upd.available
            ? (upd.how === 'app'
              ? <button type="button" className="btn primary" onClick={install} disabled={installing}>{installing ? t("Updating… Bridge AI restarts when it's done") : t('Update to {version}', { version: upd.latest })}</button>
              : <span className="small">{t('{version} is out. Update from a terminal:', { version: upd.latest })} <code>{upd.command}</code></span>)
            : <span className="muted small">{upd.held ? t('Bridge AI {version} needs macOS {macos}, so this Mac stays on {current}.', { version: upd.latest, macos: upd.held.macos, current: upd.current }) : upd.latest ? t("You're on the latest version ({version}).", { version: upd.current }) : t('No newer version was found.')} {t('Copy details below and send them, and it can be fixed.')}</span>)}
        </div>
        <details className="crash-more">
          <summary>{t('Details')}{ver ? ` · Bridge AI ${ver}` : ''}</summary>
          <pre>{stack || String(error?.stack || '')}</pre>
          <p className="muted small">{t('Also kept on your computer, in {path}.', { path: '~/.bridge-ai/logs/ui-errors.log' })}</p>
        </details>
        <div className="crash-acts"><CopyDetails error={error} stack={stack} where={name} version={ver} /></div>
      </div>
    </div>
  )
}
