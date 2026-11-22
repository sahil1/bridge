// Which tests a change needs (test/run.mjs, test-scope), and how CI's machines share them.
import fs from 'node:fs'
import path from 'node:path'

// Which tests a change to test/run.mjs needs: the suites whose own entry in its list changed or was
// added, when that list is all that changed; every test when anything else in it did (how they're
// run: lanes, tries, time limits, the build, the core files). A suite taken off the list needs
// none, and a comment none.
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

// ---------- The tests for a change ----------
// pick({ suites, changed, core, app, runner, root, versionOnly, texts }): the suites a change runs.
//   changed: the files it changes, as git names them; core: patterns of the files whose change runs
//   every test; app: of those whose change runs every test that opens the app (and what covers or
//   uses them); runner: runnerChange's answer (null: every test); versionOnly(f): a package file
//   with only its version changed; texts: server/index.js and test/lib/harness.mjs as they were and
//   are, and git's diff of each ({ before, after, diff }), for the ones changed (one missing: every
//   test, as which of its statements changed can't be said).
// A suite runs for a change to a file it covers (its `covers`), to a file it uses (its `uses`, the
// files it imports or reads itself, and every file those import), to its own test file, or to a
// file under test/ it names; server/index.js and the harness by the statements changed in them
// (indexChange, harnessChange), and a file in shared/ as the files that import it too.
export function pick({ suites, changed, core, app = [], runner, root, versionOnly = () => false, texts = {} }) {
  if (runner === null || changed.some((f) => core.some((re) => re.test(f)) && !versionOnly(f))) return suites
  const isApp = (f) => app.some((re) => re.test(f))
  const graph = importGraph(root)
  const tests = testFiles(root)
  const also = new Set()
  // The harness: the suites that call what changed in it (a function, startSlack), or every test.
  if (changed.includes('test/lib/harness.mjs')) {
    const h = texts['test/lib/harness.mjs']
    const r = h?.before != null && h.after != null && tests.harnessChange(h)
    if (!r) return suites
    r.forEach((n) => also.add(n))
  }
  // Counted as changed (for covers and uses), and used only (for uses: what the app's core files
  // stand for, as the tests that open the whole app use them).
  const own = new Set(changed.filter((f) => f !== 'server/index.js'))
  const shell = new Set(changed.includes('server/index.js') ? ['server/index.js'] : [])
  // A change to a file in shared/ is one to the files that import it, there and in the app, the
  // server and the desktop app (server/index.js: the statements that use it).
  const shared = changed.filter((f) => f.startsWith('shared/'))
  const fromShared = new Set(shared.flatMap((f) => [...importersOf(graph, f, (x) => x.startsWith('shared/'))]))
  for (const g of fromShared) if (g !== 'server/index.js') (isApp(g) ? shell : own).add(g)
  // server/index.js: what its changed statements are about (indexChange), or every test.
  if (shell.has('server/index.js') || fromShared.has('server/index.js')) {
    const index = texts['server/index.js']
    const users = routeUsers(root, tests)
    const parts = []
    if (shell.has('server/index.js')) parts.push(index?.before != null && index.after != null && indexChange({ ...index, users }))
    if (fromShared.has('server/index.js')) for (const f of shared) parts.push(index?.after != null && indexUsersOf(index.after, f, users))
    for (const p of parts) {
      if (!p || p.every) return suites
      p.files.forEach((f) => (isApp(f) ? shell : own).add(f))
      p.suites.forEach((n) => also.add(n))
    }
  }
  // src/styles.css: the files that show what its changed rules style (styleChange), or, for one
  // that styles the whole page (body, :root's colours, a rule with no class), every test that opens
  // the app.
  let opensApp = changed.some(isApp)
  if (changed.includes('src/styles.css')) {
    const css = texts['src/styles.css']
    const r = css?.before != null && css.after != null && styleChange(css, srcTexts(root))
    if (!r) opensApp = true
    else r.forEach((f) => own.add(f))
  }
  const used = [...own, ...shell]
  const named = new Set(changed.filter((f) => /^test\/(suites|lib|stand-ins|fixtures)\//.test(f) && f !== 'test/lib/harness.mjs').flatMap((f) => [...tests.usersOf(f)]))
  return suites.filter((s) => runner.includes(s.name) || changed.includes(`test/suites/${s.name}.mjs`) || named.has(s.name) || also.has(s.name)
    || (opensApp && (s.build || s.browser))
    || [...own].some((f) => s.covers.some((re) => re.test(f)))
    || (() => { const u = usesOf(root, graph, tests, s); return used.some((f) => u.files.has(f) || u.dirs.some((d) => f.startsWith(`${d}/`))) })())
}

// The statements a diff touches (git diff -U0's hunks), in a file as it was (lines taken out) and
// as it is (lines put in): [[side, statement]], or null when a line is in none of them.
const touchedBy = (was, is, diff) => {
  const out = []
  for (const h of String(diff).matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [a, b, c, d] = [Number(h[1]), h[2] == null ? 1 : Number(h[2]), Number(h[3]), h[4] == null ? 1 : Number(h[4])]
    for (const [side, from, n] of [[was, a, b], [is, c, d]]) {
      if (!n) continue
      const at = side.list.filter((s) => s.to >= from && s.from <= from + n - 1)
      if (!at.length) return null
      for (const s of at) out.push([side, s])
    }
  }
  return out
}

// ---------- src/styles.css ----------
// A stylesheet's rules, each { from, to, selector, at }: its lines (a comment just before it its
// own), its selector, and the at-rules it's in (@media …). null when it can't be read so.
export function cssRules(text) {
  const t = String(text).replace(/\r\n/g, '\n')
  const rules = []
  const open = [] // { prelude, from, rules: the rules inside it }
  let buf = ''
  let from = null
  let lead = null // where the comment before what comes next started
  let line = 1
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === '\n') { line++; continue }
    if (ch === '/' && t[i + 1] === '*') {
      const end = t.indexOf('*/', i + 2)
      if (end < 0) return null
      if (!buf.trim() && lead == null) lead = line
      line += (t.slice(i, end).match(/\n/g) || []).length
      i = end + 1
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = t.indexOf(ch, i + 1)
      if (end < 0) return null
      buf += t.slice(i, end + 1)
      i = end
      continue
    }
    if (ch === '{') {
      open.push({ prelude: buf.trim(), from: lead ?? from ?? line, rules: [] })
      buf = ''; from = null; lead = null
    } else if (ch === '}') {
      const b = open.pop()
      if (!b) return null
      const rule = { from: b.from, to: line, selector: b.prelude, at: open.map((o) => o.prelude), inner: b.rules }
      rules.push(rule)
      for (const o of open) o.rules.push(rule)
      buf = ''; from = null; lead = null
    } else if (ch === ';') {
      // A declaration ends, or an at-rule with no block (@import): the whole sheet's.
      if (!open.length && buf.trim()) rules.push({ from: lead ?? from ?? line, to: line, selector: buf.trim(), at: [], inner: [] })
      buf = ''; from = null; lead = null
    } else {
      if (!buf.trim() && /\S/.test(ch)) from = line
      buf += ch
    }
  }
  return open.length ? null : rules
}
// The classes a selector needs, one list for each of its selectors (split at its commas): what's in
// :not(…) and the like isn't needed, nor what an [attribute] says.
const needs = (selector) => {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of selector) {
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth--
    if (ch === ',' && !depth) { parts.push(cur); cur = '' } else cur += ch
  }
  parts.push(cur)
  return parts.map((p) => {
    let s = p
    for (let k = 0; k < 5; k++) s = s.replace(/:[\w-]+\([^()]*\)/g, '').replace(/\[[^\]]*\]/g, '')
    return [...s.matchAll(/[.#](-?[A-Za-z_][\w-]*)/g)].map((m) => m[1])
  })
}
// The app's files that show a class: its name in them (className="… update-pop", classList.add('x')),
// or the start of it before what's put in (`k-${kind}` for k-idea).
const showing = (src, cls) => {
  const re = new RegExp(`(?<![\\w-])${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`)
  const starts = [...cls.matchAll(/-/g)].map((m) => cls.slice(0, m.index + 1))
  return src.filter(([, t]) => re.test(t) || starts.some((s) => t.includes(`${s}\${`) || t.includes(`'${s}' +`) || t.includes(`"${s}" +`))).map(([f]) => f)
}
// What a change to src/styles.css ({ before, after, diff }) styles: for each rule it touches (as it
// was and as it is; an @media's line, each rule in it), the app's files that show what it needs, by
// the class that fewest show (each is needed, so one is enough). null for every test that opens the
// app: a rule needing no class (body, :root and its colours, a button), one for the whole sheet
// (@keyframes, @font-face, @import), or one whose classes no file shows as they're written.
export function styleChange({ before, after, diff }, src) {
  const sides = [cssRules(before), cssRules(after)]
  if (!sides[0] || !sides[1]) return null
  // Each hunk's rules on each side: the ones it's in, not the @media around them, unless it's in
  // none of those (the @media's own line: then each rule in it).
  const touched = []
  for (const h of String(diff).matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const [a, b, c, d] = [Number(h[1]), h[2] == null ? 1 : Number(h[2]), Number(h[3]), h[4] == null ? 1 : Number(h[4])]
    for (const [list, from, n] of [[sides[0], a, b], [sides[1], c, d]]) {
      if (!n) continue
      const at = list.filter((r) => r.to >= from && r.from <= from + n - 1)
      // (Lines after the last rule: comments, nothing styled.)
      if (!at.length && from <= (list.at(-1)?.to || 0)) return null
      touched.push(...at.filter((r) => !r.inner.some((x) => at.includes(x))))
    }
  }
  const files = new Set()
  const each = (r) => {
    if (r.inner.length && /^@(media|supports|container|layer)\b/.test(r.selector)) return r.inner.every(each)
    if (r.selector.startsWith('@') || r.at.some((a) => !/^@(media|supports|container|layer)\b/.test(a))) return false
    for (const classes of needs(r.selector)) {
      const shown = classes.map((c) => showing(src, c)).filter((l) => l.length).sort((a, b) => a.length - b.length)[0]
      if (!shown) return false
      shown.forEach((f) => files.add(f))
    }
    return true
  }
  for (const r of touched) if (!each(r)) return null
  return files
}
const srcAt = new Map()
const srcTexts = (root) => {
  if (!srcAt.has(root)) srcAt.set(root, walk(root, 'src').filter((f) => /\.(jsx?|mjs)$/.test(f)).map((f) => [f, read(root, f)]))
  return srcAt.get(root)
}

// ---------- What the app, the server and the desktop app import ----------
// Every source file here and the files it imports (import … from './x.js', export … from, import
// './x.css', require('./x'), CSS's @import), as the build and Node.js load them with it. Not what a
// file loads only when asked (import('./x.js'): a view opened later), packages or what's spawned.
const SOURCE = ['src', 'shared', 'server', 'desktop', 'relay', 'account', 'counts', 'scripts', 'chief']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.wrangler', '.out'])
const walk = (root, dir, out = []) => {
  let list
  try { list = fs.readdirSync(path.join(root, dir), { withFileTypes: true }) } catch { return out }
  for (const e of list) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(root, p, out) } else out.push(p)
  }
  return out
}
const read = (root, f) => { try { return fs.readFileSync(path.join(root, f), 'utf8') } catch { return '' } }
const IMPORTS = [/\bfrom\s*['"](\.{1,2}\/[^'"\n]+)['"]/g, /\bimport\s*['"](\.{1,2}\/[^'"\n]+)['"]/g, /\brequire\(\s*['"](\.{1,2}\/[^'"\n]+)['"]\s*\)/g, /@import\s+(?:url\()?['"](\.{1,2}\/[^'"\n]+)['"]/g]
const graphs = new Map()
export function importGraph(root) {
  if (graphs.has(root)) return graphs.get(root)
  const files = SOURCE.flatMap((d) => walk(root, d)).filter((f) => /\.(jsx?|mjs|cjs|css)$/.test(f))
  const have = new Set(files)
  const to = new Map()
  for (const f of files) {
    const text = read(root, f)
    to.set(f, new Set(IMPORTS.flatMap((re) => [...text.matchAll(re)].map((m) => resolveIn(have, f, m[1])).filter(Boolean))))
  }
  const graph = { files: have, to, from: new Map(files.map((f) => [f, new Set()])) }
  for (const [f, s] of to) for (const x of s) graph.from.get(x).add(f)
  graphs.set(root, graph)
  return graph
}
const resolveIn = (have, from, spec) => {
  const p = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec.replace(/[?#].*$/, '')))
  return [p, `${p}.js`, `${p}.jsx`, `${p}.mjs`, `${p}/index.js`].find((c) => have.has(c)) || null
}
// The files these import, and what those import, and so on (with themselves).
export function closureOf(graph, roots) {
  const seen = new Set()
  const todo = [...roots]
  while (todo.length) {
    const f = todo.pop()
    if (seen.has(f)) continue
    seen.add(f)
    for (const x of graph.to.get(f) || []) todo.push(x)
  }
  return seen
}
// The files that import f, and those that import them while through (a file in shared/, say).
const importersOf = (graph, f, through) => {
  const out = new Set()
  const todo = [f]
  while (todo.length) {
    for (const g of graph.from.get(todo.pop()) || []) if (!out.has(g)) { out.add(g); if (through(g)) todo.push(g) }
  }
  return out
}

// What a suite uses: the files in its `uses` and those its own file (and the files under test/ it
// names, but the harness, whose server is every test's) imports from here, each with what it
// imports, and the files it reads by name (path.join(ROOT, 'README.md'); a folder, path.join(ROOT,
// 'src'), for every file in it). A `uses` file that isn't there (moved, say) is the folder it was
// in, so a test is never left out by a rename. server/index.js read by name is by its statements, as
// for every test: what a test reads there is what a statement calls (devices: relay.whenAsked's
// notification, a change to which runs the tests of relay.js).
const uses = new Map()
const usesOf = (root, graph, tests, s) => {
  const key = `${root}\n${s.name}`
  if (uses.has(key)) return uses.get(key)
  const runs = new Set()
  const reads = new Set()
  const dirs = new Set()
  const take = (p, run) => {
    if (!p || p === '.' || /^(dist|test|node_modules)(\/|$)|^package(-lock)?\.json$/.test(p) || (!run && p === 'server/index.js')) return
    let st = null
    try { st = fs.statSync(path.join(root, p)) } catch { /* not there */ }
    if (!st) dirs.add(path.posix.dirname(p))
    else if (st.isDirectory()) dirs.add(p)
    else (run && graph.files.has(p) ? runs : reads).add(p)
  }
  for (const p of s.uses || []) take(p, true)
  for (const f of tests.readBy(s.name)) {
    const text = tests.text(f)
    for (const re of IMPORTS) for (const m of text.matchAll(re)) take(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1])), true)
    // (A name built from more, path.join(ROOT, 'src', 'i18n', `${l}.json`): the folder.)
    for (const m of text.matchAll(/path\.(?:join|resolve)\(ROOT((?:\s*,\s*'[^'\n]*')+)\s*([,)])/g)) take(path.posix.normalize([...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join('/')), false)
  }
  const files = closureOf(graph, runs)
  for (const f of reads) files.add(f)
  const u = { files, dirs: [...dirs].filter((d) => d && d !== '.') }
  uses.set(key, u)
  return u
}

// ---------- Files under test/ ----------
// The suites (test/suites/<name>.mjs), the helpers (test/lib), the stand-ins (test/stand-ins) and
// fixtures (test/fixtures). A file under test/ is used by the suites that name it ('slack.mjs',
// stand-ins/slack.mjs), or name a helper or stand-in that does; one a suite builds the name of
// (stand-ins/${n}.cjs) is every file in that folder. In the harness, by the function it's named in:
// the suites that call that function (startSlack), or every suite for one named outside a function
// or loaded as the harness is.
const testsAt = new Map()
export function testFiles(root) {
  if (testsAt.has(root)) return testsAt.get(root)
  const all = ['test/suites', 'test/lib', 'test/stand-ins', 'test/fixtures'].flatMap((d) => walk(root, d))
  const texts = new Map()
  const text = (f) => { if (!texts.has(f)) texts.set(f, /\.(mjs|cjs|js|json)$/.test(f) && !f.startsWith('test/fixtures/') ? read(root, f).replace(/^\s*\/\/.*$/gm, '') : ''); return texts.get(f) }
  const suites = all.filter((f) => /^test\/suites\/[\w-]+\.mjs$/.test(f))
  const readers = all.filter((f) => !f.startsWith('test/fixtures/') && f !== 'test/lib/harness.mjs' && f !== 'test/lib/scope.mjs')
  const nameOf = (f) => (f.startsWith('test/suites/') ? path.posix.basename(f, '.mjs') : null)
  const names = (t, f) => {
    const base = path.posix.basename(f)
    const dir = path.posix.basename(path.posix.dirname(f))
    return (t.includes(base) && new RegExp(`(?<![\\w.-])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(t)) || (t.includes(dir) && new RegExp(`${dir}(?:'\\s*,\\s*\`|/\\$\\{)`).test(t))
  }
  // The harness's statements that name each file, and which names each defines (all of it as one
  // statement, naming nothing it defines, when it can't be read so: every suite's).
  const whole = read(root, 'test/lib/harness.mjs')
  const harness = statements(whole) || [{ kind: 'other', names: [], code: whole.replace(/^\s*\/\/.*$/gm, '') }]
  const callers = new Map() // a harness name -> the readers that call it
  const callersOf = (n) => {
    if (!callers.has(n)) {
      const re = new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`)
      callers.set(n, new Set())
      const s = new Set(readers.filter((r) => re.test(text(r))))
      // A helper the harness keeps to itself: the callers of the functions that call it; every
      // suite for one that what the harness does as it loads uses (globalThis.fetch's key).
      for (const h of harness) {
        if (h.kind === 'import' || h.names.includes(n) || !re.test(h.code)) continue
        if (!h.names.length) { readers.forEach((r) => s.add(r)); break }
        for (const m of h.names) for (const r of callersOf(m)) s.add(r)
      }
      callers.set(n, s)
    }
    return callers.get(n)
  }
  const every = new Set(suites.map(nameOf))
  const users = new Map()
  const usersOf = (f) => {
    if (users.has(f)) return users.get(f)
    users.set(f, new Set()) // (one that names itself, or two each other)
    const out = new Set()
    const by = (r) => { const n = nameOf(r); if (n) out.add(n); else if (r !== f) for (const x of usersOf(r)) out.add(x) }
    for (const r of readers) if (r !== f && names(text(r), f)) by(r)
    for (const h of harness) {
      if (!names(h.code, f)) continue
      if (!h.names.length || h.kind === 'import') { users.set(f, every); return every }
      for (const n of h.names) for (const r of callersOf(n)) by(r)
    }
    users.set(f, out)
    return out
  }
  // What a suite runs as its own: its file and the helpers and stand-ins it uses (not the harness).
  const readBy = (name) => new Set([`test/suites/${name}.mjs`, ...readers.filter((f) => f !== `test/suites/${name}.mjs` && usersOf(f).has(name))])
  // A change to the harness ({ before, after, diff }): the suites that call the functions and values
  // it changed (each statement as it was and as it is), or null for every test: one with nothing of
  // its own named (an import, what it does as it loads), or a harness that can't be read so.
  const harnessChange = ({ before, after, diff }) => {
    const sides = [statements(before), statements(after)]
    if (!sides[0] || !sides[1]) return null
    const touched = touchedBy({ list: sides[0] }, { list: sides[1] }, diff)
    if (!touched) return null
    const out = new Set()
    for (const [, s] of touched) {
      if (s.kind === 'import' || !s.names.length) return null
      for (const n of s.names) for (const r of callersOf(n)) { const name = nameOf(r); for (const x of name ? [name] : usersOf(r)) out.add(x) }
    }
    return out
  }
  const t = { usersOf, readBy, text, suites, all, harnessChange }
  testsAt.set(root, t)
  return t
}

// ---------- server/index.js ----------
// A file's top-level statements, each { from, to, code, kind, names, spec, route, exported }: from
// the comment just before it (the lines at the left edge before it) to its last line, code without
// its comments. kind: import (spec: from where), def (names: what it defines), route (app.get(…) and
// the like, with its address) or other. null when a line at the left edge starts no statement (the
// text of a template, say), so the caller does the safe thing.
const STATEMENT = /^(import\b|export\b|const\b|let\b|var\b|function\b|async\b|class\b|if\b|for\b|while\b|try\b|switch\b|do\b|\{|\(|;|[\w$]+(?:\??\.[\w$]+)*\s*(?:\(|=[^=]|\+\+|--|\.|\?\.|$))/
export function statements(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  const out = []
  let lead = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^\s*$/.test(l) || /^(\/\/|\/\*| \*)/.test(l)) { if (lead == null) lead = i + 1; continue }
    if (/^[^\s}\])]/.test(l)) {
      if (!STATEMENT.test(l)) return null
      out.push({ from: lead ?? i + 1, to: i + 1, at: i + 1 })
    } else if (out.length) out[out.length - 1].to = i + 1
    else return null
    lead = null
  }
  if (out.length) out[out.length - 1].to = lines.length
  for (const s of out) {
    s.code = lines.slice(s.at - 1, s.to).filter((l) => !/^\s*\/\//.test(l)).join('\n')
    const c = s.code.replace(/^export\s+(default\s+)?/, '')
    s.exported = c !== s.code
    s.names = []
    let m
    if (/^import\b/.test(c)) {
      s.kind = 'import'
      s.spec = (c.match(/\bfrom\s*['"]([^'"]+)['"]/) || c.match(/^import\s*['"]([^'"]+)['"]/) || [])[1] || null
      const head = c.replace(/\bfrom\s*['"][^'"]+['"][\s\S]*$/, '').replace(/^import\s*/, '')
      for (const x of head.matchAll(/\*\s*as\s+([\w$]+)|([\w$]+)\s+as\s+([\w$]+)|([\w$]+)/g)) s.names.push(x[1] || x[3] || x[4])
    } else if ((m = c.match(/^(?:async\s+)?function\*?\s*([\w$]+)|^class\s+([\w$]+)/))) {
      s.kind = 'def'
      s.names.push(m[1] || m[2])
    } else if ((m = c.match(/^(?:const|let|var)\s+([\w$]+|\{[^=]*\}|\[[^=]*\])/))) {
      s.kind = 'def'
      s.names.push(...(/^[{[]/.test(m[1]) ? [...m[1].matchAll(/([\w$]+)(?!\s*:)/g)].map((x) => x[1]) : [m[1]]))
      s.alias = (c.match(/^(?:const|let|var)\s+[\w$]+\s*=\s*(?:await\s+)?(?:new\s+)?([\w$]+)(?:\.[\w$]+)?\(/) || [])[1] || null
    } else if ((m = c.match(/^app\.(?:get|post|put|delete|patch|all|use)\(\s*((['"`])\/[^'"`]*\2|\[(?:\s*(['"`])\/[^'"`]*\3\s*,?)+\s*\])/))) {
      s.kind = 'route'
      s.routes = [...m[1].matchAll(/['"`](\/[^'"`]*)['"`]/g)].map((x) => x[1])
    } else s.kind = 'other'
    // The names it uses (not a property's: .x), its own words in strings too.
    s.words = new Set([...s.code.matchAll(/(?<![.\w$])[A-Za-z_$][\w$]*/g)].map((x) => x[0]))
  }
  return out
}

// Where the app and the tests ask for a route: the files in src/ that have its address in them
// (/studio/recent, /agents/${id}/files for /api/agents/:pane/files), and the suites (or helpers they
// use) that do.
const usersAt = new Map()
const PARAM = /^:|[*()?+{}[\]]/ // a part of an address that stands for any (:pane, {*splat})
function routeUsers(root, tests) {
  if (usersAt.has(root)) return usersAt.get(root)
  const src = srcTexts(root)
  const test = tests.all.filter((f) => /^test\/(suites|lib)\/.*\.mjs$/.test(f) && f !== 'test/lib/harness.mjs').map((f) => [f, tests.text(f)])
  const seen = new Map()
  const of = (route) => {
    if (seen.has(route)) return seen.get(route)
    const parts = route.replace(/^\/api(?=\/|$)/, '').split('/').filter(Boolean)
    const out = { files: new Set(), suites: new Set() }
    if (parts.some((p) => !PARAM.test(p))) {
      const re = new RegExp(`/${parts.map((p) => (PARAM.test(p) ? '[^/\'"`\\s?]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}(?![\\w-])`)
      for (const [f, t] of src) if (re.test(t)) out.files.add(f)
      for (const [f, t] of test) if (re.test(t)) for (const n of f.startsWith('test/suites/') ? [path.posix.basename(f, '.mjs')] : tests.usersOf(f)) out.suites.add(n)
    }
    seen.set(route, out)
    return out
  }
  usersAt.set(root, of)
  return of
}

// What a change to server/index.js picks (pick above): for each top-level statement it touches, in
// the file as it was or as it is,
// - an import of a file here: that file (one of a package: every test);
// - a route (app.get('/api/x', …)): the files here it calls (by the names it imports from them, or a
//   value made by one: const remote = makeRemote(…)), and the app's files and the tests that ask
//   for its address; failing those, what the values it uses call; failing that, every test;
// - a function or value it defines: what it calls, and what each statement using it picks;
// - anything else (what's set up as the server starts, middleware every request goes through): what
//   it calls, or every test when it calls nothing of its own (app.use(…) with no address is always
//   every test).
// { files, suites, every }: the files to count as changed, suites to run, and every for all of them.
export function indexChange({ before, after, diff, users }) {
  const was = parse(before)
  const is = parse(after)
  if (!was || !is) return { every: true }
  const touched = touchedBy(was, is, diff)
  if (!touched) return { every: true }
  const out = { files: new Set(), suites: new Set(), every: false }
  for (const [side, s] of touched) {
    const r = side.picks(s, users)
    if (r.every) return { every: true }
    r.files.forEach((f) => out.files.add(f))
    r.suites.forEach((x) => out.suites.add(x))
  }
  return out
}
// What the statements in server/index.js that use a file's names pick (a file in shared/ changed).
export function indexUsersOf(text, file, users) {
  const is = parse(text)
  if (!is) return { every: true }
  const out = { files: new Set(), suites: new Set(), every: false }
  for (const s of is.list.filter((x) => x.kind === 'import' && is.fileOf(x) === file)) {
    for (const u of is.list.filter((x) => x !== s && s.names.some((n) => x.words.has(n)))) {
      const r = is.picks(u, users)
      if (r.every) return { every: true }
      r.files.forEach((f) => out.files.add(f))
      r.suites.forEach((x) => out.suites.add(x))
    }
  }
  return out
}
const parse = (text) => {
  if (text == null) return null
  const list = statements(text)
  if (!list) return null
  const fileOf = (s) => (s.spec && /^\.{1,2}\//.test(s.spec) ? path.posix.normalize(path.posix.join('server', s.spec)) : null)
  const mod = new Map() // a name -> the file here it's imported from, or a value one made
  for (const s of list) if (s.kind === 'import' && fileOf(s)) for (const n of s.names) mod.set(n, fileOf(s))
  for (const s of list) if (s.kind === 'def' && s.alias && mod.has(s.alias)) for (const n of s.names) mod.set(n, mod.get(s.alias))
  const defs = new Map() // a name -> the statements defining it
  for (const s of list) if (s.kind === 'def') for (const n of s.names) defs.set(n, [...(defs.get(n) || []), s])
  const filesOf = (s) => new Set([...s.words].filter((w) => mod.has(w) && !(s.kind === 'import')).map((w) => mod.get(w)))
  const memo = new Map()
  const picks = (s, users) => {
    if (memo.has(s)) return memo.get(s)
    const r = { files: new Set(), suites: new Set(), every: false }
    memo.set(s, r) // (a statement using another that uses it: once is enough)
    const own = filesOf(s)
    if (s.kind === 'import') {
      const f = fileOf(s)
      if (f) r.files.add(f)
      else r.every = true
    } else if (s.kind === 'route') {
      // (One for every address, as the app's page is served: every test.)
      if (s.routes.some((x) => !x.replace(/^\/api(?=\/|$)/, '').split('/').some((p) => p && !PARAM.test(p)))) r.every = true
      for (const x of s.routes) { const u = users(x); u.files.forEach((f) => r.files.add(f)); u.suites.forEach((n) => r.suites.add(n)) }
      own.forEach((f) => r.files.add(f))
      if (!r.files.size && !r.suites.size) callsOf(s).forEach((f) => r.files.add(f))
      if (!r.files.size && !r.suites.size) r.every = true
    } else if (s.kind === 'def' && s.alias && mod.has(s.alias)) {
      // A value a file here makes (const desk = makeFrontDesk({ ask: setupAsk })) is that file: what's
      // handed to it changes what it does, not what everything using desk does.
      own.forEach((f) => r.files.add(f))
    } else if (s.kind === 'def') {
      own.forEach((f) => r.files.add(f))
      const using = list.filter((x) => x !== s && s.names.some((n) => x.words.has(n)))
      if (s.exported || (!using.length && !own.size)) r.every = true
      for (const u of using) {
        const q = picks(u, users)
        if (q.every) { r.every = true; break }
        q.files.forEach((f) => r.files.add(f))
        q.suites.forEach((x) => r.suites.add(x))
      }
    } else {
      // (setInterval(routineTick, …) is about what routineTick calls.)
      own.forEach((f) => r.files.add(f))
      if (!own.size) callsOf(s).forEach((f) => r.files.add(f))
      if (!r.files.size || /^app\.use\(/.test(s.code)) r.every = true
    }
    return r
  }
  // What the values and functions a statement uses call (the files here they use by name).
  const callsOf = (s) => new Set([...s.words].flatMap((w) => (defs.get(w) || []).filter((d) => d !== s).flatMap((d) => [...filesOf(d)])))
  return { list, picks, fileOf }
}
