// One-click fixes for what macOS asks you to allow: open the right page of System Settings, show
// the app to add there in Finder (to drag into the list), and say which app that is: Bridge AI
// itself when you use the app, or the terminal you started it from.
import path from 'node:path'
import { execFile } from 'node:child_process'
import { IS_MAC } from './paths.js'

const SECURITY = 'x-apple.systempreferences:com.apple.preference.security'
const PANES = {
  'full-disk': { url: `${SECURITY}?Privacy_AllFiles`, label: 'Full Disk Access' },
  calendars: { url: `${SECURITY}?Privacy_Calendars`, label: 'Calendars' },
  files: { url: `${SECURITY}?Privacy_FilesAndFolders`, label: 'Files & Folders' },
  automation: { url: `${SECURITY}?Privacy_Automation`, label: 'Automation' },
  microphone: { url: `${SECURITY}?Privacy_Microphone`, label: 'Microphone' },
  'internet-accounts': { url: 'x-apple.systempreferences:com.apple.Internet-Accounts-Settings.extension', label: 'Internet Accounts' },
}

// $TERM_PROGRAM of the terminal Bridge AI was started from, by the name System Settings lists it under.
const TERMINALS = { Apple_Terminal: 'Terminal', 'iTerm.app': 'iTerm', ghostty: 'Ghostty', WarpTerminal: 'Warp', vscode: 'Visual Studio Code', WezTerm: 'WezTerm', kitty: 'kitty', Alacritty: 'Alacritty', Hyper: 'Hyper', Tabby: 'Tabby' }

// The app macOS asks about: the desktop app runs this server on its own binary, inside its bundle.
export function app() {
  const bundle = /^(.*?\.app)\//.exec(process.execPath)?.[1]
  if (process.versions.electron && bundle) return { name: path.basename(bundle, '.app'), bundle, desktop: true }
  return { name: TERMINALS[process.env.TERM_PROGRAM] || null, bundle: null, desktop: false }
}

export const status = () => ({ mac: IS_MAC, app: app(), panes: Object.fromEntries(Object.entries(PANES).map(([k, v]) => [k, v.label])) })

const open = (args) => new Promise((resolve, reject) => {
  execFile('open', args, { timeout: 15000 }, (err) => (err ? reject(new Error('Couldn\'t open System Settings')) : resolve({ ok: true })))
})

export function openSettings(pane) {
  if (!IS_MAC) throw new Error('This is a macOS setting')
  const p = PANES[pane]
  if (!p) throw new Error('No such settings page')
  return open([p.url])
}

// Bridge AI in Finder, selected, so you can drag it into the list in System Settings.
export function reveal() {
  const a = app()
  if (!IS_MAC || !a.bundle) throw new Error('Add the app with the + button in System Settings')
  return open(['-R', a.bundle])
}
