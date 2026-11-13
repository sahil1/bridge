// A computer set up for other people to try (an app store's reviewers): its review code
// (server/relay.js, bridge-ai pair --review), which lasts days and pairs several phones, where Pair
// a device's code works once for 15 minutes. Two Bridge AIs on their own relays
// (stand-ins/relay.mjs), "Demo" started with BRIDGE_REVIEW_PAIRING=1 and "Mine" without, and phones
// spoken for here (lib/linkclient.mjs). Mine never makes one. Demo's pairs phone after phone, each
// one a phone not kept yet, is the same after a restart, isn't
// stopped by wrong guesses, and stops when used up, run out, made anew or stopped; a phone can't
// make one; and the CLI shows it and writes its QR code as a picture.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, startKit, startRelay, checks, until, sleep } from '../lib/harness.mjs'
import { linkAs } from '../lib/linkclient.mjs'

const { ok, done } = checks('review-pairing')
const relays = []
const kits = []
const kitWith = async (name, rel, env = {}) => {
  const k = await startKit(`review-pairing-${name.toLowerCase()}`, {
    env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name, ...env } },
  })
  kits.push(k)
  return k
}
const relayJson = (k) => JSON.parse(fs.readFileSync(path.join(k.data, 'relay.json'), 'utf8'))
const refusal = (fn) => fn().then(() => null, (e) => e)

try {
  const rd = await startRelay('review-pairing-demo')
  const rm = await startRelay('review-pairing-mine')
  relays.push(rd, rm)
  const demo = await kitWith('Demo', rd, { BRIDGE_REVIEW_PAIRING: '1' })
  const mine = await kitWith('Mine', rm)
  ok(!!(await until(async () => (await demo.api('/relay')).online && (await mine.api('/relay')).online, 20000)), 'each is connected to its own relay')
  const cli = (k, ...a) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'cli.js'), ...a], { cwd: k.dir, env: { ...process.env, HOME: k.home, BRIDGE_HOME: k.data, BRIDGE_PORT: String(k.port) }, encoding: 'utf8', timeout: 30000 })

  // ---------- only a computer started as one for others to try ----------
  const no = await refusal(() => mine.api('/relay/pair', { review: {} }))
  ok(/BRIDGE_REVIEW_PAIRING=1/.test(no?.message || '') && (await mine.api('/relay')).review === null && !relayJson(mine).review, 'a computer not started for it makes no review code, and says what would', no?.message)
  const noCli = cli(mine, 'pair', '--review')
  ok(noCli.status !== 0 && /BRIDGE_REVIEW_PAIRING=1/.test(noCli.stderr + noCli.stdout), 'nor from the CLI, which says the same', [noCli.status, noCli.stderr])
  // One left in its relay.json (copied from a review computer) doesn't work there either.
  const planted = (await demo.api('/relay/pair', { review: {} })).review
  await mine.restart(() => { const j = relayJson(mine); j.review = { ...relayJson(demo).review, link: `${rm.url}/#pair=${planted.code}` }; fs.writeFileSync(path.join(mine.data, 'relay.json'), JSON.stringify(j)) })
  await until(async () => (await mine.api('/relay')).online, 20000)
  const stray = await linkAs(rm.url, { code: planted.code, name: 'Stray' })
  ok(stray.refused?.why === 'code-expired' && (await mine.api('/relay')).review === null, 'and one written into its relay.json is refused there', stray.refused)

  // ---------- the review code: days, several phones ----------
  const r = (await demo.api('/relay/pair', { review: { fresh: true } })).review
  const days = (r.expires - Date.now()) / 86400000
  ok(r.link === `${rd.url}/#pair=${r.code}&name=Demo` && /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/.test(r.code) && r.code !== planted.code && days > 13.9 && days <= 14 && r.uses === 0 && r.max === 25, 'Demo makes one: a link and a code as Pair a device\'s, for 14 days and 25 phones', { ...r, days })
  const old = await linkAs(rd.url, { code: planted.code, name: 'Late' })
  ok(old.refused?.why === 'code-expired', 'the one made before it no longer works', old.refused)
  const one = await linkAs(rd.url, { code: r.code, name: 'x', about: { name: 'Reviewer 1' } })
  const two = await linkAs(rd.url, { code: r.code, name: 'x', about: { name: 'Reviewer 2' } })
  ok((await one.request?.('GET', '/api/version'))?.status === 200 && (await two.request?.('GET', '/api/version'))?.status === 200, 'two phones pair with the same code, and each is answered', [one.refused, two.refused])
  const st = await demo.api('/relay')
  const paired = st.devices.filter((d) => /^Reviewer [12]$/.test(d.name))
  ok(paired.length === 2 && paired.every((d) => d.kind === 'phone' && d.fresh && d.connected) && st.review.uses === 2, 'both are phones, not kept yet, and the code says it has paired two', { paired, uses: st.review.uses })
  const made = await one.request('POST', '/api/relay/pair', { review: {} })
  ok(made.status >= 400 && /on your computer/.test(made.json?.error || '') && (await demo.api('/relay')).review.code === r.code, 'a phone can\'t make a review code', made)
  // Pair a device's own code is as it was beside it: once.
  const p = (await demo.api('/relay/pair', {})).pairing
  const a = await linkAs(rd.url, { code: p.code, name: 'x', about: { name: 'Mine 1' } })
  const b = await linkAs(rd.url, { code: p.code, name: 'x', about: { name: 'Mine 2' } })
  ok((await a.request?.('GET', '/api/version'))?.status === 200 && b.refused?.why === 'code-expired', 'Pair a device\'s code still pairs one phone, once', [a.refused, b.refused])
  for (const c of [one, two, a]) c.close()

  // ---------- wrong guesses don't stop it; a restart keeps it ----------
  await sleep(10500) // strangers' hellos are counted over 10 seconds (devices)
  const wrong = `${r.code.slice(0, 4)}-AAAA-AAAA-AAAA-AAAA`
  const guesses = []
  for (let i = 0; i < 6; i++) guesses.push((await linkAs(rd.url, { code: wrong, name: 'Guess' })).refused?.why)
  ok(guesses.every((w) => w === 'code-expired'), 'six wrong guesses at it are each turned away', guesses)
  await demo.restart()
  await until(async () => (await demo.api('/relay')).online, 20000)
  ok((await demo.api('/relay')).review?.code === r.code && (await demo.api('/relay')).review.uses === 2, 'after a restart it\'s the same code, with its count')
  const three = await linkAs(rd.url, { code: r.code, name: 'x', about: { name: 'Reviewer 3' } })
  ok((await three.request?.('GET', '/api/version'))?.status === 200, 'and still pairs, after the guesses and the restart', three.refused)
  three.close()

  // ---------- the CLI ----------
  const png = path.join(demo.dir, 'qr.png')
  const shown = cli(demo, 'pair', '--review', '--png', png)
  const sig = fs.existsSync(png) ? fs.readFileSync(png).subarray(0, 8).toString('hex') : null
  ok(shown.status === 0 && shown.stdout.includes(`Link: ${r.link}`) && shown.stdout.includes(`Code: ${r.code}`) && /for 22 more phones \(3 paired so far\)/.test(shown.stdout) && sig === '89504e470d0a1a0a', 'bridge-ai pair --review shows the same code, how long and how many it has left, and writes its QR code as a PNG', [shown.status, shown.stdout.slice(-600), shown.stderr, sig])
  const status = cli(demo, 'status')
  ok(status.stdout.includes(r.code), 'bridge-ai status shows it too', status.stdout.slice(-600))

  // ---------- used up, run out, stopped ----------
  await sleep(10500)
  const longer = cli(demo, 'pair', '--review', '--days', '60')
  const l1 = (await demo.api('/relay')).review
  ok(longer.status === 0 && l1.code === r.code && l1.uses === 3 && l1.max === 25 && Math.round((l1.expires - Date.now()) / 86400000) === 60 && longer.stdout.includes(`Link: ${r.link}`), '--days on one that works makes the same code last that long, with what it has paired', [longer.stderr, l1])
  const most = (await demo.api('/relay/pair', { review: { days: 400 } })).review
  ok(most.code === r.code && Math.round((most.expires - Date.now()) / 86400000) === 90, 'for 90 days at most', most)
  const short = cli(demo, 'pair', '--review', '--new', '--uses', '1', '--days', '2')
  const s1 = (await demo.api('/relay')).review
  ok(short.status === 0 && s1.code !== r.code && s1.uses === 0 && s1.max === 1 && Math.round((s1.expires - Date.now()) / 86400000) === 2, '--new makes another, for that many', [short.stderr, s1])
  const u1 = await linkAs(rd.url, { code: s1.code, name: 'x', about: { name: 'Only' } })
  const u2 = await linkAs(rd.url, { code: s1.code, name: 'x', about: { name: 'Too many' } })
  ok((await u1.request?.('GET', '/api/version'))?.status === 200 && u2.refused?.why === 'code-expired' && (await demo.api('/relay')).review === null, 'a code for one phone pairs one, then is gone', [u1.refused, u2.refused])
  u1.close()
  const s2 = (await demo.api('/relay/pair', { review: { days: 1 } })).review
  await demo.restart(() => { const j = relayJson(demo); j.review.expires = Date.now() - 1000; fs.writeFileSync(path.join(demo.data, 'relay.json'), JSON.stringify(j)) })
  await until(async () => (await demo.api('/relay')).online, 20000)
  const late = await linkAs(rd.url, { code: s2.code, name: 'Late' })
  ok(late.refused?.why === 'code-expired' && (await demo.api('/relay')).review === null, 'one that has run out pairs no one', late.refused)
  const s3 = (await demo.api('/relay/pair', { review: {} })).review
  const stopped = cli(demo, 'pair', '--review', '--stop')
  const after = await linkAs(rd.url, { code: s3.code, name: 'After' })
  ok(stopped.status === 0 && after.refused?.why === 'code-expired' && !relayJson(demo).review, '--stop ends it', [stopped.stderr, after.refused])
  ok((await demo.api('/relay')).devices.some((d) => d.name === 'Reviewer 1'), 'and the phones it paired stay until removed')
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
}
process.exit(done().fail ? 1 : 0)
