import { useState } from 'react'
import { api, settingsChanged, usePoll } from '../../api.js'
import { TRIALS } from '../../trials.js'
import { More } from './Advanced.jsx'
import Icon from '../Icon.jsx'
import { t } from '../../i18n/index.js'

// A beta feature's switch, at the top of its own place in Settings (src/trials.js setting), marked
// Beta: its name, what it is in a line, the rest under More. What it turns on shows under it while
// it's on (children). Settings › About & Updates › Beta Features lists them all, each with the way
// here. disabled: why it can't be changed from here (a string), said under it.
export function useBeta(id) {
  const { data: conf } = usePoll('/config', 10 * 60 * 1000)
  const [mine, setMine] = useState(null) // as you set it, at once; saved behind it
  const [err, setErr] = useState(null)
  const on = mine ?? conf?.trials?.[id] === true
  const set = async (v) => {
    setMine(v); setErr(null)
    try { await api('/settings', { method: 'PATCH', body: { trials: { [id]: v } } }); settingsChanged() } catch (e) { setErr(e.message); setMine(null) }
  }
  return { on, set, err, known: !!conf }
}

export function BetaSwitch({ id, disabled = null, children = null }) {
  const x = TRIALS.find((b) => b.id === id)
  const { on, set, err, known } = useBeta(id)
  if (!x) return null
  return (
    <div className={`st-beta${on ? ' on' : ''}`} data-setting={x.setting} data-beta={id}>
      <label className="st-beta-main">
        <span className="st-beta-text">
          <span className="st-beta-name"><span>{t(x.label)}</span><span className="st-chip beta">{t('Beta')}</span></span>
          <span className="muted small">{t(x.short)} <More>{t(x.hint)}</More></span>
        </span>
        <input type="checkbox" role="switch" className="tg" checked={on} disabled={!known || !!disabled} onChange={(e) => set(e.target.checked)} aria-label={t(x.label)} />
      </label>
      {disabled && <p className="muted small st-beta-note"><Icon name="info" size={11} /> {disabled}</p>}
      {err && <p className="error-text small" role="alert">{err}</p>}
      {on && children && <div className="st-beta-body">{children}</div>}
    </div>
  )
}

// Several at the top of one place (Meetings' four), one under the other.
export function Betas({ ids, mac = false }) {
  const list = TRIALS.filter((x) => ids.includes(x.id) && (!x.mac || mac))
  if (!list.length) return null
  return <div className="st-betas">{list.map((x) => <BetaSwitch key={x.id} id={x.id} />)}</div>
}
