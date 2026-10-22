import { useState } from 'react'
import Icon from './Icon.jsx'
import { api, refetch, settingsChanged, usePoll, viaRelay } from '../api.js'
import { askRestart, useRecheck } from './PermissionFix.jsx'

// herdr chosen to run agents, but not installed or not answering: nothing can start, so say so
// under the top bar, with one click back to the built-in runtime (applied on restart). It goes away
// by itself once herdr answers (checked now and then, and when you come back to the window).
export default function RuntimeNotice({ runtime }) {
  const herdr = runtime === 'herdr'
  const { data, refresh } = usePoll(herdr ? '/herdr/sessions' : null, 60 * 1000)
  const [switched, setSwitched] = useState(false)
  const [err, setErr] = useState(null)
  useRecheck(() => refresh(), 0, herdr && data?.installed === false)
  if (!herdr || !data || data.installed !== false) return null
  const builtin = async () => {
    setErr(null)
    try {
      await api('/settings', { method: 'PATCH', body: { runtime: 'builtin' } })
      settingsChanged(); refetch('/fix'); setSwitched(true)
      if (!viaRelay) setTimeout(askRestart, 300)
    } catch (e) { setErr(e.message) }
  }
  return (
    <div className="rt-notice" role="status">
      <Icon name="alert" size={13} />
      <span>{switched ? 'Bridge AI runs agents itself after a restart.' : <>Agents run in herdr, which isn't installed or isn't running. Start it, or use the built-in runtime (<a href="https://herdr.dev" target="_blank" rel="noreferrer">herdr.dev</a>).</>}</span>
      {!switched && <button type="button" className="btn small" onClick={builtin}>Use built-in</button>}
      {err && <span className="error-text">{err}</span>}
    </div>
  )
}
