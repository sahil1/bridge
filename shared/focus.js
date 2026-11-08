// What needs you now, and what has gone quiet: one rule for everything that counts or lists what
// waits on you (Home, the needs-you inbox, the top bar's chip, the sidebar's and the phone's Home
// badge, the devices menu, the window's title and so the Dock's badge), so they all say the same.
// The server sorts by it too (server/needsyou.js), and each device says how many of its own are quiet.
//
// Each thing that waits on you has a last-active time (`active`, worked out on the computer it's on:
// server/engaged.js, needsyou.js, home.js): the latest of
//   - when it began waiting (`since`: a permission or question asked, a run that failed),
//   - when you last messaged, answered or opened that agent (`seen.you`),
//   - when you last did any of that in its project (`seen.project`: any agent in the same folder, or
//     a new one you started there) or its space (`seen.space`),
//   - for a Chief of Staff task, when it last changed (`seen.changed`) or you replied to it
//     (`seen.replied`).
// A thing from a computer too old to say has only `since` (or `at`); one with no time at all is new.
//
// - Quiet: nothing on it from you or from it for QUIET_DAYS (3: a weekend away doesn't make Friday's
//   work quiet by Monday morning, a week does). Not counted anywhere, folded under "Quiet for 3+
//   days" by project, and never dropped: still there to answer, open or clear. Something new on it
//   (you open it, it asks again, the task changes) makes it count again. Pinned on Home is never
//   quiet: you put it there.
// - Now: the rest, the highest score first. The score is how much it holds up (a permission or a
//   question stops an agent until you answer: 3; a run that failed: 2; a task Chief of Staff waits on
//   you for: 1) plus how fresh it is (active in the last hour: 3; the last 8 hours: 2; the last day:
//   1; before that: 0). A tie goes to what holds up more, then to the most recently active. So an
//   agent blocked on a question in a project you used an hour ago (6) comes before a task you last
//   touched yesterday morning (1 + 1), and a task untouched for four days is quiet.
// - The first TOP of them are said first and with why: blocking, and what was latest ("You were on
//   this 12 min ago", "You were in shop 1 h ago", "You replied 20 min ago", "Asked 5 min ago").
export const QUIET_DAYS = 3
export const TOP = 3
const HOUR = 36e5
const DAY = 864e5

const ms = (v) => { const t = typeof v === 'number' ? v : Date.parse(v || ''); return Number.isFinite(t) && t > 0 ? t : 0 }
// The latest of some times, as an ISO string, or null when there's none.
export const latest = (...vs) => { const t = Math.max(0, ...vs.map(ms)); return t ? new Date(t).toISOString() : null }

// What kind of wait it is: a Home item's task, or the inbox's type (permission, question, failed, review).
export const needOf = (i) => (i?.kind === 'task' ? 'task' : i?.type || null)
const WEIGHT = { permission: 3, question: 3, failed: 2, task: 1 }
export const blocking = (i) => needOf(i) === 'permission' || needOf(i) === 'question'

// When it or you were last on it (ms), 0 when nothing says.
export const activeAt = (i) => ms(i?.active) || ms(i?.since) || ms(i?.at)
export const isQuiet = (i, now = Date.now()) => { const a = activeAt(i); return a > 0 && now - a >= QUIET_DAYS * DAY }

const band = (age) => (age < HOUR ? 3 : age < 8 * HOUR ? 2 : age < DAY ? 1 : 0)
export const score = (i, now = Date.now()) => (WEIGHT[needOf(i)] ?? 0) + (activeAt(i) ? band(now - activeAt(i)) : 3)

// Now before quiet; then the score, what holds up more, the most recently active.
export function compare(now = Date.now(), quiet = (i) => isQuiet(i, now)) {
  return (x, y) => quiet(x) - quiet(y) || score(y, now) - score(x, now) || (WEIGHT[needOf(y)] ?? 0) - (WEIGHT[needOf(x)] ?? 0) || activeAt(y) - activeAt(x)
}
export const rank = (items, now = Date.now(), quiet) => [...items].sort(compare(now, quiet))

// Split into what needs you now (ranked) and what has gone quiet (the most recently active first).
// keep(i): one that's never quiet (pinned on Home).
export function split(items, { now = Date.now(), keep = () => false } = {}) {
  const quiet = (i) => !keep(i) && isQuiet(i, now)
  const all = rank(items, now, quiet)
  return { now: all.filter((i) => !quiet(i)), quiet: all.filter(quiet) }
}

// Why it's among the first: whether it stops an agent (blocking), and what of it was latest, with
// when: you on it ('you'), you in its project or space ('project', 'space'), you replied to the task
// or it changed ('replied', 'changed'), or its wait beginning ('new').
export function reason(i) {
  const s = i?.seen || {}
  let best = null
  for (const [by, at] of [['you', s.you], ['project', s.project], ['space', s.space], ['replied', s.replied], ['changed', s.changed], ['new', i?.since || i?.at]]) {
    const t = ms(at)
    if (t && (!best || t > best.t)) best = { by, t }
  }
  return { blocking: blocking(i), by: best?.by || null, at: best ? new Date(best.t).toISOString() : null }
}

// The project a quiet one is folded under: its agent's project, else the agent; null for the Chief
// of Staff's (its questions and its tasks), which the page names in its own language.
export const projectOf = (i) => (i?.kind === 'task' || i?.agent?.chief ? null : i?.agent?.project || i?.agent?.title || '')
