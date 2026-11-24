import { partsOf, search } from '../../shared/manualparse.js'

// Bridge AI's manual (shared/manual.md, made from README.md and the words in Settings: scripts/
// manual.js), in the app's own build, so Help works on a phone with no computer to ask: loaded the
// first time Help or ⌘K wants it, as a part of the build of its own.
let loading = null
export function loadManual() {
  loading ||= import('../../shared/manual.md?raw').then((m) => {
    const text = String(m.default || '')
    const parts = partsOf(text)
    // Its topics: each part at the top (## …), with the ones under it (### …).
    const topics = parts.filter((p) => p.level === 2).map((p) => ({ ...p, under: parts.filter((x) => x.level === 3 && x.path[0] === p.title) }))
    return { text, parts, topics }
  }, (e) => { loading = null; throw e })
  return loading
}

export const findIn = (m, q, n) => (m ? search(m.parts, q, n) : [])
// The topic a part is in (its ## part).
export const topicOf = (m, part) => m?.topics.find((x) => x.title === part?.path?.[0]) || null
