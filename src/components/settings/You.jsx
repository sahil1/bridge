import { useEffect, useState } from 'react'
import LocationPicker from './LocationPicker.jsx'
import Appearance from '../Appearance.jsx'
import Permissions from './Permissions.jsx'
import { BetaSwitch } from './Beta.jsx'
import { useSettings, SaveNote } from './General.jsx'
import { Advanced, Line } from './Advanced.jsx'
import { t, tx } from '../../i18n/index.js'

// Settings › You: who you are and where (your name, your place, for the weather and the morning
// brief), the layout, and how Bridge AI looks (Appearance: color mode, theme, text size, language;
// under Advanced, density, the font, sharing a theme, the top bar). Home, a beta feature, is where
// Bridge AI opens, so its switch is at the top. Under Advanced too: what Bridge AI is allowed on
// this computer (Permissions).
export default function You() {
  const { s, save, note } = useSettings()
  const [name, setName] = useState('')
  useEffect(() => { if (s) setName(s.effective.name || '') }, [s])
  if (!s) return <div className="skeleton-rows"><div /><div /><div /></div>
  const eff = s.effective
  const seg = (label, value, options, onPick) => (
    <div className="seg ap-seg" role="radiogroup" aria-label={t(label)}>
      {options.map(([v, l]) => <button key={l} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onPick(v)}>{t(l)}</button>)}
    </div>
  )
  return (
    <div className="st-sections st-you">
      <SaveNote note={note} />
      <BetaSwitch id="home" />

      <section className="st-sec" data-setting="name">
        <Line label={t('Your name')} hint={t('What the Chief of Staff and the morning brief call you.')}>
          <input className="st-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== (eff.name || '') && save({ name: name.trim() })}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} placeholder={t('First name')} aria-label={t('Your name')} maxLength={60} />
        </Line>
      </section>

      <section className="st-sec" data-setting="location">
        <Line label={t('Location')} hint={t('For the weather and the morning brief. Only the place you pick is saved.')} />
        <LocationPicker value={eff.location} onChange={(loc) => save({ location: loc })} />
      </section>

      <section className="st-sec" data-setting="layout">
        <Line label={t('Layout')} hint={t('Simple: your Chief of Staff and your agents. Everything: every panel.')}
          title={t('Simple keeps the screen to your chief of staff and your agents: the Today panel waits behind one button, and the Agents board shows up once you have agents. Everything shows every panel.')}>
          {seg('Layout', !!eff.simple, [[true, tx('Simple')], [false, tx('Everything')]], (on) => save({ simple: on }))}
        </Line>
      </section>

      <Appearance />
      <Advanced order={40}><Permissions /></Advanced>
    </div>
  )
}
