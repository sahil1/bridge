import { useEffect, useState } from 'react'
import LocationPicker from './LocationPicker.jsx'
import Appearance from '../Appearance.jsx'
import Permissions from './Permissions.jsx'
import { useSettings, useSwitch, SaveNote } from './General.jsx'
import { Advanced, Line, More } from './Advanced.jsx'
import { t, tx } from '../../i18n/index.js'

// Settings › You: who you are and where (your name, your place, for the weather and the morning
// brief), the layout and Home, where Bridge AI opens (home.on: on unless you turn it off; off, it
// opens where you were), and how Bridge AI looks (Appearance: color mode, theme, text size,
// language; under Advanced, density, the font, sharing a theme, the top bar). Under Advanced too:
// what Bridge AI is allowed on this computer (Permissions).
export default function You() {
  const { s, save, note } = useSettings()
  const [name, setName] = useState('')
  useEffect(() => { if (s) setName(s.effective.name || '') }, [s])
  const [homeOn, setHome] = useSwitch(s?.effective?.home?.on !== false, (on) => save({ home: { on } }))
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

      <section className="st-sec" data-setting="home">
        <label className="st-check"><input type="checkbox" checked={homeOn} onChange={(e) => setHome(e.target.checked)} />
          <span><b>{t('Home')}</b> <span className="muted small">{t('Where Bridge AI opens: what needs you, and what\'s coming up.')} <More>{t('Where Bridge AI opens: what needs you on every computer, answered right there, then what\'s ready to look at and what\'s coming up, with Everything a click away.')} {t('Off: Bridge AI opens where you were.')}</More></span></span></label>
      </section>

      <Appearance />
      <Advanced order={40}><Permissions /></Advanced>
    </div>
  )
}
