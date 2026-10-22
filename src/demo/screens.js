// What each made-up agent's terminal shows, drawn from its conversation the way that CLI draws it:
// the Terminal tab, the phone's Terminals list, the status line Chat reads while it works, and
// the question picker that becomes a card.
export const COLS = 64
export const ROWS = 30

const E = '\x1b['
const c = (code, s) => `${E}${code}m${s}${E}0m`
const dim = (s) => c('2', s)
const bold = (s) => c('1', s)
const orange = (s) => c('38;5;209', s)
const green = (s) => c('38;5;114', s)
const blue = (s) => c('38;5;111', s)
const gray = (s) => c('38;5;245', s)
const rule = (ch = '─') => gray(ch.repeat(COLS))
const clean = (s) => String(s).replace(/\*\*|`/g, '').replace(/^#+\s*/gm, '')

// Word wrap to the screen, with a first-line prefix and an indent for the rest.
function wrap(text, first, rest, width = COLS) {
  const out = []
  for (const para of clean(text).split('\n')) {
    let line = ''
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) { out.push(''); continue }
    for (const w of words) {
      const room = width - (out.length ? rest.length : first.length) - 1
      if (line && (line + ' ' + w).length > room) { out.push(line); line = w } else line = line ? `${line} ${w}` : w
    }
    out.push(line)
  }
  return out.map((l, i) => (i === 0 ? first : rest) + l)
}

// Paths as the CLI shows them: inside the agent's folder, relative to it.
const rel = (a, s) => String(s || '').replace(`${a.cwd}/`, '').replace(a.cwd.replace(/^\/Users\/[^/]+/, '~') + '/', '')
const fit = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const secs = (since) => `${Math.max(1, Math.round((Date.now() - since) / 1000))}s`
const ktok = (since) => `${(1 + (Date.now() - since) / 9000).toFixed(1)}k`

// ---------- Claude Code ----------
function claude(a) {
  const out = []
  for (const m of a.log.slice(-14)) {
    if (m.role === 'user') out.push('', ...wrap(m.text, `${gray('>')} `, '  ').map((l) => gray(l)))
    else if (m.role === 'assistant') out.push('', ...wrap(m.text, '⏺ ', '  '))
    else if (m.role === 'tool') out.push('', `${green('⏺')} ${bold(m.tool)}(${fit(rel(a, m.hint), COLS - m.tool.length - 4)})`, gray(`  ⎿  ${m.out || (m.changes ? `Updated with ${m.changes[0].add} addition${m.changes[0].add === 1 ? '' : 's'} and ${m.changes[0].del} removal${m.changes[0].del === 1 ? '' : 's'}` : 'Done')}`))
    else if (m.role === 'event') out.push('', gray(`  ⎿  ${m.text}`))
  }
  if (a.status === 'working') out.push('', orange(`✻ ${a.doing || 'Working'}… `) + gray(`(${secs(a.since)} · ↓ ${ktok(a.since)} tokens)`))
  if (a.question) out.push(...question(a.question))
  else out.push('', rule(), `${gray('❯')} ${a.draft || ''}`, rule(), gray('  ⏵⏵ accept edits on (shift+tab to cycle)'))
  return out
}

// Claude's question picker: a tab row, the question, numbered options.
function question(q) {
  const opts = q.options.flatMap((o, i) => [`${i === 0 ? blue('❯') : ' '} ${i === 0 ? blue(`${i + 1}. ${o.label}`) : `${i + 1}. ${o.label}`}`, gray(`     ${o.desc}`)])
  const n = q.options.length
  return [
    '', rule(),
    ` ←  ${E}48;5;24m ☐ ${q.tab} ${E}0m  ✔ Submit  →`,
    '', ...wrap(q.text, '', ''), '',
    ...opts,
    `  ${n + 1}. Type something.`,
    rule(),
    `  ${n + 2}. Chat about this`,
    '', gray('Enter to select · ↑/↓ to navigate · Esc to cancel'),
  ]
}

// ---------- Codex ----------
function codex(a) {
  const out = [gray('╭──────────────────────────────────────────────╮'), `${gray('│')} ${bold('>_ OpenAI Codex')} ${gray('(v0.48)')}                       ${gray('│')}`, `${gray('│')} ${gray('directory:')} ${a.cwd.replace(/^\/Users\/[^/]+/, '~').slice(-33).padEnd(33)} ${gray('│')}`, gray('╰──────────────────────────────────────────────╯')]
  for (const m of a.log.slice(-12)) {
    if (m.role === 'user') out.push('', ...wrap(m.text, `${gray('›')} `, '  '))
    else if (m.role === 'assistant') out.push('', ...wrap(m.text, '• ', '  '))
    else if (m.role === 'tool') out.push('', `${green('•')} ${bold(m.tool === 'shell' ? 'Ran' : 'Edited')} ${fit(rel(a, m.hint), COLS - 10)}`, gray(`  └ ${m.out || (m.changes ? `+${m.changes[0].add} -${m.changes[0].del}` : 'done')}`))
  }
  if (a.status === 'working') out.push('', `${gray('•')} ${a.doing || 'Working'} ${gray(`(${secs(a.since)} • esc to interrupt)`)}`)
  out.push('', `${gray('›')} ${a.draft || gray('Ask Codex to do anything')}`, '', gray('  ⏎ send   ⇧⏎ newline   ⌃T transcript   ⌃C quit'))
  return out
}

// ---------- OpenCode and Gemini CLI: their own looks, simply ----------
function opencode(a) {
  const out = [`${bold('opencode')} ${gray('v1.0  ·  billing-api  ·  claude-sonnet-5-5')}`, rule('━')]
  for (const m of a.log.slice(-12)) {
    if (m.role === 'user') out.push('', ...wrap(m.text, `${blue('┃')} `, `${blue('┃')} `))
    else if (m.role === 'assistant') out.push('', ...wrap(m.text, '  ', '  '))
    else if (m.role === 'tool') out.push('', gray(`  ${m.tool === 'shell' ? '$' : '✱'} ${fit(rel(a, m.hint), COLS - 20)}${m.out ? `  ${m.out}` : ''}`))
  }
  if (a.status === 'working') out.push('', `  ${orange('⬝⬝■⬝')} ${a.doing || 'Working'} ${gray('  esc to interrupt')}`)
  out.push('', rule('━'), `${blue('>')} ${a.draft || ''}`, rule('━'), gray(' enter send   ctrl+x h help'))
  return out
}

function gemini(a) {
  const out = [blue(' ██ Gemini CLI'), gray(' Tips: ask questions, edit files, or run commands.')]
  for (const m of a.log.slice(-12)) {
    if (m.role === 'user') out.push('', ...wrap(m.text, `${gray('>')} `, '  '))
    else if (m.role === 'assistant') out.push('', ...wrap(m.text, `${blue('✦')} `, '  '))
    else if (m.role === 'tool') out.push('', gray(`╭${'─'.repeat(COLS - 2)}╮`), `${gray('│')} ${green('✓')} ${bold('Shell')} ${fit(m.hint, COLS - 14)}`, gray(`╰${'─'.repeat(COLS - 2)}╯`))
  }
  if (a.status === 'working') out.push('', `${orange('⠋')} ${a.doing || 'Working'} ${gray('(esc to cancel)')}`)
  out.push('', gray(`╭${'─'.repeat(COLS - 2)}╮`), `${gray('│')} ${blue('>')} ${a.draft || gray('Type your message')}`, gray(`╰${'─'.repeat(COLS - 2)}╯`), gray(' ~/code/docs-site (main)        no sandbox        gemini-3-pro'))
  return out
}

const DRAW = { claude, codex, opencode, gemini }

// A plain terminal tab running a dev server.
export function shell(s) {
  return [
    `${green('➜')}  ${blue('acme-shop')} ${gray('git:(')}main${gray(')')} pnpm dev`, '',
    `> acme-shop@0.0.0 dev ${s.cwd.replace(/^\/Users\/[^/]+/, '~')}`, '> vite', '',
    `  ${green('VITE v7.1.4')}  ready in ${bold('412')} ms`, '',
    `  ${green('➜')}  ${bold('Local')}:   ${blue('http://localhost:5173/')}`,
    `  ${gray('➜  Network: use --host to expose')}`,
    `  ${gray('➜  press h + enter to show help')}`,
    ...s.lines,
    ...(s.draft ? ['', s.draft] : []),
  ].join('\r\n')
}

export function screenOf(a, lines = ROWS) {
  const all = (DRAW[a.kind] || claude)(a)
  return all.slice(-Math.max(lines, 1)).join('\r\n')
}
