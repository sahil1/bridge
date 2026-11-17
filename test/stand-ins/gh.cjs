// Stand-in GitHub CLI for Bots' changes (bots-changes): opens no pull request anywhere, but answers
// as gh does, keeps each one in ~/gh-prs.json, and logs each call to ~/gh-calls.log ({ args, cwd,
// body }).
//   gh pr create --draft --title=… --body-file=- --base=… --head=…   prints the new pull request's
//                                       address; one for that branch already: "a pull request for
//                                       branch … already exists: <url>", exit 1
//   gh pr view <branch> --json url -q .url   that branch's pull request's address
//   gh pr merge …                       refused here: a test checks it's never asked
// ~/gh-signed-out there: every call says gh isn't signed in, as gh does.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const args = process.argv.slice(2)
const home = os.homedir()
const file = path.join(home, 'gh-prs.json')
const prs = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return [] } })()
const opt = (name) => { const a = args.find((x) => x.startsWith(`--${name}=`)); if (a) return a.slice(name.length + 3); const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null }
let body = ''
const done = (code, out = '', err = '') => {
  fs.appendFileSync(path.join(home, 'gh-calls.log'), `${JSON.stringify({ args, cwd: process.cwd(), body })}\n`)
  if (out) process.stdout.write(`${out}\n`)
  if (err) process.stderr.write(`${err}\n`)
  process.exit(code)
}
const go = () => {
  if (fs.existsSync(path.join(home, 'gh-signed-out'))) return done(4, '', 'To get started with GitHub CLI, please run:  gh auth login')
  if (args[0] === 'pr' && args[1] === 'create') {
    const head = opt('head')
    const had = prs.find((p) => p.head === head)
    if (had) return done(1, '', `a pull request for branch "${head}" into branch "${had.base}" already exists:\n${had.url}`)
    const n = 100 + prs.length + 1
    const pr = { number: n, url: `https://github.com/acme/app/pull/${n}`, head, base: opt('base'), title: opt('title'), draft: args.includes('--draft'), body }
    prs.push(pr)
    fs.writeFileSync(file, JSON.stringify(prs, null, 2))
    return done(0, `\nCreating draft pull request for ${head} into ${pr.base} in acme/app\n\n${pr.url}`)
  }
  if (args[0] === 'pr' && args[1] === 'view') {
    const pr = prs.find((p) => p.head === args[2])
    return pr ? done(0, pr.url) : done(1, '', `no pull requests found for branch "${args[2]}"`)
  }
  if (args[0] === 'pr' && args[1] === 'merge') return done(1, '', 'merging is not allowed in this test')
  return done(1, '', `unknown command ${args.join(' ')}`)
}
if (args.includes('--body-file=-')) {
  process.stdin.on('data', (d) => { body += d })
  process.stdin.on('end', go)
} else go()
