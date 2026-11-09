// An agent on another of your devices, in a tab of this window: that device's own view of it (the
// one an agent's own window shows, at /m/<id>/?window=<pane>, through this device), so you can work
// with it next to this device's agents without switching. Only the tabs in view are drawn, so at
// most two of these are open at once. Tab ids: remote:<device id, or "here">:<pane id>.
// That page is at an address of its own on this computer (api.js machineUrl), another site to this
// one: it can't reach into this page, and this one only talks to it in messages.
// Dictation here, with the focus in it or nothing focused and it on screen: the words are handed to
// its page, which puts them where they'd have gone had they been said there; and what's started in
// it (its mic button, Ask out loud) this page listens for, giving it the words (dictation/controller.js).
// The computer this window runs on, in a tab of another device's window at its own address: its page
// doesn't go in another computer's (server/index.js ownFrames), so the tab offers to switch instead.
import { useEffect, useMemo, useRef } from 'react'
import Icon from './Icon.jsx'
import { goMachine } from './Machines.jsx'
import { registerBox, handOver } from '../dictation/controller.js'
import { machineUrl, apart } from '../api.js'
import { machineOfHost } from '../../shared/machinehost.js'
import { passOn } from '../passed.js'
import { t } from '../i18n/index.js'

export default function RemoteAgent({ a }) {
  const { machine, pane } = a.remote
  const device = a.device || t('your other device')
  // The look and such, passed as it opens (a change to them later would load it again).
  const src = useMemo(() => `${machineUrl(machine, `/?window=${encodeURIComponent(pane)}`)}${passOn({ prefs: !!machine && apart })}`, [machine, pane])
  const origin = new URL(src, location.href).origin
  const away = !machine && !!machineOfHost(location.host)
  const frame = useRef(null)
  useEffect(() => {
    if (away) return
    const box = { frame: true, name: a.title, origin, el: () => frame.current, win: () => frame.current?.contentWindow || null, visible: () => !!frame.current?.getClientRects().length, insert: (text) => handOver(box, text) }
    return registerBox(a.paneId, box)
  }, [a.paneId, a.title, origin, away])
  const go = <button type="button" className="ghost-btn small" onClick={() => goMachine(machine, { agent: pane, back: a.title })} title={t('Show {name} in this window, at this agent', { name: device })}>{t('Go to {name}', { name: device })}</button>
  const own = <button type="button" className="ghost-btn small" onClick={() => goMachine(machine, { agent: pane, own: true })} title={t('Open {name} in a window of its own, beside this one', { name: device })}><Icon name="popout" size={12} /> {t('New window')}</button>
  return (
    <section className="pane remote-pane">
      <div className="remote-bar">
        <Icon name="laptop" size={12} />
        <span className="remote-where">{t('On {name}', { name: device })}</span>
        <span className="grow" />
        {go}
        {own}
      </div>
      {away
        ? <div className="remote-away"><p>{t('{name} is on {device}, the computer this window runs on. Its page opens only in a window of its own, not in a tab of another computer\'s.', { name: a.title, device })}</p><div className="remote-away-acts">{go}{own}</div></div>
        : <iframe ref={frame} className="remote-frame" title={a.title} src={src} allow="clipboard-read; clipboard-write" data-composer={a.paneId} />}
    </section>
  )
}
