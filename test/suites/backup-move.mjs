// Back Up & Move (server/backup.js, Settings › Back Up & Move, Account & Backup once Bold Bridge accounts exist), with three Bridge AIs: Studio, whose
// setup moves; Laptop, linked with it (each on its own relay, stand-ins/relay.mjs), where it moves
// to; and Spare, where a backup is restored (its data folder in its home, as an install has it, and
// its Chief of Staff's folder somewhere of its own). One stand-in Slack (stand-ins/slack.mjs) has the
// app they all connect as, so it shows which computer is connected. In the browser named by
// BRIDGE_TEST_BROWSER. Checked:
//   Back Up: one file, from Settings; a passphrase too short refused; the file's header plain, and
//   nothing else in it readable (no token, instructions, memory, what a bot keeps about people, MCP
//   server's secret, not even the bot's name); a wrong passphrase, a header changed, a tag cut short
//   and other scrypt settings, each turned away;
//   Restore (Spare, in the app): what comes, in full, before anything changes: each bot's folders
//   (Bridge AI's own refused), who may ask, answering without asking (not from a file), who you are
//   there (not taken from a file); routines and MCP servers unticked until you tick them, each
//   routine's command and folder, each server's whole command and its env (NODE_OPTIONS flagged);
//   then applied: the bot with its instructions, memory and what it keeps about people, the folder
//   refused left out and said, its connection with its tokens (readable by you only) but paused,
//   saying why, so Slack gets no second connection; its scheduled routine paused; the Chief of
//   Staff's playbook in its own folder there (the one there kept beside it), its folder setting
//   left as it was; the MCP servers in Claude Code's config; Start connects it;
//   A phone through its relay page, paired a moment ago and not kept yet: Back Up & Move says what to
//   do on Studio, in the phone's language (German), and opens by itself once it's kept there.
//   Move (Studio to Laptop, from a phone paired with Studio once it's kept): the phone can't make
//   or open a file (that's on the computer itself) but can Move; one move at a time (a second calls
//   the first off, one applied has to be undone first); Laptop shows what's coming, named as the
//   link names Studio, and applies it only from itself; once applied, Studio's bots, connection
//   and scheduled routine are paused, and Laptop's started: one connection to Slack throughout, and
//   a question is answered on Laptop;
//   a bot's file in Studio's Activity, sent to Laptop with Send to…;
//   Start Here Again: refused while Laptop can't be reached; then Laptop pauses what came (it
//   doesn't start with Start), Studio starts only what the move paused (a bot paused before stays
//   paused);
//   moved again with Studio closed as Laptop applies it: said, what came stays paused (nothing
//   connects twice), and Try Again once Studio is back pauses Studio's and starts Laptop's.
import fs from 'node:fs'
import path from 'node:path'
import { startKit, startRelay, startSlack, checks, until, browser, page, shot, TEST, IS_WIN } from '../lib/harness.mjs'
import { lookers, openSettings, M, openBot } from '../lib/bots.mjs'
import { linkAs } from '../lib/linkclient.mjs'

const { ok, done } = checks('backup-move')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const PASS = 'correct horse battery'
const SECRETS = ['xapp-test', 'xoxb-test', 'MARKER-INSTRUCTIONS', 'MARKER-MEMORY', 'MARKER-PEOPLE', 'mcp-secret-0451', 'Pricing Desk', 'MARKER-PLAYBOOK']
const LONG = `echo formatting${' '.repeat(220)}--then-the-rest-of-it`
const relays = []
const kits = []
const slack = await startSlack('backup-move')
// inHome: its data folder at ~/.bridge-ai, as an install has it; chief: its Chief of Staff's folder
// set to one of its own (chief.path).
const kitWith = async (name, rel, { inHome = false, chief = null } = {}) => {
  let dataDir = null
  const k = await startKit(`backup-move-${name.toLowerCase()}`, {
    config: { name: 'Tester', trials: { 'slack-bot': true, routines: true }, ...(chief ? { chief: { kind: 'claude', path: chief } } : {}) },
    env: ({ data, home }) => {
      let d = data
      if (inHome) { d = path.join(home, '.bridge-ai'); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(path.join(data, 'config.json'), path.join(d, 'config.json')) }
      if (chief) fs.mkdirSync(path.join(home, chief.replace(/^~[\\/]/, ''), 'state'), { recursive: true })
      dataDir = d
      if (rel) fs.writeFileSync(path.join(d, 'relay.json'), JSON.stringify(rel.relayFile))
      for (const f of ['notes', 'inbox']) fs.mkdirSync(path.join(home, f), { recursive: true })
      return { BRIDGE_COMPUTER_NAME: name, BRIDGE_SLACK_URL: slack.url, BRIDGE_SLACK_PING_MS: '1000', BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000', BRIDGE_BOT_HOLD_MS: '60000', BRIDGE_LINK_PING_MS: '1500', ...(inHome ? { BRIDGE_HOME: d } : {}) }
    },
  })
  k.dataDir = dataDir
  kits.push(k)
  k.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'helper-claude.cjs'), 'utf8'))
  await k.api('/setup', { name: 'Tester' })
  await k.api('/agents/catalog')
  return k
}
const sockets = async () => (await slack.state()).connections
const conns = async (k) => (await k.api('/connections')).connections
const online = (k, name) => until(async () => (await k.api('/machines')).machines.find((m) => m.name === name && m.online), 30000, 300)

try {
  const ra = await startRelay('backup-move-studio')
  const rb = await startRelay('backup-move-laptop')
  relays.push(ra, rb)
  const studio = await kitWith('Studio', ra)
  const laptop = await kitWith('Laptop', rb)
  const spare = await kitWith('Spare', null, { inHome: true, chief: '~/chief-elsewhere' })
  const S = lookers(studio, slack)

  // ---------- Studio's setup ----------
  await studio.api('/bots', { name: 'Pricing Desk' })
  await studio.api('/bots/b1/tokens', { appToken: 'xapp-test', botToken: 'xoxb-test' })
  await studio.api('/bots/b1/settings', { askers: [{ id: 'U0DANA', name: 'Dana' }], readsFrom: ['~/notes'], instructions: '# Pricing Desk\n\nAnswer about prices. MARKER-INSTRUCTIONS\n' })
  await studio.api('/bots/b1/memory', { kind: 'bot', text: 'Dana runs sales. MARKER-MEMORY' })
  // What it keeps about each person (botcontext.js's shape), with what doesn't fit it, left out there.
  const ex = { q: 'b1-q1', conv: 'D0DANA:1', at: '2026-11-18T10:00:00.000Z', where: { kind: 'dm', id: 'D0DANA', name: null, private: true }, asked: 'MARKER-PEOPLE asked', answered: 'Answered.', planted: 'JUNK-FIELD' }
  fs.writeFileSync(path.join(studio.dataDir, 'bots', 'b1', 'people.json'), JSON.stringify({ v: 1, extra: 'JUNK-TOP', people: { U0DANA: { name: 'Dana', at: ex.at, kept: [ex, 'JUNK-ITEM'], proposed: [] }, 'not an id': { name: 'JUNK-PERSON', kept: [ex] } } }))
  // A second bot whose file says things Settings wouldn't take: Bridge AI's own folder, answering
  // without asking, and someone else as you there (written in its bot.json, as a file can say anything).
  await studio.api('/bots', { name: 'Helper' })
  // (Its changes as draft pull requests, pr, as a bot kept them before: one mode now, suggest, proposing
  // a PR that waits for your OK.)
  const hj = path.join(studio.dataDir, 'bots', 'b2', 'bot.json')
  fs.writeFileSync(hj, JSON.stringify({ ...JSON.parse(fs.readFileSync(hj, 'utf8')), readsFrom: ['~/.bridge-ai', '~/notes'], askers: [{ id: 'U0EVE', name: 'Eve' }], auto: true, owner: { id: 'U0EVE', name: 'Eve' }, changes: 'pr', repo: '~/notes', mcp: ['tracker'], agentsStatus: true, memory: 'auto', agentCopies: true, answerers: ['agent:codex', 'agent:claude'] }, null, 2))
  await studio.api('/routines', { name: 'Monday numbers', command: 'Post the numbers [answer The numbers.]', to: 'bot', bot: 'b1', channel: { id: 'C0LAUNCH', name: 'launch' }, schedule: 'every monday at 9' })
  await studio.api('/routines', { name: 'Weekly tidy', command: 'Tidy the notes', cwd: '~/notes', kind: 'claude' })
  fs.writeFileSync(path.join(studio.dataDir, 'chief', 'state', 'playbook.md'), '# Playbook\n\nMARKER-PLAYBOOK: mornings are for deep work.\n')
  fs.writeFileSync(path.join(studio.home, '.claude.json'), JSON.stringify({ mcpServers: {
    tracker: { type: 'stdio', command: 'node', args: ['tracker.js'], env: { TRACKER_TOKEN: 'mcp-secret-0451' } },
    fmt: { type: 'stdio', command: 'sh', args: ['-c', LONG], env: { NODE_OPTIONS: '--require ./x.js', npm_config_registry: 'https://registry.example/', GIT_SSH_COMMAND: 'ssh -o x', PIP_INDEX_URL: 'https://pypi.example/' } },
  } }, null, 2))
  await studio.api('/settings', { location: { label: 'Lisbon', lat: 38.72, lon: -9.14, timezone: 'Europe/Lisbon' }, chief: { kind: 'claude', path: '~/studio-chief' } }, 'PATCH')
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
    ok(/Bots arrive paused, until the computer they came from has stopped them\./.test(await sec.innerText()), 'Settings says what comes arrives paused')
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
    ok(file?.kind === 'bridge-ai-backup' && file.from === 'Studio' && file.kdf?.name === 'scrypt' && file.kdf.N === 2 ** 17 && Buffer.from(file.kdf.salt, 'base64').length === 16 && file.cipher?.name === 'aes-256-gcm' && Buffer.from(file.cipher.nonce, 'base64').length === 12 && Buffer.from(file.cipher.tag, 'base64').length === 16, 'its header: what it is, where from, scrypt with a 16-byte salt, AES-256-GCM with a 12-byte nonce and a 16-byte tag', file && { ...file, sealed: `${String(file.sealed).length} characters` })
    const found = SECRETS.filter((x) => text.includes(x))
    ok(!found.length && !text.includes(Buffer.from('xoxb-test').toString('base64')), 'nothing else in it readable: no token, instructions, memory, what it keeps about people, MCP secret, playbook, or the bot\'s name', found)
    const again = await studio.api('/backup/file', { passphrase: PASS }).catch((e) => e)
    ok(again?.kdf?.salt && again.kdf.salt !== file.kdf.salt && again.cipher.nonce !== file.cipher.nonce, 'each backup has a salt and a nonce of its own')
  })
  await part('turned away', async () => {
    const tried = (f, pass = PASS) => spare.api('/backup/open', { file: JSON.stringify(f), passphrase: pass }).catch((e) => e)
    const wrong = await tried(file, 'not the right one')
    ok(wrong.status === 403 && wrong.j?.code === 'passphrase' && /passphrase doesn't open this backup/.test(wrong.message), 'a wrong passphrase says so', wrong.message)
    ok((await tried({ ...file, from: 'Elsewhere' })).status === 403, 'and so does a file whose header was changed (it\'s sealed in too)')
    const cut = await tried({ ...file, cipher: { ...file.cipher, tag: Buffer.from(file.cipher.tag, 'base64').subarray(0, 4).toString('base64') } })
    ok(cut.status === 400 && cut.j?.code === 'damaged', 'a tag cut short isn\'t opened (16 bytes, always)', cut.message)
    const easy = await tried({ ...file, kdf: { ...file.kdf, N: 2 ** 14 } })
    const hard = await tried({ ...file, kdf: { ...file.kdf, N: 2 ** 20, r: 16 } })
    ok(easy.status === 400 && hard.status === 400 && easy.j?.code === 'damaged' && hard.j?.code === 'damaged', 'nor one asking for scrypt settings this app doesn\'t write', { easy: easy.message, hard: hard.message })
    ok(!(await spare.api('/backup')).paused.connections.length && !(await spare.api('/bots')).bots?.length, 'nothing changed on Spare')
  })

  // ---------- Restore, on Spare ----------
  await part('restore', async () => {
    await spare.api('/bots', { name: 'Pricing Desk' })
    const chiefThere = path.join(spare.home, 'chief-elsewhere', 'state')
    fs.writeFileSync(path.join(chiefThere, 'playbook.md'), '# Spare\'s playbook\n')
    // From a file, routines and MCP servers only when ticked: not given, none added.
    const o = await spare.api('/backup/open', { file: text, passphrase: PASS })
    ok(JSON.stringify(o.plan.optIn) === '["routines","mcp","settings"]', 'from a file, routines, MCP servers and settings are to tick', o.plan.optIn)
    ok(o.plan.settings.values?.location?.includes('Lisbon'), 'each setting shown with its value', o.plan.settings.values)
    const r0 = await spare.api('/backup/apply', { id: o.id, parts: { bots: false, connections: false, chief: false } })
    ok(!r0.routines.length && !r0.mcp.length && !r0.settings.length && !fs.existsSync(path.join(spare.home, '.claude.json')) && !(await spare.api('/settings')).user.location, 'not ticked: no routine, MCP server or setting added', r0)
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
    const pricing = await plan.locator('[data-bot="Pricing Desk (2)"]').innerText()
    const helper = await plan.locator('[data-bot="Helper"]').innerText()
    ok(/Pricing Desk, as Pricing Desk \(2\)/.test(pricing) && /reads ~[\\/]notes/.test(pricing) && /who can ask: Dana \(U0DANA\)/.test(pricing) && /what it keeps about each person/.test(pricing), 'each bot: renamed for the one here, what it reads, who may ask it', pricing)
    ok(/won't read ~\/\.bridge-ai: Bridge AI's own folder/.test(helper) && /reads ~\/notes/.test(helper) && /who can ask: Eve \(U0EVE\)/.test(helper) && /answered without asking there: here it waits for you/.test(helper) && /you there, in the file: Eve \(U0EVE\)\. Not taken from a file/.test(helper), 'and the one whose file asks for more: Bridge AI\'s own folder refused, who may ask, not answering without asking, who you are there not taken', helper)
    const held = ['answered by agent:codex, agent:claude', 'suggests changes in ~/notes', 'uses your MCP servers tracker', 'answers from copies of your agents\' conversations', 'says what your agents are doing', 'keeps what it learns without asking'].filter((w) => !helper.includes(`${w}: asked for in the file, off here until you turn it on`))
    ok(!held.length, 'and what would let it act for you, as the file asks, off here until you turn it on: changes and their repository, your MCP servers, copies of your agents\' conversations, saying what they do, keeping what it learns', { missing: held, helper })
    const shown = await plan.innerText()
    ok(/From Studio/.test(shown) && /Pricing Desk \(Slack\).*with its tokens, paused until you Start it/s.test(shown) && /playbook\.md, replacing the one here/.test(shown), 'its connection paused, the playbook', shown)
    const box = (k) => plan.locator(`[data-part="${k}"] input`)
    ok(!(await box('routines').isChecked()) && !(await box('mcp').isChecked()) && !(await box('settings').isChecked()) && await box('bots').isChecked() && /off unless you tick it: it runs things on this computer/.test(await plan.locator('[data-part="mcp"]').innerText()), 'routines, MCP servers and settings unticked, saying why', shown)
    await box('routines').check()
    await box('mcp').check()
    await box('settings').check()
    ok(/Lisbon/.test(await plan.locator('[data-setting-key="location"]').innerText()), 'ticked, each setting with its value', await plan.locator('.bk-values').innerText())
    const tidy = await plan.locator('[data-routine="Weekly tidy"]').innerText()
    const numbers = await plan.locator('[data-routine="Monday numbers"]').innerText()
    ok(/runs Tidy the notes/.test(tidy) && /in ~\/notes, with claude/.test(tidy) && /runs by itself: paused until you Start it/.test(numbers) && /posted by Pricing Desk \(2\) in launch/.test(numbers), 'each routine: its command, its folder and agent, or where it posts', { tidy, numbers })
    const fmt = await plan.locator('[data-server="fmt"]').textContent()
    ok(fmt.includes(`runs sh -c ${LONG}`) && /with NODE_OPTIONS, npm_config_registry, GIT_SSH_COMMAND, PIP_INDEX_URL set/.test(fmt) && /NODE_OPTIONS, npm_config_registry, GIT_SSH_COMMAND, PIP_INDEX_URL can make it run more than its command/.test(fmt) && /runs node tracker\.js/.test(await plan.locator('[data-server="tracker"]').innerText()), 'each MCP server: its whole command, its env\'s names, NODE_OPTIONS flagged', fmt)
    ok((await spare.api('/bots')).bots.length === 1, '(nothing applied yet)')
    await shot(p, `${tag}backup-move-plan`)
    await plan.locator('button', { hasText: 'Apply' }).click()
    await sec.locator('button', { hasText: 'Start Them Here' }).waitFor({ timeout: 20000 })
    const said = await sec.innerText()
    ok(/Helper doesn't read ~\/\.bridge-ai: Bridge AI's own folder can't be read from/.test(said) && /Helper doesn't answer without asking here/.test(said) && /Helper doesn't make changes here \(the file asked for suggested changes in ~\/notes\)/.test(said) && /Helper uses none of your MCP servers here/.test(said), 'what was left out, said', said.slice(0, 1500))
    const bots = (await spare.api('/bots')).bots
    const bot = bots.find((x) => x.name === 'Pricing Desk (2)')
    const hb = bots.find((x) => x.name === 'Helper')
    const hv = hb && await spare.api(`/bots/${hb.id}`)
    ok(!!bot && hv?.settings.readsFrom.map((f) => f.replace(/\\/g, '/')).join() === '~/notes' && hv.settings.auto === false && !hv.settings.owner, 'the bot from the file reads only what Settings would let it, doesn\'t answer without asking, and has no one as you there', hv?.settings)
    ok(hv?.settings.changes === 'none' && !hv.settings.repo && !hv.settings.mcp.length && hv.settings.agentsStatus === false && hv.settings.memory === 'approve' && hv.settings.agentCopies === false && !hv.settings.answerers && /Helper is answered by what's here \(Automatic\): the file asked for agent:codex, agent:claude/.test(said), 'nor is answered by what the file names, makes changes, uses your MCP servers, answers from your agents\' conversations, says what they do, or keeps what it learns without asking', hv?.settings)
    const v = bot && await spare.api(`/bots/${bot.id}`)
    ok(/MARKER-INSTRUCTIONS/.test(v?.instructions?.text || '') && (await spare.api(`/bots/${bot.id}/memory`)).items.some((m) => /MARKER-MEMORY/.test(m.text) && m.state === 'kept'), 'with its instructions and what it remembers', v && { instructions: v.instructions })
    const pj = fs.readFileSync(path.join(spare.dataDir, 'bots', bot.id, 'people.json'), 'utf8')
    ok(/MARKER-PEOPLE/.test(pj) && JSON.parse(pj).people.U0DANA.kept.length === 1 && !/JUNK/.test(pj), 'and what it keeps about each person, what doesn\'t fit its shape left out', pj.slice(0, 400))
    const c = (await conns(spare)).find((x) => x.own?.id === bot?.id)
    const tokens = c && path.join(spare.dataDir, 'connections', c.id, 'slack.json')
    ok(c?.paused?.why && /Restored from a backup of Studio: stop its bots on Studio first/.test(c.paused.why) && c.state === 'off' && !c.owner, 'its connection, paused, saying why, with no one as you there', c && { paused: c.paused, state: c.state, owner: c.owner })
    ok(!!tokens && JSON.parse(fs.readFileSync(tokens, 'utf8')).botToken === 'xoxb-test' && (IS_WIN || (fs.statSync(tokens).mode & 0o777) === 0o600), 'its tokens there, readable by you only')
    ok(/Restored from a backup of Studio/.test(v?.why || '') && v?.state === 'off', 'the bot says why it isn\'t connected', v && { state: v.state, why: v.why })
    ok((await sockets()) === before, 'and Slack has no second connection', await sockets())
    const r = (await spare.api('/routines')).routines.find((x) => x.name === 'Monday numbers')
    const t2 = (await spare.api('/routines')).routines.find((x) => x.name === 'Weekly tidy')
    ok(r?.paused === true && r.bot === bot?.id && r.auto === true && t2?.cwd === '~/notes' && t2.kind === 'claude', 'its routines, ticked: the scheduled one paused, posting as the bot as it\'s called here', { r, t2 })
    ok(/MARKER-PLAYBOOK/.test(fs.readFileSync(path.join(chiefThere, 'playbook.md'), 'utf8')) && /Spare's playbook/.test(fs.readFileSync(path.join(chiefThere, 'playbook.before-restore.md'), 'utf8')) && !fs.existsSync(path.join(spare.dataDir, 'chief', 'state', 'playbook.before-restore.md')), 'the Chief of Staff\'s playbook, in its folder there, the one there kept beside it')
    const mcp = JSON.parse(fs.readFileSync(path.join(spare.home, '.claude.json'), 'utf8'))
    ok(mcp.mcpServers?.tracker?.env?.TRACKER_TOKEN === 'mcp-secret-0451' && mcp.mcpServers?.fmt?.args?.[1] === LONG, 'the MCP servers, ticked, in Claude Code\'s config there')
    const set = (await spare.api('/settings')).user
    ok(set.location?.label === 'Lisbon' && set.chief?.path === '~/chief-elsewhere', 'and the settings, the Chief of Staff\'s folder left as it was there', { location: set.location, chief: set.chief })
    ok(!spare.log().includes('xoxb-test') && !spare.log().includes(PASS) && !JSON.stringify(fs.readdirSync(path.join(spare.dataDir, 'bots', bot.id, 'trace')).map((f) => fs.readFileSync(path.join(spare.dataDir, 'bots', bot.id, 'trace', f), 'utf8'))).includes('xoxb-test'), 'no token or passphrase in its log or the bot\'s record')
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
  let laptopM = null
  let studioM = null
  await part('move', async () => {
    const p1 = (await studio.api('/relay/pair', {})).pairing
    await laptop.api('/machines', { link: `${ra.url} ${p1.code}` })
    laptopM = await online(studio, 'Laptop')
    studioM = await online(laptop, 'Studio')
    ok(!!laptopM && !!studioM, 'Studio and Laptop, linked')
    // (Helper paused before the move: it stays paused when the move is undone.)
    await studio.api('/bots/b2/settings', { paused: true })
    const through = await fetch(`${studio.url}/m/${laptopM.id}/api/backup`)
    ok(through.status === 403, 'another computer can\'t look at what\'s waiting here through the link', through.status)
    const phone = await linkAs(ra.url, { code: (await studio.api('/relay/pair', {})).pairing.code, name: 'Pocket', about: { name: 'Pocket' } })
    const fresh = await phone.request('GET', '/api/backup')
    ok(fresh.status === 403 && fresh.json?.code === 'not-kept', 'a phone paired a moment ago can\'t, until it\'s kept here', fresh)
    await studio.api(`/relay/devices/${phone.deviceId}/keep`, {})
    const seen = await phone.request('GET', '/api/backup')
    ok(seen.status === 200 && seen.json?.here === false && seen.json.linked.some((m) => m.name === 'Laptop'), 'kept: the phone sees Back Up & Move, with Laptop to move to', seen.json && { here: seen.json.here, linked: seen.json.linked })
    const viaPhone = await phone.request('POST', '/api/backup/file', { passphrase: PASS })
    ok(viaPhone.status === 403, 'a file is made on the computer itself, not from the phone', viaPhone)
    const first = await phone.request('POST', '/api/backup/move', { to: laptopM.id })
    ok(first.status === 200 && first.json?.state === 'sent', 'Move, from the phone: sent over the link', first)
    phone.close()
    // Moved again before it's applied, twice at once: one is sent, the others called off.
    const both = await Promise.all([studio.api('/backup/move', { to: laptopM.id }).catch((e) => e), studio.api('/backup/move', { to: laptopM.id }).catch((e) => e)])
    const moves = (await studio.api('/backup')).moves
    ok(both.every((x) => x.state === 'sent') && moves.filter((m) => m.state === 'sent').length === 1 && moves.filter((m) => m.state === 'cancelled').length === 2, 'Move again before it\'s applied, twice at once: one waits, the others are called off', moves.map((m) => m.state))
    const inc = await until(async () => { const l = (await laptop.api('/backup')).incoming; return l.length === 1 ? l[0] : null }, 15000)
    ok(inc?.from === 'Studio', 'Laptop shows one move coming, and waits', (await laptop.api('/backup')).incoming)
    ok((await studio.api('/bots/b1')).state === 'connected' && !(await laptop.api('/bots')).bots?.length, '(nothing changed yet, on either)')
    const refused = await fetch(`${studio.url}/m/${laptopM.id}/api/backup/apply`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: inc.id }) })
    ok(refused.status === 403, 'Studio can\'t say yes for Laptop through the link', refused.status)
    const plan = (await laptop.api(`/backup/pending/${inc.id}`)).plan
    ok(plan.from === 'Studio' && plan.bots[0]?.as === 'Pricing Desk' && plan.connections[0]?.tokens && !plan.optIn.length, 'Laptop sees the bot and its connection, named as the link names Studio', plan)
    const ph = plan.bots.find((x) => x.name === 'Helper')
    ok(ph && !ph.held && ph.asks.answerers.join() === 'agent:codex,agent:claude' && ph.asks.changes === 'suggest' && ph.asks.repo === '~/notes' && ph.asks.mcp.join() === 'tracker' && ph.asks.memory === 'auto', 'between your own computers what a bot does for you comes along, shown first', ph)
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
    ok(/MARKER-PEOPLE/.test(fs.readFileSync(path.join(laptop.dataDir, 'bots', 'b1', 'people.json'), 'utf8')), 'with what its bot keeps about each person')
    const lh = await laptop.api('/bots/b2')
    ok(lh.settings.answerers?.join() === 'agent:codex,agent:claude' && lh.settings.changes === 'suggest' && lh.settings.mcp.join() === 'tracker' && lh.settings.memory === 'auto' && lh.settings.agentsStatus === true, 'and Helper does for you there what it did here', lh.settings)
    ok(await until(async () => (await sockets()) === 1, 10000) && (await studio.api('/bots/b1')).state !== 'connected', 'one connection to Slack, Laptop\'s', await sockets())
    const again = await studio.api('/backup/move', { to: laptopM.id }).catch((e) => e)
    ok(again.status === 409 && again.j?.code === 'moved', 'one setup in one place: moving it again means Start Here Again first', again.message)
    await slack.ask({ user: 'U0DANA', text: `${M} After the move? [answer Answered on Laptop.]` })
    const d = await lookers(laptop, slack).draftOf('After the move')
    ok(d?.draft === 'Answered on Laptop.' && !(await S.needs()).some((x) => /After the move/.test(x.text)), 'a question now is answered on Laptop, not Studio', d)
  })

  // ---------- A bot's file, sent on from its Activity ----------
  await part('Send to… from Activity', async () => {
    const place = (await laptop.api('/places', { path: path.join(laptop.home, 'inbox') })).place
    const { ctx, p, errors } = await page(b, studio.url)
    await openBot(p)
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

  // ---------- Start Here Again ----------
  await part('Start Here Again', async () => {
    const mv = (await studio.api('/backup')).moves[0]
    laptop.stop()
    ok(!!(await until(async () => !(await studio.api('/machines')).machines.find((m) => m.name === 'Laptop')?.online, 30000, 300)), '(Laptop closed)')
    const no = await studio.api(`/backup/moves/${mv.id}/undo`, {}).catch((e) => e)
    ok(no.status === 409 && /couldn't be reached to pause it there/.test(no.message) && (await conns(studio))[0].paused, 'refused while Laptop can\'t be reached to pause it there: nothing starts here', no.message)
    await laptop.restart()
    ok(!!(await online(studio, 'Laptop')) && !!(await until(async () => (await sockets()) === 1, 15000)), '(Laptop back, answering)')
    // Laptop moving it on (here, to Studio) and that move still waiting when Studio takes it back: the
    // onward move is called off there, and can't be applied.
    const onward = await laptop.api('/backup/move', { to: studioM.id })
    const waiting = await until(async () => (await studio.api('/backup')).incoming.find((x) => x.from === 'Laptop'), 15000)
    const u = await studio.api(`/backup/moves/${mv.id}/undo`, {})
    ok(onward.state === 'sent' && !!waiting && (await laptop.api('/backup')).moves.find((m) => m.id === onward.id)?.state === 'cancelled', 'a move of it on from Laptop still waiting: called off as Studio takes it back', (await laptop.api('/backup')).moves)
    ok(!!(await until(async () => !(await studio.api('/backup')).incoming.some((x) => x.id === waiting.id), 10000)), 'and it\'s gone from where it was waiting')
    const late = await studio.api('/backup/apply', { id: waiting.id }).catch((e) => e)
    ok(late.status === 404, 'so it can\'t be applied now', late.message)
    const lc = (await conns(laptop))[0]
    ok(u.state === 'undone' && lc?.paused && /Studio took it back/.test(lc.paused.why) && (await laptop.api('/bots/b1')).paused === true, 'Start Here Again: Laptop pauses what came, saying why', { u, laptop: lc?.paused })
    ok(!!(await until(async () => (await studio.api('/bots/b1')).state === 'connected', 20000)) && (await studio.api('/bots/b2')).paused === true, 'Studio starts what the move paused, and only that (Helper, paused before, stays paused)')
    ok(await until(async () => (await sockets()) === 1, 15000), 'one connection to Slack, Studio\'s', await sockets())
    const started = await laptop.api('/backup/start', {})
    ok(!started.connections.length && (await conns(laptop))[0].paused && started.paused.some((c) => c.takenBack), 'on Laptop, Start doesn\'t start what Studio took back', started)
  })

  // ---------- Moved again, with the computer it came from closed as it's applied ----------
  await part('a computer that can\'t be reached', async () => {
    const sent = await studio.api('/backup/move', { to: laptopM.id })
    const inc = await until(async () => (await laptop.api('/backup')).incoming.find((x) => x.from === 'Studio'), 15000)
    ok(sent.state === 'sent' && !!inc, 'moved again, now it\'s undone: Laptop shows what\'s coming', sent)
    studio.stop()
    ok(!!(await until(async () => !(await laptop.api('/machines')).machines.find((m) => m.name === 'Studio')?.online, 30000, 300)), '(Studio closed)')
    const r = await laptop.api('/backup/apply', { id: inc.id })
    const mine = (r.paused || []).filter((c) => !c.takenBack)
    ok(r.handoff === 'failed' && !!r.error && mine.length === 1 && /Moved from Studio, which couldn't be reached to stop its bots there: stop them on Studio, then Start here/.test(mine[0].why), 'applied, but Studio couldn\'t be asked to pause its bots: said, and what came stays paused', r)
    ok((await sockets()) === 0, 'so nothing connects to Slack twice', await sockets())
    await studio.restart()
    ok(!!(await online(laptop, 'Studio')) && !!(await until(async () => (await sockets()) === 1, 15000)), '(Studio back, answering)')
    const again = await laptop.api('/backup/handoff', {})
    ok(again.handoff === 'done' && !(again.paused || []).filter((c) => !c.takenBack).length, 'Try Again: Studio pauses its bots, and Laptop\'s start', again)
    ok((await studio.api('/bots/b1')).paused === true && !!(await until(async () => (await laptop.api('/bots')).bots.some((x) => x.name === 'Pricing Desk (2)' && x.state === 'connected'), 20000)), 'Studio\'s bot paused, Laptop\'s connected')
    ok(!!(await until(async () => (await sockets()) === 1, 15000)), 'one connection to Slack again', await sockets())
  })
  // ---------- Moved on, then Start Here Again where it started ----------
  await part('moved on', async () => {
    const back = await laptop.api('/backup/move', { to: studioM.id })
    const inc = await until(async () => (await studio.api('/backup')).incoming.find((x) => x.from === 'Laptop'), 15000)
    const r = await studio.api('/backup/apply', { id: inc.id })
    ok(back.state === 'sent' && r.handoff === 'done', 'Laptop moves it on (here, back to Studio, as a new move): applied, Laptop pauses', r)
    ok(!!(await until(async () => (await sockets()) === 1, 15000)), 'one connection to Slack (one paused on Laptop when it came stays paused)', await sockets())
    const first = (await studio.api('/backup')).moves.find((m) => m.state === 'moved')
    const no = await studio.api(`/backup/moves/${first.id}/undo`, {}).catch((e) => e)
    ok(no.status === 409 && no.j?.code === 'moved-on' && /Laptop moved it on to Studio, where it answers now/.test(no.message), 'Start Here Again on the first move: refused, as Laptop moved it on (said)', no.message)
    await new Promise((x) => setTimeout(x, 3000))
    ok((await sockets()) === 1, 'still one connection to Slack', await sockets())
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
  // A phone paired a moment ago (its page through the relay, as the apps run it), not kept on Studio
  // yet: Back Up & Move says what to do there, in the phone's language, not the server's English
  // refusal; and it opens by itself once it's kept.
  await part('a phone paired a moment ago, through its relay page', async () => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, ...(which === 'chromium' ? { isMobile: true } : {}), hasTouch: true, deviceScaleFactor: 2 })
    await ctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-lang', JSON.stringify('de')) } catch { /* no storage */ } })
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    const was = new Set((await studio.api('/relay')).devices.map((d) => d.id))
    await p.goto((await studio.api('/relay/pair', {})).pairing.link, { waitUntil: 'commit' })
    await p.locator('#pair-go').click({ timeout: 15000 })
    const f = await until(() => p.frames().find((x) => x !== p.mainFrame() && x.url().startsWith(ra.url)), 30000, 100)
    await openSettings(f, 'backup', '.modal.settings')
    const sec = f.locator('.modal.settings .st-scroll').first()
    const note = f.locator('.modal.settings [data-kept="no"]')
    const said = await note.waitFor({ timeout: 30000 }).then(() => note.innerText(), () => null)
    ok(!!said && /Sichern & Umziehen funktioniert auf diesem Gerät, sobald Studio es behält\. Wähle auf Studio „Behalten“/.test(said) && !/Keep .* in Bridge AI on Studio first/.test(said), 'not kept on Studio yet: what to do there, in German, naming Studio (not the server\'s English refusal)', said || await sec.innerText().catch(() => ''))
    await shot(p, `${tag}backup-move-phone-not-kept`)
    const d = await until(async () => (await studio.api('/relay')).devices.find((x) => !was.has(x.id) && x.fresh), 10000, 200)
    ok(!!d, 'Studio lists the phone as new, to keep or remove', (await studio.api('/relay')).devices)
    if (d) await studio.api(`/relay/devices/${d.id}/keep`, {})
    ok(!!(await until(async () => f.locator('[data-setting="backup"]').count(), 15000)), 'kept on Studio: Back Up & Move opens on the phone by itself')
    ok(!errors.length, 'no page errors', errors)
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
