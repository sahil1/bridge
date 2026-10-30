// Stand-in for every installer a test's server would run (its BRIDGE_INSTALL_STANDIN): it says what
// would have run, shows some progress like an installer, and for an agent's install leaves a
// stand-in of that agent in the test's bin folder (beside this one), so Bridge AI finds it
// installed. Each command goes in installs.log there.
//   installer.cjs <the command that would have run, in base64>
const fs = require('node:fs')
const path = require('node:path')

const cmd = Buffer.from(process.argv[2] || '', 'base64').toString('utf8')
const bin = __dirname
fs.appendFileSync(path.join(bin, 'installs.log'), `${cmd}\n`)
const AGENTS = [[/claude\.ai\/install|@anthropic-ai\/claude-code|cask claude-code/, 'claude'], [/chatgpt\.com\/codex|@openai\/codex|cask codex/, 'codex'], [/gemini-cli/, 'gemini'], [/copilot/i, 'copilot'], [/cursor\.com\/install/, 'cursor-agent'], [/qwen-code/, 'qwen']]
const agent = AGENTS.find(([re]) => re.test(cmd))?.[1]
const say = (s) => process.stdout.write(`${s}\n`)
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
