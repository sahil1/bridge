import { useEffect, useState } from 'react'
import { goMachine } from '../components/Machines.jsx'

const SITE = 'https://github.com/sahil1/bridge'

// The phone apps' way back to their start screen, to pair a real computer (null in a browser).
const toStart = window.bridgeAndroid?.home ? () => window.bridgeAndroid.home()
  : window.bridgeNative?.post ? () => window.bridgeNative.post({ type: 'home' })
    : null

// ?clean=1: no strip, for recording videos and taking screenshots.
const clean = new URLSearchParams(location.search).get('clean') === '1'

// An offline machine (the Linux workstation, the Windows PC) can't be shown: say what it would do.
const OFFLINE = '.mc-row:has(.mc-dot:not(.on)) .mc-item, .rmc.off .rmc-head'
function MachineNote() {
  const [note, setNote] = useState(null)
  useEffect(() => {
    let t
    const click = (e) => {
      const el = e.target.closest?.(OFFLINE)
      if (!el) return
      e.preventDefault(); e.stopPropagation()
      const name = el.closest('.rmc, .mc-row')?.querySelector('.rmc-name, .mc-text b')?.textContent || 'That device'
      setNote(`${name} is offline. In the app, it opens right here once it's back.`)
      clearTimeout(t); t = setTimeout(() => setNote(null), 4500)
    }
    document.addEventListener('click', click, true)
    return () => { document.removeEventListener('click', click, true); clearTimeout(t) }
  }, [])
  return note ? <div className="demo-note" role="status">{note}</div> : null
}

// A thin strip over the app: this is the demo, where to get the real thing, and in the phone
// apps, how to pair a computer instead.
export default function DemoBar({ machine }) {
  useEffect(() => { document.body.classList.add('demo-app'); if (!clean) document.body.classList.add('demo-on') }, [])
  if (clean) return <MachineNote />
  return (
    <>
      <MachineNote />
      <div className="demo-bar" role="note">
        <span className="demo-tag">Demo</span>
        <span className="demo-what">{machine === 'studio' ? 'Made-up agents and data, on the Studio Mac' : 'Made-up agents and data. This Mac is a new install'}</span>
        <button type="button" className="demo-switch" onClick={() => goMachine(machine === 'studio' ? null : 'studio')}>{machine === 'studio' ? '‹ The new install' : 'See everything ›'}</button>
        <span className="demo-grow" />
        <a href={SITE} target="_blank" rel="noreferrer">Get Bridge AI<span className="demo-long"> for your computer</span> ›</a>
        {toStart && <button type="button" onClick={toStart}>Pair a computer</button>}
      </div>
    </>
  )
}
