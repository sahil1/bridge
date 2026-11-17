// Right-click in the desktop app (desktop/contextmenu.js), with a stand-in Electron: a misspelled
// word in a message box offers what the system's spelling suggests (one click puts it in) and Add
// to Dictionary, then Cut, Copy and Paste; a word with no suggestions says so; selected text and a
// link offer Copy and Copy Link; a right-click on nothing shows nothing; every window the app opens
// gets the menu; and Windows and Linux spell in the computer's languages. The menu bar's ⌘R (Ctrl+R
// on Windows and Linux): the window's page asked first, a sheet with focus taking it (Fill Right),
// and Reload when the page doesn't take it, doesn't answer in time or has gone, or the item was
// picked with the pointer. Also: every file the desktop app loads goes into the built app.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { checks, ROOT } from '../lib/harness.mjs'

const { ok, done } = checks('desktop-menu')
const require = createRequire(import.meta.url)
const { attach, menuFor, pageFirst } = require(path.join(ROOT, 'desktop', 'contextmenu.js'))

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

// The menu bar's ⌘R: View › Reload, asking the window's page first. A stand-in window's page runs
// what it's asked against a page of its own (bridgeMenuKey as src/components/studio/sheetkeys.js
// has it, or none), answers late, or has gone.
const reloads = []
const reload = pageFirst({ label: 'Reload', accelerator: 'CmdOrCtrl+R' }, () => reloads.push(1), { ms: 60 })
const windowWith = (page, { late = false, gone = false, destroyed = false } = {}) => {
  const asked = []
  return {
    asked,
    webContents: {
      isDestroyed: () => destroyed,
      executeJavaScript: (js) => {
        asked.push(js)
        if (late) return new Promise(() => {})
        if (gone) return Promise.reject(new Error('Render frame was disposed'))
        return Promise.resolve(new Function('window', `return (${js})`)(page))
      },
    },
  }
}
const sheet = (took) => ({ bridgeMenuKey: (k) => { took.push(k); return k === 'CmdOrCtrl+R' } })
const mac = { triggeredByAccelerator: true, metaKey: true, ctrlKey: false }
const pc = { triggeredByAccelerator: true, metaKey: false, ctrlKey: true }
const press = async (w, event) => { const before = reloads.length; await reload.click(reload, w, event); return reloads.length > before }
ok(reload.label === 'Reload' && reload.accelerator === 'CmdOrCtrl+R' && typeof reload.click === 'function', 'View › Reload keeps its name and its key, ⌘R (Ctrl+R on Windows and Linux)', reload)
let took = []
let w = windowWith(sheet(took))
ok(!(await press(w, mac)) && took.join() === 'CmdOrCtrl+R' && w.asked.length === 1, '⌘R with a sheet\'s cells in focus: the page asked first takes it (Fill Right), and nothing reloads', { took, asked: w.asked })
took = []
w = windowWith(sheet(took))
ok(!(await press(w, pc)) && took.join() === 'CmdOrCtrl+R', 'Ctrl+R on Windows and Linux: the same', took)
ok(await press(windowWith({ bridgeMenuKey: () => false }), mac), '⌘R anywhere else (the page doesn\'t take it): Reload')
ok(await press(windowWith({}), mac), 'a page with nothing to take it (no sheet opened yet, another page): Reload')
ok(await press(windowWith({ bridgeMenuKey: () => 'yes' }), mac), 'an answer that isn\'t true: Reload')
const t0 = Date.now()
const hung = await press(windowWith(sheet([]), { late: true }), mac)
ok(hung && Date.now() - t0 < 1000, 'a page that doesn\'t answer (hung, or still loading): Reload, once its time is up', Date.now() - t0)
ok(await press(windowWith(sheet([]), { gone: true }), mac) && await press(windowWith(sheet([]), { destroyed: true }), mac) && await press(undefined, mac), 'a page that has gone, a window closed, or no window: Reload')
took = []
w = windowWith(sheet(took))
ok(await press(w, { triggeredByAccelerator: false, metaKey: false }) && await press(w, { triggeredByAccelerator: true, metaKey: false, ctrlKey: false }) && !took.length && !w.asked.length, 'Reload picked from the View menu, with the pointer or Enter there: Reload, the page not asked', w.asked)

// The desktop app's own files all go into the built app.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'))
const files = new Set(pkg.build.files)
const loaded = (f) => [...fs.readFileSync(path.join(ROOT, 'desktop', f), 'utf8').matchAll(/require\('\.\/([\w.-]+\.js)'\)/g)].map((x) => x[1])
const missing = [...new Set([...loaded('main.js'), ...loaded('dictation.js')])].filter((f) => !files.has(f))
ok(missing.length === 0, 'every file main.js loads is in the built app', missing)
const main = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8')
// Its menu bar: View › Reload is the item above.
ok(/contextMenu\.pageFirst\(\{ label: 'Reload', accelerator: 'CmdOrCtrl\+R' \}, \(\) => win\?\.webContents\.reload\(\)\)/.test(main) && (main.match(/accelerator: 'CmdOrCtrl\+R'/g) || []).length === 1, 'the app\'s View › Reload is that item, and nothing else in its menu has ⌘R')
const ready = main.slice(main.indexOf('app.whenReady()'))
ok(ready.indexOf('contextMenu.attach(') > 0 && ready.indexOf('contextMenu.attach(') < ready.indexOf('createWindow()'), 'the app sets the menu up before its first window opens')

done()
