// A terminal scrolled by a finger, on a phone or a tablet. xterm.js 6 scrolls with the wheel, its
// scrollbar and the keyboard, but a swipe on it did nothing: its scrolling isn't the page's, so the
// browser had nothing to move. Here an up-or-down swipe scrolls it line by line under the finger,
// and a flick glides on and slows the way a page does. A sideways swipe (a terminal wider than a
// phone) and a tap are left to the browser.
//   el: the element the terminal is in
//   lineHeight(): one line's height in px, as drawn now
//   scroll(n): scroll n lines (less than 0: up, back through history)
// Gives back a function that stops it.
export default function touchScroll(el, { lineHeight, scroll }) {
  let from = null // { x, y }: where the finger went down
  let axis = null // 'y' once it's a scroll, 'x' once it's the browser's
  let last = null // { y, t }
  let rest = 0 // px moved that don't make a whole line yet
  let speed = 0 // px per ms, the latest
  let glide = 0
  const move = (px) => {
    rest += px
    const h = lineHeight() || 16
    const n = Math.trunc(rest / h)
    if (n) { rest -= n * h; scroll(-n) }
  }
  const stop = () => { cancelAnimationFrame(glide); glide = 0 }
  const onStart = (e) => {
    stop()
    if (e.touches.length !== 1) { from = null; return }
    const t = e.touches[0]
    from = { x: t.clientX, y: t.clientY }
    last = { y: t.clientY, t: e.timeStamp }
    axis = null
    rest = 0
    speed = 0
  }
  const onMove = (e) => {
    if (!from || e.touches.length !== 1) return
    const t = e.touches[0]
    if (!axis) {
      const dx = Math.abs(t.clientX - from.x)
      const dy = Math.abs(t.clientY - from.y)
      if (Math.max(dx, dy) < 6) return // a tap, so far
      axis = dy >= dx ? 'y' : 'x'
    }
    if (axis !== 'y') return
    e.preventDefault() // the terminal's, not the page's
    const dy = t.clientY - last.y
    const dt = Math.max(1, e.timeStamp - last.t)
    speed = 0.8 * (dy / dt) + 0.2 * speed
    last = { y: t.clientY, t: e.timeStamp }
    move(dy)
  }
  const onEnd = () => {
    if (axis !== 'y' || !from) { from = null; return }
    from = null
    // A flick: carry on, slowing down, as a page does. A finger that stopped before lifting doesn't.
    let v = Math.abs(speed) > 0.25 ? speed : 0
    let at = performance.now()
    const step = (now) => {
      const dt = Math.min(50, now - at)
      at = now
      move(v * dt)
      v *= Math.pow(0.95, dt / 16)
      glide = Math.abs(v) > 0.03 ? requestAnimationFrame(step) : 0
    }
    if (v) glide = requestAnimationFrame(step)
  }
  el.addEventListener('touchstart', onStart, { passive: true })
  el.addEventListener('touchmove', onMove, { passive: false })
  el.addEventListener('touchend', onEnd, { passive: true })
  el.addEventListener('touchcancel', onEnd, { passive: true })
  return () => {
    stop()
    el.removeEventListener('touchstart', onStart)
    el.removeEventListener('touchmove', onMove)
    el.removeEventListener('touchend', onEnd)
    el.removeEventListener('touchcancel', onEnd)
  }
}
