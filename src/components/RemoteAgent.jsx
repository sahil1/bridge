// An agent on another of your devices, in a tab of this window: that device's own view of it (the
// one an agent's own window shows, at /m/<id>/?window=<pane>, through this device), so you can work
// with it next to this device's agents without switching. Only the tabs in view are drawn, so at
// most two of these are open at once. Tab ids: remote:<device id, or "here">:<pane id>.
// Dictation here, with the focus in it or nothing focused and it on screen: the words are handed to
// its page, which puts them where they'd have gone had they been said there (dictation/controller.js).
import { useEffect, useRef } from 'react'
import Icon from './Icon.jsx'
import { goMachine } from './Machines.jsx'
import { registerBox, handOver } from '../dictation/controller.js'
import { t } from '../i18n/index.js'

export default function RemoteAgent({ a }) {
  const { machine, pane } = a.remote
  const src = `${machine ? `/m/${machine}` : ''}/?window=${encodeURIComponent(pane)}`
  const device = a.device || t('your other device')
  const frame = useRef(null)
  useEffect(() => registerBox(a.paneId, {
    frame: true,
    name: a.title,
    visible: () => !!frame.current?.getClientRects().length,
    insert: (text) => handOver(frame.current, text),
  }), [a.paneId, a.title])
  return (
    <section className="pane remote-pane">
      <div className="remote-bar">
        <Icon name="laptop" size={12} />
        <span className="remote-where">{t('On {name}', { name: device })}</span>
        <span className="grow" />
        <button type="button" className="ghost-btn small" onClick={() => goMachine(machine, { agent: pane, back: a.title })} title={t('Show {name} in this window, at this agent', { name: device })}>{t('Go to {name}', { name: device })}</button>
        <button type="button" className="ghost-btn small" onClick={() => goMachine(machine, { agent: pane, own: true })} title={t('Open {name} in a window of its own, beside this one', { name: device })}><Icon name="popout" size={12} /> {t('New window')}</button>
      </div>
      <iframe ref={frame} className="remote-frame" title={a.title} src={src} allow="clipboard-read; clipboard-write" data-composer={a.paneId} />
    </section>
  )
}
