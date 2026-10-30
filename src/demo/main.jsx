// The demo: Bridge AI's own UI on made-up agents and data, answered in the page (backend.js), with
// a strip that says so. `npm run demo:build` makes it a static site in dist-demo/; the phone apps
// bundle it for "Try the demo".
import { mount } from '../standalone/mount.jsx'
import { store } from '../components/layout.jsx'
import { createDemo } from './backend.js'
import DemoBar from './DemoBar.jsx'
import './demo.css'

// The made-up computer's project folders, offered first in New agent.
if (!store.get('cc-recent-dirs', null)) store.set('cc-recent-dirs', ['~/code/acme-shop', '~/code/billing-api', '~/code/docs-site'])

// This device is a brand-new install; ?m=studio is the Studio Mac, with everything going on.
const machine = new URLSearchParams(location.search).get('m')
mount(createDemo({ everything: machine === 'studio' }), <DemoBar machine={machine} />)
