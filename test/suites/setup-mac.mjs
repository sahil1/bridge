// What setup's Everything runs on a Mac (scripts/setup-mac.sh), run for real by bash, with stand-ins
// for sudo, softwareupdate, xcode-select, curl, brew, touch and rm (BRIDGE_SETUP_STANDINS), so
// nothing is installed, no password is asked and macOS's window never opens: Apple's command line
// developer tools installed exactly once whichever way they come (softwareupdate's newest label
// without a window; macOS's own window when it lists none; Homebrew's installer when Homebrew comes
// too, and then never softwareupdate), the password asked once at the start (in words the server
// knows to show as "needs you", on a clean screen that says what it's for and that nothing
// shows as you type) and kept fresh only while it runs, no password at all when only Homebrew's
// programs install, and a password that doesn't work stopping it with the words the server reads.
// Homebrew found where its installer puts it on an Intel Mac (/usr/local) and on Apple silicon
// (/opt/homebrew, before an older Intel one left on the PATH), with a stand-in uname and those
// folders under the stand-ins' root/; and when it's in neither, it says so and stops. Not on
// Windows, which has no bash and no developer tools to install.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, TEST, IS_WIN, checks } from '../lib/harness.mjs'

const { ok, skip, done } = checks('setup-mac')
const SCRIPT = path.join(ROOT, 'scripts', 'setup-mac.sh')
const PLACEHOLDER = '/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress'
// The server's reading of the Set up Bridge AI tab (server/index.js, tabSays): sudo's prompt, the
// line that says it stopped.
const ASKS = /password[^\n]*:$/i
const STOPPED = /^Setup stopped before the end\b/m

if (IS_WIN) {
  skip('setup-mac.sh', 'Windows has no bash and no developer tools to install')
  process.exit(done().fail ? 1 : 0)
}

// A folder of stand-ins, each logging what it was asked to do in log.txt. listing: what
// softwareupdate -l says. windowInstalls: macOS's window "installs" the tools when it opens.
// arch: what uname -m says (this computer's own, without it). brewAt: where Homebrew's installer
// puts brew (/usr/local, /opt/homebrew: under root/ here); onPath: a brew on the PATH too (without
// brewAt, the one Homebrew's installer leaves there).
function standIns({ listing = '', windowInstalls = false, sudoFails = false, arch = null, brewAt = null, onPath = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-setup-mac-'))
  const dev = path.join(dir, 'dev')
  const log = path.join(dir, 'log.txt')
  const node = (name, src) => {
    fs.writeFileSync(path.join(dir, `${name}.cjs`), `const fs = require('fs'), path = require('path'), dir = ${JSON.stringify(dir)}, a = process.argv.slice(2)\nconst log = (s) => fs.appendFileSync(path.join(dir, 'log.txt'), s + '\\n')\n${src}`)
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, `${name}.cjs`)}" "$@"\n`, { mode: 0o755 })
  }
  // The tools "installed": a folder with a git, named in devtools.txt (stand-ins/xcode-select.cjs).
  const install = `fs.mkdirSync(path.join(dir, 'dev', 'usr', 'bin'), { recursive: true }); fs.writeFileSync(path.join(dir, 'dev', 'usr', 'bin', 'git'), '#!/bin/sh\\n', { mode: 0o755 }); fs.writeFileSync(path.join(dir, 'devtools.txt'), path.join(dir, 'dev'))`
  // sudo: -v asks (prints its prompt, -p's words), -n -v keeps it fresh; anything else runs as is.
  node('sudo', `
if (a[0] === '-v') { const p = a[a.indexOf('-p') + 1] || 'Password:'; process.stdout.write(p + '\\n'); log('sudo asked: ' + p); process.exit(${sudoFails ? 1 : 0}) }
if (a[0] === '-n') { log('sudo kept fresh'); process.exit(0) }
log('sudo ' + a.join(' '))
const r = require('child_process').spawnSync(a[0], a.slice(1), { stdio: 'inherit' })
process.exit(r.status ?? 1)`)
  node('softwareupdate', `
if (a[0] === '-l') { process.stdout.write(${JSON.stringify(listing)}); process.exit(0) }
log('softwareupdate ' + a.join(' '))
if (a[0] === '-i') { ${install} }`)
  node('touch', `log('touch ' + a.join(' '))`)
  node('rm', `log('rm ' + a.join(' '))`)
  // macOS's window: logged by the shared stand-in; "installs" them here when it's meant to.
  fs.copyFileSync(path.join(TEST, 'stand-ins', 'xcode-select.cjs'), path.join(dir, 'xcode-select-real.cjs'))
  node('xcode-select', `
if (a[0] !== '-p') log('xcode-select ' + a.join(' '))
if (a[0] === '--install' && ${windowInstalls}) { ${install} }
require('./xcode-select-real.cjs')`)
  // Homebrew's installer, as curl fetches it: bash that notes it ran and, as the real one does on a
  // Mac without them, brings the developer tools.
  node('curl', `
log('curl ' + a.join(' '))
process.stdout.write('echo "Homebrew installer (stand-in)"; "${process.execPath}" "' + path.join(dir, 'brought.cjs') + '"; echo "brew installer ran NONINTERACTIVE=$NONINTERACTIVE" >> "' + path.join(dir, 'log.txt') + '"')`)
  const placed = brewAt ? `const b = path.join(dir, 'root', ${JSON.stringify(brewAt)}, 'bin'); fs.mkdirSync(b, { recursive: true }); fs.writeFileSync(path.join(b, 'brew'), '#!/bin/sh\\necho "brew (${brewAt}) $* HOMEBREW_NO_ASK=$HOMEBREW_NO_ASK" >> ' + JSON.stringify(path.join(dir, 'log.txt')) + '\\n', { mode: 0o755 })` : ''
  fs.writeFileSync(path.join(dir, 'brought.cjs'), `const fs = require('fs'), path = require('path'), dir = ${JSON.stringify(dir)}\n${install}\n${placed}\n`)
  if (onPath) node('brew', `log('brew ' + a.join(' ') + ' HOMEBREW_NO_ASK=' + process.env.HOMEBREW_NO_ASK)`)
  if (arch) node('uname', `process.stdout.write(a[0] === '-m' ? ${JSON.stringify(arch)} + '\\n' : 'Darwin\\n')`)
  return { dir, dev, lines: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) }
}
// bare: only the system's own folders on the PATH, so no Homebrew of this computer's is found.
const run = (s, ...args) => {
  const bare = args[0] === 'bare'
  if (bare) args.shift()
  const r = spawnSync('/bin/bash', [SCRIPT, ...args], { env: { PATH: bare ? '/usr/bin:/bin' : process.env.PATH, HOME: os.tmpdir(), BRIDGE_SETUP_STANDINS: s.dir }, encoding: 'utf8', timeout: 30000 })
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, timedOut: r.error?.code === 'ETIMEDOUT' }
}
const count = (lines, re) => lines.filter((l) => re.test(l)).length
const LISTING = [
  'Software Update Tool',
  '',
  'Finding available software',
  'Software Update found the following new or updated software:',
  '* Label: Command Line Tools for Xcode-16.3',
  '\tTitle: Command Line Tools for Xcode, Version: 16.3, Size: 861139KiB, Recommended: YES, ',
  '* Label: Command Line Tools beta 2 for Xcode 27.0-27.0',
  '\tTitle: Command Line Tools beta 2 for Xcode, Version: 27.0, Size: 930000KiB, Recommended: YES, ',
  '* Label: Command Line Tools for Xcode 26.4-26.4.1',
  '\tTitle: Command Line Tools for Xcode 26.4, Version: 26.4.1, Size: 920104KiB, Recommended: YES, ',
  '* Label: macOS Tahoe 26.5-25F71',
  '\tTitle: macOS Tahoe 26.5, Version: 26.5, Size: 7340032KiB, Recommended: YES, Action: restart, ',
  '',
].join('\n')

try {
  // ---------- The developer tools alone, the way Homebrew's installer gets them ----------
  {
    const s = standIns({ listing: LISTING })
    const t0 = Date.now()
    const r = run(s, 'devtools')
    const l = s.lines()
    ok(r.status === 0 && !r.timedOut, 'the developer tools alone: it finishes', r.out.slice(-600))
    ok(r.status === 0 && Date.now() - t0 < 15000, 'and doesn\'t wait on what kept the password fresh', Date.now() - t0)
    const asked = l.filter((x) => x.startsWith('sudo asked: '))
    ok(asked.length === 1 && l[0].startsWith('sudo asked: '), 'your Mac\'s password is asked once, first', l)
    ok(ASKS.test(asked[0]?.slice(12).trim() || ''), 'in words the server shows as "needs you"', asked[0])
    const before = r.out.slice(0, r.out.indexOf('Password for this Mac'))
    ok(/^\x1b\[2J\x1b\[H/.test(r.out) && /Setting up Bridge AI: Apple's command line developer tools\./.test(before) && /the one you log in to this Mac with/.test(before) && /Nothing shows as you type it/.test(before), 'on a clean screen that says what it sets up, which password, and that nothing shows as you type it', before)
    ok(l.includes('sudo kept fresh'), 'and kept fresh while it runs (installing the tools takes longer than sudo remembers it)', l)
    ok(count(l, /^softwareupdate -i /) === 1, 'they\'re installed exactly once', l)
    ok(l.includes('softwareupdate -i Command Line Tools for Xcode 26.4-26.4.1'), 'with the newest label softwareupdate lists (by Xcode version, not a beta)', l)
    ok(l.indexOf(`touch ${PLACEHOLDER}`) >= 0 && l.indexOf(`touch ${PLACEHOLDER}`) < l.findIndex((x) => x.startsWith('softwareupdate -i')) && l.indexOf(`rm -f ${PLACEHOLDER}`) > l.findIndex((x) => x.startsWith('softwareupdate -i')), 'with Homebrew\'s placeholder file there while it lists them, and gone after', l)
    ok(r.status === 0 && !l.some((x) => /xcode-select --install/.test(x)) && !l.some((x) => /^curl /.test(x)), 'no window from macOS, and no Homebrew', l)
    fs.rmSync(s.dir, { recursive: true, force: true })
  }

  // ---------- Not listed: macOS's own window, then on once they're in ----------
  {
    const s = standIns({ listing: 'Software Update Tool\n\nFinding available software\nNo new software available.\n', windowInstalls: true })
    const r = run(s, 'devtools')
    const l = s.lines()
    ok(r.status === 0, 'softwareupdate lists none: it still finishes', r.out.slice(-600))
    ok(count(l, /xcode-select --install/) === 1 && count(l, /^softwareupdate -i/) === 0, 'through macOS\'s own window instead, once', l)
    ok(/Click Install in the window macOS opened \(not Get Xcode\), then Agree/.test(r.out), 'and says to click Install there, not Get Xcode, then Agree (the server shows that as needing you)', r.out.slice(-600))
    fs.rmSync(s.dir, { recursive: true, force: true })
  }

  // ---------- With Homebrew: its installer brings them, so they aren't installed again ----------
  {
    const s = standIns({ listing: LISTING })
    const r = run(s, 'devtools', 'homebrew', 'ical-buddy')
    const l = s.lines()
    ok(r.status === 0, 'the developer tools with Homebrew: it finishes', r.out.slice(-600))
    ok(count(l, /^sudo asked: /) === 1, 'one password for both', l)
    ok(count(l, /^curl .*Homebrew\/install/) === 1 && count(l, /^brew installer ran NONINTERACTIVE=1$/) === 1, 'Homebrew\'s own installer, once, not stopping to ask for Return', l)
    ok(count(l, /^softwareupdate -i/) === 0 && count(l, /xcode-select --install/) === 0 && fs.existsSync(path.join(s.dir, 'devtools.txt')), 'the developer tools come with it (exactly once): never softwareupdate or macOS\'s window as well', l)
    ok(l.includes('brew install ical-buddy HOMEBREW_NO_ASK=1'), 'then icalBuddy, with the Homebrew just installed, without it asking to go on', l)
    fs.rmSync(s.dir, { recursive: true, force: true })
  }

  // ---------- Where Homebrew's installer puts it: /usr/local on an Intel Mac, /opt/homebrew on
  // Apple silicon; not on the PATH until your shell profile says so ----------
  {
    const s = standIns({ listing: LISTING, arch: 'x86_64', brewAt: '/usr/local', onPath: false })
    const r = run(s, 'bare', 'devtools', 'homebrew', 'ical-buddy')
    const l = s.lines()
    ok(r.status === 0 && l.includes('brew (/usr/local) install ical-buddy HOMEBREW_NO_ASK=1'), 'an Intel Mac: Homebrew is found in /usr/local, where its installer puts it there, and icalBuddy installs with it', l)
    ok(/Setting up Bridge AI: Apple's command line developer tools, Homebrew, icalBuddy\./.test(r.out), 'and the password screen names all three', r.out.slice(0, 400))
    fs.rmSync(s.dir, { recursive: true, force: true })
  }
  {
    const s = standIns({ listing: LISTING, arch: 'arm64', brewAt: '/opt/homebrew' })
    const r = run(s, 'devtools', 'homebrew', 'ical-buddy')
    const l = s.lines()
    ok(r.status === 0 && l.includes('brew (/opt/homebrew) install ical-buddy HOMEBREW_NO_ASK=1') && !l.some((x) => /^brew install /.test(x)), 'Apple silicon: the Homebrew just installed in /opt/homebrew, not an older (Intel) one left on the PATH', l)
    fs.rmSync(s.dir, { recursive: true, force: true })
  }
  {
    const s = standIns({ listing: LISTING, arch: 'x86_64', onPath: false })
    const r = run(s, 'bare', 'devtools', 'homebrew', 'ical-buddy')
    ok(r.status === 1 && /Homebrew's installer finished, but there's no brew in \S*\/root\/usr\/local\/bin\./.test(r.out) && STOPPED.test(r.out), 'Homebrew\'s installer done and no brew where it goes: it says so, and stops with the words the server reads', r.out.slice(-400))
    fs.rmSync(s.dir, { recursive: true, force: true })
  }

  // ---------- Only Homebrew's programs: nothing asks ----------
  {
    const s = standIns()
    const r = run(s, `brew=${path.join(s.dir, 'brew')}`, 'ical-buddy')
    const l = s.lines()
    ok(r.status === 0 && !l.some((x) => /^sudo/.test(x)), 'with Homebrew here and only its programs to install, no password', l)
    ok(l.includes('brew install ical-buddy HOMEBREW_NO_ASK=1'), 'and they install with it', l)
    fs.rmSync(s.dir, { recursive: true, force: true })
  }

  // ---------- A password that doesn't work ----------
  {
    const s = standIns({ listing: LISTING, sudoFails: true })
    const r = run(s, 'devtools')
    const l = s.lines()
    ok(r.status === 1 && STOPPED.test(r.out), 'a password that doesn\'t work: it stops, with the words the server reads', r.out.slice(-600))
    ok(l.some((x) => x.startsWith('sudo asked: ')) && !l.some((x) => /^(softwareupdate|touch|curl|brew)/.test(x)), 'and nothing else runs', l)
    fs.rmSync(s.dir, { recursive: true, force: true })
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
}
process.exit(done().fail ? 1 : 0)
