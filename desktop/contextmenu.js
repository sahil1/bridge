// Right-click in the desktop app's windows. Chromium underlines misspelled words in message boxes
// and fields by itself, but Electron shows no menu, so there was no way to see what it suggests. Here:
// the spelling suggestions for a misspelled word (one click puts it in), Add to Dictionary, then
// Cut, Copy, Paste and Select All in a field, Copy on selected text, Copy Link on a link. A page
// with its own right-click menu (a meeting in the sidebar, say) keeps it: the page cancels the event,
// and then there's no menu to show here.
//
// The spelling is the system's: macOS's own checker, and on Windows and Linux Chromium's, in the
// languages your computer is set to (Chromium fetches those dictionaries once; no text goes with it).
//
// Also the menu bar's one key a page has a use for as well (pageFirst, below): ⌘R.

// What to show for a right-click (Electron's context-menu params): the menu's items, empty for none.
// act: { replace(word), learn(word), copyLink(url) }.
function menuFor(p = {}, act = {}) {
  const items = []
  const flags = p.editFlags || {}
  if (p.isEditable && p.misspelledWord) {
    const words = (p.dictionarySuggestions || []).slice(0, 6)
    for (const w of words) items.push({ label: w, click: () => act.replace?.(w) })
    if (!words.length) items.push({ label: 'No Spelling Suggestions', enabled: false })
    items.push({ type: 'separator' }, { label: 'Add to Dictionary', click: () => act.learn?.(p.misspelledWord) }, { type: 'separator' })
  }
  if (p.isEditable) {
    items.push({ role: 'cut', enabled: !!flags.canCut }, { role: 'copy', enabled: !!flags.canCopy }, { role: 'paste', enabled: !!flags.canPaste }, { type: 'separator' }, { role: 'selectAll', enabled: flags.canSelectAll !== false })
  } else {
    if (p.selectionText?.trim()) items.push({ role: 'copy' })
    if (/^https?:|^mailto:/i.test(p.linkURL || '')) items.push({ label: 'Copy Link', click: () => act.copyLink?.(p.linkURL) })
  }
  return items
}

// Spelling in the languages this computer is set to, where the system's own checker doesn't already
// pick them (Windows and Linux): those Chromium has dictionaries for, else US English.
function languages(ses, app) {
  if (process.platform === 'darwin' || ses.getSpellCheckerLanguages().length) return
  const have = new Set(ses.availableSpellCheckerLanguages || [])
  const want = [...new Set((app.getPreferredSystemLanguages?.() || [app.getLocale()]).flatMap((l) => [l, l.split('-')[0]]).filter((l) => have.has(l)))].slice(0, 3)
  try { ses.setSpellCheckerLanguages(want.length ? want : ['en-US']) } catch { /* not a language it has */ }
}

// Every window the app opens, from the first one on.
function attach({ app, Menu, clipboard, session }) {
  languages(session.defaultSession, app)
  app.on('web-contents-created', (_e, wc) => {
    wc.on('context-menu', (_ev, p) => {
      const items = menuFor(p, {
        replace: (w) => wc.replaceMisspelling(w),
        learn: (w) => wc.session.addWordToSpellCheckerDictionary(w),
        copyLink: (u) => clipboard.writeText(u),
      })
      if (items.length) Menu.buildFromTemplate(items).popup()
    })
  })
}

// ---------- A menu bar key the page takes first ----------
// ⌘R (Ctrl+R on Windows and Linux) is View › Reload, and in a sheet it's Fill Right, as in Excel,
// Google Sheets and Numbers. Pressed, the item asks the window it was pressed in first
// (window.bridgeMenuKey(accelerator), which Studio's sheets answer: src/components/studio/
// sheetkeys.js); when the page takes it, that's all. Otherwise (nothing there takes it, or no answer
// within ASK_MS: a page that hangs, has gone or is still loading) it does what it always did.
// Picked from the menu, with the pointer or the keys that go through the menu, it never asks.
const ASK_MS = 400
// Reached by its key, ⌘ or Ctrl down (a click or Enter in the menu has neither).
const byKey = (event) => !!event?.triggeredByAccelerator && !!(event.metaKey || event.ctrlKey)
async function pageTakes(wc, key, ms = ASK_MS) {
  if (!wc || wc.isDestroyed?.()) return false
  let timer
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms) })
  const asked = Promise.resolve()
    .then(() => wc.executeJavaScript(`typeof window.bridgeMenuKey === 'function' && window.bridgeMenuKey(${JSON.stringify(key)}) === true`))
    .then((took) => took === true, () => false)
  try { return await Promise.race([asked, late]) } finally { clearTimeout(timer) }
}
// item: the menu item ({ label, accelerator }); run: what it does when the page doesn't take its key.
function pageFirst(item, run, { ms = ASK_MS } = {}) {
  return {
    ...item,
    click: async (_m, w, event) => {
      if (byKey(event) && await pageTakes(w?.webContents, item.accelerator, ms)) return
      run()
    },
  }
}

module.exports = { attach, menuFor, pageFirst, ASK_MS }
