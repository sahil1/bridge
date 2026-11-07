// A routine's schedule (Routines, with Scheduled Routines on): said in plain words ("every weekday
// at 9", "mondays and thursdays at 2pm", "every month on day 1 at 8"), read into a schedule, said
// back the same way, and its next runs worked out in the computer's own time. Shared by the server,
// which runs routines (server/routines.js), and the page, which shows what a schedule means while
// you type it. Pure, so the tests can ask about any moment.
//
// A schedule: { every, at, days, date }
//   every: 'day' | 'weekday' | 'week' | 'month' | '<n>d' | '<n>w', as routines have always had it
//   at:    'HH:MM', 24-hour, the computer's own time
//   days:  for a week or n weeks, the weekdays it's on (0 Sunday … 6 Saturday)
//   date:  for a month, the day of the month, -1 for its last day (a 31st in a shorter month is its last day)
// Every n days or n weeks counts from since, the day the schedule was set.

const DAY = 864e5
const WEEKDAYS = { sun: 0, sunday: 0, sundays: 0, mon: 1, monday: 1, mondays: 1, tue: 2, tues: 2, tuesday: 2, tuesdays: 2, wed: 3, weds: 3, wednesday: 3, wednesdays: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4, fri: 5, friday: 5, fridays: 5, sat: 6, saturday: 6, saturdays: 6 }
const NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
// Words that say nothing on their own, left over once the rest is read.
const FILLER = new Set(['every', 'each', 'on', 'the', 'at', 'and', 'in', 'of', 'a', 'an', 'repeat', 'repeats', 'run', 'it', 'please', 'from', 'to', 'day', 'days', 'week', 'weeks', 'month', 'months', 'once', 'o\'clock', 'oclock', 'morning', 'mornings', 'afternoon', 'afternoons', 'evening', 'evenings', 'night', 'nights'])
export const EXAMPLE = 'every weekday at 9'

const pad = (n) => String(n).padStart(2, '0')
const hm = (at) => { const m = /^(\d\d):(\d\d)$/.exec(at || ''); return m ? [Number(m[1]), Number(m[2])] : null }
// A day as a number that doesn't care about clock changes: its date on a calendar.
const dayNo = (d) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY)
const weekNo = (d) => Math.floor((dayNo(d) + 3) / 7) // weeks start on Monday (day 0 was a Thursday)
const lastOfMonth = (y, m) => new Date(y, m + 1, 0).getDate()
const sortDays = (days) => [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)) // Monday first

// The time in what's typed: "at 9", "9am", "9:30", "21.15", "noon"; else "morning" and the like.
function timeIn(s) {
  const word = { noon: '12:00', midday: '12:00', midnight: '00:00' }
  const pats = [
    /\bat\s+(noon|midday|midnight|\d{1,2}(?:[:.h]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)(?=\s|$)/,
    /(?:^|\s)(\d{1,2}[:.h]\d{2}\s*(?:am|pm|a\.m\.|p\.m\.)?|\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.)|noon|midday|midnight)(?=\s|$)/,
  ]
  for (const re of pats) {
    const m = re.exec(s)
    if (!m) continue
    const raw = m[1].replace(/\./g, (x, i, all) => (/\d/.test(all[i - 1] || '') && /\d/.test(all[i + 1] || '') ? ':' : '')).replace(/h(?=\d)/, ':').replace(/\s+/g, '')
    let at = word[raw] || null
    if (!at) {
      const t = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(raw)
      if (!t) return { error: `"${m[1].trim()}" isn't a time` }
      let h = Number(t[1])
      const min = Number(t[2] || 0)
      if (t[3]) { if (h < 1 || h > 12) return { error: `"${m[1].trim()}" isn't a time` }; h = (h % 12) + (t[3] === 'pm' ? 12 : 0) }
      if (h > 23 || min > 59) return { error: `"${m[1].trim()}" isn't a time` }
      at = `${pad(h)}:${pad(min)}`
    }
    return { at, rest: `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}` }
  }
  const part = /\b(mornings?|afternoons?|evenings?|nights?)\b/.exec(s)
  if (part) return { at: { m: '09:00', a: '14:00', e: '18:00', n: '21:00' }[part[1][0]], rest: s.replace(part[0], ' '), part: true }
  return { at: null, rest: s }
}

// What's typed, read: { when, assumed } or { error } saying what it couldn't follow. now: for the
// day a schedule that names none starts on (weekly: today's weekday; monthly: today's date).
export function parse(input, now = new Date()) {
  let s = ` ${String(input || '').toLowerCase().replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim()} `
  if (!s.trim()) return { error: `Say when it repeats, like ${EXAMPLE}` }
  if (/\b(hourly|every\s+(\d+\s+)?(hours?|minutes?|mins?))\b/.test(s)) return { error: 'A routine runs once a day at most. Say the days and a time, like every day at 9.' }
  const t = timeIn(s)
  if (t.error) return { error: t.error }
  s = ` ${t.rest} `
  let when = null
  const take = (re, fn) => { if (when) return; const m = re.exec(s); if (m) { when = fn(m); s = s.replace(m[0], ' ') } }
  const named = () => {
    const days = []
    s = s.replace(/\b[a-z]+\b/g, (w) => { if (w in WEEKDAYS) { days.push(WEEKDAYS[w]); return ' ' } return w })
    return sortDays(days)
  }
  // Every n days, every n (or other) weeks.
  take(/\bevery\s+(\d+|other)\s+days?\b/, (m) => { const n = m[1] === 'other' ? 2 : Number(m[1]); return { every: n === 1 ? 'day' : `${n}d` } })
  take(/\bevery\s+(\d+|other)\s+weeks?\b/, (m) => { const n = m[1] === 'other' ? 2 : Number(m[1]); return { every: n === 1 ? 'week' : `${n}w`, days: null } })
  take(/\b(fortnightly|biweekly|every\s+other(?=\s+(sun|mon|tue|wed|thu|fri|sat)))\b/, () => ({ every: '2w', days: null }))
  // Weekdays, the weekend.
  take(/\b(weekdays?|workdays?|work\s+days?|business\s+days?|(mon|monday)\s*(-|–|to|through|thru|till|until)\s*(fri|friday))\b/, () => ({ every: 'weekday' }))
  take(/\bweekends?\b/, () => ({ every: 'week', days: [6, 0] }))
  // A month: on day 15, the 1st, the last day.
  take(/\b(monthly|every\s+month|each\s+month|a\s+month|of\s+(the|every|each)\s+month)\b/, () => ({ every: 'month', date: null }))
  if (!when && /\b(\d{1,2})(st|nd|rd|th)\b|\blast\s+day\b/.test(s)) when = { every: 'month', date: null }
  if (when?.every === 'month') {
    const d = /\b(?:on\s+)?(?:day\s+(\d{1,2})|the\s+(\d{1,2})(?:st|nd|rd|th)?|(\d{1,2})(?:st|nd|rd|th))\b/.exec(s)
    const last = /\b(the\s+)?last\s+day\b/.exec(s)
    if (last) { when.date = -1; s = s.replace(last[0], ' ') } else if (d) {
      const n = Number(d[1] || d[2] || d[3])
      if (n < 1 || n > 31) return { error: `There's no day ${n} in a month` }
      when.date = n
      s = s.replace(d[0], ' ')
    } else when.date = now.getDate()
  }
  take(/\b(daily|every\s*day|each\s+day|every\s+(morning|afternoon|evening|night)|each\s+(morning|afternoon|evening|night))\b/, () => ({ every: 'day' }))
  if (!when && t.part && /\bevery\b|\beach\b/.test(s)) when = { every: 'day' }
  take(/\b(weekly|every\s+week|each\s+week|once\s+a\s+week)\b/, () => ({ every: 'week', days: null }))
  // Weekdays by name: alone, or for every n weeks.
  const days = named()
  if (days.length) {
    if (!when) when = { every: 'week', days }
    else if (when.every === 'week' || /^\d+w$/.test(when.every)) when.days = when.days?.length ? sortDays([...when.days, ...days]) : days
    else return { error: 'Say one way it repeats: weekdays, or the days by name' }
    if (when.every === 'week' && when.days.length === 7) when = { every: 'day' }
    else if (when.every === 'week' && when.days.length === 5 && [1, 2, 3, 4, 5].every((d) => when.days.includes(d))) when = { every: 'weekday' }
  }
  const left = s.split(/\s+/).filter((w) => /[a-z]/.test(w) && !FILLER.has(w))
  if (left.length) return { error: `Didn't follow "${left.join(' ')}". Try ${EXAMPLE}, mondays at 10, or every month on day 1 at 8.` }
  if (!when) return { error: t.at ? 'Say how often too, like every day at 9 or mondays at 10' : `Say when it repeats, like ${EXAMPLE}` }
  if ((when.every === 'week' || /^\d+w$/.test(when.every)) && !when.days?.length) when.days = [now.getDay()]
  if (/^\d+[dw]$/.test(when.every) && (parseInt(when.every, 10) < 2 || parseInt(when.every, 10) > (when.every.endsWith('d') ? 60 : 12))) return { error: when.every.endsWith('d') ? 'Every 2 to 60 days' : 'Every 2 to 12 weeks' }
  return { when: tidy({ ...when, at: t.at || '09:00' }), assumed: t.at ? null : 'time' }
}

// Only what this kind of schedule uses.
export function tidy(w) {
  const out = { every: w.every, at: hm(w.at) ? w.at : '09:00' }
  if (w.every === 'week' || /^\d+w$/.test(w.every)) out.days = sortDays((w.days || []).filter((d) => d >= 0 && d <= 6))
  if (w.every === 'month') out.date = w.date === -1 ? -1 : Math.max(1, Math.min(31, Number(w.date) || 1))
  return out
}

// Back into words that read the same way again (the picker writes these into the field).
export function toText(w) {
  const at = `at ${w.at}`
  const days = (w.days || []).map((d) => NAMES[d]).join(' and ')
  if (w.every === 'day') return `every day ${at}`
  if (w.every === 'weekday') return `every weekday ${at}`
  if (w.every === 'week') return `every ${days} ${at}`
  if (w.every === 'month') return `every month on ${w.date === -1 ? 'the last day' : `day ${w.date}`} ${at}`
  const n = parseInt(w.every, 10)
  return w.every.endsWith('w') ? `every ${n} weeks on ${days} ${at}` : `every ${n} days ${at}`
}

// What it means, as a sentence to translate: [words with {placeholders}, their values]. locale: for
// the days' names and the time (the system's own when not given).
export function describe(w, locale) {
  const [h, m] = hm(w.at) || [9, 0]
  const time = new Date(2000, 0, 3, h, m).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  const day = (d) => new Date(2000, 0, 2 + d).toLocaleDateString(locale, { weekday: 'long' }) // 2 Jan 2000 was a Sunday
  const list = (w.days || []).map(day)
  const days = typeof Intl.ListFormat === 'function' ? new Intl.ListFormat(locale, { type: 'conjunction' }).format(list) : list.join(', ')
  const n = parseInt(w.every, 10)
  if (w.every === 'day') return ['Every day at {time}', { time }]
  if (w.every === 'weekday') return ['Every weekday at {time}', { time }]
  if (w.every === 'week') return ['Every {days} at {time}', { days, time }]
  if (w.every === 'month') return w.date === -1 ? ['Every month on its last day at {time}', { time }] : ['Every month on day {date} at {time}', { date: w.date, time }]
  if (w.every.endsWith('w')) return ['Every {n} weeks on {days} at {time}', { n, days, time }]
  return ['Every {n} days at {time}', { n, time }]
}
// The same in English, filled in (for the server's own notes and notifications).
export const sentence = (w) => { const [s, v] = describe(w, 'en-US'); return s.replace(/\{(\w+)\}/g, (_, k) => v[k]) }

// Whether a routine runs on that day.
function onDay(w, d, since) {
  const dow = d.getDay()
  if (w.every === 'day') return true
  if (w.every === 'weekday') return dow >= 1 && dow <= 5
  if (w.every === 'week') return (w.days || []).includes(dow)
  if (w.every === 'month') { const last = lastOfMonth(d.getFullYear(), d.getMonth()); return d.getDate() === (w.date === -1 ? last : Math.min(w.date, last)) }
  const n = parseInt(w.every, 10)
  if (w.every.endsWith('w')) return (w.days || []).includes(dow) && (!since || (((weekNo(d) - anchor(w, since)) % n) + n) % n === 0)
  return !since || (((dayNo(d) - anchor(w, since)) % n) + n) % n === 0
}
const atOn = (w, d) => { const [h, m] = hm(w.at) || [9, 0]; return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m) }
// Every n days or weeks counts from its first run: the first of its days, at its time, once it was set.
function anchor(w, since) {
  const s = new Date(since)
  const weeks = w.every.endsWith('w')
  for (let i = 0; i < 7; i++) {
    const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i)
    if (weeks && !(w.days || []).includes(d.getDay())) continue
    if (atOn(w, d) >= s) return weeks ? weekNo(d) : dayNo(d)
  }
  return weeks ? weekNo(s) : dayNo(s)
}

// Its next n runs after from, as Dates.
export function next(w, { from = new Date(), since = null, n = 3 } = {}) {
  const out = []
  if (!w?.every || !hm(w.at)) return out
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let i = 0; i < 800 && out.length < n; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    if (!onDay(w, d, since)) continue
    const at = atOn(w, d)
    if (at > from && (!since || at >= new Date(since))) out.push(at)
  }
  return out
}

// The run that was due last, at or before now and not before since (when the schedule was set): a
// Date, or null when none has come yet.
export function lastDue(w, { now = new Date(), since = null } = {}) {
  if (!w?.every || !hm(w.at)) return null
  const floor = since ? new Date(since) : null
  for (let i = 0; i < 400; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    if (floor && d < new Date(floor.getFullYear(), floor.getMonth(), floor.getDate())) return null
    if (!onDay(w, d, since)) continue
    const at = atOn(w, d)
    if (at <= now && (!floor || at >= floor)) return at
  }
  return null
}

// How many days apart its runs are, at most: for when a run counts as missed.
export function periodOf(w) {
  if (w.every === 'day') return 1
  if (w.every === 'weekday') return 3
  if (w.every === 'month') return 31
  const n = parseInt(w.every, 10)
  return w.every.endsWith('w') ? n * 7 : w.every === 'week' ? 7 : n
}
