// Cloud agents on the phone alone: Bridge AI's own UI for cloud agents, bundled in the phone apps
// and run with no computer (`npm run cloud:build`, served by the apps like the demo). The app keeps
// the keys and makes the requests to the providers (native.js); this page follows the agents.
// ?check=1: the app's background check instead (Android), with no UI.
const params = new URLSearchParams(location.search)

if (params.get('check') === '1') {
  import('./check.js').then((m) => m.check())
} else {
  Promise.all([import('../standalone/mount.jsx'), import('./backend.js')]).then(([{ mount }, { createPhone }]) => {
    // A notification tapped while this is open: the app says which agent.
    window.bridgeOpenAgent = (paneId) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId } }))
    mount(createPhone())
  })
}
