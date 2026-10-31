// Right-click in the desktop app (desktop/contextmenu.js), with a stand-in Electron: a misspelled
// word in a message box offers what the system's spelling suggests (one click puts it in) and Add
// to Dictionary, then Cut, Copy and Paste; a word with no suggestions says so; selected text and a
// link offer Copy and Copy Link; a right-click on nothing shows nothing; every window the app opens
// gets the menu; and Windows and Linux spell in the computer's languages. Also: every file the
// desktop app loads goes into the built app.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { checks, ROOT } from '../lib/harness.mjs'

const { ok, done } = checks('desktop-menu')
const require = createRequire(import.meta.url)
const { attach, menuFor } = require(path.join(ROOT, 'desktop', 'contextmenu.js'))

const did = []
const act = { replace: (w) => did.push(['replace', w]), learn: (w) => did.push(['learn', w]), copyLink: (u) => did.push(['link', u]) }
const labels = (items) => items.map((i) => i.label || i.role || i.type)
const editable = { isEditable: true, editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true } }

// A misspelled word in a message box.
let m = menuFor({ ...editable, misspelledWord: 'recieve', dictionarySuggestions: ['receive', 'relieve'] }, act)
ok(labels(m).join(',') === 'receive,relieve,separator,Add to Dictionary,separator,cut,copy,paste,separator,selectAll', 'a misspelled word: its suggestions first, Add to Dictionary, then Cut, Copy, Paste and Select All', labels(m))
m[0].click()
m.find((i) => i.label === 'Add to Dictionary').click()
ok(JSON.stringify(did) === JSON.stringify([['replace', 'receive'], ['learn', 'recieve']]), 'a suggestion puts that word in; Add to Dictionary learns the word as typed', did)
m = menuFor({ ...editable, misspelledWord: 'x'.repeat(12), dictionarySuggestions: Array.from({ length: 9 }, (_, i) => `w${i}`) }, act)
ok(labels(m).filter((l) => /^w\d$/.test(l)).length === 6, 'at most six suggestions')
m = menuFor({ ...editable, misspelledWord: 'qzxv', dictionarySuggestions: [] }, act)
ok(m[0].label === 'No Spelling Suggestions' && m[0].enabled === false && labels(m).includes('Add to Dictionary'), 'no suggestions: says so, and still offers Add to Dictionary')

// A field with nothing misspelled: the editing items, enabled as the field allows.
m = menuFor({ isEditable: true, editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true } }, act)
ok(labels(m).join(',') === 'cut,copy,paste,separator,selectAll' && m[0].enabled === false && m[2].enabled === true, 'a field: Cut, Copy, Paste, Select All, greyed when there is nothing to cut or copy', m)

// Not a field.
ok(labels(menuFor({ selectionText: 'some words' }, act)).join(',') === 'copy', 'selected text: Copy')
m = menuFor({ linkURL: 'https://example.com/a' }, act)
m[0].click()
ok(labels(m).join(',') === 'Copy Link' && did.at(-1)?.[1] === 'https://example.com/a', 'a link: Copy Link copies it')
ok(menuFor({ linkURL: 'javascript:alert(1)' }, act).length === 0 && menuFor({}, act).length === 0 && menuFor({ selectionText: '   ' }, act).length === 0, 'nothing to offer (nothing selected, a script link): no menu at all')

// attach: every window gets it, a right-click pops it up and its items act on that window.
const listeners = {}
const app = { on: (ev, f) => { listeners[ev] = f }, getPreferredSystemLanguages: () => ['fr-CA', 'de-DE'], getLocale: () => 'fr-CA' }
const langs = { set: null }
const ses = { getSpellCheckerLanguages: () => [], availableSpellCheckerLanguages: ['en-US', 'fr', 'de-DE'], setSpellCheckerLanguages: (l) => { langs.set = l } }
const popped = []
const Menu = { buildFromTemplate: (items) => ({ popup: () => popped.push(items) }) }
const typed = []
const wc = { handlers: {}, on(ev, f) { this.handlers[ev] = f }, replaceMisspelling: (w) => typed.push(w), session: { addWordToSpellCheckerDictionary: (w) => typed.push(`+${w}`) } }
const plat = Object.getOwnPropertyDescriptor(process, 'platform')
Object.defineProperty(process, 'platform', { value: 'linux' })
try { attach({ app, Menu, clipboard: { writeText: () => {} }, session: { defaultSession: ses } }) } finally { Object.defineProperty(process, 'platform', plat) }
ok(JSON.stringify(langs.set) === JSON.stringify(['fr', 'de-DE']), 'Windows and Linux: spelling in the computer\'s languages that have a dictionary', langs.set)
listeners['web-contents-created']?.({}, wc)
wc.handlers['context-menu']?.({}, { ...editable, misspelledWord: 'teh', dictionarySuggestions: ['the'] })
ok(popped.length === 1 && popped[0][0].label === 'the', 'a window opened after: right-click shows the menu', popped)
popped[0][0].click()
popped[0].find((i) => i.label === 'Add to Dictionary').click()
ok(typed.join(',') === 'the,+teh', 'its items act on that window: the word replaced, or learnt', typed)
wc.handlers['context-menu']?.({}, {})
ok(popped.length === 1, 'a right-click on nothing: no menu')

// The desktop app's own files all go into the built app.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'))
const files = new Set(pkg.build.files)
const loaded = (f) => [...fs.readFileSync(path.join(ROOT, 'desktop', f), 'utf8').matchAll(/require\('\.\/([\w.-]+\.js)'\)/g)].map((x) => x[1])
const missing = [...new Set([...loaded('main.js'), ...loaded('dictation.js')])].filter((f) => !files.has(f))
ok(missing.length === 0, 'every file main.js loads is in the built app', missing)
const main = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8')
const ready = main.slice(main.indexOf('app.whenReady()'))
ok(ready.indexOf('contextMenu.attach(') > 0 && ready.indexOf('contextMenu.attach(') < ready.indexOf('createWindow()'), 'the app sets the menu up before its first window opens')

done()
