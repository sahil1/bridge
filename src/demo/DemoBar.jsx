import { useEffect } from 'react'

const SITE = 'https://github.com/sahil1/bridge'

// The phone apps' way back to their start screen, to pair a real computer (null in a browser).
const toStart = window.bridgeAndroid?.home ? () => window.bridgeAndroid.home()
  : window.bridgeNative?.post ? () => window.bridgeNative.post({ type: 'home' })
    : null

// A thin strip over the app: this is the demo, where to get the real thing, and in the phone
// apps, how to pair a computer instead.
export default function DemoBar() {
  useEffect(() => { document.body.classList.add('demo-on') }, [])
  return (
    <div className="demo-bar" role="note">
      <span className="demo-tag">Demo</span>
      <span className="demo-what">Made-up agents and data</span>
      <span className="demo-grow" />
      <a href={SITE} target="_blank" rel="noreferrer">Get Bridge AI<span className="demo-long"> for your computer</span> ›</a>
      {toStart && <button type="button" onClick={toStart}>Pair a computer</button>}
    </div>
  )
}
