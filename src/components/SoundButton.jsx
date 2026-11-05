import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { api, refetch } from '../api.js'
import { t } from '../i18n/index.js'

// The speaker in the top bar: Bridge AI's notifications with a sound, or without one (this
// computer's, a browser's and your phones'). They still come either way. Kept on the computer
// (alertSounds in its settings), where its notifications are made, which tells your other devices.
// row: a row of the Status menu (StatusMenu.jsx), with a switch.
export default function SoundButton({ conf, size = 15, row = false }) {
  const [picked, setPicked] = useState(null) // what was just clicked, until the settings say so too
  useEffect(() => setPicked(null), [conf?.alertSounds])
  if (!conf) return null
  const on = picked ?? conf.alertSounds !== false
  const flip = async () => {
    setPicked(!on)
    try { await api('/alerts/sound', { method: 'POST', body: { on: !on } }); refetch('/config') } catch { setPicked(null) }
  }
  if (row) return (
    <button type="button" className={`status-row sound-btn${on ? '' : ' off'}`} onClick={flip} role="switch" aria-checked={on}
      title={on ? t('Notifications play a sound, on all your devices. Click to silence them.') : t('Notifications are silent: they still come, without a sound. Click to turn sounds back on.')}>
      <Icon name={on ? 'volume' : 'volume-off'} size={14} /><span className="status-row-text">{t('Notification sounds')}</span><span className="status-switch" aria-hidden="true" />
    </button>
  )
  return (
    <button type="button" className={`win-btn sound-btn${on ? '' : ' off'}`} onClick={flip} aria-pressed={!on}
      aria-label={on ? t('Turn off notification sounds') : t('Turn on notification sounds')}
      title={on ? t('Notifications play a sound, on all your devices. Click to silence them.') : t('Notifications are silent: they still come, without a sound. Click to turn sounds back on.')}>
      <Icon name={on ? 'volume' : 'volume-off'} size={size} />
    </button>
  )
}
