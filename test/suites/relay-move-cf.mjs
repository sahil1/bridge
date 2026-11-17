// Moving from Bridge AI's relay to your own Cloudflare keeps everything paired, end to end. A Bridge
// AI ("Studio") on Bridge AI's relay (stand-ins/hosted-relay.mjs, with the accounts stand-in), with
// another computer ("Laptop", on a relay of its own) linked to it and two phones spoken for in Node
// (lib/linkclient.mjs: one connected as it moves, one not), deploys a relay of its own with an API
// token (stand-ins/cloudflare.mjs: Cloudflare's API, and the Worker deployed with it, run as the
// relay stand-in at its workers.dev address). Cloudflare is asked only what deploying needs (the
// account, its Workers, a workers.dev subdomain for an account with none yet, the Worker with its
// token and a migration, then on workers.dev), and the Worker is the relay as built here. Studio
// keeps its key and every device; the phone connected then is told the new address, sealed (MOVE),
// and gets in there with what it has; the one that wasn't finds Studio at the hosted address it
// left, which Studio stays connected to, and is told there; Laptop follows by itself; and once all
// three have been seen at the new address, Studio lets go of the hosted address and it's removed
// from Bridge AI's relay. Then Update relay deploys the same Worker again at the same address,
// without a second migration (which Cloudflare refuses).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { K, json } from '../../relay/web/link.js'
import { TEST, startKit, startRelay, startHostedRelay, startAccounts, startCloudflare, checks, until } from '../lib/harness.mjs'
import { linkAs } from '../lib/linkclient.mjs'

const { ok, done } = checks('relay-move-cf')
// The servers can't look up <name>.localhost (as on macOS and Windows): they reach Bridge AI's relay
// and the Worker, stood in for, the way Bridge AI does everywhere.
const env = { NODE_OPTIONS: `--import ${pathToFileURL(path.join(TEST, 'stand-ins', 'no-localhost-names.mjs')).href}` }
const TOKEN = 'cf-api-token-for-the-stand-in-0123456789'
const kits = []
let acc = null
let hr = null
let cf = null
let rb = null
const relayJson = (k) => JSON.parse(fs.readFileSync(path.join(k.data, 'relay.json'), 'utf8'))
const other = async (k, name) => (await k.api('/machines')).machines.find((m) => m.name === name) || null
// The next sealed record of a kind, from a phone spoken for in Node.
const word = async (c, kind, ms = 15000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { const r = await c.next(end - Date.now()).catch(() => null); if (!r) return null; if (r.kind === kind) return json(r.body) }
  return null
}
// What an address at <name>.localhost answers when asked to forget its computer, with that
// computer's token, reached on this computer as a browser reaches it (0: nothing answered). 404: the
// relay doesn't know it any more.
const forgetAt = (u, token) => new Promise((resolve) => {
  const lookup = (h, o, cb) => (o?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4))
  const req = http.request(`${u}/_relay/forget`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Length': 0 }, lookup, timeout: 5000 }, (res) => { res.resume(); resolve(res.statusCode) })
  req.on('timeout', () => req.destroy())
  req.on('error', () => resolve(0))
  req.end()
})

try {
  acc = await startAccounts('relay-move-cf')
  hr = await startHostedRelay('relay-move-cf', {}, acc)
  cf = await startCloudflare('relay-move-cf', { token: TOKEN, accounts: [{ id: 'acct-cf', name: 'Mine' }] })
  rb = await startRelay('relay-move-cf-laptop')
  const a = await startKit('relay-move-cf-studio', { env: { ...env, BRIDGE_COMPUTER_NAME: 'Studio', BRIDGE_LINK_PING_MS: '1500', BRIDGE_CLOUDFLARE_URL: cf.url }, config: { relay: { hostedUrl: hr.url }, account: acc.accountConfig } })
  const l = await startKit('relay-move-cf-laptop', { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rb.relayFile)); return { ...env, BRIDGE_COMPUTER_NAME: 'Laptop', BRIDGE_LINK_PING_MS: '1500' } } })
  kits.push(a, l)
  await a.api('/setup', { name: 'Tester' })
  await l.api('/setup', { name: 'Tester' })

  // Studio on Bridge AI's relay, with its Bold Bridge account.
  await a.api('/account/code', { email: 'pat@example.com' })
  await a.api('/account/verify', { email: 'pat@example.com', code: await acc.code('pat@example.com') })
  await a.api('/account/request', { kind: 'relay' })
  await acc.admin('POST', `/admin/accounts/${(await a.api('/account')).account.id}`, { relay: 'approved' })
  const hostedAt = (await a.api('/relay/deploy', { method: 'hosted' })).url
  ok(new RegExp(`^http://[a-z2-7]{12}\\.localhost:${hr.port}$`).test(hostedAt || '') && !!(await until(async () => (await a.api('/relay')).online && (await l.api('/relay')).online, 20000)), 'Studio is on Bridge AI\'s relay, and Laptop on a relay of its own', hostedAt)
  await l.api('/machines', { link: (await a.api('/relay/pair', {})).pairing.link })
  ok(!!(await until(async () => (await other(l, 'Studio'))?.online && (await other(a, 'Laptop'))?.online, 30000)), 'Laptop is linked with Studio, each reaching the other', await other(l, 'Studio'))

  // Two phones: Pocket stays connected, Spare is put away. A phone is paired once Studio has its first
  // sealed record (ABOUT): it's not put away before that, or Studio never hears it (on a slower
  // computer, where both reach Studio at once).
  const pairPhone = async (name) => {
    const c = await linkAs(hostedAt, { code: (await a.api('/relay/pair', {})).pairing.code, name, about: { name } })
    await until(async () => c.deviceId && (await a.api('/relay')).devices.some((d) => d.id === c.deviceId), 10000, 100)
    return c
  }
  const pocket = await pairPhone('Pocket')
  const spare = await pairPhone('Spare')
  spare.close()
  const paired = (await a.api('/relay')).devices
  ok(!!pocket.welcome && !!spare.welcome && ['Laptop', 'Pocket', 'Spare'].every((n) => paired.some((d) => d.name === n)) && paired.length === 3, 'two phones pair with Studio on Bridge AI\'s relay, and it lists them with Laptop', paired.map((d) => [d.id, d.name]))
  const keyBefore = relayJson(a).key.public

  // ---------- Your own Cloudflare, with an API token ----------
  const moved = await a.api('/relay/deploy', { method: 'token', token: TOKEN })
  const at = moved.url
  ok(moved.method === 'token' && !moved.hosted && new RegExp(`^http://bridge-[0-9a-f]{10}\\.bridge-[0-9a-f]{8}\\.localhost:${cf.port}$`).test(at || '') && moved.moved?.from === hostedAt && moved.moved.hosted === true, 'Studio moves to a Worker of its own on Cloudflare, saying where from', { url: at, method: moved.method, moved: moved.moved })
  const ids = (list) => list.map((d) => d.id).sort().join()
  const named = (list) => list.map((d) => `${d.id} ${d.name}`).sort()
  ok(relayJson(a).key.public === keyBefore && ids(moved.devices) === ids(paired), 'with the same key, and every phone and computer still paired (none to pair again)', { sameKey: relayJson(a).key.public === keyBefore, before: named(paired), after: named(moved.devices) })
  const conf = relayJson(a)
  const script = conf.cf?.script
  const hostedToken = conf.moved?.token
  ok(!conf.hosted && JSON.stringify(conf.cf) === JSON.stringify({ account: 'acct-cf', accountName: 'Mine', script, method: 'token', apiToken: TOKEN }) && /^bridge-[0-9a-f]{10}$/.test(script || ''), 'it keeps which Worker is its own, on which account, and how it signed in', conf.cf)
  const st = await cf.state()
  const asked = [...new Set(st.calls.map((c) => `${c.method} ${c.path.replace(script, '<script>')}`))]
  const needed = ['GET /accounts', 'GET /accounts/acct-cf/workers/scripts', 'GET /accounts/acct-cf/workers/subdomain', 'PUT /accounts/acct-cf/workers/subdomain', 'PUT /accounts/acct-cf/workers/scripts/<script>', 'POST /accounts/acct-cf/workers/scripts/<script>/subdomain']
  ok(asked.length === needed.length && needed.every((x) => asked.includes(x)), 'Cloudflare is asked only what deploying needs: the account, its Workers, a workers.dev subdomain (it had none), the Worker, then on workers.dev', asked)
  const w = st.workers[`acct-cf/${script}`]
  ok(w?.same === true && w.token === conf.token && w.tag === 'v1' && w.enabled === true && w.uploads === 1 && /^bridge-[0-9a-f]{8}$/.test(st.subdomains['acct-cf'] || ''), 'the Worker is the relay as built here, with this computer\'s token and its migration, on workers.dev', { ...w, token: w?.token === conf.token, sub: st.subdomains['acct-cf'] })

  // The phone connected as it moved: told at once, sealed, and in at the new address with what it has.
  const told = await word(pocket, K.MOVE)
  ok(told?.url === at && told.name === 'Studio' && told.hosted === false && told.link?.startsWith(`${at}/#pair=`), 'the phone connected as Studio moved is told the new address, sealed (MOVE)', told)
  const pocketThere = await until(async () => { const c = await linkAs(at, { device: pocket.device, hostKey: pocket.hostKey, about: { name: 'Pocket' } }); return c.welcome ? c : (c.close?.(), null) }, 20000, 500)
  ok(!!pocketThere && (await pocketThere.request('GET', '/api/version'))?.status === 200, 'and gets in at the Worker with its own key and Studio\'s, as before')
  pocketThere?.close()

  // The phone that was put away finds Studio at the hosted address it left, and is told there.
  ok((await hr.state()).computers === 1, 'Studio stays connected at the hosted address for the rest', await hr.state())
  const spareBack = await until(async () => { const c = await linkAs(hostedAt, { device: spare.device, hostKey: spare.hostKey, about: { name: 'Spare' } }); return c.welcome ? c : (c.close?.(), null) }, 20000, 500)
  const toldThere = spareBack && await word(spareBack, K.MOVE)
  ok(toldThere?.url === at && toldThere.hosted === false && toldThere.link?.startsWith(`${at}/#pair=`), 'the phone that wasn\'t connected gets in at the hosted address and is told the new one there, sealed', toldThere)
  spareBack?.close()
  const spareThere = await until(async () => { const c = await linkAs(at, { device: spare.device, hostKey: spare.hostKey, about: { name: 'Spare' } }); return c.welcome ? c : (c.close?.(), null) }, 20000, 500)
  ok((await spareThere?.request('GET', '/api/version'))?.status === 200, 'and gets in at the Worker with what it has')
  spareThere?.close()

  // Laptop follows Studio by itself.
  ok(!!(await until(async () => { const m = await other(l, 'Studio'); return m?.relay === at && m.online }, 40000, 300)), 'Laptop follows Studio to its Worker by itself, and reaches it there', await other(l, 'Studio'))

  // Every device has been seen at the new address: the hosted address goes.
  ok(!!(await until(async () => { const c = relayJson(a); return !c.moved && !c.leaving && !(await a.api('/relay')).moved }, 20000)), 'once both phones and Laptop have been seen at the Worker, Studio lets go of the hosted address', { moved: relayJson(a).moved?.left, leaving: relayJson(a).leaving })
  const gone = await forgetAt(hostedAt, hostedToken)
  ok(!!hostedToken && (await hr.state()).computers === 0 && gone === 404, 'and the hosted address left behind is removed from Bridge AI\'s relay (it no longer knows Studio\'s token there: 404)', { state: await hr.state(), forget: gone })
  const now = await a.api('/relay')
  ok(now.online && now.url === at && !now.hosted && now.devices.every((d) => !d.moving), 'Studio is online at its Worker, with no device left behind', { online: now.online, url: now.url, devices: now.devices.map((d) => [d.name, d.moving]) })

  // Update relay: the same Worker again, at the same address, with no second migration.
  await a.api('/relay/update', {})
  const again = (await cf.state()).workers[`acct-cf/${script}`]
  ok(relayJson(a).url === at && again?.uploads === 2 && again.tag === 'v1' && again.token === conf.token, 'Update relay deploys the same Worker again, at the same address, without a second migration', again && { ...again, token: again.token === conf.token })
  ok(!!(await until(async () => (await a.api('/relay')).online, 15000)), 'and Studio stays online there')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-2000))
} finally {
  for (const k of kits) k.stop()
  rb?.stop()
  cf?.stop()
  hr?.stop()
  acc?.stop()
}
process.exit(done().fail ? 1 : 0)
