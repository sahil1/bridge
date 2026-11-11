// Today's calendar, read locally from macOS Calendar: through Bridge AI's own helper
// (native/bridgecal.swift), or icalBuddy on a Mac without it. The Exchange account is
// already synced there, so there's no sign-in and nothing leaves the Mac.
// Meeting notes carry Teams passcodes and organizer links; only the join link, the invite's own
// words above the Teams boilerplate (whole, and as a short agenda) and the files it links to are
// kept. With bridgecal, each event also has its calendar's colour, a lasting id, this Mac's own id
// for it (for Open in Calendar, openin.js) and whether it repeats, your answer to it, who organised
// it, and who's invited with each one's address, reply and role. It only reads: nothing here adds,
// changes or answers an event.
import { execFile } from 'node:child_process'
import { tool, calBin } from './fixes.js'
import { notPerson } from './notpeople.js'

const SEP_EV = '@@EV@@'
const SEP_PROP = '¦' // ¦
const DEFAULT_EXCLUDE = ['United States holidays', 'Birthdays', 'Tasks', 'Reminders']

// code on the error: what the app can offer to fix (noIcalBuddy: install it; calendarAccess: allow
// Bridge AI in System Settings › Privacy & Security › Calendars).
const fail = (message, code) => Object.assign(new Error(message), code ? { code } : {})
async function run(args) {
  if (process.platform !== 'darwin') throw fail('The calendar reads macOS Calendar. It isn\'t available on this platform yet.')
  // Found where Homebrew puts it too: opened at login, the app's own PATH has no Homebrew folders.
  const bin = await tool('icalBuddy')
  if (!bin) throw fail('The calendar needs icalBuddy, a small free tool from Homebrew.', 'noIcalBuddy')
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 20000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } }, (err, out, errOut) => {
      // macOS hasn't let it see your calendars (you said no, or turned it off).
      if (/^\s*error: No calendars/im.test(`${out}\n${errOut}`)) return reject(fail('Bridge AI isn\'t allowed to see your calendars yet.', 'calendarAccess'))
      if (err?.code === 'ENOENT') return reject(fail('The calendar needs icalBuddy, a small free tool from Homebrew.', 'noIcalBuddy'))
      if (err) return reject(new Error((errOut || err.message).trim().split('\n')[0] || 'icalBuddy failed'))
      resolve(out)
    })
  })
}

const at = (date, time) => {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = (time || '00:00').split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm)
}

// "2026-10-06 at 09:00 - 09:30" | "2026-10-06 at 22:00 - 2026-10-07 at 01:00" | "2026-10-06" | "2026-10-06 - 2026-10-08"
function parseWhen(s) {
  s = s.trim()
  let m = /^(\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2}) - (?:(\d{4}-\d{2}-\d{2}) at )?(\d{2}:\d{2})$/.exec(s)
  if (m) return { start: at(m[1], m[2]), end: at(m[3] || m[1], m[4]), allDay: false }
  m = /^(\d{4}-\d{2}-\d{2})(?: - (\d{4}-\d{2}-\d{2}))?$/.exec(s)
  if (m) { const end = at(m[2] || m[1]); end.setDate(end.getDate() + 1); return { start: at(m[1]), end, allDay: true } }
  return null
}

function joinLink(text) {
  const m = /(https:\/\/teams\.microsoft\.com\/(?:l\/meetup-join|meet)\/[^\s<>"]+)|(https:\/\/[\w.-]*zoom\.us\/j\/[^\s<>"]+)|(https:\/\/meet\.google\.com\/[\w-]+)/.exec(text || '')
  return m ? m[0] : null
}

// Documents linked in the invite (a deck on SharePoint, a Google Doc, a PDF), for the meeting's
// notes: not the join link, the dial-in or the call app's help pages. Outlook's safe links are
// unwrapped to where they go.
const NOT_DOCS = /(^|\.)(teams\.microsoft\.com|zoom\.us|meet\.google\.com|webex\.com|aka\.ms|go\.microsoft\.com|support\.(google|microsoft|zoom)\.\w+|dialin\.teams\.microsoft\.com|teams\.live\.com|calendar\.google\.com|outlook\.office(365)?\.com)$/i
const DOCS = /(^|\.)(sharepoint\.com|onedrive\.live\.com|1drv\.ms|docs\.google\.com|drive\.google\.com|dropbox\.com|box\.com|figma\.com|notion\.so|atlassian\.net|miro\.com|loom\.com|canva\.com|airtable\.com|quip\.com)$/i
const SP = { p: 'PowerPoint', w: 'Word document', x: 'Excel workbook', b: 'PDF', f: 'Folder', o: 'OneNote', v: 'Video' }
const GOOGLE = { document: 'Google Doc', presentation: 'Google Slides', spreadsheets: 'Google Sheet', forms: 'Google Form' }
function docName(u) {
  const h = u.hostname.replace(/^www\./, '')
  const sp = /^\/:(\w):\//.exec(u.pathname)
  if (/sharepoint\.com$/.test(h)) return `${SP[sp?.[1]] || 'File'} on ${/-my\.sharepoint/.test(h) ? 'OneDrive' : 'SharePoint'}`
  if (/onedrive|1drv/.test(h)) return 'File on OneDrive'
  if (h === 'docs.google.com') return GOOGLE[u.pathname.split('/')[1]] || 'Google Doc'
  if (h === 'drive.google.com') return 'File on Google Drive'
  if (/atlassian\.net$/.test(h)) return u.pathname.startsWith('/wiki') ? 'Confluence page' : 'Jira'
  const brand = { 'figma.com': 'Figma file', 'notion.so': 'Notion page', 'miro.com': 'Miro board', 'loom.com': 'Loom video', 'dropbox.com': 'File on Dropbox', 'box.com': 'File on Box', 'canva.com': 'Canva design', 'airtable.com': 'Airtable', 'quip.com': 'Quip document' }
  return brand[Object.keys(brand).find((k) => h === k || h.endsWith(`.${k}`))] || h
}
export function docLinks(...texts) {
  const out = []
  for (const raw of texts.join('\n').match(/https?:\/\/[^\s<>"'\])]+/g) || []) {
    let url = raw.replace(/[.,;:!?]+$/, '')
    try {
      let u = new URL(url)
      if (/safelinks\.protection\.outlook\.com$/i.test(u.hostname) && u.searchParams.get('url')) { url = u.searchParams.get('url'); u = new URL(url) }
      if (NOT_DOCS.test(u.hostname)) continue
      const file = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')
      const isFile = /\.(pdf|pptx?|docx?|xlsx?|key|numbers|pages|csv|md|txt)$/i.test(file)
      if (!DOCS.test(u.hostname) && !isFile) continue
      if (out.some((x) => x.url === url)) continue
      out.push({ url, name: isFile ? file : docName(u) })
    } catch { /* not a link */ }
    if (out.length >= 8) break
  }
  return out
}

// Cut to n characters at a whole word, with "…" (never mid-word), when it's longer.
export const whole = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  const c = t.slice(0, n)
  return `${(c.slice(0, c.lastIndexOf(' ')) || c).replace(/[\s,;:.·-]+$/, '')}…`
}
function agendaOf(notes) {
  const before = (notes || '').split(/_{8,}|Microsoft Teams|Join Zoom|Join with Google Meet/)[0]
  const lines = before.split('\n').map((l) => l.replace(/^\s*[*•-]\s*/, '').trim()).filter((l) => l && !/^https?:/.test(l))
  // Exchange often stores curly apostrophes as "???" (I???d); show them as apostrophes.
  const text = lines.join(' · ').replace(/(\w)\?{3}(\w)/g, "$1'$2").replace(/\s+/g, ' ').trim()
  return text ? whole(text, 220) : null
}
// Outlook's safe link, as where it goes.
const unwrap = (url) => {
  try { const u = new URL(url); return /safelinks\.protection\.outlook\.com$/i.test(u.hostname) && u.searchParams.get('url') ? u.searchParams.get('url') : url } catch { return url }
}
// The invite's own words, whole, for the event's panel: its lines as written (blank ones kept to
// one), with Outlook's safe links as where they go and Exchange's "???" as apostrophes. Up to the
// call app's part (Teams' or Zoom's join details, passcodes and dial-ins, which Join stands for), as
// the agenda is, and Google Meet's and Webex's; that part starts with a line of its own, so an
// invite that only names Teams keeps its words. 6,000 characters at most, ended at a word.
const CALL_PART = /_{8,}|-::~:~::~|-- Do not delete or change any of the following text\. --|^[ \t]*(?:Microsoft Teams meeting|Microsoft Teams Need help\?|Join Zoom Meeting|Join with Google Meet|Join on your computer, mobile app or room device)/im
function inviteOf(notes) {
  let text = String(notes || '').replace(/\r\n?/g, '\n').split(CALL_PART)[0]
    .replace(/https?:\/\/[^\s<>"']+/g, unwrap)
    .replace(/(\w)\?{3}(\w)/g, "$1'$2")
    .split('\n').map((l) => l.replace(/\s+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim()
  if (text.length > 6000) { const c = text.slice(0, 6000); text = `${(c.slice(0, c.search(/\s\S*$/)) || c).trimEnd()}…` }
  return text || null
}

// Who's invited, as the event's panel and the floating card show them: each one's name, address,
// reply (accepted, declined, tentative, pending; null when it isn't known), role (required,
// optional, chair; null), whether they organised it and whether it's you, the organizer first.
// bridgecal says all of that (given: its guests); icalBuddy, and a bridgecal from before it did,
// only who's on the invite (names: a name, or an address when that's all there is; addresses: the
// same people's, when there's one each), so no one's reply is known. People only, as attendees:
// told while their address is whole. The organizer is one of them even when the invite doesn't list
// them.
const REPLIES = new Set(['accepted', 'declined', 'tentative', 'pending'])
const ROLES = new Set(['required', 'optional', 'chair'])
const ADDRESS = /^[^\s@]+@[^\s@]+$/
const line = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
function guestsOf(given, names, addresses, organizer) {
  const list = Array.isArray(given)
    ? given.filter((g) => g && typeof g === 'object').map((g) => ({ name: line(g.name, 120), email: line(g.email, 200).toLowerCase(), status: REPLIES.has(g.status) ? g.status : null, role: ROLES.has(g.role) ? g.role : null, organizer: g.organizer === true, you: g.you === true }))
    : names.map((a, i) => {
      const s = line(a, 200)
      const email = ADDRESS.test(s) ? s.toLowerCase() : names.length === addresses.length ? line(addresses[i], 200).toLowerCase() : ''
      return { name: ADDRESS.test(s) ? '' : s.slice(0, 120), email, status: null, role: null, organizer: false, you: false }
    })
  const out = list.map((g) => ({ ...g, email: ADDRESS.test(g.email) ? g.email : null, name: g.name && !ADDRESS.test(g.name) ? g.name : null }))
    .filter((g) => (g.name || g.email) && !notPerson(g.name && g.email ? `${g.name} <${g.email}>` : g.name || g.email))
  // icalBuddy's organizer and an older bridgecal's: by name, among them or added.
  if (!Array.isArray(given) && organizer) {
    const o = out.find((g) => g.name === organizer || g.email === organizer.toLowerCase())
    if (o) o.organizer = true
    else if (!notPerson(organizer)) out.unshift({ name: ADDRESS.test(organizer) ? null : organizer, email: ADDRESS.test(organizer) ? organizer.toLowerCase() : null, status: null, role: null, organizer: true, you: false })
  }
  return [...out.filter((g) => g.organizer), ...out.filter((g) => !g.organizer)]
}
// How many of them each event carries: everyone on a big invite is counted, and the first 150 shown.
const GUESTS_MAX = 150

export function parse(out) {
  const events = []
  for (const chunk of out.split(SEP_EV).slice(1)) {
    const parts = chunk.split(SEP_PROP)
    const head = parts.shift().trim()
    const cal = /\(([^()]*)\)\s*$/.exec(head)
    const title = (cal ? head.slice(0, cal.index) : head).trim()
    const props = {}
    for (const p of parts) {
      const m = /^(\w+): ([\s\S]*)$/.exec(p.trim())
      if (m) props[m[1]] = m[2].trim()
      else if (!props.when) props.when = p.trim()
    }
    const when = parseWhen(props.when || '')
    if (!when) continue
    const attendees = (props.attendees || '').split(',').map((s) => s.trim()).filter(Boolean)
    events.push(eventOf({ title, calendar: cal ? cal[1] : null, ...when, location: props.location, url: props.url, notes: props.notes, attendees }))
  }
  return events.sort(byStart)
}

// Your answer to an invite, as bridgecal reads it (icalBuddy can't): accepted, tentative,
// declined, none (not answered yet), organizer (yours), or null (no one invited).
const ANSWERS = new Set(['accepted', 'tentative', 'declined', 'none', 'organizer'])
const HEX = /^#[0-9a-f]{6}$/i

// One event as the app shows it, from what bridgecal or icalBuddy said about it. start, end: Dates.
// Its people only: a room, a shared calendar, a list or a mailbox like schedule@ invited with them
// isn't someone at it (told while its address is still whole). id: the title and start, as before
// (callevent.js and meetings keep it); uid: the event's own lasting id with its start, when the
// calendar has one, so a renamed event is still itself. local: this Mac's id for it in its calendar
// store, and repeats: whether it's one of a series, which Open in Calendar finds it by (bridgecal's;
// none from icalBuddy, so no Open in Calendar). attendees: the names of who's on the invite, and of
// who organised it when that's someone else not on it (for Prep, a meeting's people and Meeting
// Insights, which go by name); guests: all of them as the panel shows them (guestsOf), you too.
function eventOf({ title, calendar, start, end, allDay, location, url, notes, attendees: all = [], emails = [], guests: given, canceled = false, color, uid, local, repeats, response, organizer }) {
  const listed = all.map(String).filter((a) => !notPerson(a))
  const attendees = organizer && !listed.some((a) => a.toLowerCase() === organizer.toLowerCase()) && !notPerson(organizer) ? [organizer, ...listed] : listed
  const guests = guestsOf(given, all.map(String), emails, organizer)
  return {
    id: `${title}|${start.toISOString()}`,
    uid: uid ? `${uid}|${start.toISOString()}` : null,
    local: typeof local === 'string' && local && local.length <= 255 ? local : null,
    repeats: repeats === true,
    color: HEX.test(color || '') ? color.toLowerCase() : null,
    response: ANSWERS.has(response) ? response : null,
    organizer: organizer ? (organizer.includes('@') ? organizer.split('@')[0] : organizer) : null,
    title: title || '(no title)',
    canceled: canceled || /^cancell?ed:/i.test(title),
    calendar: calendar || null,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay,
    location: location && !/^Microsoft Teams Meeting$/i.test(location) ? location : null,
    online: /teams|zoom|meet/i.test(`${location || ''} ${url || ''} ${notes || ''}`),
    join: joinLink(url) || joinLink(notes),
    attendees: attendees.slice(0, 50).map((a) => (a.includes('@') ? a.split('@')[0] : a)),
    attendeeCount: attendees.length,
    guests: guests.slice(0, GUESTS_MAX),
    guestCount: guests.length,
    // Whether the calendar said who's replied (bridgecal), or only who's invited (icalBuddy).
    replies: Array.isArray(given),
    // Their addresses, for AI Assist's prep to find your mail with them and the people you've met.
    emails: emails.filter((x) => /^[^\s@]+@[^\s@]+$/.test(x) && !notPerson(x)).slice(0, 50).map((x) => x.toLowerCase()),
    agenda: agendaOf(notes),
    description: inviteOf(notes),
    links: docLinks(url, notes),
  }
}
const byStart = (a, b) => (a.start < b.start ? -1 : 1)

// macOS's calendar store through Bridge AI's own helper (native/bridgecal.swift): what Allow access
// let Bridge AI see. from, to: days, both in. light: no notes, link or attendees (the year view).
// null from a bridgecal built before it could read (it only asks, and answers "granted").
function readNative(bin, from, to, light, exclude) {
  return new Promise((resolve, reject) => {
    execFile(bin, ['events', from, to, light ? 'light' : 'full', ...exclude], { timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (err, out, errOut) => {
      const said = String(out || '').trim()
      if (said === 'granted') return resolve(null)
      if (/^(denied|restricted|unknown)$/.test(said)) return reject(fail('Bridge AI isn\'t allowed to see your calendars yet.', 'calendarAccess'))
      if (err) return reject(new Error(String(errOut || err.message).trim().split('\n')[0] || 'Reading the calendar failed'))
      try { resolve(JSON.parse(said).map((e) => eventOf({ ...e, start: new Date(e.start), end: new Date(e.end) })).sort(byStart)) } catch { reject(new Error('Reading the calendar failed')) }
    })
  })
}
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const FULL = ['-iep', 'title,datetime,location,attendees,url,notes', '-po', 'title,datetime,location,url,attendees,notes']
const LIGHT = ['-iep', 'title,datetime,location', '-po', 'title,datetime,location']
const BASE = ['--strEncoding', 'Unicode (UTF-8)', '-b', SEP_EV, '-ps', `|${SEP_PROP}|`, '-nrd', '-df', '%Y-%m-%d', '-tf', '%H:%M']
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function makeCalendar(cfg) {
  let cache = null
  let at0 = 0
  const ranges = new Map() // "from|to" -> { at, value }
  const exclude = cfg.calendar?.exclude || DEFAULT_EXCLUDE
  // The days asked for: through bridgecal when it's here and can read, else icalBuddy, given the
  // same days in its own words.
  const read = async (from, to, light, icalDays) => {
    const cal = calBin()
    const got = cal && await readNative(cal, from, to, light, exclude)
    return got || parse(await run([...BASE, ...(light ? LIGHT : FULL), '-ec', exclude.join(','), ...icalDays]))
  }
  const get = async (force = false) => {
    if (!force && cache && Date.now() - at0 < 3 * 60 * 1000) return cache
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
    const events = await read(ymd(today), ymd(tomorrow), false, ['eventsToday+1'])
    const dayOf = (e) => (new Date(e.start) < tomorrow ? 'today' : 'tomorrow')
    cache = {
      today: events.filter((e) => dayOf(e) === 'today' && new Date(e.end) > today),
      tomorrow: events.filter((e) => dayOf(e) === 'tomorrow'),
      fetchedAt: new Date().toISOString(),
    }
    at0 = Date.now()
    return cache
  }
  // Today's and tomorrow's as last read for the app, or null: no read of its own, so what looks in
  // the background (AI Assist's prep) never waits on the calendar or asks macOS for it.
  get.cached = () => cache
  // Any span up to a year, for the week, month and year views. Long spans skip notes and
  // attendees (the year view only needs titles and times).
  get.range = async (from, to, force = false) => {
    if (!ISO_DAY.test(from || '') || !ISO_DAY.test(to || '')) throw new Error('from and to must be YYYY-MM-DD')
    const days = (new Date(to) - new Date(from)) / 864e5
    if (days < 0 || days > 400) throw new Error('Range must be 0 to 400 days')
    const key = `${from}|${to}`
    const hit = ranges.get(key)
    if (!force && hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.value
    const events = await read(from, to, days > 62, [`eventsFrom:${from}`, `to:${to}`])
    const value = { from, to, events, light: days > 62, fetchedAt: new Date().toISOString() }
    ranges.set(key, { at: Date.now(), value })
    if (ranges.size > 20) ranges.delete(ranges.keys().next().value)
    return value
  }
  return get
}

// How the calendar is shown, the same on each of your devices (config.json's calendar): the day the
// week starts on (0 Sunday, 1 Monday, 6 Saturday; null: what the browser's language says), your
// working hours (what the day and week grids show at least, the rest shaded), the calendars hidden
// from view (still read, so the legend can bring them back) and whether Chief of Staff's tasks with
// a day are on the grid. Only what Bridge AI shows: nothing here changes a calendar.
const hour = (v, d) => (Number.isInteger(v) && v >= 0 && v <= 24 ? v : d)
export function viewOf(cfg) {
  const c = cfg.calendar || {}
  const workStart = Math.min(23, hour(c.workStart, 9))
  const end = hour(c.workEnd, 17)
  return {
    weekStart: [0, 1, 6].includes(c.weekStart) ? c.weekStart : null,
    workStart, workEnd: end > workStart ? end : Math.min(24, workStart + 8),
    hidden: Array.isArray(c.hidden) ? c.hidden.filter((x) => typeof x === 'string').slice(0, 60) : [],
    tasks: c.tasks !== false,
  }
}
// A change from the calendar's own controls, checked, as settings.patch takes it (which keeps the
// rest of calendar, such as exclude).
export function viewPatch(body = {}, cfg = {}) {
  const now = viewOf(cfg)
  const out = {}
  if ('weekStart' in body) {
    if (body.weekStart !== null && ![0, 1, 6].includes(body.weekStart)) throw new Error('The week starts on a Sunday, a Monday or a Saturday')
    out.weekStart = body.weekStart
  }
  if ('workStart' in body || 'workEnd' in body) {
    const s = 'workStart' in body ? body.workStart : now.workStart
    const e = 'workEnd' in body ? body.workEnd : now.workEnd
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 24 || e <= s) throw new Error('Working hours end after they start, within the day')
    Object.assign(out, { workStart: s, workEnd: e })
  }
  if ('hidden' in body) {
    if (!Array.isArray(body.hidden)) throw new Error('Say which calendars to hide')
    out.hidden = [...new Set(body.hidden.map((x) => String(x).slice(0, 120)).filter(Boolean))].slice(0, 60)
  }
  if ('tasks' in body) out.tasks = !!body.tasks
  if (!Object.keys(out).length) throw new Error('Nothing to change')
  return { calendar: out }
}
