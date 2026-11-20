// Which tests a change to test/run.mjs needs (test/run.mjs, test-scope): the suites whose own entry
// in its list changed or was added, when that list is all that changed; every test when anything
// else in it did (how they're run: lanes, tries, time limits, the build). A suite taken off the list
// needs none, and a comment none.
//   runnerChange(before, after): null for every test, or the names of the suites to run.
// The list is SUITES' lines, one suite to a line: anything else in it (a suite over two lines) counts
// as the rest of the runner, so it runs every test rather than miss one.
const START = 'const SUITES = [\n'
const listOf = (text) => {
  const t = String(text).replace(/\r\n/g, '\n')
  const at = t.indexOf(START)
  const end = at < 0 ? -1 : t.indexOf('\n]\n', at)
  if (end < 0) return null
  const entries = new Map()
  for (const line of t.slice(at + START.length, end).split('\n')) {
    const m = line.match(/^ {2}\{ name: '([\w-]+)'.*\},$/)
    if (m) entries.set(m[1], line)
    else if (!/^\s*(\/\/.*)?$/.test(line)) return null
  }
  return { entries, rest: t.slice(0, at) + t.slice(end) }
}

export function runnerChange(before, after) {
  const a = listOf(before)
  const b = listOf(after)
  if (!a || !b || a.rest !== b.rest) return null
  return [...b.entries].filter(([name, line]) => a.entries.get(name) !== line).map(([name]) => name)
}

// A share of the suites, for CI's machines that split them (--shard i/n): each in turn goes to the
// share with the least expected time so far, its time limit (minutes) or 2 minutes, so the shares
// take about as long as each other. The same suites give the same shares every time.
export function shareOf(suites, i, n) {
  const load = Array(n).fill(0)
  return suites.filter((s) => {
    const k = load.indexOf(Math.min(...load))
    load[k] += s.minutes || 2
    return k === i - 1
  })
}
