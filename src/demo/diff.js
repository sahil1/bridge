// Line diffs for the demo's made-up repos: what git diff and an agent's edit would show.
const split = (s) => (s == null || s === '' ? [] : String(s).replace(/\n$/, '').split('\n'))

// Each line of a and b as kept (' '), removed ('-') or added ('+'), by longest common subsequence.
function ops(a, b) {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([' ', a[i]]); i++; j++ } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(['-', a[i++]]); else out.push(['+', b[j++]])
  }
  while (i < n) out.push(['-', a[i++]])
  while (j < m) out.push(['+', b[j++]])
  return out
}

// Hunks with 3 lines of context, as git makes them.
export function hunks(before, after, ctx = 3) {
  let o = 1
  let n = 1
  const rows = ops(split(before), split(after)).map(([t, l]) => {
    const r = { t, l, o, n }
    if (t !== '+') o++
    if (t !== '-') n++
    return r
  })
  const changed = rows.flatMap((r, i) => (r.t === ' ' ? [] : [i]))
  const out = []
  for (let k = 0; k < changed.length; k++) {
    const start = Math.max(0, changed[k] - ctx)
    let end = Math.min(rows.length - 1, changed[k] + ctx)
    while (k + 1 < changed.length && changed[k + 1] - ctx <= end + 1) end = Math.min(rows.length - 1, changed[++k] + ctx)
    const part = rows.slice(start, end + 1)
    const oldLines = part.filter((r) => r.t !== '+').length
    const newLines = part.filter((r) => r.t !== '-').length
    out.push({ head: `@@ -${oldLines ? part[0].o : part[0].o - 1},${oldLines} +${newLines ? part[0].n : part[0].n - 1},${newLines} @@`, lines: part.map((r) => r.t + r.l) })
  }
  return out
}

export const count = (lines) => ({ add: lines.filter((l) => l[0] === '+').length, del: lines.filter((l) => l[0] === '-').length })

// An edit as Chat shows it under a reply ("Changed 2 files"): diff lines and counts.
export function editLines(before, after) {
  const lines = before == null ? ['@@ new file @@', ...split(after).map((l) => `+${l}`)] : hunks(before, after).flatMap((h) => [h.head, ...h.lines])
  return { lines, ...count(lines) }
}

// The file with its nth change (hunk) put back as it was.
export function undoHunk(before, after, n) {
  const h = hunks(before, after)[n]
  if (!h) return after
  const [, start, len] = /\+(\d+),(\d+)/.exec(h.head).map(Number)
  const lines = split(after)
  lines.splice(len ? start - 1 : start, len, ...h.lines.filter((l) => l[0] !== '+').map((l) => l.slice(1)))
  return `${lines.join('\n')}\n`
}

// `git diff HEAD -- path` for a tracked file, or the whole file as added for a new one.
export function gitDiff(path, before, after) {
  if (before == null) return { diff: `--- /dev/null\n+++ b/${path}\n@@ new file @@\n${split(after).map((l) => `+${l}`).join('\n')}`, untracked: true }
  if (after == null) return { diff: `diff --git a/${path} b/${path}\ndeleted file mode 100644\n--- a/${path}\n+++ /dev/null\n@@ -1,${split(before).length} +0,0 @@\n${split(before).map((l) => `-${l}`).join('\n')}\n` }
  const hs = hunks(before, after)
  if (!hs.length) return { diff: '' }
  return { diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hs.map((h) => [h.head, ...h.lines].join('\n')).join('\n')}\n` }
}
