// Enter in a message box that sends (an agent's chat, the Chief of Staff's, Home, a bot's, a
// whiteboard's AI Assist…), one rule for all of them, by Settings › You › Enter Key (enterKey in
// config.json, read from /config):
//   smart   Enter sends with the caret at the end of what you wrote (spaces and new lines after it
//           don't count) and nothing selected. Anywhere else, or with words selected, it's a new
//           line, so going back to change a word doesn't send the message half done. The default.
//   always  Enter sends.
//   mod     ⌘Enter sends (Ctrl+Enter on Windows and Linux); Enter is a new line.
// In all three ⌘Enter (Ctrl+Enter) sends, Shift+Enter is a new line, and nothing is sent while an
// input method is still putting a word together (Japanese, Chinese, Korean: isComposing, or the
// keyCode 229 Safari gives the Enter that ends it). A phone's or a tablet's keyboard on the screen
// keeps what each box did with it before (onScreen); a keyboard connected to one follows the setting.
// No imports, so test/suites/smart-enter.mjs checks the rule as it is.
export const ENTER_KEYS = ['smart', 'always', 'mod']
export const enterKeyOf = (v) => (ENTER_KEYS.includes(v) ? v : 'smart')

// Nothing but spaces and new lines after the caret, and nothing selected.
export const atEnd = (value, start, end) => start === end && !/\S/.test(String(value ?? '').slice(end ?? 0))

// What Enter does in a box: 'send', 'newline' (left to the box, so it's the box's own new line, in
// place of what's selected, and undo knows it), or null (another key, or an input method's Enter).
// e: the key event (React's or the browser's); box: the textarea, or { value, selectionStart,
// selectionEnd }; mode: the setting; onScreen: with a keyboard on the screen, what the box does
// ('send' or 'newline'), else null.
export function enterDoes(e, box, { mode = 'smart', onScreen = null } = {}) {
  const k = e?.nativeEvent || e
  if (!k || k.key !== 'Enter' || k.isComposing || k.keyCode === 229) return null
  if (k.shiftKey) return 'newline'
  if (k.metaKey || k.ctrlKey) return 'send'
  if (onScreen) return onScreen
  const m = enterKeyOf(mode)
  if (m === 'always') return 'send'
  if (m === 'mod') return 'newline'
  return atEnd(box?.value, box?.selectionStart, box?.selectionEnd) ? 'send' : 'newline'
}

// ⌘ on a Mac, an iPhone or an iPad; Ctrl elsewhere. modEnter: the two, as a setting names them.
const MAC = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = () => (MAC() ? '⌘' : 'Ctrl')
export const modEnter = () => (MAC() ? '⌘Enter' : 'Ctrl+Enter')

// A keyboard on the screen (a phone's or a tablet's): a touch screen with a keyboard's height of the
// page covered, against the most of it seen at this width (turned sideways is another width). One
// connected to the phone covers nothing, or only iOS's bar of shortcuts, much less than 150 px.
const most = new Map()
const room = () => { const v = window.visualViewport; return v ? v.height * v.scale : window.innerHeight }
const note = () => { const w = window.innerWidth; most.set(w, Math.max(most.get(w) || 0, room())) }
if (typeof window !== 'undefined') {
  note()
  window.visualViewport?.addEventListener('resize', note)
  window.addEventListener('resize', note)
}
export function keyboardOnScreen() {
  if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: coarse)').matches) return false
  note()
  return room() < (most.get(window.innerWidth) || 0) - 150
}
