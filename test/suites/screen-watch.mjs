// Watching a screen in a meeting (src/components/meetings/changes.js): a picture for each new slide
// or page, and none for a call's own view of faces, a cursor, a notification or a slide sliding in.
// The screens are drawn here as the small grey copies the page makes of a shared window, a look
// every two seconds: a Meet gallery like one where 171 pictures were kept in 25 minutes, and a
// presentation with the faces in a strip beside it.
import { judge, W, H } from '../../src/components/meetings/changes.js'
import { checks } from '../lib/harness.mjs'

const { ok, done } = checks('screen-watch')
const LOOK = 2000

let seed = Number(process.env.SCREEN_SEED) || 7 // SCREEN_SEED: other screens, to try it on more
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const screen = (bg = 32) => new Uint8Array(W * H).fill(bg)
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
const rect = (g, x, y, w, h, v) => { for (let j = Math.max(0, Math.round(y)); j < Math.min(H, Math.round(y + h)); j++) for (let i = Math.max(0, Math.round(x)); i < Math.min(W, Math.round(x + w)); i++) g[j * W + i] = v }
const noise = (g, x, y, w, h, amp) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) g[j * W + i] = clamp(g[j * W + i] + (rnd() - 0.5) * 2 * amp) }
const oval = (g, cx, cy, rx, ry, v) => { for (let j = Math.floor(cy - ry); j <= cy + ry; j++) for (let i = Math.floor(cx - rx); i <= cx + rx; i++) if (i >= 0 && j >= 0 && i < W && j < H && ((i - cx) / rx) ** 2 + ((j - cy) / ry) ** 2 <= 1) g[j * W + i] = v }
// Lines of words, each word a short dark bar: what text looks like this small.
const words = (g, x, y, w, lines, key) => { let s = key; const r = () => (s = (s * 69069 + 1) % 4294967296) / 4294967296; for (let l = 0; l < lines; l++) { let cx = x; while (cx < x + w - 4) { const len = 3 + Math.floor(r() * 7); rect(g, cx, y + l * 5, Math.min(len, x + w - cx), 2, 20); cx += len + 2 } } }
// Someone on camera: a head and shoulders that shift a little each look, over a slightly noisy room.
const face = (g, x, y, w, h, t, phase) => {
  rect(g, x, y, w, h, 120 + Math.round(Math.sin(t / 7 + phase) * 3)); noise(g, x, y, w, h, 3)
  const dx = Math.sin(t * 0.9 + phase) * 2 + (rnd() - 0.5) * 3, dy = (rnd() - 0.5) * 2
  oval(g, x + w / 2 + dx, y + h * 0.42 + dy, w * 0.16, h * 0.26, 185); rect(g, x + w * 0.25 + dx, y + h * 0.72 + dy, w * 0.5, h * 0.28, 60)
}
// A camera that's off: an initial in a circle, and "This video is paused" under it when it's paused.
const off = (g, x, y, w, h, paused) => { rect(g, x, y, w, h, 75); oval(g, x + w / 2, y + h * 0.42, w * 0.11, h * 0.17, 150); if (paused) rect(g, x + w * 0.2, y + h * 0.66, w * 0.6, h * 0.12, 30) }
const chrome = (g) => { rect(g, 0, 0, W, 7, 230); words(g, 4, 2, 120, 1, 3); rect(g, 0, H - 8, W, 8, 40); rect(g, 70, H - 6, 20, 4, 200) }

// A run of looks: how many pictures were kept, and at which looks.
function run(frames) {
  const j = judge()
  const at = []
  frames.forEach((g, i) => { if (j.look(g, i * LOOK)) at.push(i) })
  return at
}

// ---------- A call's own view: Meet's gallery, nobody sharing, for 25 minutes ----------
{
  const tiles = [[18, 9, 58, 34], [80, 9, 58, 34], [4, 46, 49, 34], [56, 46, 49, 34], [108, 46, 49, 34]]
  const live = [true, false, false, false, true]
  let talking = 0
  const frames = []
  for (let t = 0; t < 750; t++) {
    if (t % 37 === 20) { const k = 1 + Math.floor(rnd() * 3); live[k] = !live[k] } // a camera on or off (the network)
    if (t % 9 === 0) talking = Math.floor(rnd() * 5) // whoever's talking gets a border
    const g = screen(); chrome(g)
    tiles.forEach(([x, y, w, h], k) => {
      if (live[k]) face(g, x, y, w, h, t, k); else off(g, x, y, w, h, k !== 3)
      rect(g, x + 2, y + h - 5, 16, 2, 230) // the name under the tile
      if (k === talking) { rect(g, x, y, w, 1, 140); rect(g, x, y + h - 1, w, 1, 140); rect(g, x, y, 1, h, 140); rect(g, x + w - 1, y, 1, h, 140) }
    })
    frames.push(g)
  }
  const at = run(frames)
  ok(at.length <= 1, 'a call with nobody sharing (faces, cameras going on and off, whoever talks lit up): at most one picture in 25 minutes, not one every few seconds', { pictures: at.length, at: at.slice(0, 12) })
}

// ---------- Someone shares slides; the faces are a strip beside them ----------
{
  const frames = []
  const changes = []
  let slide = 1, next = 0, prevSlide = null
  for (let t = 0; t < 750; t++) {
    if (t === next) { changes.push(t); slide++; next = t + 22 + Math.floor(rnd() * 24) }
    const draw = (n) => { const g = screen(); chrome(g); rect(g, 2, 9, 116, 72, 245); words(g, 8, 13, 70, 1, n * 101); words(g, 8, 24, 100, 6 + (n % 4), n * 977 + 5); if (n % 3 === 0) rect(g, 70, 50, 40, 26, 150 + (n % 5) * 15); return g }
    let g = draw(slide)
    if (changes.at(-1) === t && prevSlide) { const a = prevSlide; for (let i = 0; i < g.length; i++) g[i] = (g[i] + a[i]) >> 1 } // the slide fading in
    for (let k = 0; k < 3; k++) face(g, 122, 9 + k * 24, 36, 22, t, k)
    if (changes.at(-1) !== t) prevSlide = draw(slide)
    frames.push(g)
  }
  const at = run(frames)
  const late = changes.slice(1).filter((c) => !at.some((a) => a >= c && a <= c + 6))
  ok(at.length >= changes.length - 1 && at.length <= changes.length + 1, 'a shared deck: a picture for each slide, the faces beside it left out', { slides: changes.length, pictures: at.length })
  ok(late.length <= 1, 'each one within a few seconds of it showing', { missed: late.slice(0, 5) })
}

// ---------- A cursor, a notification, a slide in the same template, a scroll ----------
{
  const base = (n = 1) => { const g = screen(); chrome(g); rect(g, 2, 9, 156, 72, 245); words(g, 8, 13, 70, 1, n * 101); words(g, 8, 24, 140, 8, n * 977); return g }
  const frames = []
  for (let t = 0; t < 40; t++) frames.push(base()) // the deck's first slide, kept
  for (let t = 0; t < 60; t++) { const g = base(); rect(g, 20 + ((t * 13) % 120), 20 + ((t * 7) % 50), 3, 4, 0); frames.push(g) } // the cursor going round
  const quiet = run(frames).length
  ok(quiet === 1, 'a cursor moving over a slide keeps no more pictures', { pictures: quiet })

  const toast = frames.slice(0, 40)
  for (let t = 0; t < 30; t++) { const g = base(); if (t === 10 || t === 11) { rect(g, 110, 10, 46, 14, 210); words(g, 112, 13, 40, 2, 55) } toast.push(g) }
  ok(run(toast).length === 1, 'nor does a notification there for a few seconds')

  const title = frames.slice(0, 40)
  for (let t = 0; t < 30; t++) { const g = base(); rect(g, 8, 13, 70, 2, 245); words(g, 8, 13, 60, 1, 4242); rect(g, 8, 24, 140, 12, 245); words(g, 8, 24, 140, 3, 777); title.push(g) }
  ok(run(title).length === 2, 'the next slide in the same template (a new title and points) is a picture')

  const scroll = frames.slice(0, 40)
  for (let t = 0; t < 6; t++) scroll.push(base(10 + t)) // scrolling a page: all of it moving
  for (let t = 0; t < 20; t++) scroll.push(base(20))
  for (let t = 0; t < 4; t++) scroll.push(base(30 + t))
  for (let t = 0; t < 20; t++) scroll.push(base(40))
  ok(run(scroll).length === 3, 'a page scrolled and left: a picture each time it settles, and the scrolling never counts as video', { pictures: run(scroll).length })
}

// ---------- Slides flicking past ----------
{
  const frames = []
  for (let t = 0; t < 150; t++) { const g = screen(); chrome(g); rect(g, 2, 9, 156, 72, 245); words(g, 8, 13, 140, 9, Math.floor(t / 6) * 31 + 1); frames.push(g) }
  const at = run(frames)
  const most = Math.max(...at.map((a) => at.filter((b) => b >= a && b < a + 90).length))
  ok(most <= 6 && at.length >= 6, 'slides flicked through every 12 seconds: six pictures at most in any three minutes', { pictures: at.length, mostIn3Min: most })
}

process.exit(done().fail ? 1 : 0)
