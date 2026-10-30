// An agent on another of your devices, in a tab of this window: that device's own view of it (the
// one an agent's own window shows, at /m/<id>/?window=<pane>, through this device), so you can work
// with it next to this device's agents without switching. Only the tabs in view are drawn, so at
// most two of these are open at once. Tab ids: remote:<device id, or "here">:<pane id>.
import Icon from './Icon.jsx'
import { goMachine } from './Machines.jsx'
import { t } from '../i18n/index.js'

export default function RemoteAgent({ a }) {
  const { machine, pane } = a.remote
  const src = `${machine ? `/m/${machine}` : ''}/?window=${encodeURIComponent(pane)}`
  const device = a.device || t('your other device')
  return (
    <section className="pane remote-pane">
      <div className="remote-bar">
        <Icon name="laptop" size={12} />
        <span className="remote-where">{t('On {name}', { name: device })}</span>
        <span className="grow" />
        <button type="button" className="ghost-btn small" onClick={() => goMachine(machine, { agent: pane })} title={t('Show {name} in this window, at this agent', { name: device })}>{t('Go to {name}', { name: device })}</button>
        <button type="button" className="ghost-btn small" onClick={() => goMachine(machine, { agent: pane, own: true })} title={t('Open {name} in a window of its own, beside this one', { name: device })}><Icon name="popout" size={12} /> {t('New window')}</button>
      </div>
      <iframe className="remote-frame" title={a.title} src={src} allow="clipboard-read; clipboard-write" />
    </section>
  )
}
