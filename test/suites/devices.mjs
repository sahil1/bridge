// Your devices, linked for real: two Bridge AIs ("Studio" and "Laptop"), each with its own relay
// (stand-ins/relay.mjs: the real relay, run on this computer), linked end to end and encrypted as
// they are for you. Then what used to leave a link stuck until Bridge AI was restarted, each put
// right by itself: a connection that went quiet (a Mac that slept), one that dropped, a new link
// that didn't work for a device already linked, a device that moved to a new relay, one whose key
// changed, and one that forgot this device. And Fix, which says where a connection stops. And an
// ask a relay in between can't steer to six digits of its choosing.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import WebSocket from 'ws'
import { newKey, rawPublic, phoneHello, plainFrame, readPlain } from '../../relay/web/link.js'
import { startKit, startRelay, checks, until } from '../lib/harness.mjs'

const { ok, done } = checks('devices')
const QUIET = 1500 * 2.5 // BRIDGE_LINK_PING_MS below: a quiet link is started over after this
const relays = []
const kits = []
const kitWith = async (name, rel) => {
  const k = await startKit(`devices-${name.toLowerCase()}`, {
    env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, BRIDGE_LINK_PING_MS: '1500' } },
  })
  kits.push(k)
  return k
}
const relayJson = (k) => JSON.parse(fs.readFileSync(path.join(k.data, 'relay.json'), 'utf8'))
const other = async (k, name) => (await k.api('/machines')).machines.find((m) => m.name === name) || null
const online = (k, name) => until(async () => (await other(k, name))?.online === true, 30000, 300)

try {
  const ra = await startRelay('devices-studio')
  const rb = await startRelay('devices-laptop')
  relays.push(ra, rb)
  const a = await kitWith('Studio', ra)
  const b = await kitWith('Laptop', rb)
  ok(!!(await until(async () => (await a.api('/relay')).online && (await b.api('/relay')).online, 20000)), 'each is connected to its own relay')

  // ---------- Pair a device: one code, a QR and a link ----------
  const p = (await a.api('/relay/pair', {})).pairing
  ok(/^<svg/.test(p?.qr || '') && p.link === `${ra.url}/#pair=${p.code}` && /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/.test(p.code), 'Pair a device gives a QR code, a link and a code', p && { link: p.link, code: p.code })
  // Typed on the other computer: its address and the code, as they come (lower case, spaces).
  const typed = `${ra.url} ${p.code.toLowerCase().replace(/-/g, ' ')}`
  const added = await b.api('/machines', { link: typed })
  ok(added.machine?.state === 'linked' && added.machine.name === 'Studio', 'Laptop links with the address and code typed in', added.machine)
  ok(!!(await online(a, 'Laptop')), 'and Studio links back by itself')
  ok(!!(await online(b, 'Studio')), 'both online')
  const studio = await other(b, 'Studio')
  const through = await fetch(`${b.url}/m/${studio.id}/api/machines/summary`).then((r) => r.json())
  ok(through?.name === 'Studio', 'Laptop reaches Studio\'s Bridge AI through the link', through)
  ok((await a.api('/relay')).devices.filter((d) => d.kind === 'computer').length === 1, 'Studio has Laptop once among its paired devices')

  // ---------- a connection that goes quiet (a Mac that slept) ----------
  await ra.freeze()
  const quiet = await until(async () => (await other(b, 'Studio'))?.online === false, QUIET * 4, 200)
  ok(!!quiet, 'a link that goes quiet is noticed as lost', await other(b, 'Studio'))
  await ra.thaw()
  ok(!!(await online(b, 'Studio')), 'and connects again by itself once the network is back, with no restart')

  // ---------- one that drops ----------
  await ra.drop()
  ok(!!(await online(b, 'Studio')), 'a dropped connection comes back by itself')

  // ---------- a new link that doesn't work, for a device that's linked ----------
  // (Pasted while Studio is closed, so it's tried as Studio comes back; it used to stop the link
  // for good, until Bridge AI was restarted.)
  a.stop()
  ok(!!(await until(async () => (await other(b, 'Studio'))?.online === false, 15000, 200)), 'Studio quit: Laptop sees it offline')
  const pasted = b.api('/machines', { link: `${ra.url}/#pair=AAAA-BBBB-CCCC-DDDD-EEEE` }).then((r) => r, (e) => ({ error: e.message }))
  await a.restart()
  const bogus = await pasted
  ok((await other(b, 'Studio'))?.state === 'linked', 'an old link pasted for a device that\'s linked leaves it linked', bogus)
  ok(!!(await online(b, 'Studio')), 'and back online when Studio opens again')

  // ---------- moved to a new relay ----------
  const ra2 = await startRelay('devices-studio-new')
  relays.push(ra2)
  const conf = relayJson(a)
  fs.writeFileSync(path.join(a.data, 'relay.json'), JSON.stringify({ ...conf, ...ra2.relayFile }))
  await a.restart()
  ok(!!(await until(async () => (await a.api('/relay')).online && (await a.api('/relay')).url === ra2.url, 20000)), 'Studio is on its new relay')
  ok(!!(await until(async () => (await other(b, 'Studio'))?.relay === ra2.url && (await other(b, 'Studio'))?.online, 30000, 300)), 'Laptop follows Studio to its new relay by itself', await other(b, 'Studio'))

  // ---------- Fix: where the connection stops ----------
  const good = await b.api(`/machines/${studio.id}/check`, {})
  ok(good.online && good.steps.every((s) => s.ok) && good.steps.some((s) => s.step === 'link'), 'Fix on a working link: every step fine', good.steps)
  a.stop()
  const off = await b.api(`/machines/${studio.id}/check`, {})
  const lastStep = off.steps[off.steps.length - 1]
  ok(!off.online && off.steps.find((s) => s.step === 'relay')?.ok && lastStep.step === 'link' && !lastStep.ok && /isn't connected to its relay/.test(lastStep.text), 'Fix with Studio closed: its relay answers, Studio isn\'t there, said plainly', off.steps)
  ra2.stop()
  await until(async () => !(await fetch(`${ra2.url}/_relay/health`).then(() => true, () => false)), 5000)
  const gone = await b.api(`/machines/${studio.id}/check`, {})
  ok(gone.steps.find((s) => s.step === 'relay')?.ok === false && /Can't reach Studio's relay/.test(gone.steps.find((s) => s.step === 'relay').text), 'Fix with its relay gone: says it can\'t reach it', gone.steps)

  // Back on the first relay, for what's next.
  fs.writeFileSync(path.join(a.data, 'relay.json'), JSON.stringify({ ...relayJson(a), ...ra.relayFile }))
  await a.restart()
  ok(!!(await until(async () => (await other(b, 'Studio'))?.relay === ra.url && (await other(b, 'Studio'))?.online, 40000, 300)), 'Studio back on its first relay, and Laptop with it')

  // ---------- its key changed ----------
  const { key: _old, ...noKey } = relayJson(a)
  a.stop()
  fs.writeFileSync(path.join(a.data, 'relay.json'), JSON.stringify(noKey))
  await a.restart()
  const changed = await until(async () => (await other(b, 'Studio'))?.state === 'changed', 30000, 300)
  ok(!!changed, 'Studio with a new key: Laptop says so instead of trying again and again', await other(b, 'Studio'))
  ok(/doesn't have the key it was linked with/.test((await other(b, 'Studio'))?.error || (await b.api(`/machines/${studio.id}/check`, {})).steps.map((s) => s.text).join(' ')), 'with what to do')
  const p2 = (await a.api('/relay/pair', {})).pairing
  const relinked = await b.api('/machines', { link: p2.link })
  ok(relinked.machine?.state === 'linked', 'a new code from Studio links it again, with its new key', relinked.machine)
  ok(!!(await online(b, 'Studio')), 'online again')

  // ---------- it forgot this device ----------
  const laptopAtStudio = await other(a, 'Laptop')
  b.stop()
  await a.api(`/machines/${laptopAtStudio.id}`, null, 'DELETE')
  await b.restart()
  ok(!!(await until(async () => (await other(b, 'Studio'))?.state === 'removed', 30000, 300)), 'Studio unlinked Laptop while it was closed: Laptop says so', await other(b, 'Studio'))
  const asked = await b.api('/machines/ask', { relay: ra.url, name: 'Studio' })
  ok(asked.machine?.state === 'asking' && /^\d{3} \d{3}$/.test(asked.machine.code || ''), 'Link again asks Studio, with six digits to check', asked.machine)
  const ask = await until(async () => (await a.api('/machines')).asks.find((x) => x.name === 'Laptop'), 15000)
  ok(ask?.code === asked.machine.code, 'Studio shows the same six digits', ask)
  await a.api(`/machines/asks/${ask.id}`, { allow: true })
  ok(!!(await online(b, 'Studio')), 'allowed there: linked again')
  ok(!!(await online(a, 'Laptop')), 'both ways')

  // ---------- an ask a relay in between can't steer ----------
  // A device asking Studio, spoken for here the way a relay in between could: the six digits come
  // only once its number matches the commit it made before it saw Studio's.
  const stranger = await newKey(true)
  const d = Buffer.from(await rawPublic(stranger)).toString('base64url')
  const hash = (label, ...parts) => createHash('sha256').update(Buffer.concat([Buffer.from(label), ...parts.map((x) => Buffer.from(x, 'base64url'))])).digest()
  const commit = (r) => hash('bridge ask v2', d, r).toString('base64url')
  const digits = (h, n, r) => { const s = String(hash('bridge check v2', h, d, n, r).readUInt32BE(0) % 1000000).padStart(6, '0'); return `${s.slice(0, 3)} ${s.slice(3)}` }
  const knock = (extra) => new Promise((res, rej) => {
    const ws = new WebSocket(`${ra.url.replace(/^http/, 'ws')}/_relay/link`)
    const t = setTimeout(() => { ws.terminate(); rej(new Error('Studio didn\'t answer')) }, 10000)
    ws.on('message', async (data, bin) => {
      if (bin) { clearTimeout(t); ws.close(); return res(readPlain(new Uint8Array(data))) }
      const s = String(data)
      if (s[0] === '{' && JSON.parse(s).host) ws.send(plainFrame({ ...(await phoneHello(stranger, null, 'Stranger')).hello, kind: 'computer', os: 'linux', ask: 1, ...extra }))
    })
    ws.on('error', (e) => { clearTimeout(t); rej(e) })
  })
  const shown = async () => (await a.api('/machines')).asks.find((x) => x.name === 'Stranger') || null
  const old = await knock({})
  ok(old?.t === 'refuse' && /^Update Bridge AI on this device/.test(old.why), 'an ask from Bridge AI 3.3 or earlier (no commit) is told to update, or link with a code', old)
  const r1 = randomBytes(16).toString('base64url')
  const first = await knock({ c: commit(r1) })
  ok(first?.why === 'asked' && !!first.n && !!first.h, 'an ask with a commit gets Studio\'s number back', first)
  ok(!(await shown()), 'and isn\'t shown yet: no six digits until it shows its own number')
  const wrong = await knock({ c: commit(r1), r: randomBytes(16).toString('base64url') })
  ok(wrong?.n === first.n && !(await shown()), 'a number that doesn\'t match its commit is ignored', wrong)
  await knock({ c: commit(r1), r: r1 })
  const seen = await until(shown, 5000)
  ok(seen?.code === digits(first.h, first.n, r1), 'the one it committed to: six digits from both keys and both numbers', { seen, want: digits(first.h, first.n, r1) })
  const again = await knock({ c: commit(randomBytes(16).toString('base64url')) })
  ok(!!again?.n && again.n !== first.n && !(await shown()), 'a new commit starts it over: a new number from Studio, and no digits until the asking device shows its own', again)
  await a.api(`/machines/asks/${seen.id}`, { allow: false })
  ok((await knock({ c: commit(r1) }))?.why === 'denied', 'turned down: turned away')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
}
process.exit(done().fail ? 1 : 0)
