// Your devices, linked for real: two Bridge AIs ("Studio" and "Laptop"), each with its own relay
// (stand-ins/relay.mjs: the real relay, run on this computer), linked end to end and encrypted as
// they are for you. Then what used to leave a link stuck until Bridge AI was restarted, each put
// right by itself: a connection that went quiet (a Mac that slept), one that dropped, a new link
// that didn't work for a device already linked, a device that moved to a new relay, one whose key
// changed, and one that forgot this device. And Fix, which says where a connection stops. And an
// ask a relay in between can't steer to six digits of its choosing.
// And what a relay in between can't do any more: phones spoken for here (lib/linkclient.mjs), one
// as phones pair now (what it says about itself sealed, first) and one from before (in the clear
// only), and the relay stood in for rewriting hellos or answering them itself. Nothing said in the
// clear renames a device, makes a phone a computer, moves a computer, or unlinks one; a code pairs
// one device; a device counts as connected once it has shown it holds its key; one removed is told so
// sealed, its notifications and new requests stop at once; a computer that linked with Studio's code
// meets the others only once kept there; and strangers' hellos are let go past a few a second.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import WebSocket from 'ws'
import { newKey, rawPublic, phoneHello, plainFrame, readPlain, K } from '../../relay/web/link.js'
import { ROOT, startKit, startRelay, checks, until, sleep } from '../lib/harness.mjs'
import { linkAs } from '../lib/linkclient.mjs'

const { ok, done } = checks('devices')
const QUIET = 1500 * 2.5 // BRIDGE_LINK_PING_MS below: a quiet link is started over after this
const relays = []
const kits = []
// fast: links checked every 1.5 s (so a quiet one is seen quickly); without, as in the app (30 s).
const kitWith = async (name, rel, { fast = true } = {}) => {
  const k = await startKit(`devices-${name.toLowerCase()}`, {
    env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, ...(fast ? { BRIDGE_LINK_PING_MS: '1500' } : {}) } },
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
  ok(/^<svg/.test(p?.qr || '') && p.link === `${ra.url}/#pair=${p.code}&name=Studio` && /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/.test(p.code), 'Pair a device gives a QR code, a link (with the computer\'s name, for the phone\'s "Pair with Studio?") and a code', p && { link: p.link, code: p.code })
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
  const ctl = (r, what) => fetch(`${r.url}/_test/${what}`, { method: 'POST' }).then((x) => x.json())

  // ---------- nothing the relay can change in the clear is believed ----------
  const pairCode = async () => (await a.api('/relay/pair', {})).pairing.code
  const devOf = async (id) => (await a.api('/relay')).devices.find((d) => d.id === id) || null
  const evil = { kind: 'computer', relay: 'http://127.0.0.1:9' }
  const code1 = await pairCode()
  // A phone pairing now, its hello made to say (as a relay in between could) it's a computer called
  // Studio Mac at another relay; sealed, it says it's Pocket.
  const pocket = await linkAs(ra.url, { code: code1, name: 'Studio Mac', hello: evil, about: { name: 'Pocket' } })
  ok((await pocket.request?.('GET', '/api/version'))?.status === 200, 'a phone pairs with Pair a device\'s code, and is answered', pocket.refused)
  const pd = await devOf(pocket.deviceId)
  ok(pd?.name === 'Pocket' && pd.kind === 'phone' && !pd.relay && pd.fresh, 'what its hello said in the clear (a computer, its name, a relay) counts for nothing: it\'s a phone, by the name it sent sealed, and new until kept', pd)
  const st1 = await a.api('/relay')
  ok(!st1.pairing && st1.paired?.name === 'Pocket', 'a code pairs one device: its QR code goes, and Studio says which device it paired', { pairing: !!st1.pairing, paired: st1.paired })
  ok((await a.api('/machines')).newDevices.some((d) => d.id === pocket.deviceId && d.kind === 'phone'), 'and the app says so on Studio, to keep or remove')
  const second = await linkAs(ra.url, { code: code1, name: 'Second' })
  const code2 = await pairCode()
  const mistyped = await linkAs(ra.url, { code: code2.replace(/.$/, (x) => (x === 'A' ? 'B' : 'A')), name: 'Mistyped' })
  ok(second.refused?.why === 'code-expired' && mistyped.refused?.why === 'code-expired', 'the same code again: turned away; and a mistyped one gets the very same answer, so nothing tells a guess from a used code', [second.refused, mistyped.refused])
  pocket.close()
  await until(async () => !(await devOf(pocket.deviceId))?.connected, 5000, 100)
  const pocketAgain = await linkAs(ra.url, { device: pocket.device, hostKey: pocket.hostKey, name: 'Renamed in the clear', hello: evil, about: { name: 'Pocket 2', ...evil } })
  ok((await pocketAgain.request?.('GET', '/api/version'))?.status === 200, 'paired, it connects again')
  const pd2 = await devOf(pocket.deviceId)
  ok(pd2?.name === 'Pocket 2' && pd2.kind === 'phone' && !pd2.relay, 'its name is the one it says sealed (never the one in the clear), and its kind never changes: still a phone, with no relay', pd2)
  pocketAgain.close()
  await until(async () => !(await devOf(pocket.deviceId))?.connected, 5000, 100)
  const silent = await linkAs(ra.url, { device: pocket.device, hostKey: pocket.hostKey })
  await sleep(1000)
  const before = (await devOf(pocket.deviceId))?.connected
  await silent.send(K.PING, 0)
  ok(before === false && !!(await until(async () => (await devOf(pocket.deviceId))?.connected, 5000, 100)), 'a hello from its key (anyone who has seen the key, its relay, can send one) doesn\'t make it connected; its first sealed record does', { before })
  silent.close()
  // One from before: no sealed ABOUT, no seal (the iPhone app carries its own older copy).
  const oldPhone = await linkAs(ra.url, { code: await pairCode(), name: 'Old phone', old: true })
  ok((await oldPhone.request?.('GET', '/api/version'))?.status === 200 && (await devOf(oldPhone.deviceId))?.name === 'Old phone', 'a phone from before pairs, is answered, and keeps the name it gave in the clear when it paired', await devOf(oldPhone.deviceId))
  oldPhone.close()
  const oldAgain = await linkAs(ra.url, { device: oldPhone.device, hostKey: oldPhone.hostKey, name: 'Studio Mac', old: true, hello: evil })
  const oldAnswer = await oldAgain.request?.('GET', '/api/version')
  const od = await devOf(oldPhone.deviceId)
  ok(oldAnswer?.status === 200 && od?.name === 'Old phone' && od.kind === 'phone' && !od.relay, 'then connects again as before, and what it says in the clear after that changes nothing', od)

  // ---------- removing one removes it ----------
  const sub = { endpoint: `https://127.0.0.1:9/push/${Date.now()}`, keys: { p256dh: 'not-a-key', auth: 'not-a-secret' } }
  const subbed = await oldAgain.request('POST', '/api/push/subscribe', { subscription: sub, label: 'Old phone' })
  ok(subbed.status === 200 && (await a.api('/push/devices')).some((x) => x.label === 'Old phone'), 'the old phone turns notifications on, through the link', subbed)
  await a.api(`/relay/devices/${oldPhone.deviceId}`, null, 'DELETE')
  const after = await oldAgain.request('GET', '/api/version')
  ok(/removed/.test(after.error || ''), 'removed on Studio: what it asks right after is turned down at once', after)
  ok(!(await a.api('/push/devices')).some((x) => x.label === 'Old phone'), 'and its notifications stop: its subscription goes with it', await a.api('/push/devices'))
  oldAgain.close()
  const oldBack = await linkAs(ra.url, { device: oldPhone.device, hostKey: oldPhone.hostKey, old: true })
  ok(oldBack.refused?.why === 'not-paired', 'connecting again, a phone from before is refused in the clear, as it always was', oldBack.refused)
  await a.api(`/relay/devices/${pocket.deviceId}`, null, 'DELETE')
  const removedNow = await linkAs(ra.url, { device: pocket.device, hostKey: pocket.hostKey })
  const word = removedNow.welcome ? await removedNow.next().catch(() => null) : null
  ok(word?.kind === K.GONE, 'one from now on is told it was removed in a sealed record, the only word that unpairs it', { refused: removedNow.refused, kind: word?.kind })
  removedNow.close?.()
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8')
  ok(/whenAsked\(/.test(src) && !/whenAsked\([^\n]*\$\{a\.code\}/.test(src), 'the six digits of an ask never go in a notification')

  // ---------- a relay that rewrites Laptop's hello, or answers for Studio ----------
  const machineOf = async (k, name) => (await k.api('/relay')).devices.find((d) => d.kind === 'computer' && d.name === name) || null
  await ctl(ra, 'tamper?name=Evil&relay=http%3A%2F%2F127.0.0.1%3A9')
  await ra.drop()
  ok(!!(await online(b, 'Studio')), 'Laptop\'s hello rewritten on the way: it still links')
  const lp = await machineOf(a, 'Laptop')
  ok(lp?.relay === rb.url && !(await machineOf(a, 'Evil')) && (await other(a, 'Laptop'))?.relay === rb.url, 'and Studio keeps Laptop\'s name and relay as Laptop said them sealed: no other name, no move to the relay\'s address', { lp, machine: await other(a, 'Laptop') })
  await ctl(ra, 'forge?as=refuse&why=not-paired')
  await ra.drop()
  const told = await until(async () => { const m = await other(b, 'Studio'); return m && !m.online && /couldn't be checked/.test(m.error || '') ? m : null }, 20000, 300)
  ok(told?.state === 'linked', 'Studio\'s relay refuses Laptop in the clear ("not paired"): Laptop says the answer couldn\'t be checked, stays linked, and keeps trying (it used to take itself as unlinked)', await other(b, 'Studio'))
  await ctl(ra, 'forge?as=welcome')
  await sleep(4000)
  ok((await other(b, 'Studio'))?.state === 'linked', 'answered with keys that aren\'t Studio\'s: still linked, saying so', await other(b, 'Studio'))
  await ctl(ra, 'honest')
  await b.api(`/machines/${(await other(b, 'Studio')).id}/check`, {})
  ok(!!(await online(b, 'Studio')), 'the relay honest again: linked again')

  // ---------- a connection that goes quiet (a Mac that slept) ----------
  await ra.freeze()
  const quiet = await until(async () => (await other(b, 'Studio'))?.online === false, QUIET * 4, 200)
  ok(!!quiet, 'a link that goes quiet is noticed as lost', await other(b, 'Studio'))
  await ra.thaw()
  ok(!!(await online(b, 'Studio')), 'and connects again by itself once the network is back, with no restart')

  // ---------- one that drops ----------
  await ra.drop()
  ok(!!(await online(b, 'Studio')), 'a dropped connection comes back by itself')

  // ---------- one that drops while something of Studio's is on its way ----------
  // Asked again once the link is back: a window opened then showed the error as its page, or
  // stayed white for want of its code.
  const net = (r, q = '') => fetch(`${r.url}/_test/net${q}`, { method: 'POST' })
  await net(ra, '?ms=400')
  const inFlight = fetch(`${b.url}/m/${studio.id}/api/version`).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))
  await sleep(200)
  await ra.drop()
  const got = await inFlight
  await net(ra)
  ok(got.status === 200 && !!got.json?.version, 'something of Studio\'s asked for as its link drops is asked again once it\'s back, and comes', got)

  // ---------- Studio drops off the network without a word (Wi-Fi off, a lid closed on the move) ----------
  // Its relay hears nothing either way, and kept saying it was there: Laptop asks Studio itself.
  let t0 = Date.now()
  await ctl(ra, 'away')
  const lost = await until(async () => (await other(b, 'Studio'))?.online === false, 60000, 200)
  const lostIn = lost ? Date.now() - t0 : null
  ok(lostIn != null && lostIn < QUIET * 2 + 5000, `Studio drops off the network without a word: Laptop sees it offline in ${lostIn} ms (limit ${QUIET * 2 + 5000})`, await other(b, 'Studio'))
  await sleep(45000) // its relay lets it go too, once it's been quiet 40 s
  t0 = Date.now()
  await ctl(ra, 'back')
  const backOn = await until(async () => (await other(b, 'Studio'))?.online === true, 30000, 200)
  const relinkedIn = backOn ? Date.now() - t0 : null
  ok(relinkedIn != null && relinkedIn < 12000, `back on the network: linked again in ${relinkedIn} ms (limit 12 s)`, await other(b, 'Studio'))

  // ---------- a link that dies without a word, then something's asked of it ----------
  // Desk checks its links as the app does (every 30 s). Its link to Studio goes dead without a word
  // (its relay hears nothing either way): what you click there is answered within seconds, on a new
  // link, rather than waiting on the dead one until its next check (up to 75 s).
  const rd = await startRelay('devices-desk')
  relays.push(rd)
  const desk = await kitWith('Desk', rd, { fast: false })
  ok(!!(await until(async () => (await desk.api('/relay')).online, 20000)), 'Desk, which checks its links every 30 s, is on its relay')
  await desk.api('/machines', { link: (await a.api('/relay/pair', {})).pairing.link })
  ok(!!(await online(desk, 'Studio')), 'and linked with Studio')

  // ---------- one that linked with Studio's code meets the others once kept there ----------
  const fresh = await until(async () => { const m = await a.api('/machines'); return m.newDevices.some((d) => d.name === 'Desk' && d.machine) && m.newDevices.some((d) => d.name === 'Laptop') && m.machines.filter((x) => x.held).length === 2 ? m : null }, 15000, 300)
  ok(!!fresh && fresh.machines.find((m) => m.name === 'Desk')?.held && fresh.machines.find((m) => m.name === 'Laptop')?.held, 'Desk and Laptop linked with Studio\'s code: Studio says so (Keep or Remove), and holds back introducing them to its other computers', fresh?.newDevices)
  await sleep(2000)
  ok(!(await other(desk, 'Laptop')) && !(await other(b, 'Desk')), 'so Desk and Laptop don\'t meet through Studio yet')
  const asksInvite = await fetch(`${desk.url}/m/${(await other(desk, 'Studio')).id}/api/machines/invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then(async (r) => ({ status: r.status, ...(await r.json().catch(() => ({}))) }))
  ok(asksInvite.status >= 400 && /^Keep Desk in Bridge AI on Studio first/.test(asksInvite.error || ''), 'nor can Desk get a code of Studio\'s to hand on', asksInvite)
  for (const d of fresh.newDevices.filter((x) => ['Laptop', 'Desk'].includes(x.name))) await a.api(`/relay/devices/${d.id}/keep`, {})
  ok(!!(await online(desk, 'Laptop')) && !!(await online(b, 'Desk')), 'kept on Studio: Desk and Laptop are introduced, and linked both ways')
  ok(!(await a.api('/machines')).newDevices.some((d) => ['Laptop', 'Desk'].includes(d.name)), 'and Studio says no more about them')
  const studioOnDesk = await other(desk, 'Studio')
  await fetch(`${ra.url}/_test/silence`, { method: 'POST' }) // Studio's relay: the devices' connections to it go dead
  ok((await other(desk, 'Studio'))?.online === true, 'Studio still looks online to Desk')
  t0 = Date.now()
  const late = await fetch(`${desk.url}/m/${studioOnDesk.id}/api/version`).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }), (e) => ({ error: e.message }))
  const lateIn = Date.now() - t0
  ok(late.status === 200 && !!late.json?.version && lateIn < 20000, `something asked of Studio on the dead link is answered in ${lateIn} ms, on a new one (limit 20 s; it waited for the next check)`, late)

  // ---------- a new link that doesn't work, for a device that's linked ----------
  // (Pasted while Studio is closed, so it's tried as Studio comes back; it used to stop the link
  // for good, until Bridge AI was restarted.)
  a.stop()
  ok(!!(await until(async () => (await other(b, 'Studio'))?.online === false, 15000, 200)), 'Studio quit: Laptop sees it offline')
  // Its page meanwhile, in a window: that it isn't reachable, trying again by itself (not the error as the page).
  const away = await fetch(`${b.url}/m/${studio.id}/`, { headers: { accept: 'text/html' } })
  const awayHtml = await away.text()
  ok(away.status === 503 && /Studio isn't reachable/.test(awayHtml) && /http-equiv="refresh"/.test(awayHtml) && /Trying again/.test(awayHtml), 'a page of Studio\'s while it\'s away says it isn\'t reachable, and tries again by itself', { status: away.status, html: awayHtml.slice(0, 300) })
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
  // (A key that isn't the one it was linked with could be the relay's, so nothing kept changes on
  // it: it says so, and keeps trying.)
  const changed = await until(async () => { const m = await other(b, 'Studio'); return m?.state === 'linked' && !m.online && /couldn't be checked/.test(m.error || '') ? m : null }, 30000, 300)
  ok(!!changed, 'Studio with a new key: Laptop says the answer couldn\'t be checked, and stays linked, trying again', await other(b, 'Studio'))
  ok(/set up again, link it again with a code from Studio/.test((await other(b, 'Studio'))?.error || ''), 'with what to do')
  const p2 = (await a.api('/relay/pair', {})).pairing
  const relinked = await b.api('/machines', { link: p2.link })
  ok(relinked.machine?.state === 'linked', 'a new code from Studio links it again, with its new key', relinked.machine)
  ok(!!(await online(b, 'Studio')), 'online again')

  // ---------- it forgot this device ----------
  const laptopAtStudio = await other(a, 'Laptop')
  b.stop()
  await a.api(`/machines/${laptopAtStudio.id}`, null, 'DELETE')
  await b.restart()
  ok(!!(await until(async () => (await other(b, 'Studio'))?.state === 'removed', 30000, 300)), 'Studio unlinked Laptop while it was closed: Laptop is told so, sealed, and says so', await other(b, 'Studio'))
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

  // ---------- strangers' hellos, many at once ----------
  await sleep(10500)
  const knocks = await Promise.all(Array.from({ length: 20 }, () => linkAs(ra.url, { name: 'Stranger', ms: 4000 })))
  const answered = knocks.filter((k) => k.refused).length
  ok(answered >= 1 && answered <= 12 && knocks.some((k) => k.unanswered), `strangers' hellos past a dozen in 10 s are let go unanswered (${answered} of 20 answered), so no one keeps Studio working out keys`, { answered })
  await sleep(10500)
  ok(!!(await online(b, 'Studio')), 'while Laptop, paired, still links')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
}
process.exit(done().fail ? 1 : 0)
