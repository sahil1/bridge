// Back Up & Move (server/backup.js, Settings › Back Up & Move), with three Bridge AIs: Studio, whose
// setup moves; Laptop, linked with it (each on its own relay, stand-ins/relay.mjs), where it moves
// to; and Spare, where a backup is restored. One stand-in Slack (stand-ins/slack.mjs) has the app
// they all connect as, so it shows which computer is connected. In the browser named by
// BRIDGE_TEST_BROWSER. Checked:
//   Back Up: one file, from Settings; a passphrase too short refused; the file's header plain, and
//   nothing else in it readable (no token, no instructions, no memory, no MCP server's secret, not
//   even the bot's name); a wrong passphrase, and a header changed, each said;
//   Restore (Spare, in the app): what comes before anything changes (a bot by a name taken there
//   comes as "Pricing Desk (2)"), then each part applied: the bot with its instructions and
//   memory, its connection with its tokens (readable by you only) but paused, saying why, so Slack
//   gets no second connection; its scheduled routine paused; the Chief of Staff's playbook (the one
//   there kept beside it); the MCP server in Claude Code's config; Start connects it;
//   Move (Studio to Laptop, from a phone paired with Studio): the phone can't make or open a file
//   (that's on the computer itself) but can Move; Laptop shows what's coming and applies it only
//   from itself (Studio, through the link, is refused); once applied, Studio's bot, connection and
//   scheduled routine are paused, and Laptop's started: one connection to Slack throughout, and a
//   question is answered on Laptop;
//   a bot's file in Studio's Activity, sent to Laptop with Send to…;
//   moved back with Laptop closed as Studio applies it: said, what came stays paused (nothing
//   connects twice), and Try Again once Laptop is back pauses Laptop's and starts Studio's.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { startKit, startRelay, startSlack, checks, until, browser, page, shot, TEST, IS_WIN } from '../lib/harness.mjs'
import { lookers, openSettings, M } from '../lib/bots.mjs'
import { linkAs } from '../lib/linkclient.mjs'

const { ok, done } = checks('backup-move')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const PASS = 'correct horse battery'
const SECRETS = ['xapp-test', 'xoxb-test', 'MARKER-INSTRUCTIONS', 'MARKER-MEMORY', 'mcp-secret-0451', 'Pricing Desk', 'MARKER-PLAYBOOK']
const relays = []
const kits = []
const slack = await startSlack('backup-move')
const kitWith = async (name, rel) => {
  const k = await startKit(`backup-move-${name.toLowerCase()}`, {
    config: { name: 'Tester', trials: { 'slack-bot': true, routines: true } },
    env: ({ data, home }) => {
      if (rel) fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile))
      for (const f of ['notes', 'inbox']) fs.mkdirSync(path.join(home, f), { recursive: true })
      return { BRIDGE_COMPUTER_NAME: name, BRIDGE_SLACK_URL: slack.url, BRIDGE_SLACK_PING_MS: '1000', BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000', BRIDGE_BOT_HOLD_MS: '60000', BRIDGE_LINK_PING_MS: '1500' }
    },
  })
  kits.push(k)
  k.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
  await k.api('/setup', { name: 'Tester' })
  await k.api('/agents/catalog')
  return k
}
const sockets = async () => (await slack.state()).connections
const conns = async (k) => (await k.api('/connections')).connections

try {
  const ra = await startRelay('backup-move-studio')
  const rb = await startRelay('backup-move-laptop')
  relays.push(ra, rb)
  const studio = await kitWith('Studio', ra)
  const laptop = await kitWith('Laptop', rb)
  const spare = await kitWith('Spare', null)
  const S = lookers(studio, slack)

  // ---------- Studio's setup ----------
  await studio.api('/bots', { name: 'Pricing Desk' })
  await studio.api('/bots/b1/tokens', { appToken: 'xapp-test', botToken: 'xoxb-test' })
  await studio.api('/bots/b1/settings', { askers: [{ id: 'U0DANA', name: 'Dana' }], readsFrom: ['~/notes'], instructions: '# Pricing Desk\n\nAnswer about prices. MARKER-INSTRUCTIONS\n' })
  await studio.api('/bots/b1/memory', { kind: 'bot', text: 'Dana runs sales. MARKER-MEMORY' })
  await studio.api('/routines', { name: 'Monday numbers', command: 'Post the numbers [answer The numbers.]', to: 'bot', bot: 'b1', channel: { id: 'C0LAUNCH', name: 'launch' }, schedule: 'every monday at 9' })
  fs.writeFileSync(path.join(studio.data, 'chief', 'state', 'playbook.md'), '# Playbook\n\nMARKER-PLAYBOOK: mornings are for deep work.\n')
  fs.writeFileSync(path.join(studio.home, '.claude.json'), JSON.stringify({ mcpServers: { tracker: { type: 'stdio', command: 'node', args: ['tracker.js'], env: { TRACKER_TOKEN: 'mcp-secret-0451' } } } }, null, 2))
  await studio.api('/settings', { location: { label: 'Lisbon', lat: 38.72, lon: -9.14, timezone: 'Europe/Lisbon' } }, 'PATCH')
  ok(!!(await S.connected()), 'Studio: a bot, connected to Slack')
  ok(await until(async () => (await sockets()) === 1, 10000), 'one connection to Slack')
  // A file its bot made, in Studio's Activity (sent on to Laptop below).
  await slack.ask({ user: 'U0DANA', text: `${M} The price sheet please [make prices.md Starter is $10.] [answer Here it is.]` })
  const madeQ = await S.draftOf('The price sheet please')
  await studio.api(`/bots/questions/${encodeURIComponent(madeQ.id)}`, { send: true })
  ok(!!(await until(async () => (await slack.state()).files.some((f) => f.name === 'prices.md'), 15000)), 'its bot made a file and sent it')

  // ---------- Back Up, in the app ----------
  let file = null
  let text = ''
  await part('back up', async () => {
    const short = await studio.api('/backup/file', { passphrase: 'short' }).catch((e) => e)
    ok(short.status === 400 && /at least 8 characters/.test(short.message), 'a passphrase too short is refused', short.message)
    const { ctx, p, errors } = await page(b, studio.url)
    await openSettings(p, 'backup', '.modal.settings [data-setting="backup"]')
    const sec = p.locator('[data-setting="backup"]')
    ok(/arrives paused until the computer it came from has stopped its bots/.test(await sec.innerText()), 'Settings says what comes arrives paused')
    await p.locator('.modal.settings details.st-adv[data-section="backup"] > summary').click()
    const words = await p.locator('[data-setting="backup-what"]').innerText()
    ok(/What Goes/.test(words) && /In it:/.test(words) && /with their tokens/.test(words) && /Left out:/.test(words) && /meetings and recordings/.test(words), 'and, under Advanced, exactly what goes and what\'s left out', words.slice(0, 900))
    await sec.locator('input[aria-label="Passphrase"]').fill(PASS)
    await sec.locator('input[aria-label="The passphrase again"]').fill(PASS)
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), sec.locator('button', { hasText: 'Back Up' }).click()])
    const to = path.join(studio.dir, dl.suggestedFilename())
    await dl.saveAs(to)
    text = fs.readFileSync(to, 'utf8')
    file = JSON.parse(text)
    ok(/^Studio-\d{4}-\d{2}-\d{2}\.bridge-backup$/.test(dl.suggestedFilename()) && !!(await until(async () => /Saved Studio-/.test(await sec.innerText()), 5000)), 'Back Up saves one file, named for the computer and the day, and says so', dl.suggestedFilename())
    await shot(p, `${tag}backup-move-studio`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
  await part('sealed', async () => {
    ok(file?.kind === 'bridge-ai-backup' && file.from === 'Studio' && file.kdf?.name === 'scrypt' && file.kdf.N >= 2 ** 17 && file.kdf.salt && file.cipher?.name === 'aes-256-gcm' && file.cipher.nonce && file.cipher.tag, 'its header: what it is, where from, scrypt with a salt, AES-256-GCM with a nonce', file && { ...file, sealed: `${String(file.sealed).length} characters` })
    const found = SECRETS.filter((x) => text.includes(x))
    ok(!found.length && !text.includes(Buffer.from('xoxb-test').toString('base64')), 'nothing else in it readable: no token, instructions, memory, MCP secret, playbook, or the bot\'s name', found)
    const again = await studio.api('/backup/file', { passphrase: PASS }).catch((e) => e)
    ok(again?.kdf?.salt && again.kdf.salt !== file.kdf.salt && again.cipher.nonce !== file.cipher.nonce, 'each backup has a salt and a nonce of its own')
  })
  await part('a wrong passphrase', async () => {
    const wrong = await spare.api('/backup/open', { file: text, passphrase: 'not the right one' }).catch((e) => e)
    ok(wrong.status === 403 && wrong.j?.code === 'passphrase' && /passphrase doesn't open this backup/.test(wrong.message), 'a wrong passphrase says so', wrong.message)
    const changed = await spare.api('/backup/open', { file: JSON.stringify({ ...file, from: 'Elsewhere' }), passphrase: PASS }).catch((e) => e)
    ok(changed.status === 403, 'and so does a file whose header was changed (it\'s sealed in too)', changed.message)
    ok(!(await spare.api('/backup')).paused.connections.length && !(await spare.api('/bots')).bots?.length, 'nothing changed on Spare')
  })

  // ---------- Restore, on Spare, in the app ----------
  await part('restore', async () => {
    await spare.api('/bots', { name: 'Pricing Desk' })
    fs.writeFileSync(path.join(spare.data, 'chief', 'state', 'playbook.md'), '# Spare\'s playbook\n')
    const before = await sockets()
    const { ctx, p, errors } = await page(b, spare.url)
    await openSettings(p, 'backup', '.modal.settings [data-setting="backup"]')
    const sec = p.locator('[data-setting="backup"]')
    const saved = path.join(spare.dir, 'studio.bridge-backup')
    fs.writeFileSync(saved, text)
    await sec.locator('input[type="file"]').setInputFiles(saved)
    await sec.locator('input[aria-label="Its passphrase"]').fill('not the right one')
    await sec.locator('button', { hasText: /^\s*Open$/ }).click()
    ok(!!(await until(async () => /passphrase doesn't open this backup/.test(await sec.innerText()), 30000)), 'in the app too, a wrong passphrase is said')
    await sec.locator('input[aria-label="Its passphrase"]').fill(PASS)
    await sec.locator('button', { hasText: /^\s*Open$/ }).click()
    const plan = sec.locator('.bk-plan')
    await plan.waitFor({ timeout: 30000 })
    const shown = await plan.innerText()
    ok(/From Studio/.test(shown) && /Pricing Desk, as Pricing Desk \(2\)/.test(shown) && /Pricing Desk \(Slack\).*with its tokens, paused until you Start it/s.test(shown) && /Monday numbers.*runs by itself: paused until you Start it/s.test(shown) && /playbook\.md, replacing the one here/.test(shown) && /tracker for Claude Code · runs node tracker\.js/.test(shown), 'what comes, before anything changes: the bot renamed for the one here, its connection paused, its routine paused, the playbook, the MCP server', shown)
    ok((await spare.api('/bots')).bots.length === 1, '(nothing applied yet)')
    await shot(p, `${tag}backup-move-plan`)
    await plan.locator('button', { hasText: 'Apply' }).click()
    await sec.locator('button', { hasText: 'Start Them Here' }).waitFor({ timeout: 20000 })
    const bot = (await spare.api('/bots')).bots.find((x) => x.name === 'Pricing Desk (2)')
    ok(!!bot, 'the bot, by a name not taken here', (await spare.api('/bots')).bots)
    const v = bot && await spare.api(`/bots/${bot.id}`)
    ok(/MARKER-INSTRUCTIONS/.test(v?.instructions?.text || '') && (await spare.api(`/bots/${bot.id}/memory`)).items.some((m) => /MARKER-MEMORY/.test(m.text) && m.state === 'kept'), 'with its instructions and what it remembers', v && { instructions: v.instructions })
    const c = (await conns(spare)).find((x) => x.own?.id === bot?.id)
    const tokens = c && path.join(spare.data, 'connections', c.id, 'slack.json')
    ok(c?.paused?.why && /Restored from a backup of Studio: stop its bots on Studio first/.test(c.paused.why) && c.state === 'off', 'its connection, paused, saying why', c && { paused: c.paused, state: c.state })
    ok(!!tokens && JSON.parse(fs.readFileSync(tokens, 'utf8')).botToken === 'xoxb-test' && (IS_WIN || (fs.statSync(tokens).mode & 0o777) === 0o600), 'its tokens there, readable by you only')
    ok(/Restored from a backup of Studio/.test(v?.why || '') && v?.state === 'off', 'the bot says why it isn\'t connected', v && { state: v.state, why: v.why })
    ok((await sockets()) === before, 'and Slack has no second connection', await sockets())
    const r = (await spare.api('/routines')).routines.find((x) => x.name === 'Monday numbers')
    ok(r?.paused === true && r.bot === bot?.id && r.auto === true, 'its scheduled routine paused, posting as the bot as it\'s called here', r)
    ok(/MARKER-PLAYBOOK/.test(fs.readFileSync(path.join(spare.data, 'chief', 'state', 'playbook.md'), 'utf8')) && /Spare's playbook/.test(fs.readFileSync(path.join(spare.data, 'chief', 'state', 'playbook.before-restore.md'), 'utf8')), 'the Chief of Staff\'s playbook, the one there kept beside it')
    const mcp = JSON.parse(fs.readFileSync(path.join(spare.home, '.claude.json'), 'utf8'))
    ok(mcp.mcpServers?.tracker?.env?.TRACKER_TOKEN === 'mcp-secret-0451', 'the MCP server in Claude Code\'s config there')
    ok((await spare.api('/settings')).user.location?.label === 'Lisbon', 'and the settings')
    ok(!spare.log().includes('xoxb-test') && !spare.log().includes(PASS) && !JSON.stringify(fs.readdirSync(path.join(spare.data, 'bots', bot.id, 'trace')).map((f) => fs.readFileSync(path.join(spare.data, 'bots', bot.id, 'trace', f), 'utf8'))).includes('xoxb-test'), 'no token or passphrase in its log or the bot\'s record')
    await shot(p, `${tag}backup-move-restored`)
    await sec.locator('button', { hasText: 'Start Them Here' }).click()
    ok(!!(await until(async () => (await spare.api(`/bots/${bot.id}`)).state === 'connected', 20000)), 'Start: connected')
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
    // (Spare goes: one app on two computers is what Move is for.)
    spare.stop()
    ok(await until(async () => (await sockets()) === 1, 15000), '(Spare closed: one connection again)')
  })

  // ---------- Move, from a phone paired with Studio ----------
  await part('move', async () => {
    const p1 = (await studio.api('/relay/pair', {})).pairing
    await laptop.api('/machines', { link: `${ra.url} ${p1.code}` })
    const laptopM = await until(async () => (await studio.api('/machines')).machines.find((m) => m.name === 'Laptop' && m.online), 30000, 300)
    const studioM = await until(async () => (await laptop.api('/machines')).machines.find((m) => m.name === 'Studio' && m.online), 30000, 300)
    ok(!!laptopM && !!studioM, 'Studio and Laptop, linked')
    const phone = await linkAs(ra.url, { code: (await studio.api('/relay/pair', {})).pairing.code, name: 'Pocket', about: { name: 'Pocket' } })
    const seen = await phone.request('GET', '/api/backup')
    ok(seen.status === 200 && seen.json?.here === false && seen.json.linked.some((m) => m.name === 'Laptop'), 'the phone sees Back Up & Move, with Laptop to move to', seen.json && { here: seen.json.here, linked: seen.json.linked })
    const viaPhone = await phone.request('POST', '/api/backup/file', { passphrase: PASS })
    ok(viaPhone.status === 403, 'a file is made on the computer itself, not from the phone', viaPhone)
    const moved = await phone.request('POST', '/api/backup/move', { to: laptopM.id })
    ok(moved.status === 200 && moved.json?.state === 'sent', 'Move, from the phone: sent over the link', moved)
    phone.close()
    const inc = await until(async () => (await laptop.api('/backup')).incoming[0], 15000)
    ok(inc?.from === 'Studio', 'Laptop shows what\'s coming, and waits', inc)
    ok((await studio.api('/bots/b1')).state === 'connected' && !(await laptop.api('/bots')).bots?.length, '(nothing changed yet, on either)')
    const through = await fetch(`${studio.url}/m/${laptopM.id}/api/backup/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: inc.id }) })
    ok(through.status === 403, 'Studio can\'t say yes for Laptop through the link', through.status)
    const plan = (await laptop.api(`/backup/pending/${inc.id}`)).plan
    ok(plan.bots[0]?.as === 'Pricing Desk' && plan.connections[0]?.tokens, 'Laptop sees the bot and its connection', plan)
    const r = await laptop.api('/backup/apply', { id: inc.id })
    ok(r.handoff === 'done' && !r.paused.length, 'applied on Laptop; Studio paused its bots, so Laptop\'s connections start', r)
    const sb = await studio.api('/bots/b1')
    const sc = (await conns(studio))[0]
    ok(sb.paused === true && sc.paused && /Moved to Laptop/.test(sc.paused.why), 'Studio: its bot and connection paused, saying where it went', { paused: sb.paused, conn: sc.paused })
    const sr = (await studio.api('/routines?refresh=1')).routines.find((x) => x.name === 'Monday numbers')
    ok(sr?.paused === true, 'and its scheduled routine', sr)
    const mv = (await studio.api('/backup')).moves[0]
    ok(mv?.state === 'moved' && mv.toName === 'Laptop', 'Studio\'s Back Up & Move says it moved', mv)
    const lb = await until(async () => { const v = await laptop.api('/bots/b1').catch(() => null); return v?.state === 'connected' ? v : null }, 20000)
    ok(!!lb && !(await conns(laptop))[0]?.paused, 'Laptop: connected', lb && lb.state)
    ok(await until(async () => (await sockets()) === 1, 10000) && (await studio.api('/bots/b1')).state !== 'connected', 'one connection to Slack, Laptop\'s', await sockets())
    await slack.ask({ user: 'U0DANA', text: `${M} After the move? [answer Answered on Laptop.]` })
    const L = lookers(laptop, slack)
    const d = await L.draftOf('After the move')
    ok(d?.draft === 'Answered on Laptop.' && !(await S.needs()).some((x) => /After the move/.test(x.text)), 'a question now is answered on Laptop, not Studio', d)
  })

  // ---------- A bot's file, sent on from its Activity ----------
  await part('Send to… from Activity', async () => {
    const place = (await laptop.api('/places', { path: path.join(laptop.home, 'inbox') })).place
    const { ctx, p, errors } = await page(b, studio.url)
    await openSettings(p)
    await p.locator('.sb-tabs [role="tab"]', { hasText: 'Activity' }).click()
    const row = p.locator('[data-setting="bots-files"] [data-file="prices.md"]')
    await row.waitFor({ timeout: 15000 })
    await row.locator('button', { hasText: 'Send to…' }).click()
    const dlg = p.locator('.xfer-dialog')
    await dlg.waitFor({ timeout: 10000 })
    await until(async () => (await dlg.locator('select[aria-label="Into"]').count()) > 0, 20000)
    await dlg.locator('select[aria-label="Into"]').selectOption({ label: place.name || 'inbox' })
    await dlg.locator('button[type="submit"]').click()
    const got = path.join(laptop.home, 'inbox', 'prices.md')
    ok(!!(await until(() => fs.existsSync(got), 30000)) && fs.readFileSync(got, 'utf8') === 'Starter is $10.\n', 'Send to…: the bot\'s file lands on Laptop, the same bytes', fs.existsSync(got) ? fs.readFileSync(got, 'utf8') : null)
    ok((await studio.api('/bots/b1/files')).files.some((f) => f.name === 'prices.md'), 'and stays beside its record on Studio')
    // Studio's Back Up & Move says where it went.
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'backup' } })))
    const sec = p.locator('[data-setting="backup"]')
    await sec.waitFor({ timeout: 10000 })
    ok(!!(await until(async () => /Moved to Laptop on .*: the bots, connections and scheduled routines here are paused/.test(await sec.innerText()) && (await sec.locator('.bk-list button', { hasText: 'Start Here Again' }).count()) === 1, 10000)), 'Studio\'s Back Up & Move: moved to Laptop, paused here, with Start Here Again')
    ok(await sec.locator('.bk-conn button', { hasText: /^\s*Start$/ }).count() === 0 && (await studio.api('/backup/start', {})).connections.length === 0 && (await conns(studio))[0].paused, 'its connection there starts again only with the move undone, never with Start')
    await shot(p, `${tag}backup-move-moved`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
  // ---------- Back the other way, with the computer it came from unreachable as it's applied ----------
  await part('a computer that can\'t be reached', async () => {
    const studioM = (await laptop.api('/machines')).machines.find((m) => m.name === 'Studio')
    const sent = await laptop.api('/backup/move', { to: studioM.id })
    const inc = await until(async () => (await studio.api('/backup')).incoming.find((x) => x.from === 'Laptop'), 15000)
    ok(sent.state === 'sent' && !!inc, 'Laptop moves it back to Studio: Studio shows what\'s coming', sent)
    laptop.stop()
    ok(!!(await until(async () => !(await studio.api('/machines')).machines.find((m) => m.name === 'Laptop')?.online, 30000, 300)), '(Laptop closed)')
    const r = await studio.api('/backup/apply', { id: inc.id })
    const mine = (r.paused || []).filter((c) => !c.movedTo)
    ok(r.handoff === 'failed' && !!r.error && mine.length === 1 && /Moved from Laptop, which couldn't be reached to stop its bots there: stop them on Laptop, then Start here/.test(mine[0].why), 'applied, but Laptop couldn\'t be asked to pause its bots: said, and what came stays paused', r)
    ok((await sockets()) === 0, 'so nothing connects to Slack twice', await sockets())
    await laptop.restart()
    ok(!!(await until(async () => (await studio.api('/machines')).machines.find((m) => m.name === 'Laptop')?.online, 30000, 300)), '(Laptop back)')
    ok(!!(await until(async () => (await sockets()) === 1, 15000)), '(Laptop\'s bot answering there again)')
    const again = await studio.api('/backup/handoff', {})
    ok(again.handoff === 'done' && !(again.paused || []).filter((c) => !c.movedTo).length, 'Try Again: Laptop pauses its bots, and Studio\'s start', again)
    ok((await laptop.api('/bots/b1')).paused === true && !!(await until(async () => (await studio.api('/bots')).bots.some((x) => x.name === 'Pricing Desk (2)' && x.state === 'connected'), 20000)), 'Laptop\'s bot paused, Studio\'s connected')
    ok(!!(await until(async () => (await sockets()) === 1, 15000)), 'one connection to Slack again', await sockets())
  })
  await part('the phone\'s layout', async () => {
    const { ctx, p, errors } = await page(b, laptop.url, { phone: true })
    await openSettings(p, 'backup', '.modal.settings [data-setting="backup"]')
    const sec = p.locator('[data-setting="backup"]')
    const wide = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    ok(/Move to Another Computer/.test(await sec.innerText()) && wide <= 0, 'at a phone\'s width: Back Up & Move, nothing wider than the screen', wide)
    await shot(p, `${tag}backup-move-phone`)
    ok(errors.length === 0, 'no page errors', errors)
    await ctx.close()
  })
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-2500))
} finally {
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
  slack.stop()
  await b.close().catch(() => {})
}
process.exit(done().fail ? 1 : 0)
