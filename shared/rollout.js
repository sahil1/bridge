// What a release's notes tell the update check, in lines GitHub doesn't show, beside the oldest
// macOS it opens on (server/updates.js):
//   <!-- rollout: 10 -->        Stable installs whose bucket (0-99, picked once at random and kept
//                               in their settings) is under 10 are offered it; the rest aren't until
//                               it's raised. 0 pauses it for everyone, Early Access too. None: 100.
//   <!-- revoked: 3f9c2a1b -->  early-access codes taken back, by id (server/earlyaccess.js)
// npm run rollout -- <version> <percent> changes the first on GitHub (scripts/rollout.js), and
// scripts/release.js keeps one written in the version's CHANGELOG section, so it starts that way.
const ROLLOUT = /^<!-- rollout: (\d{1,3}) -->[^\S\n]*\n?/m
const REVOKED = /^<!-- revoked: ([\w\s-]*?) -->\s*$/gm

// The percentage a release's notes give (0 to 100), or null for everyone.
export function rolloutOf(notes) {
  const m = String(notes || '').match(ROLLOUT)
  return m ? Math.min(100, Number(m[1])) : null
}
// The notes with that line set to percent, at the end; 100 takes it out (everyone).
export function withRollout(notes, percent) {
  const rest = String(notes || '').replace(new RegExp(ROLLOUT.source, 'gm'), '').replace(/\s+$/, '')
  return percent >= 100 ? `${rest}\n` : `${rest}\n\n<!-- rollout: ${percent} -->\n`
}
// Whether an install in this bucket is offered a release at this percentage.
export const inRollout = (bucket, percent) => percent == null || (percent > 0 && Number.isInteger(bucket) && bucket < percent)
// The early-access code ids the notes take back.
export const revokedIn = (notes) => [...String(notes || '').matchAll(REVOKED)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
// The notes taking one more back, in one line at the end.
export function withRevoked(notes, id) {
  const ids = [...new Set([...revokedIn(notes), id])]
  return `${String(notes || '').replace(REVOKED, '').replace(/\s+$/, '')}\n\n<!-- revoked: ${ids.join(' ')} -->\n`
}
// The notes as people read them: without the lines GitHub hides.
export const shown = (notes) => String(notes || '').replace(/^<!--[^\n]*-->[^\S\n]*\n?/gm, '')
