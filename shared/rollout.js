// What a release's notes tell the update check, in lines GitHub doesn't show, beside the oldest
// macOS it opens on (server/updates.js):
//   <!-- rollout: 10 -->        Stable installs whose bucket (0-99, picked once at random and kept
//                               in their settings) is under 10 are offered it; the rest aren't until
//                               it's raised. 0 pauses it for everyone, Early Access too. None: 100.
// npm run rollout -- <version> <percent> changes it on GitHub (scripts/rollout.js), and
// scripts/release.js keeps one written in the version's CHANGELOG section, so it starts that way.
const ROLLOUT = /^<!-- rollout: (\d{1,3}) -->[^\S\n]*\n?/m

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
// The notes as people read them: without the lines GitHub hides.
export const shown = (notes) => String(notes || '').replace(/^<!--[^\n]*-->[^\S\n]*\n?/gm, '')
