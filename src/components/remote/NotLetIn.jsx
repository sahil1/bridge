// The whole window, once the computer it shows hasn't let this device in (Which Devices May Connect
// there, server/letin.js; api.js notLetIn): which computer, and where it's let in, instead of every
// panel failing on its own. Through another of your computers, when that's the one not let in, it
// says so. It asks again every few seconds and opens the app as soon as that computer lets it in.
// The ways elsewhere: the phone app's start screen, or back to the computer this window comes from.
import { useEffect, useState } from 'react'
import Icon from '../Icon.jsx'
import { notLetIn, phoneApp, machineId, hostApi } from '../../api.js'
import { goMachine } from '../Machines.jsx'
import { t } from '../../i18n/index.js'

const AGAIN_MS = 4000

export default function NotLetIn({ children }) {
  const [out, setOut] = useState(() => notLetIn.get())
  const [home, setHome] = useState(null) // the computer this window comes from, when it shows another
  useEffect(() => notLetIn.subscribe(setOut), [])
  useEffect(() => {
    if (!out) return
    if (machineId && out.at) hostApi('/machines').then((d) => setHome(d?.here?.name || null), () => {})
    const look = async () => {
      if (document.hidden) return
      const r = await fetch(`${out.at}/api/config`, { cache: 'no-store' }).catch(() => null)
      if (r?.ok) location.reload()
    }
    const id = setInterval(look, AGAIN_MS)
    return () => clearInterval(id)
  }, [out])
  if (!out) return children
  const computer = out.computer || t('That computer')
  return (
    <div className="crash-screen letin-screen" role="alert">
      <div className="crash-card">
        <Icon name="lock" size={28} />
        <h1>{out.through ? t('{computer} hasn\'t let {through} in', { computer, through: out.through }) : t('{computer} hasn\'t let this device in', { computer })}</h1>
        {out.through && <p className="muted">{t('This device comes through {through}.', { through: out.through })}</p>}
        <p>{t('On {computer}: Settings › Remote Access › Which Devices May Connect.', { computer })}</p>
        <p className="muted small">{t('This opens by itself once it does.')}</p>
        <div className="crash-acts">
          {home && <button type="button" className="btn" onClick={() => goMachine(null)}><Icon name="back" size={12} /> {t('Back to {name}', { name: home })}</button>}
          {phoneApp && <button type="button" className="btn" onClick={phoneApp.start}><Icon name="phone" size={12} /> {t('Start screen')}</button>}
          <button type="button" className="ghost-btn" onClick={() => location.reload()}>{t('Try again')}</button>
        </div>
      </div>
    </div>
  )
}
