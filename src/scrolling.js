// Scroll bars as macOS draws its overlay ones (styles.css › Scroll bars): an area's thumb shows while
// the pointer is over it, and for a moment while you scroll it some other way (the keys, a swipe),
// so a list scrolled from the keyboard says where you are in it. Only a scroll of yours: one the
// app makes itself (a chat following its newest message) leaves the bar out of sight. The area
// scrolling is marked data-scrolling until it's been still for a moment.
const YOURS = 700 // ms after a key, the wheel or a touch in which a scroll is taken as yours
const STILL = 900 // ms after the last scroll that its thumb goes

export function watchScrolling(doc = document) {
  let last = -Infinity
  const marked = new Map()
  const yours = () => { last = performance.now() }
  for (const type of ['keydown', 'wheel', 'touchmove', 'pointerdown']) doc.addEventListener(type, yours, { capture: true, passive: true })
  doc.addEventListener('scroll', (e) => {
    if (performance.now() - last > YOURS) return
    const el = e.target === doc ? doc.scrollingElement : e.target
    if (!el || el.nodeType !== 1) return
    if (marked.has(el)) clearTimeout(marked.get(el))
    else el.setAttribute('data-scrolling', '')
    marked.set(el, setTimeout(() => { marked.delete(el); el.removeAttribute('data-scrolling') }, STILL))
  }, { capture: true, passive: true })
}
