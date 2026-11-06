// Find in this chat or terminal: ⌘F on a Mac, Ctrl+F elsewhere (⌘K is the search of everything).
// The key goes to the chat or terminal of the pane that has focus, else the one under the pointer.
// Each marks itself with data-find and opens its own bar (components/FindBar.jsx) when sent
// bridge-find. In a browser, ⌘F anywhere else is the browser's own find. The desktop app has none,
// so there it goes to the pane you last clicked in (or the only one) too, unless you're typing
// somewhere that isn't a chat or a terminal: Studio's editors and other fields keep the key.
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const desktop = () => !!window.bridgeApp?.desktop

// A letter with ⌘ (Ctrl), as the keyboard writes it; by its place on the keyboard only when the
// layout doesn't write Latin letters (Cyrillic, Greek), as browsers do for their own shortcuts.
const letter = (e, k) => (/^[a-z]$/i.test(e.key || '') ? e.key.toLowerCase() === k : e.code === `Key${k.toUpperCase()}`)
const mod = (e) => (MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey
// ⇧⌘F is History (App.jsx), so ⌘F only without Shift.
export const isFindKey = (e) => mod(e) && !e.shiftKey && letter(e, 'f')
// ⌘G and ⇧⌘G: the next match and the one before, while a bar is open.
export const isStepKey = (e) => mod(e) && letter(e, 'g')

const FINDABLE = '[data-find]'
const shown = (e) => !!e?.isConnected && e.getClientRects().length > 0
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
// The chat or terminal an element is in, or its pane shows (the message box is in a chat's pane).
function findableOf(el) {
  if (!el?.closest || el === document.body || el === document.documentElement) return null
  const own = el.closest(FINDABLE)
  if (own) return shown(own) ? own : null
  const pane = el.closest('.pane')
  return pane ? [...pane.querySelectorAll(FINDABLE)].find(shown) || null : null
}

let pointer = null
let lastPane = null
function target() {
  const a = document.activeElement
  const focused = a && a !== document.body ? a : null
  const hit = findableOf(focused)
  if (hit) return hit
  // Focus in something else: a field, an editor, or a pane showing Files or a whiteboard. Its own.
  if (focused && (focused.matches(EDITABLE) || focused.isContentEditable || focused.closest('.pane'))) return null
  const under = pointer && findableOf(document.elementFromPoint(pointer[0], pointer[1]))
  if (under) return under
  if (!desktop()) return null
  const last = lastPane?.isConnected && findableOf(lastPane)
  if (last) return last
  const all = [...document.querySelectorAll(FINDABLE)].filter(shown)
  return all.length === 1 ? all[0] : null
}

// What's selected on the page, to start with: one line of it, not a whole passage.
function selectedText() {
  const s = String(window.getSelection?.() || '').trim()
  return s && !/\n/.test(s) && s.length <= 200 ? s : ''
}

// Opens the bar of the chat or terminal a pane shows (the ⋯ menu's Find, on a phone): true if there's one.
export function openFind(pane) {
  const el = pane && (pane.matches?.(FINDABLE) ? pane : [...pane.querySelectorAll(FINDABLE)].find(shown))
  if (!el) return false
  el.dispatchEvent(new CustomEvent('bridge-find', { bubbles: true, detail: { text: selectedText() } }))
  return true
}

let listening = false
export function listenForFind() {
  if (listening || typeof window === 'undefined') return
  listening = true
  document.addEventListener('pointermove', (e) => { pointer = e.pointerType === 'touch' ? null : [e.clientX, e.clientY] }, { capture: true, passive: true })
  document.addEventListener('pointerdown', (e) => { lastPane = e.target?.closest?.('.pane') || lastPane }, { capture: true, passive: true })
  document.documentElement.addEventListener('mouseleave', () => { pointer = null })
  window.addEventListener('keydown', (e) => {
    if (e.isComposing) return
    const find = isFindKey(e)
    if (!find && !isStepKey(e)) return
    // In the bar itself, its own keys (FindBar.jsx) do it.
    if (e.target?.closest?.('.find-bar')) return
    const el = target()
    if (!el || (!find && !el.hasAttribute('data-find-open'))) return
    // Before the terminal sees it: Ctrl+F there would be a key for the shell.
    e.preventDefault()
    e.stopPropagation()
    el.dispatchEvent(new CustomEvent(find ? 'bridge-find' : 'bridge-find-step', { bubbles: true, detail: find ? { text: selectedText() } : { dir: e.shiftKey ? -1 : 1 } }))
  }, true)
}

// ---------- Finding in the page (Chat) ----------
// Every match is painted with the CSS Custom Highlight API, so nothing is added to the page React
// draws; ::highlight(bridge-find) and (bridge-find-now) in styles.css. Bars in two panes at once
// share the two highlights.
const painted = new Map() // finder -> { all, now }
function paint() {
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return
  const all = new Highlight()
  const now = new Highlight()
  now.priority = 1
  for (const v of painted.values()) { for (const r of v.all) all.add(r); if (v.now) now.add(v.now) }
  CSS.highlights.set('bridge-find', all)
  CSS.highlights.set('bridge-find-now', now)
}

const LIMIT = 5000
// Text that ends where one of these starts or ends is a separate run: a match never joins two messages.
const BLOCKS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'PRE', 'TABLE', 'TR', 'TD', 'TH', 'SUMMARY', 'DETAILS', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'SECTION', 'TIME', 'BUTTON'])
// Not the conversation: the times and Edit under each message show only on hover.
const SKIP = '.msg-time, [aria-hidden="true"], .find-skip'
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// root(): what to look in; scroller(): what scrolls it. history(): { more, busy, error, load } for a
// conversation that goes back further than is shown, read a page at a time while you find.
export function pageFinder({ root, scroller, history }) {
  const f = { onResults: null }
  let q = ''
  let cs = false
  let matches = [] // Ranges, in order
  let sigs = [] // each one's words around it, to know it again once the page changes
  let cur = -1
  let pulling = false
  let failed = null
  let mo = null
  let timer = null

  // The runs of text, each run's nodes at their place in it, and the whole as one string.
  const collect = (el) => {
    const parts = []
    const nodes = []
    let at = 0
    let last = null
    const blockOf = (n) => { for (let e = n.parentElement; e && e !== el; e = e.parentElement) if (BLOCKS.has(e.tagName)) return e; return el }
    const seen = new Map()
    const visible = (p) => {
      if (seen.has(p)) return seen.get(p)
      // Inside a closed <details> it's there to open, as browsers' own find does.
      const v = !p.closest(SKIP) && (p.getClientRects().length > 0 || !!(p.closest('details:not([open])') && !p.closest('summary')))
      seen.set(p, v)
      return v
    }
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const p = n.parentElement
      if (!n.data || !p || p.closest('.find-bar') || !visible(p)) continue
      const b = blockOf(n)
      if (last && b !== last) { parts.push('\n'); at += 1 }
      last = b
      nodes.push({ n, at })
      parts.push(n.data)
      at += n.data.length
    }
    return { text: parts.join(''), nodes }
  }
  const nodeAt = (nodes, i) => {
    let lo = 0, hi = nodes.length - 1
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (nodes[mid].at <= i) lo = mid; else hi = mid - 1 }
    return nodes[lo]
  }
  const scan = () => {
    const el = root()
    if (!el || !q) return []
    const { text, nodes } = collect(el)
    const out = []
    sigs = []
    const re = new RegExp(escape(q), cs ? 'g' : 'gi')
    for (let m = re.exec(text); m && out.length < LIMIT; m = re.exec(text)) {
      if (!m[0]) { re.lastIndex++; continue }
      const a = nodeAt(nodes, m.index)
      const z = nodeAt(nodes, m.index + m[0].length - 1)
      const r = document.createRange()
      r.setStart(a.n, m.index - a.at)
      r.setEnd(z.n, m.index + m[0].length - z.at)
      out.push(r)
      sigs.push(text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40))
    }
    return out
  }
  const report = () => {
    const h = history?.()
    f.onResults?.({ index: cur, total: matches.length, over: matches.length >= LIMIT, busy: pulling || (!!q && !!h?.more && !failed), note: failed })
  }
  const show = () => { painted.set(f, { all: matches, now: matches[cur] || null }); paint() }

  // The room the bar takes over the top of what scrolls.
  const barRoom = (el) => (el?.querySelector('.find-bar')?.offsetHeight || 0) + 12
  // Brings the current match into view: open the <details> it's in, then scroll each box it's in,
  // innermost first, keeping it clear of the bar over the top of the chat.
  const reveal = () => {
    const r = matches[cur]
    if (!r) return
    for (let d = r.startContainer.parentElement?.closest('details:not([open])'); d; d = d.parentElement?.closest('details:not([open])')) d.open = true
    const outer = scroller()
    for (let e = r.startContainer.parentElement; e; e = e.parentElement) {
      const box = e.getBoundingClientRect()
      const at = r.getBoundingClientRect()
      const st = getComputedStyle(e)
      if (e.scrollWidth > e.clientWidth + 1 && /(auto|scroll)/.test(st.overflowX) && (at.left < box.left || at.right > box.right)) e.scrollLeft += at.left - box.left - box.width / 3
      if (e === outer || (e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(st.overflowY))) {
        const top = e === outer ? box.top + barRoom(outer) : box.top
        if (at.top < top || at.bottom > box.bottom - 8) e.scrollTop += at.top - box.top - Math.min(box.height / 3, 160)
      }
      if (e === outer) break
    }
  }
  // The first match from the top of the view down, else the last one above it.
  const nearest = () => {
    const el = scroller()
    const top = el ? el.getBoundingClientRect().top + barRoom(el) : 0
    const i = matches.findIndex((r) => r.getBoundingClientRect().bottom >= top)
    return i >= 0 ? i : matches.length - 1
  }
  // Older messages, a page at a time, while there's something to find and more to look through.
  const pull = async () => {
    const h = history?.()
    if (!q || pulling || failed || !h?.more || h.busy) return
    pulling = true
    report()
    const err = await h.load().catch((e) => e.message)
    pulling = false
    if (err) failed = err
    setTimeout(refresh, 120)
  }
  // The page changed (a new message, older ones loaded): the same match stays the current one,
  // and the view stays where it is. It's known again by the words around it, counted from the end
  // (older messages go in above it; a message's text can be drawn anew in other elements).
  const refresh = () => {
    if (!q) return
    const was = cur >= 0 ? { r: matches[cur], sig: sigs[cur], back: sigs.slice(cur).filter((x) => x === sigs[cur]).length } : null
    matches = scan()
    if (!matches.length) cur = -1
    else if (was) {
      const same = sigs.flatMap((x, i) => (x === was.sig ? [i] : []))
      if (same.length) cur = same[Math.max(0, same.length - was.back)]
      else {
        // Its words changed or went: the next one after where it was.
        const after = was.r.startContainer.isConnected ? matches.findIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, was.r) >= 0) : -1
        cur = after >= 0 ? after : Math.min(cur, matches.length - 1)
      }
    } else { cur = nearest(); reveal() }
    show()
    report()
    pull()
  }
  const watch = () => {
    if (mo || !root()) return
    mo = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(refresh, 150) })
    mo.observe(root(), { childList: true, subtree: true, characterData: true })
  }

  f.search = (query, matchCase) => {
    q = query
    cs = matchCase
    failed = null
    if (!q) { matches = []; sigs = []; cur = -1; show(); report(); return }
    watch()
    matches = scan()
    cur = matches.length ? nearest() : -1
    show()
    reveal()
    report()
    pull()
  }
  f.step = (dir) => {
    if (!matches.length) return
    cur = (cur + dir + matches.length) % matches.length
    show()
    reveal()
    report()
  }
  f.clear = () => {
    q = ''
    matches = []
    sigs = []
    cur = -1
    clearTimeout(timer)
    mo?.disconnect()
    mo = null
    painted.delete(f)
    paint()
  }
  // There's a match being looked at: the chat holds still for it rather than scroll to the newest.
  f.holding = () => !!q && cur >= 0
  return f
}
