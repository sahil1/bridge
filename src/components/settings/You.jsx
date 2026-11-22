import { useEffect, useState } from 'react'
import LocationPicker from './LocationPicker.jsx'
import Appearance from '../Appearance.jsx'
import Permissions from './Permissions.jsx'
import { BetaSwitch } from './Beta.jsx'
import { useSettings, SaveNote } from './General.jsx'
import { Advanced, Line } from './Advanced.jsx'
import { t, tx } from '../../i18n/index.js'
import { enterKeyOf, modEnter } from '../../enter.js'

// Settings › You: who you are and where (your name, your place, for the weather and the morning
// brief), the layout, and how Bridge AI looks (Appearance: color mode, theme, text size, language;
// under Advanced, density, the font, sharing a theme, the top bar). Home, a beta feature, is where
// Bridge AI opens, so its switch is at the top. Enter Key: what Enter does in a message box (src/enter.js),
// for every device that shows this computer, a phone with a keyboard too. Under Advanced too: what
// Bridge AI is allowed on this computer (Permissions).
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

      <section className="st-sec" data-setting="enter-key">
        <Line label={t('Enter Key')} hint={t('Smart: Enter sends from the end, and makes a new line mid-message.')}
          title={t('In every message box: Smart sends with the caret at the end of what you wrote, and makes a new line where you went back to change something, so nothing goes half done. {keys} always sends, and Shift+Enter is always a new line. On a phone, with a keyboard connected to it.', { keys: modEnter() })}>
          <div className="seg ap-seg" role="radiogroup" aria-label={t('Enter Key')}>
            {[['smart', t('Smart')], ['always', t('Always Sends')], ['mod', t('{keys} Sends', { keys: modEnter() })]].map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={enterKeyOf(eff.enterKey) === v} className={enterKeyOf(eff.enterKey) === v ? 'on' : ''} onClick={() => save({ enterKey: v === 'smart' ? null : v })}>{l}</button>
            ))}
          </div>
        </Line>
      </section>

      <Appearance />
      <Advanced order={40}><Permissions /></Advanced>
    </div>
  )
}
