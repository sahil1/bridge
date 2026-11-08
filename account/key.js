#!/usr/bin/env node
// The accounts service's signing key (README.md, Going live): made once, on the owner's computer.
//   node account/key.js            makes the key pair, and says where each half goes
//   node account/key.js --public   the public half of the one made already
// The private key is a file outside this repo: --key FILE, or ~/.config/bridge-ai/accounts-key.pem.
// It goes to Cloudflare as the SIGNING_KEY secret and nowhere else (npm run check:private refuses a
// private key in the repo); keep a copy in a password manager. Its public half goes in the relay's
// settings (ACCOUNTS_PUBLIC_KEY) and in Bridge AI (server/account.js).
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const at = args.indexOf('--key')
const file = path.resolve(at >= 0 ? args[at + 1] : path.join(os.homedir(), '.config', 'bridge-ai', 'accounts-key.pem'))
const fail = (msg) => { console.error(`account/key.js: ${msg}`); process.exit(1) }
const publicOf = (pem) => crypto.createPublicKey(pem).export({ format: 'jwk' }).x

if (args.includes('--public')) {
  if (!fs.existsSync(file)) fail(`there's no key at ${file} yet. Make one: node account/key.js`)
  console.log(publicOf(fs.readFileSync(file, 'utf8')))
  process.exit(0)
}
const rel = path.relative(ROOT, file)
if (!rel.startsWith('..') && !path.isAbsolute(rel)) fail(`${file} is inside this repo, where a private key must never be. Pick a place outside it (--key FILE).`)
if (fs.existsSync(file)) fail(`there's a key at ${file} already. Every device token, relay token and Early Access code was signed with it, so it isn't replaced; move it away first if that's what you want.`)
const { privateKey } = crypto.generateKeyPairSync('ed25519')
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
const x = publicOf(privateKey)
console.log(`Made the accounts service's key pair.

The private key is in ${file} (only you can read it). Keep a copy in a password manager: whoever
has it can sign anyone in. Never put it in the repo. Give it to the accounts service:

  npx wrangler@4.149.0 secret put SIGNING_KEY -c account/wrangler.toml < ${file}

The public key, ${x}, goes in two places:

  relay/wrangler.hosted.toml   ACCOUNTS_PUBLIC_KEY = "${x}"
  server/account.js            export const ACCOUNTS_PUBLIC_KEY = '${x}'`)
