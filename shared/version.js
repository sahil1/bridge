// Which of two versions is newer, in semver's order: 1.24.0 < 1.24.1 < 2.0.0, and a pre-release
// comes before its version (3.13.0-beta.1 < 3.13.0-beta.2 < 3.13.0-rc.1 < 3.13.0). The server
// (updates.js) and the page (permissions.js) compare with this; desktop/main.js has a copy.
const split = (v) => {
  const [core, pre = ''] = String(v || '').trim().replace(/^v/, '').split('+')[0].split(/-(.*)/s)
  return { core: core.split('.').map((n) => Number(n) || 0), pre: pre ? pre.split('.') : [] }
}

// 1 when a is newer, -1 when b is, 0 when they're the same version.
export function compare(a, b) {
  const x = split(a)
  const y = split(b)
  for (let i = 0; i < 3; i++) if ((x.core[i] || 0) !== (y.core[i] || 0)) return (x.core[i] || 0) > (y.core[i] || 0) ? 1 : -1
  // The same version: the release itself is newer than any pre-release of it.
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]
    const q = y.pre[i]
    if (p === undefined) return -1
    if (q === undefined) return 1
    if (p === q) continue
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) > Number(q) ? 1 : -1
    if (pn !== qn) return pn ? -1 : 1
    return p > q ? 1 : -1
  }
  return 0
}
export const newer = (a, b) => compare(a, b) > 0
// A pre-release (3.13.0-beta.1): one for Early Access only.
export const isPre = (v) => /^v?\d+\.\d+\.\d+-/.test(String(v || ''))
// A version Bridge AI is released as: 3.13.0, or a pre-release of it (3.13.0-beta.1, 3.13.0-rc.2).
export const RELEASE_VERSION = /^\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?$/
