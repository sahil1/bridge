// Where the floating card's window goes when the card changes size (desktop/main.js): b is the
// window's bounds before, n after the new size, a the screen's work area. It grows and shrinks from
// its bar's side, which the card says (low: its bar at the bottom, for a card low on the screen) and
// keeps while it's open. By the window's middle, a card opened taller than half the screen had its
// middle past the screen's, so closing it took it from the top of the screen to the bottom.
// low isn't a boolean from a page older than this: the window's middle, as before.
function floatPlace(b, n, a, low) {
  const right = b.x + b.width / 2 > a.x + a.width / 2
  const bottom = typeof low === 'boolean' ? low : b.y + b.height / 2 > a.y + a.height / 2
  // On the right of the screen it grows and shrinks to the left, so it stays in its corner.
  const x = right ? b.x + b.width - n.width : n.x
  const y = bottom ? b.y + b.height - n.height : Math.min(n.y, a.y + a.height - n.height)
  return { x: Math.round(x), y: Math.round(Math.max(a.y, y)) }
}

module.exports = { floatPlace }
