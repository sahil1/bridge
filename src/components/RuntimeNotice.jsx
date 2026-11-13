import { useState } from 'react'
import Icon from './Icon.jsx'
import { api, refetch, settingsChanged, usePoll, viaRelay } from '../api.js'
import { askRestart, useRecheck } from './PermissionFix.jsx'
import { t, tn } from '../i18n/index.js'

const HIDDEN = 'cc-herdr-hint-hidden'
const readHidden = () => { try { return localStorage.getItem(HIDDEN) || '' } catch { return '' } }
const and = (list) => (list.length > 1 ? t('{list} and {last}', { list: list.slice(0, -1).join(', '), last: list[list.length - 1] }) : list[0])

// herdr chosen to run agents, but not installed or not answering: nothing can start, so say so
// under the top bar, with one click back to the built-in runtime (applied on restart). It goes away
// by itself once herdr answers (checked now and then, and when you come back to the window).
// fellBack: herdr chosen but too old, so agents run in Bridge AI itself until it's updated. And
// with herdr running, a herdr integration for an agent that's out of date, with the command that
// updates it (until you hide it).
export default function RuntimeNotice({ runtime, fellBack }) {
  const herdr = runtime === 'herdr'
  const { data, refresh } = usePoll(herdr ? '/herdr/sessions' : null, 60 * 1000)
  const [switched, setSwitched] = useState(false)
  const [err, setErr] = useState(null)
  const [hidden, setHidden] = useState(readHidden)
  useRecheck(() => refresh(), 0, herdr && data?.installed === false)
  const builtin = async (restart = true) => {
    setErr(null)
    try {
      await api('/settings', { method: 'PATCH', body: { runtime: 'builtin' } })
      settingsChanged(); refetch('/fix'); setSwitched(true)
      if (restart && !viaRelay) setTimeout(askRestart, 300)
    } catch (e) { setErr(e.message) }
  }
  if (fellBack) {
    return (
      <div className="rt-notice" role="status">
        <Icon name="alert" size={13} />
        <span>{switched ? t('Agents stay in Bridge AI.') : tn('Agents run in Bridge AI itself for now: {why}. Update herdr ({command}), then restart Bridge AI.', { why: fellBack.why, command: <code>herdr update</code> })}</span>
        {!switched && !viaRelay && <button type="button" className="btn small" onClick={askRestart}>{t('Restart')}</button>}
        {!switched && <button type="button" className="btn small" onClick={() => builtin(false)}>{t('Keep built-in')}</button>}
        {err && <span className="error-text">{err}</span>}
      </div>
    )
  }
  if (!herdr || !data) return null
  if (data.installed === false) {
    return (
      <div className="rt-notice" role="status">
        <Icon name="alert" size={13} />
        <span>{switched ? t('Bridge AI runs agents itself after a restart.') : tn('Agents run in herdr, which isn\'t installed or isn\'t running. Start it, or use the built-in runtime ({site}).', { site: <a href="https://herdr.dev" target="_blank" rel="noreferrer">herdr.dev</a> })}</span>
        {!switched && <button type="button" className="btn small" onClick={() => builtin()}>{t('Use built-in')}</button>}
        {err && <span className="error-text">{err}</span>}
      </div>
    )
  }
  const old = data.outdated || []
  const key = old.map((o) => o.target).join(',')
  if (!old.length || hidden === key) return null
  const hide = () => { try { localStorage.setItem(HIDDEN, key) } catch { /* not kept */ } setHidden(key) }
  return (
    <div className="rt-notice" role="status">
      <Icon name="alert" size={13} />
      <span>{old.length > 1
        ? tn('herdr\'s {names} integrations are out of date. Update them in a terminal: {command}', { names: and(old.map((o) => o.label)), command: <code>{old.map((o) => o.command).join(' && ')}</code> })
        : tn('herdr\'s {name} integration is out of date. Update it in a terminal: {command}', { name: old[0].label, command: <code>{old[0].command}</code> })}</span>
      <button type="button" className="btn small" onClick={hide}>{t('Hide')}</button>
    </div>
  )
}
