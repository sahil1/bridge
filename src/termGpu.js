import { WebglAddon } from '@xterm/addon-webgl'

// A terminal drawn by the GPU (xterm.js's WebGL renderer), not row by row as page elements: an
// agent's screen changes many times a second, and drawn as elements that kept a window's main
// thread busy (14% for one fast terminal, twice that with two windows on it). Where WebGL isn't
// there, or its context is lost (the GPU reset, or more terminals open than it allows), the
// terminal carries on drawn as before. Not for the small previews of many agents at once, which
// would use up the contexts a browser allows. cc-term-dom true in this device's storage keeps the
// old way (the tests read a terminal's rows as text). Call after term.open().
export default function gpu(term) {
  try { if (localStorage.getItem('cc-term-dom') === 'true') return null } catch { /* no storage: the GPU */ }
  try {
    const gl = new WebglAddon()
    gl.onContextLoss(() => { try { gl.dispose() } catch { /* gone */ } })
    term.loadAddon(gl)
    return gl
  } catch { return null }
}
