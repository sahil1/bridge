// Today's calendar, read locally from macOS Calendar via icalBuddy. The Exchange
// account is already synced there, so there's no sign-in and nothing leaves the Mac.
// Meeting notes carry Teams passcodes and organizer links; only the join link and the
// short agenda above the Teams boilerplate are kept.
import { execFile } from 'node:child_process'

const SEP_EV = '@@EV@@'
const SEP_PROP = '¦' // ¦
const DEFAULT_EXCLUDE = ['United States holidays', 'Birthdays', 'Tasks', 'Reminders']

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('icalBuddy', args, { timeout: 20000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } }, (err, out, errOut) => {
      if (err?.code === 'ENOENT') return reject(new Error(process.platform === 'darwin' ? 'Install icalBuddy to see your calendar: brew install ical-buddy' : 'The calendar reads macOS Calendar. It isn\'t available on this platform yet.'))
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
    events.push({
      id: `${title}|${when.start.toISOString()}`,
      title: title || '(no title)',
      canceled: /^cancell?ed:/i.test(title),
      calendar: cal ? cal[1] : null,
      start: when.start.toISOString(),
      end: when.end.toISOString(),
      allDay: when.allDay,
      location: props.location && !/^Microsoft Teams Meeting$/i.test(props.location) ? props.location : null,
      online: /teams|zoom|meet/i.test(`${props.location || ''} ${props.url || ''} ${props.notes || ''}`),
      join: joinLink(props.url) || joinLink(props.notes),
      attendees: attendees.slice(0, 12).map((a) => (a.includes('@') ? a.split('@')[0] : a)),
      attendeeCount: attendees.length,
      agenda: agendaOf(props.notes),
    })
  }
  return events.sort((a, b) => (a.start < b.start ? -1 : 1))
}

const FULL = ['-iep', 'title,datetime,location,attendees,url,notes', '-po', 'title,datetime,location,url,attendees,notes']
const LIGHT = ['-iep', 'title,datetime,location', '-po', 'title,datetime,location']
const BASE = ['--strEncoding', 'Unicode (UTF-8)', '-b', SEP_EV, '-ps', `|${SEP_PROP}|`, '-nrd', '-df', '%Y-%m-%d', '-tf', '%H:%M']
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function makeCalendar(cfg) {
  let cache = null
  let at0 = 0
  const ranges = new Map() // "from|to" -> { at, value }
  const exclude = cfg.calendar?.exclude || DEFAULT_EXCLUDE
  const get = async (force = false) => {
    if (!force && cache && Date.now() - at0 < 3 * 60 * 1000) return cache
    const out = await run([...BASE, ...FULL, '-ec', exclude.join(','), 'eventsToday+1'])
    const events = parse(out)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
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
    const out = await run([...BASE, ...(days > 62 ? LIGHT : FULL), '-ec', exclude.join(','), `eventsFrom:${from}`, `to:${to}`])
    const value = { from, to, events: parse(out), light: days > 62, fetchedAt: new Date().toISOString() }
    ranges.set(key, { at: Date.now(), value })
    if (ranges.size > 20) ranges.delete(ranges.keys().next().value)
    return value
  }
  return get
}
