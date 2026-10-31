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
//   wtype               wtype is installed (Wayland; for pasteInto below)
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

// Pasting what you said where you're typing in the other app ("Where I'm typing", Settings › Voice;
// off until you pick it). It's the clipboard and the paste keys pressed for you, so it needs the key
// from other apps first, and what this system lets one app press in another:
//   a Mac          native/bridgekeys paste (⌘V through CGEvent), which needs Accessibility: asked
//                  when you pick it, never before
//   Windows        uiohook-napi's keyTap (Ctrl+V), no prompt; not into a window running as
//                  administrator (Windows drops keys sent there, without a word)
//   X11            the same (XTest), Ctrl+Shift+V in a terminal
//   Wayland        wtype types it in, on desktops that let an app do that (Hyprland, COSMIC, niri…);
//                  GNOME and KDE don't, so there the window keeps Copy
// The facts are globalKey's, and wtype: it's installed (Wayland). The answer: { can, via, asks, why,
// limit }. via: bridgekeys | keytap | wtype. asks: 'accessibility' (the Mac). why: why not, when it
// can't. limit: something it can't paste into ('admin' on Windows).
export function pasteInto(m = {}) {
  const key = globalKey(m)
  if (!key.mode) return { can: false, why: key.why }
  if (m.platform === 'darwin') {
    if (!m.helper) return { can: false, why: 'native/bin/bridgekeys isn\'t in this build (it needs Xcode\'s command line tools)' }
    return { can: true, via: 'bridgekeys', asks: 'accessibility' }
  }
  if (m.platform === 'win32') {
    if (m.hook) return { can: true, via: 'keytap', asks: null, limit: 'admin' }
    return { can: false, why: 'uiohook-napi didn\'t load' }
  }
  if (m.platform === 'linux') {
    if (m.wayland) {
      // Neither has the virtual keyboard wtype types with (and their RemoteDesktop portal asks every
      // time a session starts).
      if (/gnome|kde|plasma/i.test(m.session || '')) return { can: false, why: 'GNOME and KDE don\'t let one app type into another' }
      if (!m.wtype) return { can: false, why: 'wtype isn\'t installed' }
      return { can: true, via: 'wtype', asks: null }
    }
    if (m.hook) return { can: true, via: 'keytap', asks: null }
    return { can: false, why: 'uiohook-napi didn\'t load' }
  }
  return { can: false, why: 'Not on this system' }
}

// A terminal, by the class X11 gives its window (xprop's WM_CLASS): terminals paste with
// Ctrl+Shift+V, since Ctrl+V is a key the program in them reads. xterm and urxvt have no paste key
// for the clipboard at all.
const TERMINALS = /term|konsole|kitty|alacritty|tilix|terminator|wezterm|ghostty|guake|tilda|yakuake|foot|tabby|hyper|sakura|kgx|org\.gnome\.console|ptyxis|blackbox|cool-retro/i
export const isTerminal = (wmClass) => !!wmClass && TERMINALS.test(String(wmClass))
