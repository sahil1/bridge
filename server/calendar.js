// Today's calendar, read locally from macOS Calendar: through Bridge AI's own helper
// (native/bridgecal.swift), or icalBuddy on a Mac without it. The Exchange account is
// already synced there, so there's no sign-in and nothing leaves the Mac.
// Meeting notes carry Teams passcodes and organizer links; only the join link and the
// short agenda above the Teams boilerplate are kept.
import { execFile } from 'node:child_process'
import { tool, calBin } from './fixes.js'

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

function agendaOf(notes) {
  const before = (notes || '').split(/_{8,}|Microsoft Teams|Join Zoom|Join with Google Meet/)[0]
  const lines = before.split('\n').map((l) => l.replace(/^\s*[*•-]\s*/, '').trim()).filter((l) => l && !/^https?:/.test(l))
  // Exchange often stores curly apostrophes as "???" (I???d); show them as apostrophes.
  const text = lines.join(' · ').replace(/(\w)\?{3}(\w)/g, "$1'$2").replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, 220) : null
}

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

// One event as the app shows it, from what bridgecal or icalBuddy said about it. start, end: Dates.
function eventOf({ title, calendar, start, end, allDay, location, url, notes, attendees = [], canceled = false }) {
  return {
    id: `${title}|${start.toISOString()}`,
    title: title || '(no title)',
    canceled: canceled || /^cancell?ed:/i.test(title),
    calendar: calendar || null,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay,
    location: location && !/^Microsoft Teams Meeting$/i.test(location) ? location : null,
    online: /teams|zoom|meet/i.test(`${location || ''} ${url || ''} ${notes || ''}`),
    join: joinLink(url) || joinLink(notes),
    attendees: attendees.slice(0, 12).map((a) => (a.includes('@') ? a.split('@')[0] : a)),
    attendeeCount: attendees.length,
    agenda: agendaOf(notes),
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
