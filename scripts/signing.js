#!/usr/bin/env node
// Bridge AI's own code signing certificate, so macOS keeps what you allowed across updates (see
// desktop/sign.js). Self-signed and free: it doesn't make Gatekeeper trust the app, only lets macOS
// recognize each new build as the same app. An Apple Developer ID can replace it later.
//   node scripts/signing.js create   make it, once: ~/.bridge-ai-signing/bridge-ai.p12, with its
//                                    password in your login keychain ("Bridge AI signing")
//   node scripts/signing.js github   give it to this repo's release builds (two GitHub secrets,
//                                    BRIDGE_SIGN_P12 and BRIDGE_SIGN_PASSWORD; needs gh)
//   node scripts/signing.js          say whether there is one, and its fingerprint
// Keep the .p12 and its password to yourself: anything signed with it is, to macOS, Bridge AI.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = path.join(os.homedir(), '.bridge-ai-signing')
const P12 = path.join(DIR, 'bridge-ai.p12')
const SERVICE = 'Bridge AI signing'
const NAME = 'Bridge AI (self-signed)'
const run = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...o })
const password = () => run('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', 'p12', '-w']).trim()
const fail = (msg) => { console.error(`signing: ${msg}`); process.exit(1) }
if (process.platform !== 'darwin') fail('macOS only')

// The certificate's SHA-1, as codesign shows it in the app's signature.
function fingerprint() {
  const pem = run('/usr/bin/openssl', ['pkcs12', '-in', P12, '-nokeys', '-clcerts', '-passin', 'stdin'], { input: password() })
  return run('/usr/bin/openssl', ['x509', '-noout', '-fingerprint', '-sha1'], { input: pem }).split('=')[1].replace(/:/g, '').trim()
}

const cmd = process.argv[2] || 'status'
if (cmd === 'create') {
  if (fs.existsSync(P12)) { console.log(`There's one already: ${P12} (${fingerprint()}). Delete it first to make a new one; macOS will then ask again for what you'd allowed.`); process.exit(0) }
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 })
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cert-'))
  try {
    fs.writeFileSync(path.join(tmp, 'cert.cnf'), [
      '[req]', 'distinguished_name = dn', 'x509_extensions = ext', 'prompt = no',
      '[dn]', `CN = ${NAME}`,
      '[ext]', 'basicConstraints = critical, CA:false', 'keyUsage = critical, digitalSignature', 'extendedKeyUsage = critical, codeSigning', 'subjectKeyIdentifier = hash',
    ].join('\n'))
    // Twenty years, so it doesn't run out under you.
    run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-days', '7300', '-config', path.join(tmp, 'cert.cnf'), '-keyout', path.join(tmp, 'key.pem'), '-out', path.join(tmp, 'cert.pem')])
    const pass = crypto.randomBytes(24).toString('base64url')
    // macOS's own openssl (LibreSSL) writes a .p12 that `security import` reads.
    run('/usr/bin/openssl', ['pkcs12', '-export', '-inkey', path.join(tmp, 'key.pem'), '-in', path.join(tmp, 'cert.pem'), '-name', NAME, '-out', P12, '-passout', 'stdin'], { input: pass })
    fs.chmodSync(P12, 0o600)
    run('/usr/bin/security', ['add-generic-password', '-U', '-s', SERVICE, '-a', 'p12', '-l', SERVICE, '-j', 'The password of ~/.bridge-ai-signing/bridge-ai.p12 (scripts/signing.js)', '-w', pass])
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  console.log(`Made ${P12} (${fingerprint()}), its password in your login keychain as "${SERVICE}".\nnpm run desktop:dist now signs with it. For release builds: node scripts/signing.js github`)
} else if (cmd === 'github') {
  if (!fs.existsSync(P12)) fail('no certificate yet: node scripts/signing.js create')
  run('gh', ['secret', 'set', 'BRIDGE_SIGN_P12'], { input: fs.readFileSync(P12).toString('base64'), stdio: ['pipe', 'inherit', 'inherit'] })
  run('gh', ['secret', 'set', 'BRIDGE_SIGN_PASSWORD'], { input: password(), stdio: ['pipe', 'inherit', 'inherit'] })
  console.log('Release builds now sign with it (BRIDGE_SIGN_P12 and BRIDGE_SIGN_PASSWORD).')
} else if (cmd === 'status') {
  console.log(fs.existsSync(P12) ? `${P12} (${fingerprint()})` : 'No certificate: builds are signed ad hoc. node scripts/signing.js create makes one.')
} else fail(`unknown command ${cmd}: create, github or nothing`)
