// Where the floating card's window goes as the card grows and shrinks (desktop/floatfit.js): from
// its bar's side, so a card opened taller than half the screen and closed again is back where it
// was, not at the other end of the screen; on the screen whatever its size; and from a page older
// than this (no side said), by the window's middle as before.
import path from 'node:path'
import { createRequire } from 'node:module'
import { checks, ROOT } from '../lib/harness.mjs'

const { ok, done } = checks('float-window')
const require = createRequire(import.meta.url)
const { floatPlace } = require(path.join(ROOT, 'desktop', 'floatfit.js'))

const a = { x: 0, y: 25, width: 1440, height: 875 } // a screen's work area, under the menu bar
// Resized the way Electron does it: the top left stays, then floatPlace moves it.
const resize = (b, w, h, low) => { const n = { x: b.x, y: b.y, width: w, height: h }; return { ...floatPlace(b, n, a, low), width: w, height: h } }

// In the top right corner, where it starts.
const slim = { x: 1440 - 348 - 12, y: 37, width: 348, height: 74 }
const open = resize(slim, 420, a.height - 16, false) // as tall as desktop/main.js lets it be
ok(open.y === slim.y && open.x + open.width === slim.x + slim.width, 'high on the screen: it opens down from its bar, and grows to the left in the right corner', open)
const closed = resize(open, 348, 74, false)
ok(closed.y === slim.y && closed.x === slim.x, 'closed again, it\'s back in its corner (it went to the bottom of the screen)', { slim, closed })
ok(resize(open, 348, 74).y > 600, 'by the window\'s middle alone (a page older than this), the same close goes to the bottom: what this fixes', resize(open, 348, 74))

// Low on the screen: it opens up from its bar, and closes back down to it.
const low = { x: 40, y: 760, width: 348, height: 74 }
const up = resize(low, 420, 700, true)
ok(up.y + up.height === low.y + low.height && up.x === low.x, 'low on the screen: it opens up, its bar where it was, and on the left it grows to the right', up)
const down = resize(up, 348, 74, true)
ok(down.y === low.y, 'closed again, it\'s back where it was', down)

// Whatever it's asked, it stays on the screen.
const mid = { x: 600, y: 400, width: 348, height: 74 }
const big = resize(mid, 420, 860, false)
ok(big.y >= a.y && big.y + big.height <= a.y + a.height, 'opened down from the middle taller than what\'s left below: moved up to stay on the screen', big)
const bigUp = resize({ x: 600, y: 100, width: 348, height: 74 }, 420, 860, true)
ok(bigUp.y === a.y, 'opened up from near the top taller than what\'s above: it starts at the top of the screen', bigUp)

process.exit(done().fail ? 1 : 0)
