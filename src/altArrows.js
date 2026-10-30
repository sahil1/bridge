// Option/Alt+← and → jump a word, as in other terminals. xterm.js 6 sends them as plain modified
// arrows (ESC [1;3D), which shells and agents mostly ignore; xterm.js 5 sent what this does: ESC b
// and ESC f on a Mac, Ctrl+arrow elsewhere (Alt+↑/↓ as Ctrl+↑/↓ too). For a terminal's custom key
// handler: true when it took the key, so the handler returns false.
const MAC = ['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'].includes(globalThis.navigator?.platform)
const SEQ = MAC
  ? { ArrowLeft: '\x1bb', ArrowRight: '\x1bf' }
  : { ArrowLeft: '\x1b[1;5D', ArrowRight: '\x1b[1;5C', ArrowUp: '\x1b[1;5A', ArrowDown: '\x1b[1;5B' }

export default function altArrows(term, e) {
  if (e.type !== 'keydown' || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !SEQ[e.key]) return false
  e.preventDefault() // else Alt+← is the browser's Back off a Mac
  term.input(SEQ[e.key])
  return true
}
