// Packaging step for `npm run desktop:dist`: put a copy of Bridge AI (server, built UI, chief of
// staff templates, production dependencies) in build/app-root, which goes inside the app. The app
// runs it on its own Node, so the people you give it to need nothing else.
// No personal data goes in: settings and history live in each person's ~/.bridge-ai.
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const REPO = path.resolve(__dirname, '..')
const OUT = path.join(__dirname, 'build', 'app-root')
const IS_WIN = process.platform === 'win32'
const npm = IS_WIN ? 'npm.cmd' : 'npm'
const run = (args, cwd) => {
  const r = spawnSync(npm, args, { cwd, stdio: 'inherit', shell: IS_WIN })
  if (r.status) process.exit(r.status)
}

console.log('Building the UI...')
if (!fs.existsSync(path.join(REPO, 'node_modules'))) run(['install', '--no-audit', '--no-fund'], REPO)
run(['run', 'build'], REPO)

console.log('Copying Bridge AI into the app...')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
// The server shares two files with the UI: the MCP server catalog, and how a question is read
// off an agent's screen. shared/ holds code the server and the phone apps both run (cloud agents).
const COPY = ['server', 'shared', 'scripts', 'chief', 'relay', 'dist', 'src/components/settings/mcpCatalog.js', 'src/components/questionParse.js', 'package.json', 'package-lock.json', '.npmrc', 'config.example.json', 'LICENSE', 'NOTICE', 'README.md']
// Only files git knows about: tracked, or new and not ignored (dist/ is built just above). So
// nothing ignored, like your settings or a filled-in chief of staff note, rides along into the
// app; the privacy check below looks at the rest.
const tracked = (() => {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...COPY], { cwd: REPO, encoding: 'utf8' })
  return r.status === 0 && r.stdout ? new Set(r.stdout.split('\0').filter(Boolean).map((f) => path.normalize(f))) : null
})()
for (const p of COPY) {
  const from = path.join(REPO, p)
  if (!fs.existsSync(from)) continue
  const filter = tracked && p !== 'dist' ? (src) => fs.statSync(src).isDirectory() || tracked.has(path.relative(REPO, src)) : undefined
  fs.cpSync(from, path.join(OUT, p), { recursive: true, filter })
}
// Source maps are for development; leave them out of the app.
for (const f of fs.readdirSync(path.join(OUT, 'dist', 'assets'))) if (f.endsWith('.map')) fs.rmSync(path.join(OUT, 'dist', 'assets', f))

// The call-sound helper for meeting notes (native/calltap.swift), built here on a Mac with Xcode's
// tools; without it, meetings record the mic only.
if (process.platform === 'darwin') spawnSync(process.execPath, [path.join(REPO, 'scripts', 'calltap.js'), path.join(OUT, 'native', 'bin')], { stdio: 'inherit' })

// Nothing personal goes in the app: check what's about to be packaged.
const check = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'check-private.js'), '--dir', OUT], { stdio: 'inherit' })
if (check.status) process.exit(check.status)

// Only what the server uses. The UI's libraries (React, the markdown and code highlighters, the
// icon set) are already compiled into dist/, so they stay out: a smaller app opens faster,
// especially the first time, when macOS checks every file in it.
const used = new Set()
const scan = (p) => {
  if (fs.statSync(p).isDirectory()) return fs.readdirSync(p).forEach((f) => scan(path.join(p, f)))
  if (!/\.(m?js|cjs)$|[\\/]bridge$/.test(p)) return
  const src = fs.readFileSync(p, 'utf8')
  for (const m of src.matchAll(/(?:from\s+|import\(\s*|require\(\s*)['"]((?:@[^/'"]+\/)?[^./'"][^/'"]*)/g)) used.add(m[1])
  for (const m of src.matchAll(/localBin\(\s*['"]([^'"]+)/g)) used.add(m[1])
}
for (const d of ['server', 'shared', 'scripts', 'chief']) scan(path.join(OUT, d))
const pkgFile = path.join(OUT, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
const all = Object.keys(pkg.dependencies || {})
pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies || {}).filter(([d]) => used.has(d)))
delete pkg.devDependencies
if (pkg.scripts) delete pkg.scripts.prepare // sets up git hooks in a clone; the app isn't one
// Which build this is, so the app can tell its own server from one an older build left running.
pkg.bridgeBuild = new Date().toISOString()
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
console.log(`Installing what the server uses: ${Object.keys(pkg.dependencies).join(', ')} (left out: ${all.filter((d) => !used.has(d)).join(', ')})`)
run(['install', '--omit=dev', '--no-audit', '--no-fund'], OUT) // versions from package-lock.json
fs.rmSync(path.join(OUT, 'package-lock.json'), { force: true })

// node-pty ships source and every platform's binaries; keep this platform's binaries only.
const pty = path.join(OUT, 'node_modules', 'node-pty')
for (const d of ['deps', 'third_party', 'src', 'scripts']) fs.rmSync(path.join(pty, d), { recursive: true, force: true })
const pre = path.join(pty, 'prebuilds')
if (fs.existsSync(pre)) for (const d of fs.readdirSync(pre)) if (!d.startsWith(process.platform)) fs.rmSync(path.join(pre, d), { recursive: true, force: true })

// npm leaves node-pty's helper non-executable; terminals can't start without it.
const prebuilds = path.join(OUT, 'node_modules', 'node-pty', 'prebuilds')
if (fs.existsSync(prebuilds)) for (const d of fs.readdirSync(prebuilds)) {
  const h = path.join(prebuilds, d, 'spawn-helper')
  if (fs.existsSync(h)) fs.chmodSync(h, 0o755)
}
