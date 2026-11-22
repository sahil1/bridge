// Where each part of Settings is, by the ids Settings opens them by (src/components/Settings.jsx
// SECTIONS): a section, a tab of one, or a setting in one. One table, so a sentence that tells you
// where to go can't name a place that has moved: the server's messages (in English) take their
// "Settings › …" from placeEn() here, and the app's from where() in src/components/settings/search.js,
// in your language. Settings' own sections and tabs are checked against it (test/suites/settings-ui.mjs).
//
// Account & Backup is called Back Up & Move until Bold Bridge accounts exist (its Account tab is
// theirs, so it's then the only tab, and not said).
export const SECTIONS = {
  features: 'Your Features',
  you: 'You',
  'agents-models': 'Agents & Models',
  'meetings-voice': 'Meetings & Voice',
  mail: 'Mail & Calendar',
  bots: 'Bots',
  devices: 'Devices & Access',
  notifications: 'Notifications',
  'account-backup': 'Account & Backup',
  about: 'About & Updates',
}
export const NO_ACCOUNTS = { 'account-backup': 'Back Up & Move' }

// Each tab: [its section, its name].
export const TABS = {
  agents: ['agents-models', 'Agents'],
  providers: ['agents-models', 'Model Providers'],
  models: ['agents-models', 'Which Model Does What'],
  mcp: ['agents-models', 'MCP Servers'],
  meetings: ['meetings-voice', 'Meetings'],
  dictation: ['meetings-voice', 'Dictation'],
  voice: ['meetings-voice', 'Speech Models'],
  spoken: ['meetings-voice', 'Spoken Answers'],
  phone: ['devices', 'Phone'],
  machines: ['devices', 'Computers'],
  remote: ['devices', 'Remote Access'],
  sharing: ['devices', 'Share Links'],
  account: ['account-backup', 'Account'],
  backup: ['account-backup', 'Back Up & Move'],
}

// The settings a message names, beside their place: [the tab or section they're in, their name].
// (The app knows every setting, from search.js; the server only these.)
export const SETTINGS = {
  'remote-devices': ['remote', 'Which Devices May Connect'],
  'beta-remote-screen': ['remote', 'Remote Screen and Preview'],
  terminal: ['agents', 'Terminal app'],
  'keep-agents': ['agents', 'Keep agents running when Bridge AI quits'],
  'more-models': ['providers', 'More Models'],
  'auto-update': ['about', "Update by itself while you're away"],
  beta: ['about', 'Beta Features'],
  'usage-counts': ['about', 'Usage Counts'],
  'crash-reports': ['about', 'Crash Reports'],
  'save-notes': ['meetings', 'Save notes as Markdown'],
  'call-audio': ['meetings', 'Record the other side of calls'],
  accounts: ['providers', 'Accounts'],
  cloud: ['providers', 'Cloud Agents'],
  'mcp-server': ['mcp', 'Bridge AI as an MCP Server'],
  // Out of Beta Features in 3.22.0, each in its own place.
  home: ['you', 'Home'],
  'scheduled-routines': ['agents', 'Scheduled Routines'],
  'meeting-insights': ['meetings', 'Meeting Insights'],
  tidy: ['dictation', 'Tidy what I say'],
}

// Places outside Settings a message names, as names from the top: Bots' tabs (the sidebar's Bots,
// the phone's More › Bots), where every connection is set up and fixed.
export const PAGES = {
  connections: ['Bots', 'Connections'],
}

// The way to a place, as names from Settings down: ['Settings', 'Devices & Access', 'Remote Access'];
// one outside Settings from the top: ['Bots', 'Connections']. accounts: whether Bold Bridge accounts
// exist (Account & Backup's name). An id that isn't a place is Settings itself.
export function placePath(id, { accounts = false } = {}) {
  if (PAGES[id]) return [...PAGES[id]]
  const setting = SETTINGS[id]
  const at = setting ? setting[0] : id
  const tab = TABS[at]
  const section = tab ? tab[0] : SECTIONS[at] ? at : null
  if (!section) return ['Settings']
  const out = ['Settings', (!accounts && NO_ACCOUNTS[section]) || SECTIONS[section]]
  if (tab && (accounts || !NO_ACCOUNTS[section])) out.push(tab[1])
  if (setting && setting[1] !== out[out.length - 1]) out.push(setting[1])
  return out
}
// In English, for the server's messages: "Settings › Devices & Access › Remote Access".
export const placeEn = (id, o) => placePath(id, o).join(' › ')
