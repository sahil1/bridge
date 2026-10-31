// Stand-in for every installer a test's server would run (its BRIDGE_INSTALL_STANDIN): it says what
// would have run, shows some progress like an installer, and for an agent's install leaves a
// stand-in of that agent in the test's bin folder (beside this one), so Bridge AI finds it
// installed. Each command goes in installs.log there. Setup's line on a Mac (scripts/setup-mac.sh)
// asks for the Mac's password first when it installs Apple's developer tools or Homebrew: so does
// this, as sudo does, and it carries on once a line is typed (noted in passwords.log; "no" stands
// for a password that didn't work: it stops the way setup-mac.sh does).
//   installer.cjs <the command that would have run, in base64>
const fs = require('node:fs')
const path = require('node:path')

const cmd = Buffer.from(process.argv[2] || '', 'base64').toString('utf8')
const bin = __dirname
fs.appendFileSync(path.join(bin, 'installs.log'), `${cmd}\n`)
const AGENTS = [[/claude\.ai\/install|@anthropic-ai\/claude-code|cask claude-code/, 'claude'], [/chatgpt\.com\/codex|@openai\/codex|cask codex/, 'codex'], [/gemini-cli/, 'gemini'], [/copilot/i, 'copilot'], [/cursor\.com\/install/, 'cursor-agent'], [/qwen-code/, 'qwen']]
const agent = AGENTS.find(([re]) => re.test(cmd))?.[1]
const say = (s) => process.stdout.write(`${s}\n`)
const go = () => {
  say(`(A test: this stands in for ${cmd})`)
  say(`Setting up ${agent || 'it'}...`)
  setTimeout(() => say('Downloading 64%'), 300)
  setTimeout(() => {
    if (agent) {
      const js = path.join(bin, `${agent}.cjs`)
      fs.writeFileSync(js, "console.log('1.0.0 (stand-in)')\n")
      if (process.platform === 'win32') fs.writeFileSync(path.join(bin, `${agent}.cmd`), `@"${process.execPath}" "${js}" %*\r\n`)
      else fs.writeFileSync(path.join(bin, agent), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 })
    }
    say('Installed.')
  }, 4000)
}
if (/setup-mac\.sh/.test(cmd) && /\s(devtools|homebrew)(\s|$)/.test(cmd)) {
  process.stdout.write('Password for this Mac, to set up Bridge AI: ')
  let typed = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (d) => {
    typed += d
    if (!/[\r\n]/.test(typed)) return
    process.stdin.destroy()
    say('')
    fs.appendFileSync(path.join(bin, 'passwords.log'), 'typed\n')
    if (typed.trim() !== 'no') return go()
    say('Sorry, try again.')
    say('')
    say('Setup stopped before the end. What went wrong is above. Close this tab, then try again in Bridge AI.')
    process.exitCode = 1
  })
} else go()
