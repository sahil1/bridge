// Open in Mail and Open in Calendar: the very message or event Bridge AI read, shown in the Mac's
// own app, which is where you answer it, change it or reply (Bridge AI never sends, answers or
// changes anything, and opening it there changes nothing either). Only on a Mac, only from a window
// on it, and only once the app is where macOS keeps it.
//   Mail: its message: link, by the message's Message-ID, which Mail finds in its own mailboxes.
//   Calendar: its ical://ekevent link, by the event's id in this Mac's calendar store (bridgecal's
//     local id; icalBuddy has none, so then there's no link), with when it starts for one that
//     repeats, so it's that day's. Calendar's link isn't one Apple writes down: it's the one
//     calendar apps for the Mac use.
// Each goes to the app itself (open -a), so a link never lands in another app that took over the
// kind (Outlook as your mail app has mailto:, not message:). No AppleScript: macOS asks nothing
// (no Automation question), and nothing here reads a folder of yours.
//
// Outlook isn't offered: nothing outside it can point it at one message or event. It has no link
// to one by its Message-ID or by this Mac's id for an event, the new Outlook can't be scripted to
// find one, and a copy opened in it (a .eml, a .ics) can land as a new message, or a second event in
// your calendar. Mail and Calendar have whatever Bridge AI shows, as it's read from them.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'

const APPS = {
  mail: { name: 'Mail', app: 'Mail.app' },
  calendar: { name: 'Calendar', app: 'Calendar.app' },
}
const fail = (message, status) => Object.assign(new Error(message), { status })

// Where an app is, or null: macOS keeps its own in /System/Applications (an older macOS, in
// /Applications). BRIDGE_APPLICATIONS (tests): the one folder to look in.
function where(id, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'darwin') return null
  for (const d of env.BRIDGE_APPLICATIONS ? [env.BRIDGE_APPLICATIONS] : ['/System/Applications', '/Applications']) {
    const p = path.join(d, APPS[id].app)
    if (fs.existsSync(p)) return p
  }
  return null
}

// Which of the two this Mac has: { mail: { name: 'Mail' }, calendar: { name: 'Calendar' } }, either
// left out when it isn't here (and both, off a Mac).
export function here(o) {
  const out = {}
  for (const id of Object.keys(APPS)) if (where(id, o)) out[id] = { name: APPS[id].name }
  return out
}

// Mail's link to a message, by its Message-ID (with or without its <>).
export const messageLink = (mid) => `message://${encodeURIComponent(`<${String(mid).replace(/^<|>$/g, '')}>`)}`

// Calendar's link to an event, by this Mac's id for it: for one that repeats, with when that day's
// starts (in UTC, or for one all day, the day as it is here), which Calendar takes before the id.
const pad = (n) => String(n).padStart(2, '0')
export function eventLink({ local, start, allDay = false, repeats = false }) {
  const id = encodeURIComponent(local)
  if (!repeats) return `ical://ekevent/${id}?method=show&options=more`
  const d = new Date(start)
  const [y, mo, day, h, mi, s] = allDay ? [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()] : [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()]
  return `ical://ekevent/${y}${pad(mo)}${pad(day)}T${pad(h)}${pad(mi)}${pad(s)}Z/${id}?method=show&options=more`
}

// The link opened in the app itself. Says which, or why it can't: the app isn't here, or what
// macOS said when it didn't open.
function open(id, link) {
  const { name } = APPS[id]
  const app = where(id)
  if (!app) throw fail(process.platform === 'darwin' ? `${name} isn't on this Mac` : `${name} is the Mac's own app: it isn't on this computer`, 404)
  return new Promise((resolve, reject) => {
    execFile('open', ['-a', app, link], { timeout: 15000 }, (err, _out, stderr) => (err ? reject(new Error(`macOS said: ${String(stderr || err.message).trim().split('\n')[0]}`)) : resolve({ ok: true, app: name })))
  })
}

// A message, by its Message-ID (mail.js finds it, as Mail's index has it now).
export const openMessage = (mid) => open('mail', messageLink(mid))

// An event as the calendar gave it to the app: { local, start, allDay, repeats }.
export function openEvent(e = {}) {
  const local = typeof e.local === 'string' ? e.local : ''
  if (!local || local.length > 255 || /[\u0000-\u001f]/.test(local)) throw fail('This Mac\'s calendar has no id for this event to find it by', 400)
  if (!Number.isFinite(Date.parse(e.start))) throw fail('When does it start?', 400)
  return open('calendar', eventLink({ local, start: e.start, allDay: e.allDay === true, repeats: e.repeats === true }))
}
