// A name you put right in what dictation wrote down: the words that changed between what it wrote
// and your edit of it (the dictation window's card, Dictations), where a few words became a name.
// Each is offered for meeting memory (Remember, src/dictation/Remember.jsx), and kept only if you
// say so. Memory writes a name that way everywhere it's heard as it was, in dictation and in
// meetings, so only what reads as a name counts: capitals or digits in it (not just a sentence's
// first letter), a letter at least, a few words on each side. A sentence reworded, a word added or
// taken out, a plain word fixed ("there" for "their"), a capital alone or a common little word
// heard isn't one.

// The word without the punctuation around it ("Acme," is Acme); a mention keeps its @.
const core = (w) => w.replace(/^[^\p{L}\p{N}@]+|[^\p{L}\p{N}]+$/gu, '')
const low = (s) => s.toLowerCase().replace(/[\s-]+/g, ' ')
const LITTLE = new Set('a an the and or but to of in on at for with by is are was were be it its this that i you we they he she me my your our their not do so if as'.split(' '))
const MOST = 4 // words on either side
const LONGEST = 400 // words in all: past that, a long dictation isn't compared

// [{ heard, term }]: what was written and what you made it, up to `max` of them.
export function corrections(before, after, max = 3) {
  const a = String(before || '').split(/\s+/).filter(Boolean)
  const b = String(after || '').split(/\s+/).filter(Boolean)
  if (!a.length || !b.length || a.length > LONGEST || b.length > LONGEST) return []
  const A = a.map(core), B = b.map(core)
  // The words both have, in order (the longest common subsequence), from the end.
  const n = A.length, m = B.length
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out = []
  const seen = new Set()
  const starts = (j) => j === 0 || /[.!?:]["')]*$/.test(b[j - 1])
  const named = (j) => j >= 0 && j < m && !starts(j) && /^\p{Lu}/u.test(B[j])
  // Words that were written and words of yours in their place: one, if it reads as a name. A
  // name's other half that was right already goes with it ("Priya shaw" is "Priya Shah").
  const take = (i0, i1, j0, j1) => {
    if (i1 === i0 || j1 === j0 || i1 - i0 > MOST || j1 - j0 > MOST) return
    while (j1 - j0 < MOST && named(j0 - 1) && /[\p{Lu}\p{N}]/u.test(B[j0])) { i0--; j0-- }
    while (j1 - j0 < MOST && i1 < n && named(j1) && !/[.!?:,;]$/.test(b[j1 - 1]) && /[\p{Lu}\p{N}]/u.test(B[j1 - 1])) { i1++; j1++ }
    const heard = A.slice(i0, i1).filter(Boolean).join(' ')
    const term = B.slice(j0, j1).filter(Boolean).join(' ')
    if (heard.length < 2 || term.length < 2 || heard.length > 60 || term.length > 60 || low(heard) === low(term)) return
    if (!/\p{L}/u.test(term) || /[@/\\]|:\/\//.test(heard + term)) return
    if (i1 - i0 === 1 && LITTLE.has(heard.toLowerCase())) return
    // A capital or a digit in it, and not only a sentence's first letter.
    if (!/[\p{Lu}\p{N}]/u.test(starts(j0) ? term.slice(1) : term)) return
    const k = `${low(heard)}\n${low(term)}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ heard, term })
  }
  let i = 0, j = 0, i0 = 0, j0 = 0
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { take(i0, i, j0, j); i++; j++; i0 = i; j0 = j } else if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) i++
    else j++
  }
  take(i0, i, j0, j)
  return out.slice(0, max)
}
