// Where the floating card's window goes as the card grows and shrinks (desktop/floatfit.js): from
// its bar's side, so a card opened taller than half the screen and closed again is back where it
// was, not at the other end of the screen; on the screen whatever its size; and from a page older
// than this (no side said), by the window's middle as before. Its size zoomed (⌘+ in the main window
// zooms the card too): the card's times the zoom, on the screen. Resized by its edges, as any window.
// And when it's kept out of pictures of the screen (desktop/floatshare.js), with a stand-in for
// native/callwatch sharing: on a Mac, only while the screen is shared or recorded, so a screenshot
// shows it; until the helper has said, when it can't or has gone, and off a Mac, always; Always and
// Never as they say; the helper only while the card shows.
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { checks, ROOT } from '../lib/harness.mjs'

const { ok, done } = checks('float-window')
const require = createRequire(import.meta.url)
const { floatPlace, floatSize, resizedBounds, LIMITS } = require(path.join(ROOT, 'desktop', 'floatfit.js'))

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

// ---------- Its size, zoomed ----------
// The page measures the card in its own pixels; zoomed with the main window (⌘+), each is zoom points
// on the screen. 3.13.2 made the window the page's numbers in points: at 110% the card was cut off.
{
  const card = { w: 324, h: 280 } // the card, 300 by 256, and the 12 around it
  const sizes = [1, 1.1, 1.25, 1.5, 2, 3, 0.8].map((z) => ({ z, ...floatSize(card.w, card.h, z, a) }))
  ok(sizes.every(({ z, width, height }) => width >= card.w * z && width - card.w * z < 1 && height >= card.h * z && height - card.h * z < 1), 'zoomed from 80% to 300%: the window is the card times the zoom, to the point above', sizes)
  const small = { x: 0, y: 25, width: 1024, height: 615 } // a 13-inch Mac at Larger Text
  const big = floatSize(420, 900, 1.5, small)
  ok(big.width === Math.ceil(420 * 1.5) && big.height === small.height - 16, 'taller than a small screen: no taller than it, less 8 points above and below (the card scrolls the rest)', big)
  ok(floatSize(800, 200, 2, small).width === small.width - 16, 'and no wider than it', floatSize(800, 200, 2, small))
  ok(JSON.stringify(floatSize(324, 280, undefined, a)) === JSON.stringify(floatSize(324, 280, 1, a)) && JSON.stringify(floatSize(324, 280, 0, a)) === JSON.stringify(floatSize(324, 280, 1, a)), "a zoom it can't read counts as 100%")
}

// ---------- Resized by its edges ----------
// The edge you drag follows the pointer and the other stays; no narrower than the card's bar needs or
// wider than a column of text reads well (times the zoom); on the screen.
{
  const b = { x: 900, y: 100, width: 324, height: 400 }
  const p = { x: 900, y: 300 }
  const left = resizedBounds(b, p, { x: 780, y: 330 }, 'w', 1, a)
  ok(left.width === 444 && left.x + left.width === b.x + b.width && left.y === b.y && left.height === b.height, 'its left edge dragged 120 points left: 120 wider, its right edge where it was, its height its own', left)
  const corner = resizedBounds(b, p, { x: 960, y: 450 }, 'se', 1, a)
  ok(corner.x === b.x && corner.y === b.y && corner.width === 384 && corner.height === 550, 'its bottom right corner: wider and taller, its top left where it was', corner)
  const top = resizedBounds(b, p, { x: 900, y: 250 }, 'n', 1, a)
  ok(top.height === 450 && top.y + top.height === b.y + b.height && top.width === b.width, 'its top edge up 50: 50 taller, its bottom where it was', top)
  const narrow = resizedBounds(b, p, { x: 1100, y: 300 }, 'w', 1, a)
  const narrowZoomed = resizedBounds(b, p, { x: 1100, y: 300 }, 'w', 1.5, a)
  ok(narrow.width === LIMITS.minW + 24 && narrowZoomed.width === Math.ceil((LIMITS.minW + 24) * 1.5) && narrow.x + narrow.width === b.x + b.width, 'no narrower than the card\'s bar needs, zoomed or not', { narrow, narrowZoomed })
  const wide = resizedBounds({ ...b, x: 100 }, p, { x: 2000, y: 300 }, 'e', 1, a)
  ok(wide.width === LIMITS.maxW + 24, 'no wider than a column of text reads well', wide)
  const offRight = resizedBounds({ ...b, x: 1440 - 336 }, p, { x: 1300, y: 300 }, 'e', 1, a)
  ok(offRight.x + offRight.width <= a.x + a.width + 12, 'its right edge dragged past the screen\'s: it stops there (the 12 around the card may go over)', offRight)
  const short = resizedBounds(b, p, { x: 900, y: -400 }, 's', 1, a)
  const tall = resizedBounds({ ...b, y: 30 }, p, { x: 900, y: 2000 }, 's', 1, a)
  ok(short.height === LIMITS.minH + 24 && tall.y + tall.height <= a.y + a.height + 12, 'no shorter than its bar, no taller than the screen', { short, tall })
  ok(resizedBounds(b, p, { x: 860, y: 900 }, 'w', 1, a, 420).height === 420, 'dragged sideways, its height is the card\'s (its words wrap again), wherever the pointer goes up or down')
}

// ---------- Kept out of pictures of the screen ----------
{
  const { make, modeOf } = require(path.join(ROOT, 'desktop', 'floatshare.js'))
  const helpers = []
  const spawn = (bin, args) => {
    const p = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), args, killed: false })
    p.kill = () => { p.killed = true; p.emit('exit', null) }
    p.say = (line) => p.stdout.emit('data', `${line}\n`)
    helpers.push(p)
    return p
  }
  let changes = 0
  const card = make({ bin: '/stand-in/callwatch', mac: true, spawn, onChange: () => changes++ })
  ok(card.hidden() && modeOf(undefined) === 'sharing' && modeOf('bogus') === 'sharing', 'to begin with: kept out (While I share my screen, until the Mac has said)')
  card.set('sharing', false)
  ok(!helpers.length && card.hidden(), 'no card showing: no helper running')
  card.set('sharing', true)
  ok(helpers.length === 1 && helpers[0].args.join() === 'sharing' && card.hidden(), 'the card shows: the helper asked, and the card kept out until it answers')
  const h = helpers[0]
  const was = changes
  h.say('{"sharing":false}')
  ok(!card.hidden() && changes > was, 'nothing shared or recorded: a screenshot shows it, at once')
  h.say('{"sharing":true}')
  ok(card.hidden(), 'a call shares the screen: kept out of it')
  h.stdout.emit('data', '{"shar')
  h.stdout.emit('data', 'ing":false}\n')
  ok(!card.hidden(), 'the share ends: in pictures again (a line in two pieces read whole)')
  card.set('sharing', true)
  ok(helpers.length === 1, 'the card still showing: the same helper, not another')
  h.say('not json')
  ok(card.hidden(), 'a line it can\'t read: kept out')
  h.say('{"sharing":false}')
  h.emit('exit', 1)
  ok(card.hidden(), 'the helper gone: kept out')
  card.set('sharing', true)
  const h2 = helpers[helpers.length - 1]
  ok(helpers.length === 2 && h2 !== h, 'and asked again')
  h2.say('{"sharing":null}')
  ok(card.hidden(), 'a macOS that doesn\'t say: kept out')
  h2.say('{"sharing":false}')
  card.set('always', true)
  ok(h2.killed && card.hidden(), 'Always: kept out of screenshots too, with no helper')
  card.set('never', true)
  ok(!card.hidden() && helpers.length === 2, 'Never: in every picture')
  card.set('sharing', true)
  const h3 = helpers[helpers.length - 1]
  h3.say('{"sharing":false}')
  card.stop()
  ok(h3.killed && card.hidden(), 'the card hidden: the helper stopped, and the window kept out for when it shows again')
  const win = make({ bin: '/stand-in/callwatch', mac: false, spawn })
  const n = helpers.length
  win.set('sharing', true)
  ok(helpers.length === n && win.hidden(), 'off a Mac (Windows): nothing to say when, so kept out')
  win.set('never', true)
  ok(!win.hidden(), 'unless Never')
  const none = make({ bin: null, mac: true, spawn })
  none.set('sharing', true)
  ok(helpers.length === n && none.hidden(), 'a Mac without the helper: kept out')
}

process.exit(done().fail ? 1 : 0)
