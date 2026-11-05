// Which calendar event a call is for, to name its notes after and take its people from. With two
// on at once (back to back, one running over, or double-booked), the one the call's own window
// names (Teams puts the meeting's name in its window's title, a Meet tab its code), else the one
// you clicked Join on in Bridge AI, else the one that starts nearest to when the call did (when its
// app took the mic, not when you pressed record), on the call's app. With no call (a meeting in a
// room), the one under way now, the nearer start breaking a tie.
// Pure but for what Join last said, so tests can ask about any calendar.

const MIN = 60_000
const HOUR = 60 * MIN
// A Join this long before the call still says which meeting it was.
const JOINED_MS = 20 * MIN
// A window that names this much of an event's name counts.
const NAMED = 0.6

let joined = null // { id, at }: the event you last clicked Join on, on any of your devices
export function noteJoin(id) {
  joined = id ? { id: String(id).slice(0, 400), at: Date.now() } : null
  return { ok: true }
}

// Words of a name, lowercase and without accents. The call apps' own words ("Microsoft Teams",
// "Zoom Meeting", a browser's name) are in every one of their windows, so they don't name a meeting.
const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2)
const APP_WORDS = new Set(['microsoft', 'teams', 'zoom', 'meeting', 'meet', 'google', 'webex', 'slack', 'facetime', 'chrome', 'safari', 'edge', 'firefox', 'arc', 'brave', 'call', 'huddle'])

// How much of an event a call's windows name, 0 to 1: the Meet code or Zoom meeting number in its
// join link is all of it; else the share of the words in its name found in one window's title.
export function named(e, titles = []) {
  const ts = (titles || []).map((x) => String(x || '').toLowerCase()).filter(Boolean)
  if (!ts.length || !e) return 0
  const code = /meet\.google\.com\/([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})/i.exec(e.join || '')?.[1]?.toLowerCase() || /zoom\.us\/j\/(\d{9,11})/.exec(e.join || '')?.[1]
  if (code && ts.some((t) => t.replace(/\s+/g, '').includes(code))) return 1
  const all = [...new Set(words(e.title))]
  const ws = all.filter((w) => !APP_WORDS.has(w)).length ? all.filter((w) => !APP_WORDS.has(w)) : all
  if (!ws.length) return 0
  let best = 0
  for (const t of ts) { const have = new Set(words(t)); best = Math.max(best, ws.filter((w) => have.has(w)).length / ws.length) }
  return best
}

// events: the calendar's (calendar.js, today's). call: the call on now ({ app, since, browser },
// calls.js), or null. titles: its app's windows' titles. Gives { event, others, by }: the event (or
// null), the rest that were on (for the meeting's page to offer), and what said so: window, joined,
// call or now.
export function pick(events, { now = Date.now(), call = null, titles = [], join = joined } = {}) {
  const t = (x) => Date.parse(x)
  const at = call?.since ? t(call.since) : null
  // On now or starting within ten minutes; one that ended counts when the call began before it did
  // (it ran over), as long as that was in the last two hours.
  const from = at != null ? Math.max(Math.min(at, now), now - 2 * HOUR) : now
  const on = (events || []).filter((e) => e?.start && !e.allDay && !e.canceled && t(e.start) - now < 10 * MIN && (!e.end || t(e.end) > from))
  if (!on.length) return { event: null, others: [], by: null }
  const app = String(call?.app || '').split(/\s+/)[0].toLowerCase()
  const why = new Map()
  const score = (e) => {
    const s = t(e.start)
    const link = `${e.join || ''} ${e.location || ''}`.toLowerCase()
    let v = 0
    const n = named(e, titles)
    if (n >= NAMED) { v += 10 * n; why.set(e, 'window') }
    if (join?.id === e.id && now - join.at < JOINED_MS) { v += 6; if (!why.has(e)) why.set(e, 'joined') }
    // On the call's app: Meet runs in a browser, the rest have their own.
    if (call?.app && (call.browser ? /meet\.google\.com/.test(link) : app && link.includes(app))) v += 2
    else if (e.online) v += 1
    if (at != null) {
      // Joining a few minutes early is usual, and so is joining late: late counts half as much.
      const d = (s - at) / HOUR
      v -= d > 0 ? d : -d / 2
    } else v += (s <= now ? 2 : 0) - Math.abs(s - now) / HOUR
    return v
  }
  const ranked = on.map((e) => ({ e, v: score(e) })).sort((a, b) => b.v - a.v).map((x) => x.e)
  const event = ranked[0]
  return { event, others: ranked.slice(1, 5), by: why.get(event) || (at != null ? 'call' : 'now') }
}
