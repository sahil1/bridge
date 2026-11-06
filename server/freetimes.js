// Scheduling Assist: when an email asks to meet ("when are you free", "can we find a time"), a few
// free times from your calendar, read only. Within your working hours (Settings › Mail), clear of
// your meetings by a buffer (more for one somewhere you'd travel to), as long as the email asks
// for, and inside the other side's working day too when their time zone is known (their email's
// Date header, or a zone they name). Nothing is held or written to the calendar.

// Asked to meet, in the words people use (English for now; Find times is always there by hand).
const ASKS = /\b(when (?:are|would|will) you (?:be )?(?:free|available|around)|(?:can|could|shall|should|would) we (?:find|set up|schedule|book|grab|get|have|hop on|jump on|meet|chat|talk|sync)\b[^.?!\n]{0,40}?\b(?:time|call|meeting|chat|slot|catch.?up|minutes)|find (?:a|some) time|(?:what|which) (?:times?|days?|slots?) (?:work|suit|are good|would work)|your availability|are you (?:free|available)\b|(?:free|available) (?:for|to) (?:a |an )?(?:quick |short )?(?:call|chat|meet|talk|sync)|set up (?:a |an )?(?:quick |short )?(?:call|meeting|time|chat)|schedule (?:a |an )?(?:quick |short )?(?:call|meeting|time|chat)|(?:let me know|send (?:me|over)) (?:a few |some )?(?:times|slots)|book (?:a |an )?(?:call|meeting|time|slot))/i
export const asksToMeet = (text) => ASKS.test(String(text || ''))

// How long they ask for, in minutes: "30 minutes", "a 45-min call", "half an hour", "an hour".
export function minutesAsked(text) {
  const s = String(text || '').toLowerCase()
  let m = /\b(\d{1,3})\s*-?\s*(?:min|mins|minutes?)\b/.exec(s)
  if (m) return Math.min(240, Math.max(10, Number(m[1])))
  if (/\bhalf (?:an )?hour\b/.test(s)) return 30
  if (/\b(?:quarter of an hour)\b/.test(s)) return 15
  m = /\b(\d(?:\.\d)?)\s*-?\s*(?:hours?|hrs?)\b/.exec(s)
  if (m) return Math.min(240, Math.max(10, Math.round(Number(m[1]) * 60)))
  if (/\b(?:an|one) hour\b/.test(s)) return 60
  return null
}

// Time zones by the letters people write, as hours from UTC. ET, CT, MT and PT follow the US's
// daylight saving time for the day in question.
const FIXED = { UTC: 0, GMT: 0, BST: 60, CET: 60, CEST: 120, EET: 120, EEST: 180, IST: 330, SGT: 480, HKT: 480, JST: 540, KST: 540, AEST: 600, AEDT: 660, NZST: 720, NZDT: 780, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 }
const US = { ET: -300, CT: -360, MT: -420, PT: -480 }
// The US's daylight saving time: from the second Sunday in March to the first Sunday in November.
function usSummer(at) {
  const y = at.getUTCFullYear()
  const sunday = (month, nth) => { const d = new Date(Date.UTC(y, month, 1)); return Date.UTC(y, month, 1 + ((7 - d.getUTCDay()) % 7) + (nth - 1) * 7, 10) }
  return +at >= sunday(2, 2) && +at < sunday(10, 1)
}
const ZONE_WORD = new RegExp(`(?:\\d{1,2}(?::\\d{2})?\\s?(?:am|pm)?\\s|\\b(?:i'?m|i am|we'?re|we are|based|my time is|in|on)\\s+)\\(?(${[...Object.keys(FIXED), ...Object.keys(US)].join('|')})\\)?\\b`)

// Their time zone, as minutes from UTC and how to say it: a zone they name in the email first,
// then the offset their mail app put in its Date header. null when neither says.
export function theirZone({ text, date, at = new Date() } = {}) {
  const named = ZONE_WORD.exec(String(text || '').replace(/\n/g, ' '))
  if (named) {
    const z = named[1]
    if (z in US) return { offset: US[z] + (usSummer(at) ? 60 : 0), name: z }
    return { offset: FIXED[z], name: z }
  }
  const m = /([+-])(\d{2}):?(\d{2})\s*(?:\([^)]*\))?\s*$/.exec(String(date || '').trim())
  if (m) return { offset: (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])), name: null }
  return null
}
export const utcName = (offset) => `UTC${offset < 0 ? '−' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`

// ---------- Wall clocks in a time zone ----------
const parts = (zone, at) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }).formatToParts(at).map((x) => [x.type, x.value]))
  return { y: Number(p.year), mo: Number(p.month) - 1, d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second), wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) }
}
// Minutes the zone is ahead of UTC at that moment.
export const offsetIn = (zone, at) => { const p = parts(zone, at); return Math.round((Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s) - Math.floor(+at / 1000) * 1000) / 60000) }
// The moment it's h:mi on that day in the zone.
function wall(zone, y, mo, d, h, mi) {
  let t = Date.UTC(y, mo, d, h, mi)
  for (let i = 0; i < 3; i++) t = Date.UTC(y, mo, d, h, mi) - offsetIn(zone, new Date(t)) * 60000
  return t
}
const hm = (s, d) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : d }

export const SCHEDULE = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', buffer: 15, travel: 30, count: 3 }
export function scheduleOf(cfg) {
  const s = { ...SCHEDULE, ...(cfg?.mail?.schedule || {}) }
  const days = (Array.isArray(s.days) ? s.days : SCHEDULE.days).map(Number).filter((d) => d >= 0 && d <= 6)
  const start = hm(s.start, 540), end = hm(s.end, 1020)
  return {
    days: days.length ? [...new Set(days)].sort() : SCHEDULE.days, start: end > start ? start : 540, end: end > start ? end : 1020,
    buffer: Math.min(120, Math.max(0, Number(s.buffer) || 0)), travel: Math.min(180, Math.max(0, Number(s.travel) || 0)),
    count: Math.min(5, Math.max(3, Number(s.count) || 3)),
  }
}
// A whole day you're away: an all-day event that says so.
const AWAY = /\b(out of (?:the )?office|ooo|vacation|holiday|annual leave|leave|pto|day off|off work|travel(?:l?ing)?|sick)\b/i
// Somewhere you'd go to: a place that isn't a link or a call.
const elsewhere = (e) => !!e.location && !e.online && !/^https?:|teams|zoom|meet\.google|webex|call|phone|online/i.test(e.location)

// The free times: [{ start, end }] (ISO), at most count, spread over the days, the earliest first.
// events: the calendar's (calendar.js), zone: yours (IANA), theirs: { offset } or null, minutes:
// how long. Their working day is 9 to 6 their time. Said when theirs and yours don't overlap
// (then only yours count) and when there's nothing free in the two weeks looked at.
export function freeTimes({ events = [], now = new Date(), zone, schedule = SCHEDULE, minutes = 30, theirs = null, days = 14, count } = {}) {
  const s = schedule.start != null && typeof schedule.start === 'number' ? schedule : scheduleOf({ mail: { schedule } })
  const len = Math.min(240, Math.max(10, Number(minutes) || 30)) * 60000
  const want = count || s.count
  const busy = []
  for (const e of events) {
    if (e.canceled) continue
    const a = Date.parse(e.start), b = Date.parse(e.end)
    if (!(b > a)) continue
    if (e.allDay) { if (AWAY.test(e.title || '')) busy.push([a, b]); continue }
    const pad = (elsewhere(e) ? Math.max(s.buffer, s.travel) : s.buffer) * 60000
    busy.push([a - pad, b + pad])
  }
  const free = (a, b) => !busy.some(([x, y]) => a < y && b > x)
  // Not in the next hour, and on the hour or half hour.
  const from = Math.ceil((+now + 60 * 60000) / (30 * 60000)) * 30 * 60000
  const byDay = []
  let both = false
  const look = (useTheirs) => {
    const out = []
    const start = parts(zone, now)
    for (let i = 0; i < days; i++) {
      const p = parts(zone, new Date(wall(zone, start.y, start.mo, start.d + i, 12, 0)))
      if (!s.days.includes(p.wd)) continue
      let a = wall(zone, p.y, p.mo, p.d, Math.floor(s.start / 60), s.start % 60)
      let b = wall(zone, p.y, p.mo, p.d, Math.floor(s.end / 60), s.end % 60)
      if (useTheirs) {
        // Their 9 to 6, on the same day as yours (or the days either side, across the date line).
        const t = theirs.offset * 60000
        const mid = (a + b) / 2 + t
        const day = new Date(mid)
        const ta = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 9) - t
        const wd = new Date(ta + t).getUTCDay()
        if (wd === 0 || wd === 6) continue
        a = Math.max(a, ta); b = Math.min(b, ta + 9 * 3600e3)
      }
      a = Math.max(a, from)
      const slots = []
      for (let x = Math.ceil(a / (30 * 60000)) * 30 * 60000; x + len <= b; x += 30 * 60000) if (free(x, x + len)) slots.push(x)
      if (slots.length) out.push(slots)
    }
    return out
  }
  if (theirs && Number.isFinite(theirs.offset)) {
    const shared = look(true)
    if (shared.length) { byDay.push(...shared); both = true }
  }
  if (!byDay.length) byDay.push(...look(false))
  // One a day first, the first free time of each; then a second that day, from the afternoon.
  const picked = []
  for (const slots of byDay) { if (picked.length >= want) break; picked.push(slots[0]) }
  for (const slots of byDay) {
    if (picked.length >= want) break
    const later = slots.find((x) => x >= slots[0] + 3 * 3600e3) ?? slots.find((x) => x >= slots[0] + len + 30 * 60000)
    if (later != null) picked.push(later)
  }
  picked.sort((x, y) => x - y)
  return {
    slots: picked.map((x) => ({ start: new Date(x).toISOString(), end: new Date(x + len).toISOString() })),
    minutes: len / 60000,
    both: theirs ? both : null,
    days,
  }
}
