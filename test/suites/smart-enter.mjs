// Enter in a message box (src/enter.js), the rule itself, with no server or browser. Smart, the
// default: Enter sends with the caret at the end of what's written (spaces and new lines after it
// don't count) and nothing selected; with the caret anywhere else, or words selected, it's a new
// line. Always Sends: Enter sends. ⌘Enter Sends: Enter is a new line. In all three ⌘Enter and
// Ctrl+Enter send, Shift+Enter is a new line, and an input method's Enter (still putting a word
// together: isComposing, or Safari's keyCode 229 as it ends) does nothing of the box's. With a
// phone's keyboard on the screen, each box does what it did before. And every message box that
// sends on Enter takes it from there: none decides Enter on its own, or misses the input method.
import fs from 'node:fs'
import path from 'node:path'
import { checks, ROOT } from '../lib/harness.mjs'
import { enterDoes, atEnd, enterKeyOf, ENTER_KEYS, keyboardOnScreen } from '../../src/enter.js'

const { ok, done } = checks('smart-enter')

const key = (o = {}) => ({ key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, keyCode: 13, ...o })
// A box with the caret at | (or the words between [ and ] selected).
const box = (s) => {
  const sel = /\[(.*)\]/s.exec(s)
  if (sel) return { value: s.replace(/[[\]]/g, ''), selectionStart: sel.index, selectionEnd: sel.index + sel[1].length }
  const at = s.indexOf('|')
  return { value: s.replace('|', ''), selectionStart: at, selectionEnd: at }
}
const does = (s, o = {}, how = {}) => enterDoes(key(o), box(s), how)

ok(JSON.stringify(ENTER_KEYS) === '["smart","always","mod"]' && enterKeyOf(undefined) === 'smart' && enterKeyOf('bogus') === 'smart' && enterKeyOf('mod') === 'mod', 'the setting: Smart unless it says Always Sends or ⌘Enter Sends')

// ---------- Smart ----------
ok(does('Check the refunds|') === 'send', 'Smart: the caret at the end sends')
ok(does('Check the refunds|  \n\n ') === 'send', 'Smart: the caret before nothing but spaces and new lines is the end: it sends')
ok(does('Check the| refunds') === 'newline', 'Smart: the caret back in the words makes a new line')
ok(does('|Check the refunds') === 'newline', 'Smart: the caret at the start makes a new line')
ok(does('First line\n|Second line') === 'newline', 'Smart: the caret at the start of a later line makes a new line')
ok(does('Check the [refunds]') === 'newline', 'Smart: words selected (even the last) make a new line, in their place')
ok(does('Check the refunds[  ]') === 'newline', 'Smart: spaces at the end selected: a new line too (something is selected)')
ok(does('|') === 'send', 'Smart: an empty box is at its end (the box sends nothing)')
ok(atEnd('a\n', 1, 1) && !atEnd('ab', 1, 1) && !atEnd('ab', 0, 2) && atEnd('', 0, 0), 'the end: nothing but spaces and new lines after the caret, nothing selected')

// ---------- The keys that are the same in every mode ----------
for (const mode of ENTER_KEYS) {
  ok(does('Check the| refunds', { metaKey: true }, { mode }) === 'send' && does('Check the| refunds', { ctrlKey: true }, { mode }) === 'send' && does('Check [the] refunds', { metaKey: true }, { mode }) === 'send', `${mode}: ⌘Enter and Ctrl+Enter send, wherever the caret is`)
  ok(does('Check the refunds|', { shiftKey: true }, { mode }) === 'newline' && does('Check the| refunds', { shiftKey: true }, { mode }) === 'newline', `${mode}: Shift+Enter is a new line, even at the end`)
  ok(does('日本|', { isComposing: true }, { mode }) === null && does('日本|', { keyCode: 229 }, { mode }) === null && does('日本|', { isComposing: true, metaKey: true }, { mode }) === null, `${mode}: an input method's Enter (isComposing, or keyCode 229) neither sends nor is the box's new line`)
  ok(does('Check|', { key: 'a' }, { mode }) === null && does('Check|', { key: 'Tab' }, { mode }) === null, `${mode}: other keys are the box's own`)
}
// A React event: the browser's is its nativeEvent (isComposing is only there).
ok(enterDoes({ key: 'Enter', nativeEvent: key({ isComposing: true }) }, box('日本|')) === null && enterDoes({ key: 'Enter', nativeEvent: key() }, box('Done|')) === 'send', 'a React key event is read from its nativeEvent, input method and all')

// ---------- Always Sends, ⌘Enter Sends ----------
ok(does('Check the| refunds', {}, { mode: 'always' }) === 'send' && does('Check [the] refunds', {}, { mode: 'always' }) === 'send', 'Always Sends: Enter sends wherever the caret is')
ok(does('Check the refunds|', {}, { mode: 'mod' }) === 'newline' && does('Check the| refunds', {}, { mode: 'mod' }) === 'newline', '⌘Enter Sends: Enter is a new line, even at the end')

// ---------- A phone's keyboard on the screen: what the box did ----------
ok(does('Check the refunds|', {}, { onScreen: 'newline' }) === 'newline' && does('Check the refunds|', {}, { mode: 'always', onScreen: 'newline' }) === 'newline', 'a keyboard on the screen, in a box where Enter was a new line (an agent\'s chat): still a new line, at the end too')
ok(does('Check the| refunds', {}, { onScreen: 'send' }) === 'send' && does('Check the refunds|', {}, { mode: 'mod', onScreen: 'send' }) === 'send', 'a keyboard on the screen, in a box where Enter sent (Home): still sends')
ok(does('Check the| refunds', { metaKey: true }, { onScreen: 'newline' }) === 'send' && does('Check the refunds|', { shiftKey: true }, { onScreen: 'send' }) === 'newline', 'with ⌘ or Shift held it\'s a keyboard of its own: ⌘Enter sends, Shift+Enter is a new line')
ok(keyboardOnScreen() === false, 'no window (here): no keyboard on the screen')

// ---------- Every message box takes Enter from src/enter.js ----------
// A textarea whose key handler says 'Enter' and sends without ⌘ decides Enter on its own. (⌘Enter-
// only boxes, a new agent's first message or a comment, never send on Enter; a meeting's line, being
// changed, keeps Enter for Save as a one-line field does.)
const files = []
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.jsx$/.test(e.name)) files.push(p) } }
walk(path.join(ROOT, 'src'))
const OWN = ['src/components/meetings/Meetings.jsx:Line text']
const own = []
const unguarded = []
let users = 0
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  const rel = path.relative(ROOT, f).replace(/\\/g, '/')
  if (/from '(\.\.\/)+EnterHint\.jsx'|from '\.\/EnterHint\.jsx'/.test(s)) users++
  for (const m of s.matchAll(/<textarea\b[\s\S]*?\/>/g)) {
    const el = m[0]
    if (!/'Enter'/.test(el) || /e\.key === 'Enter' && \(e\.metaKey \|\| e\.ctrlKey\)/.test(el)) continue
    const label = /aria-label=\{t\('([^']+)'\)/.exec(el)?.[1] || ''
    if (!OWN.includes(`${rel}:${label}`)) own.push(`${rel}:${s.slice(0, m.index).split('\n').length} ${label}`)
    else if (!/isComposing/.test(el) || !/229/.test(el)) unguarded.push(`${rel} ${label}`)
  }
}
ok(users >= 9, `the message boxes take Enter from src/enter.js (EnterHint.jsx's useEnter): ${users} files`, users)
ok(!own.length, 'no message box decides Enter on its own', own)
ok(!unguarded.length, 'and the one that keeps Enter for Save waits for an input method too', unguarded)

process.exit(done().fail ? 1 : 0)
