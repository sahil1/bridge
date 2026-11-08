// Updating by itself while you're away (Settings › About & Updates): whether now's the time, from
// what each side knows. The server knows the release and what runs in it (this computer's agents, a
// meeting, a dictation: serverWhy), the desktop app whether you're away and what its windows hold
// (desktopWhy). Each gives what it's waiting for, [] for nothing, and the desktop app installs only
// when neither waits, asked again right before. Pure, so the tests can ask about any moment; the
// server (server/updates.js) and the desktop app (desktop/main.js) both decide with these.

// How long a release is out before it goes in by itself. A broken one is usually found by the
// people who update by hand, and pulled or fixed with a .1, within its first hours: 4 hours gives
// them that time, and still has most computers on the new version the same day.
export const RELEASE_HOURS = 4
// Away: no keyboard or mouse for 20 minutes (longer than reading a long page or a pause in a
// video, shorter than lunch), or the screen locked and nothing touched for 2.
export const AWAY_MINUTES = 20
export const LOCKED_MINUTES = 2
// Just woken from sleep: you're likely back, even with the screen still locked.
export const WOKE_MINUTES = 5
// An install takes a minute or two; one started this long ago that hasn't brought the new version
// didn't go through, whatever it said.
export const INSTALL_MINUTES = 10
// A version that didn't go in isn't tried by itself again until the next check for new versions
// (server/updates.js checks every 6 hours), so a failing one doesn't go round and round.
export const RETRY_HOURS = 6
// Out a day and still not in: About & Updates says what it's waiting for.
export const LONG_HOURS = 24

const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

// What a window can say it holds (src/busy.js). Anything else counts as a window that didn't say.
export const HELD = ['studio', 'file', 'draft', 'board', 'dictating', 'playing']

// The release: u is /api/updates' answer; on, the switch; checks, Check for new versions. While
// this says wait, nothing else is asked.
//   off          the switch is off
//   checks       Check for new versions is off
//   unsupported  not the desktop app on a Mac or Windows (from source, Docker, Linux's package)
//   unchecked    the last check didn't reach GitHub, so the release may have been pulled since
//   held         the newest needs a newer macOS than this Mac has
//   none         nothing newer (or a staged release not out to this computer yet)
//   prerelease   a pre-release, unless this computer is on Early Access (u.channel), which asked
//                for them
//   young        out less than RELEASE_HOURS (or GitHub didn't say when it came out)
export function releaseWhy({ u = {}, on = true, checks = true, now = Date.now() } = {}) {
  if (!on) return ['off']
  if (!checks || u.disabled) return ['checks']
  if (u.how !== 'app') return ['unsupported']
  if (u.error) return ['unchecked']
  if (u.held) return ['held']
  if (!u.available || !u.latest) return ['none']
  if ((u.prerelease || /-/.test(u.latest)) && u.channel !== 'early') return ['prerelease']
  const at = Date.parse(u.publishedAt || '')
  if (!Number.isFinite(at) || now - at < RELEASE_HOURS * HOUR) return ['young']
  return []
}

// What runs in the server: quiet is { agents: this computer's working or waiting on you (null when
// it couldn't tell), meeting: one recording, being transcribed or its notes being written,
// dictation: one being heard }; tried, the last update this copy started ({ version, from, at,
// failed }), current this version and latest the newest.
//   agents, meeting, dictation   as above
//   installing                   an update is going in now
//   failed                       this version was tried and didn't go in, under RETRY_HOURS ago
export function quietWhy({ quiet = {}, tried = null, current = null, latest = null, now = Date.now() } = {}) {
  const why = []
  if (quiet.agents == null || quiet.agents > 0) why.push('agents')
  if (quiet.meeting) why.push('meeting')
  if (quiet.dictation) why.push('dictation')
  if (tried && tried.from === current && tried.version === latest) {
    const ago = now - tried.at
    if (!tried.failed && ago < INSTALL_MINUTES * MINUTE) why.push('installing')
    else if (ago < RETRY_HOURS * HOUR) why.push('failed')
  }
  return why
}

export const serverWhy = (o) => { const r = releaseWhy(o); return r.length ? r : quietWhy({ ...o, latest: o.u?.latest }) }

// The desktop app's side: idle, seconds without keyboard or mouse; locked, the screen; woke,
// seconds since the computer last woke from sleep (null when it hasn't slept); battery, on battery
// power; windows, what each window said it holds (an array of HELD), null for one that didn't answer.
//   here      you're using the computer (or just woke it)
//   battery   on battery power: it waits until it's plugged in, as an install on battery can be cut
//             off by the computer going to sleep
//   window    a window that didn't say what it holds
//   and what the windows said
export function desktopWhy({ idle = 0, locked = false, woke = null, battery = false, windows = [] } = {}) {
  const why = []
  const away = idle >= AWAY_MINUTES * 60 || (locked && idle >= LOCKED_MINUTES * 60)
  if (!away || (woke != null && woke < WOKE_MINUTES * 60)) why.push('here')
  if (battery) why.push('battery')
  for (const w of windows) {
    if (!Array.isArray(w)) why.push('window')
    else for (const x of w) why.push(HELD.includes(x) ? x : 'window')
  }
  return [...new Set(why)]
}

// Out a day or more and still not in: About & Updates says what it's waiting for.
export const waitingLong = (u, now = Date.now()) => !!u?.available && Number.isFinite(Date.parse(u.publishedAt || '')) && now - Date.parse(u.publishedAt) >= LONG_HOURS * HOUR
