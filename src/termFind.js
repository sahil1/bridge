import { SearchAddon } from '@xterm/addon-search'

// Finding in a terminal (components/FindBar.jsx, src/find.js), with xterm.js's own search over its
// whole buffer, scrollback included. Every match is marked; the current one is selected (where
// the next look starts from) and marked over that in the chat's colours, as a terminal draws a
// selection over the addon's own marks. The marks are drawn by whichever renderer the terminal
// has: the GPU's (termGpu.js) paints them into its cells, the page-element one into its rows. A
// terminal stays dark in both looks (styles.css --term-bg), so the colours are for a dark one, as
// #RRGGBB (what xterm.js takes).
const LOOK = {
  matchBackground: '#5c4a14',
  matchOverviewRuler: '#c99a2e',
  activeMatchBackground: '#a86b00',
  activeMatchColorOverviewRuler: '#ff9632',
}
const NOW = { backgroundColor: '#ff9632', foregroundColor: '#16130b' }
export const TERM_LIMIT = 2000

// Made before its terminal is (the bar is drawn first); attach(term) once there is one.
export default function termFinder() {
  const f = { onResults: null }
  let term = null
  let addon = null
  let sub = null
  let q = ''
  let cs = false
  let now = null // the current match's own mark
  const opts = () => ({ caseSensitive: cs, decorations: LOOK })
  const unmark = () => { try { now?.dispose() } catch { /* gone with its terminal */ } now = null }
  // On the selection the addon made (its first line, when a match wraps).
  const markNow = () => {
    unmark()
    const p = q && term?.getSelectionPosition()
    if (!p) return
    const b = term.buffer.active
    const marker = term.registerMarker(p.start.y - b.baseY - b.cursorY)
    if (!marker) return
    const d = term.registerDecoration({ marker, x: p.start.x, width: (p.start.y === p.end.y ? p.end.x : term.cols) - p.start.x, layer: 'top', ...NOW })
    if (!d) { marker.dispose(); return }
    d.onRender((el) => el.classList.add('find-now'))
    d.onDispose(() => marker.dispose())
    now = d
  }
  f.attach = (t) => {
    term = t
    addon = new SearchAddon({ highlightLimit: TERM_LIMIT })
    term.loadAddon(addon)
    sub = addon.onDidChangeResults(({ resultIndex, resultCount }) => {
      if (!q) return
      markNow()
      f.onResults?.({ index: resultIndex, total: resultCount, over: resultCount >= TERM_LIMIT })
    })
  }
  f.detach = () => { sub?.dispose(); unmark(); term = null; addon = null }
  f.search = (query, matchCase) => {
    q = query
    cs = matchCase
    if (!addon) return
    // Forgets the last search too, so the match it's on stays the current one (Match case, say).
    addon.clearDecorations()
    if (!q) { unmark(); f.onResults?.({ index: -1, total: 0 }); return }
    // From the bottom up: the newest output first.
    addon.findPrevious(q, { ...opts(), incremental: true })
  }
  f.step = (dir) => { if (q && addon) { if (dir > 0) addon.findNext(q, opts()); else addon.findPrevious(q, opts()) } }
  f.clear = () => { q = ''; unmark(); try { addon?.clearDecorations() } catch { /* its terminal is gone */ } }
  // What's selected in the terminal, to start with: one line of it.
  f.seed = () => {
    const s = term?.hasSelection() ? term.getSelection().trim() : ''
    return s && !/\n/.test(s) && s.length <= 200 ? s : ''
  }
  // A terminal drawn afresh (Terminal.jsx paints the agent's screen again): mark() before, where
  // the current match is; restore(mark, shift) after, the same line again near there (shift: the
  // lines added above it), picked as the current one, so the addon's next look keeps it.
  f.mark = () => {
    const p = q && term?.getSelectionPosition()
    if (!p) return null
    const b = term.buffer.active
    const size = p.start.y === p.end.y ? p.end.x - p.start.x : term.cols - p.start.x + (p.end.y - p.start.y - 1) * term.cols + p.end.x
    return { x: p.start.x, y: p.start.y, size, line: b.getLine(p.start.y)?.translateToString(true) }
  }
  f.restore = (m, shift = 0) => {
    if (!m || !q || !term) return
    const b = term.buffer.active
    const at = m.y + shift
    for (let d = 0; d < 3000 && (at - d >= 0 || at + d < b.length); d++) {
      for (const y of d ? [at - d, at + d] : [at]) {
        if (y >= 0 && y < b.length && b.getLine(y)?.translateToString(true) === m.line) { term.select(m.x, y, m.size); return }
      }
    }
  }
  return f
}
