// Stand-in agent with a long history (put on PATH as `claude` by test/suites/terminal-scroll.mjs):
//   claude --version | claude auth status   as Claude Code answers them
//   claude --session-id <id> "plain <n>"    prints n numbered lines ("line 1 of the agent's output"),
//                                           then its prompt, and waits; what's typed shows after it
//   claude --session-id <id> "busy <n>"     the same, then one more line every 300 ms, as an agent
//                                           at work does
//   claude --session-id <id> "fullscreen <n>"  n lines kept in a full-screen view of its own, as
//                                           Claude Code's fullscreen renderer keeps them: the
//                                           alternate screen, mouse reports on (SGR), the latest
//                                           lines over its input box. Each wheel report scrolls it
//                                           three lines (64 up, 65 down), Page Up/Down a page.
// What it's sent goes in ~/agent-input.log, one JSON string a line.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const args = process.argv.slice(2)
if (args.includes('--version')) { console.log('2.1.312 (Claude Code)'); process.exit(0) }
if (args[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' })); process.exit(0) }
const [mode, count] = String(args.at(-1) || '').split(' ')
const N = Number(count) || 8000
const line = (i) => `line ${i} of the agent's output`
const log = (s) => fs.appendFileSync(path.join(os.homedir(), 'agent-input.log'), `${JSON.stringify(s)}\n`)
process.stdin.setRawMode?.(true)
process.stdin.resume()

if (mode === 'fullscreen') {
  const all = Array.from({ length: N }, (_, i) => line(i + 1))
  let up = 0 // lines scrolled up from the latest
  const draw = () => {
    const rows = process.stdout.rows || 40
    const cols = process.stdout.columns || 120
    const end = all.length - up
    const view = all.slice(Math.max(0, end - (rows - 3)), end)
    let s = '\x1b[H\x1b[2J'
    view.forEach((l, i) => { s += `\x1b[${i + 1};1H${l}` })
    s += `\x1b[${rows - 2};1H${'─'.repeat(cols)}\x1b[${rows - 1};1H❯ \x1b[${rows};1H${'─'.repeat(cols)}`
    process.stdout.write(s)
  }
  process.stdout.write('\x1b[?1049h\x1b[?1000h\x1b[?1006h')
  draw()
  process.stdout.on('resize', draw)
  process.stdin.on('data', (d) => {
    const s = d.toString()
    log(s)
    const page = (process.stdout.rows || 40) - 3
    for (const m of s.matchAll(/\x1b\[<(\d+);\d+;\d+M/g)) {
      if (m[1] === '64') up = Math.min(all.length - 1, up + 3)
      if (m[1] === '65') up = Math.max(0, up - 3)
    }
    if (s.includes('\x1b[5~')) up = Math.min(all.length - 1, up + page)
    if (s.includes('\x1b[6~')) up = Math.max(0, up - page)
    draw()
  })
} else {
  let out = ''
  for (let i = 1; i <= N; i++) out += `${line(i)}\r\n`
  process.stdout.write(`${out}❯ `)
  let n = N
  process.stdin.on('data', (d) => { log(d.toString()); process.stdout.write(d) })
  if (mode === 'busy') setInterval(() => process.stdout.write(`\r\x1b[2K${line(++n)}\r\n❯ `), 300)
}
setInterval(() => {}, 1000)
