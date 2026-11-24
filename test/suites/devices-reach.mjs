// Another of your computers that can't reach this one is said as it is, with what to do, never just
// "offline", and comes back by itself where it can: two Bridge AIs ("Mac" and "Air"), each on a relay
// of its own (stand-ins/relay.mjs: the real relay, run on this computer), linked both ways, Mac with
// Remote Screen and Preview on.
//   Mac's relay tells Air that Mac isn't connected, though it is (a relay that got it wrong, or its
//   word that Mac came back that never arrived): Air says Mac is offline, and doesn't wait on that
//   word for good. Something asked of Mac (opening it) asks Mac's relay again, on a new connection,
//   and gets through; and with nothing asked, Air asks again by itself a while later.
//   Mac doesn't know Air any more (its pairing gone, as when Mac was set up again): Air says Mac turned
//   it away, saying it doesn't know Air, and what to do, in its list ("why": a word for wherever Air
//   lists Mac) and its log, and Mac's log says it turned Air away and why; and Mac, which still
//   reaches Air, asks it what it sees and says Air can't reach it, in Air's own words (as it would
//   for an Air on a Bridge AI from before, which says only what its list says). A new code from Mac
//   links them again, Air's log says it's connected again, and Mac stops saying it can't.
//   A computer from before (Bridge AI 3.21.0, which doesn't say which of its devices it asks for),
//   linked before a guardrail was set on Mac: still answered once one is. One linked after: New, so
//   turned away until it's let in, and Mac's log says so.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, checks, until, sleep } from '../lib/harness.mjs'
import { linkAs } from '../lib/linkclient.mjs'

const { ok, done } = checks('devices-reach')
// Air asks Mac's relay again by itself this long after it said Mac isn't connected (5 minutes in the app).
const RECHECK = 12000
const relays = []
const kits = []
const kitWith = async (name, rel, env = {}) => {
  const k = await startKit(`reach-${name.toLowerCase()}`, {
    config: { trials: { 'remote-screen': true } },
    env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, BRIDGE_LINK_PING_MS: '1500', ...env } },
  })
  kits.push(k)
  return k
}
const other = async (k, name) => (await k.api('/machines')).machines.find((m) => m.name === name) || null
const online = (k, name, ms = 30000) => until(async () => (await other(k, name))?.online === true, ms, 200)
const hush = (r) => fetch(`${r.url}/_test/hush`, { method: 'POST' }).then((x) => x.json())
const relayJson = (k) => JSON.parse(fs.readFileSync(path.join(k.data, 'relay.json'), 'utf8'))

try {
  const rm = await startRelay('reach-mac')
  const ra = await startRelay('reach-air')
  relays.push(rm, ra)
  // (Mac asks Air what it sees of Mac once Air's link to it has been down this long: a minute in the app.)
  const mac = await kitWith('Mac', rm, { BRIDGE_REACH_ASK_MS: '2000' })
  const air = await kitWith('Air', ra, { BRIDGE_LINK_RECHECK_MS: String(RECHECK) })
  ok(!!(await until(async () => (await mac.api('/relay')).online && (await air.api('/relay')).online, 20000)), 'each is connected to its own relay')
  await air.api('/machines', { link: (await mac.api('/relay/pair', {})).pairing.link })
  ok(!!(await online(air, 'Mac')) && !!(await online(mac, 'Air')), 'Air and Mac linked, both ways')
  const macOnAir = await other(air, 'Mac')
  ok(macOnAir.why === null && macOnAir.error === null, 'online: nothing to say about why not', macOnAir)

  // ---------- Mac's relay says Mac isn't there, though it is ----------
  await hush(rm)
  const hushed = await until(async () => { const m = await other(air, 'Mac'); return m && !m.online ? m : null }, 8000, 100)
  ok(hushed?.why === 'offline' && /Mac is offline/.test(hushed.error || ''), 'Mac\'s relay says Mac isn\'t connected: Air says Mac is offline (why: offline)', hushed)
  const t0 = Date.now()
  await sleep(10500) // (its relay's word, from a while ago)
  const opened = await fetch(`${air.url}/m/${macOnAir.id}/api/version`).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }), (e) => ({ error: e.message }))
  const openedIn = Date.now() - t0
  ok(opened.status === 200 && !!opened.json?.version && openedIn < RECHECK, `something asked of Mac then (opening it) asks its relay again and gets through, in ${openedIn} ms from its relay's word (before Air would have asked by itself, ${RECHECK} ms)`, opened)
  ok((await other(air, 'Mac'))?.online === true, 'and Mac is online on Air again')
  await hush(rm)
  ok(!!(await until(async () => (await other(air, 'Mac'))?.online === false, 8000, 100)), 'told so again: offline on Air')
  const t1 = Date.now()
  const back = await online(air, 'Mac', RECHECK * 3)
  const backIn = Date.now() - t1
  ok(!!back && backIn >= RECHECK - 1000, `with nothing asked of Mac, Air asks its relay again by itself and is back in ${backIn} ms (after ${RECHECK} ms of its relay's word, not at once)`, await other(air, 'Mac'))

  // ---------- Mac doesn't know Air any more ----------
  // (Air's pairing taken out of Mac's relay.json while Mac is closed, with no word that it was
  // removed: as when Mac was set up again with its key kept.)
  const airKey = relayJson(mac).devices.find((d) => d.name === 'Air')?.key
  await mac.restart(() => {
    const j = relayJson(mac)
    fs.writeFileSync(path.join(mac.data, 'relay.json'), JSON.stringify({ ...j, devices: (j.devices || []).filter((d) => d.key !== airKey), removed: (j.removed || []).filter((x) => x.key !== airKey) }))
  })
  const refused = await until(async () => { const m = await other(air, 'Mac'); return m && !m.online && m.why === 'unchecked' ? m : null }, 30000, 200)
  ok(!!refused && /Mac said it doesn't know this computer/.test(refused.error) && /couldn't be checked/.test(refused.error) && /link it again with a code from Mac/.test(refused.error), 'Mac turns Air away, not knowing it: Air says so (why: unchecked), with what Mac said and what to do, not just offline', refused)
  ok(refused?.state === 'linked', 'and keeps the link as it is (a refusal in the clear could be the relay\'s)')
  ok(!!(await until(() => /relay: Air \(computer\) was turned away: it isn't linked with Mac any more/.test(mac.log()), 8000, 200)), 'Mac\'s log says it turned Air away, and why', mac.log().split('\n').filter((l) => /relay:/.test(l)).slice(-5))
  ok(/machines: Mac: Can't connect to Mac: Mac said it doesn't know this computer/.test(air.log()), 'and so does Air\'s', air.log().split('\n').filter((l) => /machines:/.test(l)).slice(-5))
  // On Mac, where Air is online (Mac reaches it): Air can't reach Mac, in Air's own words.
  const reach = await until(async () => { const m = await other(mac, 'Air'); return m?.online && m.reach ? m : null }, 45000, 500)
  ok(/Mac said it doesn't know this computer/.test(reach?.reach?.error || '') && /link it again with a code from Mac/.test(reach.reach.error), 'Mac, which still reaches Air, says Air can\'t reach it, in Air\'s words, with what to do', reach && { online: reach.online, reach: reach.reach })
  ok(/machines: Air can't reach this computer, and says: Can't connect to Mac/.test(mac.log()), 'and its log says so', mac.log().split('\n').filter((l) => /machines:/.test(l)).slice(-5))
  const again = await air.api('/machines', { link: (await mac.api('/relay/pair', {})).pairing.link })
  ok(again.machine?.state === 'linked' && !!(await online(air, 'Mac')), 'a new code from Mac links them again', again.machine)
  ok(!!(await until(() => /machines: Mac: connected again/.test(air.log()), 5000, 200)), 'and Air\'s log says it\'s connected again')
  ok((await other(air, 'Mac'))?.why === null, 'with nothing more to say')
  ok(!!(await until(async () => { const m = await other(mac, 'Air'); return m?.online && !m.reach }, 10000, 300)), 'and Mac no longer says Air can\'t reach it', await other(mac, 'Air'))

  // ---------- a computer from before ----------
  // Bridge AI 3.21.0: its ABOUT says no forDevices, and it says nothing of which of its devices asks.
  const asOld = (name) => ({ name, about: { name, kind: 'computer', os: 'mac', version: '3.21.0', relay: null }, hello: { kind: 'computer', os: 'mac', version: '3.21.0' } })
  const old = await linkAs(rm.url, { code: (await mac.api('/relay/pair', {})).pairing.code, ...asOld('OldBox') })
  ok((await old.request?.('GET', '/api/machines/summary'))?.status === 200, 'a computer on Bridge AI 3.21.0 links with Mac and is answered', old.refused)
  await mac.api('/remote/password', { password: 'reach-test-password' })
  const kept = await old.request('GET', '/api/machines/summary')
  ok(kept.status === 200 && kept.json?.name === 'Mac', 'Mac sets a guardrail (a Remote Access Password): the computer from before, linked before it, is still answered', kept)
  const listed = (await mac.api('/remote')).access.devices.find((d) => d.name === 'OldBox')
  ok(listed?.allowed === true && listed.older === true, 'and Which Devices May Connect lists it as let in, on an older Bridge AI', listed)
  const old2 = await linkAs(rm.url, { code: (await mac.api('/relay/pair', {})).pairing.code, ...asOld('OldBox2') })
  const turned = await old2.request?.('GET', '/api/machines/summary')
  ok(turned?.status === 403 && turned.json?.code === 'notLetIn' && /hasn't let this device in/.test(turned.json.error || ''), 'one linked after the guardrail: New, turned away until it\'s let in, saying so (never as offline)', turned)
  ok(!!(await until(() => /Which Devices May Connect: OldBox2 \(a linked computer\) was turned away here: it isn't let in/.test(mac.log()), 5000, 200)), 'and Mac\'s log says it turned it away', mac.log().split('\n').filter((l) => /Which Devices/.test(l)).slice(-3))
  old.close?.()
  old2.close?.()
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
}
process.exit(done().fail ? 1 : 0)
