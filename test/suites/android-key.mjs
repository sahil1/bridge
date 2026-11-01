// The Android app's release key (scripts/android-key.sh), run for real by bash with stand-ins for
// macOS's security (the Keychain) and gh (GitHub) and a home folder of its own, so no real Keychain,
// repo or key is touched. The dry run: a throwaway key in a folder of its own, its password in a file
// there, and neither stand-in asked anything; the keystore is what release builds sign with (RSA
// 4096, a self-signed certificate valid 30 years, alias bridge-ai, the password it was given),
// with Java reading it when there's a JDK here. For real, on a Mac: the key in Application Support
// readable only by you, its password in the Keychain, the three GitHub secrets made from them, the
// certificate's SHA-256 shown and the password never; and never a second key, whichever of the
// three places already has one. Then what CI does with it (from the workflows' files): the secret
// names the script sets are the ones the builds read, the APK is signed v2 and v3 and checked with
// apksigner, the release never waits on it, and pull requests build it with a throwaway key. Not on
// Windows, which has no bash (the workflow checks still run there).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { ROOT, OUT, IS_WIN, IS_MAC, checks } from '../lib/harness.mjs'

const { ok, skip, done } = checks('android-key')
const SCRIPT = path.join(ROOT, 'scripts', 'android-key.sh')
const read = (...p) => { try { return fs.readFileSync(path.join(ROOT, ...p), 'utf8') } catch { return '' } }
const SERVICE = 'Bridge AI Android release key'
const SECRETS = ['BRIDGE_ANDROID_P12', 'BRIDGE_ANDROID_PASSWORD', 'BRIDGE_ANDROID_ALIAS']
const mode = (f) => fs.statSync(f).mode & 0o777
const sha = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : '')

// A folder of stand-ins: security keeps its items in keychain.json, gh answers from gh.json
// ({ signedIn, admin, secrets: [names] }); each logs what it was asked to log.jsonl.
function standIns({ signedIn = true, admin = true, secrets = [], items = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-android-key-'))
  const home = path.join(dir, 'home')
  const tmp = path.join(dir, 'tmp')
  fs.mkdirSync(home)
  fs.mkdirSync(tmp)
  fs.writeFileSync(path.join(dir, 'gh.json'), JSON.stringify({ signedIn, admin, secrets }))
  fs.writeFileSync(path.join(dir, 'keychain.json'), JSON.stringify(items))
  const node = (name, src) => {
    fs.writeFileSync(path.join(dir, `${name}.cjs`), `const fs = require('fs'), path = require('path'), dir = ${JSON.stringify(dir)}, a = process.argv.slice(2)
const log = (o) => fs.appendFileSync(path.join(dir, 'log.jsonl'), JSON.stringify({ tool: ${JSON.stringify(name)}, ...o }) + '\\n')
const get = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined }
${src}`)
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, `${name}.cjs`)}" "$@"\n`, { mode: 0o755 })
  }
  node('security', `
const file = path.join(dir, 'keychain.json'), db = JSON.parse(fs.readFileSync(file, 'utf8')), key = get('-s') + '|' + get('-a')
if (a[0] === 'find-generic-password') {
  log({ cmd: 'find', s: get('-s'), a: get('-a'), w: a.includes('-w') })
  if (!(key in db)) { process.stderr.write('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\\n'); process.exit(44) }
  process.stdout.write(a.includes('-w') ? db[key].pw + '\\n' : 'keychain: "login.keychain-db"\\n')
  process.exit(0)
}
if (a[0] === 'add-generic-password') {
  if (key in db && !a.includes('-U')) { process.stderr.write('security: SecKeychainItemCreateFromContent: The specified item already exists in the keychain.\\n'); process.exit(45) }
  db[key] = { pw: get('-w'), label: get('-l'), comment: get('-j') }
  fs.writeFileSync(file, JSON.stringify(db))
  log({ cmd: 'add', s: get('-s'), a: get('-a'), pw: get('-w'), label: get('-l') })
  process.exit(0)
}
log({ cmd: a.join(' ') })
process.exit(1)`)
  node('gh', `
const file = path.join(dir, 'gh.json'), conf = JSON.parse(fs.readFileSync(file, 'utf8'))
if (a[0] === 'auth' && a[1] === 'status') { log({ cmd: 'auth status' }); process.exit(conf.signedIn ? 0 : 1) }
if (a[0] === 'api') { log({ cmd: 'api', path: a[1], jq: get('--jq') }); process.stdout.write(a[1] === 'repos/sahil1/bridge' && get('--jq') === '.permissions.admin' ? String(conf.admin) + '\\n' : '{}\\n'); process.exit(0) }
if (a[0] === 'secret' && a[1] === 'list') { log({ cmd: 'secret list', repo: get('--repo') }); process.stdout.write(conf.secrets.map((n) => n + '\\n').join('')); process.exit(0) }
if (a[0] === 'secret' && a[1] === 'set') {
  const value = fs.readFileSync(0, 'utf8')
  log({ cmd: 'secret set', name: a[2], repo: get('--repo'), value, body: get('--body') })
  if (!conf.secrets.includes(a[2])) conf.secrets.push(a[2])
  fs.writeFileSync(file, JSON.stringify(conf))
  process.stdout.write('Set Actions secret ' + a[2] + ' for ' + get('--repo') + '\\n')
  process.exit(0)
}
log({ cmd: a.join(' ') })
process.exit(1)`)
  const env = { PATH: `${dir}:/usr/bin:/bin`, HOME: home, TMPDIR: tmp, LANG: 'C' }
  const run = (...args) => spawnSync('/bin/bash', [SCRIPT, ...args], { env, encoding: 'utf8', timeout: 120_000 })
  const asked = () => (fs.existsSync(path.join(dir, 'log.jsonl')) ? fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const keychain = () => JSON.parse(fs.readFileSync(path.join(dir, 'keychain.json'), 'utf8'))
  const key = path.join(home, 'Library', 'Application Support', 'Bridge AI Release', 'android-release.p12')
  // What a shell with this PATH finds: the stand-ins, never the real security or gh.
  const found = spawnSync('/bin/sh', ['-c', 'command -v security; command -v gh'], { env, encoding: 'utf8' }).stdout.trim().split('\n')
  const isolated = found.length === 2 && found.every((f) => f.startsWith(dir))
  return { dir, home, env, run, asked, keychain, key, isolated, found }
}

// What openssl says of a keystore opened with its password.
function inspect(p12, pw) {
  const env = { ...process.env, P: pw }
  const o = (args, input) => spawnSync('openssl', args, { env, input, encoding: 'utf8' })
  const opens = o(['pkcs12', '-in', p12, '-noout', '-passin', 'env:P']).status === 0
  const bags = o(['pkcs12', '-in', p12, '-nokeys', '-clcerts', '-passin', 'env:P']).stdout || ''
  const cert = (bags.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----\n?/) || [''])[0]
  const text = cert ? o(['x509', '-noout', '-text', '-subject', '-issuer', '-fingerprint', '-sha256'], cert).stdout : ''
  // Valid for 30 years: not ending within 29.9 years, ending within 30.1.
  const ends = (s) => o(['x509', '-noout', '-checkend', String(s)], cert).status !== 0
  return {
    opens,
    alias: (bags.match(/friendlyName: (.*)/) || [])[1]?.trim(),
    bits: Number((text.match(/Public-Key: \((\d+) bit\)/) || [])[1]),
    subject: (text.match(/^subject=\s*(.*)$/m) || [])[1]?.trim(),
    issuer: (text.match(/^issuer=\s*(.*)$/m) || [])[1]?.trim(),
    fingerprint: (text.match(/Fingerprint=([0-9A-F:]+)/i) || [])[1]?.toUpperCase(),
    years30: !!cert && !ends(Math.round(29.9 * 365.25 * 86400)) && ends(Math.round(30.1 * 365.25 * 86400)),
  }
}

// A JDK, when there's one here (CI's runners have them): JAVA_HOME, or one CI names JAVA_HOME_<n>_<arch>.
function keytool() {
  const homes = [process.env.JAVA_HOME, ...Object.keys(process.env).filter((k) => /^JAVA_HOME_\d+/.test(k)).sort().reverse().map((k) => process.env[k])]
  for (const h of homes.filter(Boolean)) { const k = path.join(h, 'bin', IS_WIN ? 'keytool.exe' : 'keytool'); if (fs.existsSync(k)) return k }
  return null
}

if (IS_WIN) skip('android-key.sh', 'Windows has no bash; the release key is made on a Mac')
else {
  // ---------- The dry run ----------
  const s = standIns()
  const out = path.join(s.dir, 'dry')
  const r = s.run('--dry-run', '--out', out)
  const p12 = path.join(out, 'android-release.p12')
  const pwFile = path.join(out, 'password.txt')
  ok(r.status === 0 && fs.existsSync(p12) && fs.existsSync(pwFile), 'the dry run makes a throwaway key in the folder given, with its password in password.txt', `${r.stdout}${r.stderr}`)
  const pw = fs.existsSync(pwFile) ? fs.readFileSync(pwFile, 'utf8') : ''
  ok(fs.existsSync(p12) && mode(p12) === 0o600 && mode(pwFile) === 0o600, 'both readable only by you', fs.existsSync(p12) && [mode(p12).toString(8), mode(pwFile).toString(8)])
  ok(r.status === 0 && s.asked().length === 0, 'and neither the Keychain nor GitHub is asked anything', s.asked())
  const k = fs.existsSync(p12) ? inspect(p12, pw) : {}
  ok(/^[0-9a-f]{48}$/.test(pw) && k.opens, 'its password is long and random (24 bytes) and opens the keystore', { length: pw.length, opens: k.opens })
  ok(k.alias === 'bridge-ai', 'its key is under the alias bridge-ai', k.alias)
  ok(k.bits === 4096, 'it\'s RSA 4096', k.bits)
  ok(/CN\s*=\s*Bridge AI/.test(k.subject || '') && k.subject === k.issuer, 'in a self-signed certificate for Bridge AI', { subject: k.subject, issuer: k.issuer })
  ok(k.years30, 'valid for 30 years')
  ok(!!k.fingerprint && r.stdout.includes(`SHA-256 of its certificate: ${k.fingerprint}`), 'the dry run shows the certificate\'s SHA-256', r.stdout)
  ok(!!pw && !r.stdout.includes(pw) && !r.stderr.includes(pw), 'and never the password')
  const before = fs.existsSync(p12) ? sha(p12) : ''
  const again = s.run('--dry-run', '--out', out)
  ok(again.status !== 0 && /left as it is/.test(again.stderr) && fs.existsSync(p12) && sha(p12) === before, 'a second dry run into the same folder refuses and leaves its key as it was', `${again.status} ${again.stderr}`)
  const own = s.run('--dry-run')
  const where = (own.stdout.match(/a throwaway key in (.+?) \(/) || [])[1]
  ok(own.status === 0 && !!where && where.startsWith(path.join(s.dir, 'tmp')) && fs.existsSync(path.join(where, 'android-release.p12')), 'with no folder given, it makes a new temporary one and says where', own.stdout)
  const kt = keytool()
  if (!kt) skip('Java reads the keystore', 'no JDK here (JAVA_HOME)')
  else {
    const csr = spawnSync(kt, ['-certreq', '-alias', 'bridge-ai', '-keystore', p12, '-storetype', 'PKCS12', '-storepass:file', pwFile, '-file', path.join(out, 'check.csr')], { encoding: 'utf8' })
    ok(csr.status === 0 && /BEGIN NEW CERTIFICATE REQUEST/.test(fs.readFileSync(path.join(out, 'check.csr'), 'utf8')), `Java (${path.basename(path.dirname(path.dirname(kt)))}) opens the keystore and signs with its key, as apksigner does`, `${csr.stdout}${csr.stderr}`)
  }

  // ---------- For real ----------
  if (!IS_MAC) {
    const t = standIns()
    const real = t.run()
    ok(real.status !== 0 && /runs on a Mac/.test(real.stderr) && !fs.existsSync(t.key) && t.asked().length === 0, 'off a Mac it says it needs one (for the Keychain), and makes nothing', real.stderr)
  } else {
    const t = standIns()
    if (!t.isolated) ok(false, 'its security and gh are the stand-ins', t.found)
    if (t.isolated) {
      const real = t.run()
      const text = `${real.stdout}${real.stderr}`
      ok(real.status === 0 && fs.existsSync(t.key), 'for real, it makes the key in ~/Library/Application Support/Bridge AI Release', text)
      ok(fs.existsSync(t.key) && mode(t.key) === 0o600 && mode(path.dirname(t.key)) === 0o700, 'readable only by you', fs.existsSync(t.key) && [mode(t.key).toString(8), mode(path.dirname(t.key)).toString(8)])
      const item = t.keychain()[`${SERVICE}|bridge-ai`]
      const kr = item && fs.existsSync(t.key) ? inspect(t.key, item.pw) : {}
      ok(!!item && kr.opens && kr.alias === 'bridge-ai' && kr.bits === 4096 && kr.years30, `its password is in the Keychain as "${SERVICE}" (account bridge-ai), and opens it`, item && { label: item.label, opens: kr.opens })
      const sets = t.asked().filter((x) => x.cmd === 'secret set')
      const by = Object.fromEntries(sets.map((x) => [x.name, x]))
      ok(sets.length === 3 && SECRETS.every((n) => by[n]?.repo === 'sahil1/bridge'), 'it sets the three GitHub secrets on sahil1/bridge', sets.map((x) => `${x.name} ${x.repo}`))
      ok(!!by.BRIDGE_ANDROID_P12 && Buffer.from(by.BRIDGE_ANDROID_P12.value, 'base64').equals(fs.readFileSync(t.key)) && !/\s/.test(by.BRIDGE_ANDROID_P12.value), 'BRIDGE_ANDROID_P12 is the keystore itself, in base64 on one line')
      ok(by.BRIDGE_ANDROID_PASSWORD?.value === item?.pw && by.BRIDGE_ANDROID_ALIAS?.value === 'bridge-ai', 'BRIDGE_ANDROID_PASSWORD its password, BRIDGE_ANDROID_ALIAS bridge-ai')
      ok(sets.length === 3 && sets.every((x) => x.body === undefined), 'each sent to gh on its standard input, not its command line')
      ok(!!kr.fingerprint && real.stdout.includes(kr.fingerprint) && /Back it up/.test(real.stdout) && /password manager/.test(real.stdout), 'it shows the certificate\'s SHA-256 and says to back up the file and its password', real.stdout)
      const version = JSON.parse(read('package.json')).version
      ok(real.stdout.includes(`gh workflow run android-apk.yml --repo sahil1/bridge -f tag=v${version}`), 'and how to add the APK to a release already out, this checkout\'s', real.stdout.slice(-300))
      ok(!!item?.pw && !text.includes(item.pw), 'and never shows the password')

      const kept = sha(t.key)
      const n = t.asked().length
      const twice = t.run()
      const later = t.asked().slice(n)
      ok(twice.status !== 0 && /left as it is/.test(twice.stderr) && !!kept && sha(t.key) === kept && !later.some((x) => x.cmd === 'add' || x.cmd === 'secret set'), 'run again, it refuses: the key stays as it was, and nothing new goes in the Keychain or to GitHub', { stderr: twice.stderr, later })

      const resend = t.run('--secrets')
      const re = t.asked().slice(n + later.length).filter((x) => x.cmd === 'secret set')
      const reBy = Object.fromEntries(re.map((x) => [x.name, x]))
      ok(resend.status === 0 && re.length === 3 && reBy.BRIDGE_ANDROID_P12?.value === by.BRIDGE_ANDROID_P12?.value && reBy.BRIDGE_ANDROID_PASSWORD?.value === item?.pw && sha(t.key) === kept, '--secrets sets the three secrets again from the key and the Keychain, changing neither', `${resend.stdout}${resend.stderr}`)
    }

    // A key already on GitHub (made on another Mac, say): nothing made, nothing set.
    const g = standIns({ secrets: ['BRIDGE_ANDROID_P12'] })
    const onGitHub = g.run()
    ok(onGitHub.status !== 0 && /already/.test(onGitHub.stderr) && !fs.existsSync(g.key) && !g.asked().some((x) => x.cmd === 'add' || x.cmd === 'secret set'), 'with a key on GitHub already, it refuses before making anything', onGitHub.stderr)
    // The Keychain has its password but the file is gone (moved, say).
    const kc = standIns({ items: { [`${SERVICE}|bridge-ai`]: { pw: 'x' } } })
    const inKeychain = kc.run()
    ok(inKeychain.status !== 0 && /Keychain has a password/.test(inKeychain.stderr) && !fs.existsSync(kc.key) && !kc.asked().some((x) => x.cmd === 'add' || x.cmd === 'secret set'), 'with its password in the Keychain already, it refuses too', inKeychain.stderr)
    // gh not signed in, or not allowed to set secrets.
    const out1 = standIns({ signedIn: false })
    const noGh = out1.run()
    ok(noGh.status !== 0 && /gh auth login/.test(noGh.stderr) && !fs.existsSync(out1.key), 'with gh not signed in, it says how, and makes nothing', noGh.stderr)
    const notAdmin = standIns({ admin: false })
    const na = notAdmin.run()
    ok(na.status !== 0 && /can't set secrets/.test(na.stderr) && !fs.existsSync(notAdmin.key), 'nor when the gh account can\'t set the repo\'s secrets', na.stderr)
  }
}

// ---------- What CI does with it ----------
const android = read('.github', 'workflows', 'android.yml')
const release = read('.github', 'workflows', 'release.yml')
const backfill = read('.github', 'workflows', 'android-apk.yml')
const tests = read('.github', 'workflows', 'test.yml')
const script = fs.existsSync(SCRIPT) ? fs.readFileSync(SCRIPT, 'utf8') : ''
const passes = (yml) => SECRETS.every((n) => new RegExp(`${n}: \\$\\{\\{ secrets\\.${n} \\}\\}`).test(yml))
ok(SECRETS.every((n) => script.includes(n) && new RegExp(`secrets\\.${n}\\b`).test(android)), 'the builds read the three secrets the script sets', SECRETS)
ok(passes(release) && passes(backfill), 'and release.yml and android-apk.yml hand them on, by name')
ok(/assembleRelease/.test(android) && /--v2-signing-enabled true/.test(android) && /--v3-signing-enabled true/.test(android) && /apksigner" verify --verbose --print-certs/.test(android) && /--out Bridge-AI-android\.apk/.test(android), 'the APK is built with assembleRelease, signed v2 and v3 by apksigner as Bridge-AI-android.apk, and checked with apksigner verify --print-certs')
const build = android.split(/\n      - name: Build\n/)[1]?.split(/\n      - /)[0] || ''
ok(!!build && !/secrets\./.test(build), 'Gradle\'s step never gets the key (only the signing step does)', build)
const publish = release.split(/\n  release:\n/)[1] || ''
ok(/^\s+if: \$\{\{ !cancelled\(\) && startsWith\(github\.ref, 'refs\/tags\/v'\) && needs\.build\.result == 'success' \}\}$/m.test(publish) && /needs: \[build, android\]/.test(publish), 'the release waits for the Android app but publishes on the desktop builds alone', publish.slice(0, 400))
ok(/name: bridge-ai-android\n\s+path: Bridge-AI-android\.apk/.test(android) && /merge-multiple: true/.test(publish) && /sha256sum Bridge-AI-\* > SHA256SUMS\.txt/.test(publish) && /subject-path: out\/Bridge-AI-\*/.test(publish) && /gh release create .* out\/Bridge-AI-\*/.test(publish), 'the APK reaches the release job with the installers, and its checksum, attestation and upload come with theirs (Bridge-AI-*)')
ok(/gh release upload "\$TAG" Bridge-AI-android\.apk SHA256SUMS\.txt/.test(backfill) && /subject-path: out\/Bridge-AI-android\.apk/.test(backfill) && /workflow_dispatch:/.test(backfill), 'android-apk.yml adds it to a release already out, with its attestation and SHA256SUMS.txt')
const job = tests.split(/\n  android:\n/)[1] || ''
ok(/if: github\.ref_type != 'tag'/.test(job) && /uses: \.\/\.github\/workflows\/android\.yml/.test(job) && /throwaway-key: true/.test(job) && !/secrets/.test(job), 'pushes and pull requests build it with a throwaway key, never the release key, and not for a tag')

// ---------- The release notes ----------
const notes = (extra) => {
  const f = path.join(OUT, `android-notes-${extra.length}.md`)
  const env = { ...process.env }
  delete env.GITHUB_REF_NAME // CI's branch, which release.js would take for the tag
  const w = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release.js'), '--notes', f, ...extra], { cwd: ROOT, env, encoding: 'utf8' })
  return w.status === 0 ? fs.readFileSync(f, 'utf8') : `failed: ${w.stderr}`
}
fs.mkdirSync(OUT, { recursive: true })
const withApk = notes(['--android'])
const without = notes([])
ok(/`Bridge-AI-android\.apk`: open it on your phone to install it, or to update the one you have\. It isn't on Google Play yet\./.test(withApk) && /<!-- macOS [\d.]+ or later -->\n$/.test(withApk) &&
  /The Mac app needs macOS/.test(without) && !without.includes('Bridge-AI-android.apk') && withApk.replace(/The Android app is[^\n]*\n\n/, '') === without,
'with the APK in the release, its notes say how to install it (still ending with the line the update check reads); without it, they\'re the same but for that', withApk.slice(-400))

// ---------- Google Play, later ----------
const play = read('mobile', 'android', 'PLAY.md')
const listing = read('mobile', 'android', 'play', 'full-description.txt') + read('mobile', 'android', 'play', 'console.md')
const relay = read('src', 'components', 'settings', 'Relay.jsx')
ok(/t\('Pair a device'\)/.test(relay) && /Settings › Devices › Pair a device/.test(listing) && /Settings > Devices > Pair a device/.test(listing) && !/Phone & notifications/.test(listing), 'the Play listing\'s pairing steps name the Settings section and button the computer has')
ok(/android-release\.p12/.test(play) && /--alias=bridge-ai/.test(play) && /Don't accept the key Google offers/.test(play) && !/accept\s+the Google-generated key/.test(play), 'PLAY.md has Play sign with the release key, so the APK and Play\'s app update each other')

process.exit(done().fail ? 1 : 0)
