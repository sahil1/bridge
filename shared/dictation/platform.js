// Where dictation works, on the machine Bridge AI runs on. Holding the key inside Bridge AI works
// everywhere: it's the page's own key events (and on a phone, holding the mic button), so it needs
// nothing from the system, in the desktop app, a browser, Docker or the phone alike. That's the
// portable default.
//
// The key from any other app is the desktop app's, and only where the system lets it be heard with no
// permission prompt. What decides it, read when the app starts (desktop/dictation.js):
//   platform, arch      process.platform and process.arch
//   desktop             in the desktop app (Docker and a browser have no window of their own)
//   wayland             a Wayland session (XDG_SESSION_TYPE), where one app can't hear another's keys
//   session             XDG_CURRENT_DESKTOP (GNOME, KDE, Hyprland, sway…)
//   portal              the desktop has the GlobalShortcuts portal (D-Bus), true, false or null
//   electron            Electron's major version
//   helper              native/bridgekeys is in this build (a Mac)
//   hook                uiohook-napi loads here (Windows, X11)
// The answer: { mode: 'hold' | 'toggle' | null, via, asks, why }. hold: held to talk, as inside
// Bridge AI. toggle: tapped to start listening and again to stop (the key's release can't be heard).
// null: not offered here, and `why` says why (for diagnostics; the app just doesn't show it). asks:
// the system asks once to allow the key when it's first set (GNOME's portal).
export function globalKey(m = {}) {
  if (!m.desktop) return { mode: null, why: 'Only the desktop app hears keys in other apps' }
  if (m.platform === 'darwin') {
    // Carbon's hotkeys hear the key let go, with no permission (native/bridgekeys.swift).
    if (m.helper) return { mode: 'hold', via: 'bridgekeys' }
    return { mode: 'toggle', via: 'shortcut', why: 'native/bin/bridgekeys isn\'t in this build (it needs Xcode\'s command line tools)' }
  }
  if (m.platform === 'win32') {
    // x64, and the x64 app under Windows 11's emulation on Arm (untested there).
    if (m.hook) return { mode: 'hold', via: 'uiohook' }
    return { mode: 'toggle', via: 'shortcut', why: 'uiohook-napi didn\'t load' }
  }
  if (m.platform === 'linux') {
    if (m.wayland) {
      // An app can't hear another's keys on Wayland: only the desktop's GlobalShortcuts portal, which
      // says when the key is pressed (not when it's let go). sway and other wlroots desktops have none;
      // GNOME's (48 and later) answers Electron only from 45 on.
      if (!m.portal) return { mode: null, why: 'This Wayland desktop has no GlobalShortcuts portal' }
      if (/gnome/i.test(m.session || '') && Number(m.electron) < 45) return { mode: null, why: 'GNOME\'s shortcuts portal needs Electron 45 or later' }
      return { mode: 'toggle', via: 'shortcut', asks: /gnome/i.test(m.session || ''), why: 'On Wayland the key can\'t be heard let go in another app' }
    }
    // X11. uiohook-napi's Linux Arm build is really an x64 one, so there it doesn't load.
    if (m.hook) return { mode: 'hold', via: 'uiohook' }
    return { mode: 'toggle', via: 'shortcut', why: m.arch === 'x64' ? 'uiohook-napi didn\'t load (it needs libXtst)' : 'uiohook-napi has no build for this processor' }
  }
  return { mode: null, why: 'Not on this system' }
}

// The key from other apps is off until you say yes: Alfred, Raycast and other launchers often have
// it there. Bridge AI asks once, after your first words in it (controller.js offerAnyApp), and
// Settings › Voice turns it on or off.
