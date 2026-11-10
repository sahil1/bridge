// No class made of a bare value. A className that puts in what something is (its kind, type, who
// said it, its status or state) prefixes it (k-idea, src-them, s-done), so it can't take on another
// part's rule of the same name. AI Assist's suggestion on the meeting card put its kind in as it was:
// an Idea took .idea, the Ideas list's row, and was laid out as one, its words in a column 18 pixels
// wide; a meeting's mail took .mail, the Mail list's row; an MCP command in the / menu took .mcp.
import fs from 'node:fs'
import path from 'node:path'
import { checks, ROOT } from '../lib/harness.mjs'

const { ok, done } = checks('class-names')

const files = []
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.jsx?$/.test(e.name)) files.push(p) } }
walk(path.join(ROOT, 'src'))

// Each className={`…`}'s ${…} that is a thing's kind, type, src, status or state (as it is, or
// || ''), and what comes right before it in the class list.
const VALUE = /^\s*(?:[\w$]+(?:\??\.[\w$]+)*\??\.)?(kind|type|src|status|state)\s*(?:\|\|\s*(?:''|""))?\s*$/
const bare = []
let seen = 0
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8')
  for (const m of s.matchAll(/className=\{`((?:[^`\\]|\\.)*)`\}/g)) {
    const tpl = m[1]
    for (const x of tpl.matchAll(/\$\{([^{}]*)\}/g)) {
      if (!VALUE.test(x[1])) continue
      seen++
      const before = tpl.slice(0, x.index)
      if (!/-$/.test(before)) bare.push(`${path.relative(ROOT, f)}:${s.slice(0, m.index).split('\n').length}: ${m[0].slice(0, 120)}`)
    }
  }
}
ok(seen >= 10, `(the app's classes made of what something is are found: ${seen})`, seen)
ok(!bare.length, 'each class made of what something is has a prefix (k-, src-, s-…), so it can\'t take on another part\'s rule of the same name', bare)

// And the one the owner hit: no rule for the meeting card's suggestion matches a kind on its own.
const css = fs.readFileSync(path.join(ROOT, 'src', 'components', 'meetings', 'meetings.css'), 'utf8')
ok(/\.fc-tip\.k-check\b/.test(css) && !/\.fc-tip\.(check|idea|question|point)\b/.test(css), 'the card\'s suggestion is styled by its prefixed kind', css.match(/\.fc-tip\.[\w-]+/g))

process.exit(done().fail ? 1 : 0)
