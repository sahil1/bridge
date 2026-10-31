// What the operating system asks Bridge AI about, from the app's own side: the ones only the app can
// ask for and see, because it's the process macOS (or Windows) asks about. main.js hands them to the
// page as bridgeApp.permission (preload.js), and the page shows them all one way
// (src/permissions.js, src/components/PermissionFix.jsx). The rest (Calendars, Full Disk Access, the
// folders, Automation) are the server's: it's the one reading them (server/fixes.js).
//
// For each, in this order:
//   ask     the system's own question when there is one (macOS asks once: askForMediaAccess for the
//           microphone, the Accessibility prompt); when it has already answered, or has no question
//           to ask, its page of System Settings, with the tile beside it (main.js showTile)
//   status  'ok', 'ask' (not asked yet), 'denied', 'restricted' or 'unknown' (nothing says), looked up
//           without asking anything
//   reset   macOS's answer forgotten for this app only (tccutil, no password), then asked again: for
//           an answer that shows as on and doesn't take (one kept from a build signed differently: up
//           to 3.4.2 the app was signed ad hoc)
// Everything it uses comes in (create's options), so the tests stand in for macOS.
const SECURITY = 'x-apple.systempreferences:com.apple.preference.security'
const MAC_PANE = {
  microphone: `${SECURITY}?Privacy_Microphone`,
  accessibility: `${SECURITY}?Privacy_Accessibility`,
  notifications: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension',
}
const WIN_PANE = { microphone: 'ms-settings:privacy-microphone', notifications: 'ms-settings:notifications' }
// What macOS files each under (tccutil's names). Accessibility's ⌘V is also PostEvent, which the
// helper that pastes looks at (native/bridgekeys.swift).
const TCC = { microphone: ['Microphone'], accessibility: ['Accessibility', 'PostEvent'] }

// platform: process.platform. systemPreferences: Electron's. openExternal(url): opens System Settings
// (or Windows Settings). tccutil(args): runs /usr/bin/tccutil. bundleId(): this app's, or null (from
// source it's Electron's, whose answers aren't Bridge AI's to forget). showTile(kind): the tile beside
// System Settings. paste(): whether pasting where you're typing can work here (dictation.js), which
// is all Accessibility is for. onChange(): something may have changed (main.js tells the server).
function create({ platform = process.platform, systemPreferences, openExternal, tccutil, bundleId = () => null, showTile = async () => false, paste = () => false, onChange = () => {} }) {
  const MAC = platform === 'darwin'
  const WIN = platform === 'win32'
  // macOS shows its Accessibility question once per run at most; after that, its page.
  let askedAx = false
  const kinds = () => (MAC ? ['microphone', ...(paste() ? ['accessibility'] : []), 'notifications'] : WIN ? ['microphone', 'notifications'] : [])
  const media = () => {
    const s = systemPreferences.getMediaAccessStatus('microphone')
    return s === 'granted' ? 'ok' : s === 'not-determined' ? 'ask' : s === 'restricted' ? 'restricted' : 'denied'
  }
  function status(kind) {
    if (!kinds().includes(kind)) return null
    if (kind === 'microphone') return media()
    if (kind === 'accessibility') return systemPreferences.isTrustedAccessibilityClient(false) ? 'ok' : askedAx ? 'denied' : 'ask'
    return 'unknown' // notifications: neither system says whether they're on
  }
  // Its page of System Settings (Windows Settings), and on a Mac the tile beside it.
  async function open(kind) {
    let url = (MAC ? MAC_PANE : WIN ? WIN_PANE : {})[kind]
    if (!url) return null
    // Notifications opens on Bridge AI's own page with its bundle id.
    const id = MAC && kind === 'notifications' ? bundleId() : null
    if (id) url = `${url}?id=${encodeURIComponent(id)}`
    await Promise.resolve(openExternal(url)).catch(() => {})
    if (MAC) await showTile(kind)
    return 'opened'
  }
  // 'ok', 'asked' (the system's question is up: it answers there), 'opened' (System Settings),
  // 'restricted' (a profile on this computer decides), or null (nothing to allow here).
  async function ask(kind) {
    const s = status(kind)
    if (s == null || s === 'ok' || s === 'restricted') return s
    if (kind === 'microphone' && MAC && s === 'ask') {
      await systemPreferences.askForMediaAccess('microphone').catch(() => false)
      onChange()
      // Turned down just now: that's the answer, said so; Allow again goes to System Settings.
      return media()
    }
    if (kind === 'accessibility' && !askedAx) {
      askedAx = true
      // macOS lists Bridge AI under Accessibility (turned off) and asks in a window of its own, whose
      // Open System Settings goes to that list; the tile says what to do there.
      systemPreferences.isTrustedAccessibilityClient(true)
      await showTile(kind)
      return 'asked'
    }
    return open(kind)
  }
  async function reset(kind) {
    const id = MAC ? bundleId() : null
    if (!id || !TCC[kind]) return null
    // A service an older macOS doesn't know just says so; the rest are still forgotten.
    for (const s of TCC[kind]) await Promise.resolve(tccutil(['reset', s, id])).catch(() => {})
    if (kind === 'accessibility') askedAx = false
    onChange()
    return ask(kind)
  }
  const all = () => Object.fromEntries(kinds().map((k) => [k, status(k)]))
  return { kinds, status, ask, reset, open, all, canReset: (kind) => MAC && !!bundleId() && !!TCC[kind] }
}

module.exports = { create, TCC }
