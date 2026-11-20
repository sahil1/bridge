// Bots in the sidebar and set up by saying what they're for (a beta feature, its id slack-bot), with a
// stand-in model for AI Assist (stand-ins/model.mjs), the stand-in Slack, a stand-in MCP server
// (stand-ins/mcp-server.mjs, in Claude Code's own list) and Claude Code answering (stand-ins/bot-claude.cjs
// in front of helper-claude.cjs).
//   No model: + in the sidebar's Bots opens a chat that says there's none and offers the form, and
//   nothing is made. With AI Assist's model: the sidebar lists Bots with + (Make your first bot);
//   + opens the chat, the owner's words make a draft, listed in the sidebar as a Draft, whose page is
//   the chat and one card with every part of the bot AI Assist proposed (its name, folders among
//   those Bridge AI knows, the people and channels named, its MCP server, limits), each changed in
//   place or in words; nothing is set up until Create, and a Create that Settings' checks turn down
//   (a folder that isn't there) makes nothing. Create: the bot as proposed, connected as its chat
//   walks through it (its tokens pasted there, each step said as it's done), the people named found
//   once it's connected and added only once confirmed; a change in words shown first and applied on
//   confirm, or left; one Settings refuses (the whole home folder) changes nothing. The Chief of
//   Staff's `bridge bot draft`: a draft in the sidebar, nothing of it live until Create. Its MCP
//   servers: their tools listed with which only read; a run gets only its servers (--mcp-config,
//   --strict-mcp-config, never a folder it may read), every tool for you and the people named, only
//   the read-only ones for anyone else, and Activity records the tools it used. Try It as it goes:
//   what it's reading and the time so far, Stop, and the answer the moment it's there. Someone else's
//   Claude Code settings in a bot's folder (reads anywhere, a command run as it starts): its run
//   loads only your own and Bridge AI's, so neither holds; an agent of your own there loads them as
//   before; a Claude Code too old for that starts no run, saying why. Settings › Bots opens the same
//   page. The pages in light and dark, on a computer and a phone (More › Bots).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { startKit, startSlack, startModel, startLocalModel, checks, until, sleep, browser, page, shot, phoneFaults, ROOT, TEST } from '../lib/harness.mjs'
import { lookers, openSettings } from '../lib/bots.mjs'

const { ok, done } = checks('bots-setup')
const slack = await startSlack('bots-setup')
const model = await startModel('bots-setup')
const MCP = path.join(TEST, 'stand-ins', 'mcp-server.mjs')
// (A model on this computer, Ollama's, stood in, with none until a test gives it one; no other
// server here is reached.)
const ollama = await startLocalModel('bots-setup', 'ollama', [])
let home = null
const kit = await startKit('bots-setup', {
  config: { name: 'Tester', trials: { 'slack-bot': true, routines: true } },
  env: (x) => {
    home = x.home
    for (const f of ['code/pricing', 'docs']) fs.mkdirSync(path.join(x.home, f), { recursive: true })
    fs.writeFileSync(path.join(x.home, 'code/pricing/README.md'), '# Pricing\n\nThe Team plan is $12 a seat.\n')
    fs.writeFileSync(path.join(x.home, 'docs/handbook.md'), '# Handbook\n')
    // Claude Code's own list of MCP servers, with the tracker in it (and its token).
    fs.writeFileSync(path.join(x.home, '.claude.json'), JSON.stringify({ mcpServers: { tracker: { type: 'stdio', command: process.execPath, args: [MCP], env: { TRACKER_TOKEN: 'tok-tracker-123', MCP_LOG: path.join(x.home, 'mcp-server.log') } } } }))
    return { BRIDGE_SLACK_URL: slack.url, BRIDGE_SLACK_PING_MS: '1000', BRIDGE_HELPER_GONE_MS: '3000', BRIDGE_HELPER_STALL_MS: '8000', BRIDGE_BOT_CARRY_MS: '0', OLLAMA_HOST: ollama.url, LM_STUDIO_BASE_URL: 'http://127.0.0.1:9/v1' }
  },
})
const { botOf, events, connected } = lookers(kit, slack)
const logOf = (f) => { try { return fs.readFileSync(path.join(home, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
const chief = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'chief', 'bin', 'bridge'), ...args], { encoding: 'utf8', cwd: path.join(kit.data, 'chief'), env: { ...process.env, BRIDGE_URL: kit.url, BRIDGE_HOME: kit.data, BRIDGE_THREAD: 'main' } })
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const part = async (name, fn) => { try { await fn() } catch (e) { ok(false, `${name}: crashed: ${e.stack}`) } }
const assist = (id) => kit.api(`/bots/${id}/assist`)
const shown = (p, sel, ms = 10000) => p.locator(sel).first().waitFor({ timeout: ms }).then(() => true, () => false)
// A folder as these checks spell it (on Windows the server says ~\code\pricing).
const fwd = (x) => String(x ?? '').replace(/\\/g, '/')
const fwds = (l) => (l || []).map(fwd)
const real = (p) => { try { return fs.realpathSync(p) } catch { return p } }

try {
  await kit.api('/setup', { name: 'Tester' })
  await kit.api('/projects', { paths: [path.join(home, 'code/pricing')] })

  // ---------- No model ----------
  await part('no model', async () => {
    const s = await kit.api('/bots/assist')
    ok(s.assist?.model === null && s.options?.folders.some((f) => fwd(f.path) === '~/code/pricing') && s.options.mcp.includes('tracker'), 'a new chat knows there\'s no model, and what a bot can be given: the folders Bridge AI knows, your MCP servers', { assist: s.assist, options: s.options })
    const r = await kit.api('/bots/assist', { text: 'Answer pricing questions for Dana' })
    ok(!r.bot && r.setup.messages.some((m) => m.kind === 'no-model'), 'said with no model: nothing made, and the chat says why', r.setup.messages)
    ok(!(await kit.api('/bots')).bots.length, 'no bot, not even a draft')
    const x = await page(b, kit.url, { mode: 'light' })
    await x.p.locator('.rail-bots-head .rail-tool[aria-label="New bot"]').click()
    ok(await shown(x.p, '.bc li[data-kind="no-model"]'), '+ in the sidebar\'s Bots: a chat that says there\'s no model', await x.p.locator('.bc').innerText().catch(() => ''))
    ok(await shown(x.p, '.bc .bc-form .sb-new input'), 'and offers the form right there')
    await shot(x.p, `${tag}bots-setup-no-model`)
    ok(!x.errors.length, 'no page errors', x.errors)
    await x.ctx.close()
  })

  // AI Assist's model from now on (a key, picked for Studio as AI Assist's), and Claude Code to answer.
  await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
  await kit.api('/settings', { studio: { model: 'openai:gpt-5' } }, 'PATCH')
  kit.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'bot-claude.cjs'), 'utf8').replace('require(HELPER_CLAUDE)', `require(${JSON.stringify(path.join(TEST, 'stand-ins', 'helper-claude.cjs'))})`))
  await kit.api('/agents/catalog')

  const { ctx, p, errors } = await page(b, kit.url, { mode: 'light' })
  let id = null
  // ---------- The sidebar, + and the chat ----------
  await part('sidebar and chat', async () => {
    ok(await shown(p, '.rail-bots-head'), 'the sidebar has Bots, under its own heading')
    ok(await until(async () => /Make your first bot/.test(await p.locator('.rail-bot-list').innerText()), 10000), 'with no bot yet: Make your first bot')
    await p.locator('.rail-bots-head .rail-tool[aria-label="New bot"]').click()
    ok(await shown(p, '.bc .bc-examples'), '+: AI Assist\'s chat, asking what it should do, with examples')
    ok(/gpt-5/.test(await p.locator('.bc .bc-model').innerText().catch(() => '')), 'naming the model AI Assist uses')
    await shot(p, `${tag}bots-setup-new`)
    await p.locator('.bc-say textarea').fill('A bot called Pricing Desk that answers pricing questions for Dana and Sam in #launch, from my pricing folder, using the tracker MCP server.')
    await p.locator('.bc-say button[type="submit"]').click()
    ok(await shown(p, '.bc-proposal', 20000), 'its words: a draft, its page the chat with the proposal', await p.locator('.bc').innerText().catch(() => ''))
    const list = (await kit.api('/bots')).bots
    id = list[0]?.id
    ok(list.length === 1 && list[0].draft && list[0].name === 'Pricing Desk', 'a draft, named as asked', list)
    ok(await until(async () => /Pricing Desk/.test(await p.locator('.rail-bot-list').innerText()) && /draft/i.test(await p.locator('.rail-bot-list').innerText()), 10000), 'in the sidebar as a Draft', await p.locator('.rail-bot-list').innerText().catch(() => ''))
    const s = await assist(id)
    const pr = s.proposal || {}
    ok(fwds(pr.folders).includes('~/code/pricing') && pr.people.join() === 'Dana,Sam' && pr.channels.some((c) => c.name === 'launch') && pr.mcp.join() === 'tracker' && pr.platform === 'slack' && /Pricing Desk/.test(pr.instructions), 'AI Assist proposes the whole bot: its folder (one Bridge AI knows), the people and channel named, its MCP server, its instructions', pr)
    const asked = fwd(model.asked(/Known folders/).at(-1) || '')
    ok(/~\/code\/pricing/.test(asked) && /- tracker/.test(asked) && /answers pricing questions for Dana/.test(asked), 'the model was given the known folders, the MCP servers and the words', asked.slice(0, 400))
    ok(!fs.existsSync(path.join(kit.data, 'bots', id, 'instructions.md')) && !(await kit.api('/health')).bots?.some((x) => x.id === id), 'nothing of it set up yet: no instructions kept, not connected, not in the health check')
    const card = fwd(await p.locator('.bc-proposal').innerText())
    ok(/Pricing Desk/.test(await p.locator('.bc-proposal input').first().inputValue()) && /~\/code\/pricing/.test(card) && /Dana/.test(card) && /#launch/.test(card) && /tracker/.test(card), 'one card with each part', card.slice(0, 300))
    await shot(p, `${tag}bots-setup-proposal`)

    // Changed in place: the limit a day, a folder by its path.
    const day = p.locator('.bc-proposal .sb-limits input').first()
    await day.fill('20')
    await day.blur()
    await p.locator('.bc-proposal form.sb-add input[aria-label="Add a folder by its path"]').fill('~/docs')
    await p.locator('.bc-proposal form.sb-add:has(input[aria-label="Add a folder by its path"]) button[type="submit"]').click()
    ok(await until(async () => { const x = (await assist(id)).proposal; return x.limits.day === 20 && fwds(x.folders).includes('~/docs') }, 8000), 'changed in place: its limit, a folder by its path', (await assist(id)).proposal)
    // In words: a folder that isn't there, and Create turns it down.
    await p.locator('.bc-say textarea').fill('read ~/missing too')
    await p.locator('.bc-say button[type="submit"]').click()
    ok(await until(async () => fwds((await assist(id)).proposal.folders).includes('~/missing'), 15000), 'more words, the proposal again: a folder named', (await assist(id)).proposal.folders)
    await p.locator('.bc-proposal .bc-create .btn.primary').click()
    ok(await until(async () => /Folder not found: ~\/missing/.test(await p.locator('.bc-proposal').innerText()), 8000), 'Create turned down by Settings\' own check, saying why', await p.locator('.bc-proposal').innerText().catch(() => ''))
    ok((await kit.api('/bots')).bots[0].draft && !fs.existsSync(path.join(kit.data, 'bots', id, 'instructions.md')), 'and nothing of it made')
    await p.locator('.bc-proposal .sb-askers li', { hasText: '~/missing' }).locator('button').click()
    await until(async () => !fwds((await assist(id)).proposal.folders).includes('~/missing'), 5000)
    await p.locator('.bc-proposal .bc-create .btn.primary').click()
    ok(await shown(p, '.bp-cols .sb-tabs', 15000), 'Create: the bot\'s page, with its tabs and its chat beside them')
    const v = await botOf(id)
    ok(!v.draft && fwds(v.settings.readsFrom).join() === '~/code/pricing,~/docs' && v.settings.mcp.join() === 'tracker' && v.settings.limits.day === 20 && v.settings.who === 'named' && !v.settings.askers.length && /Pricing Desk/.test(v.instructions.text), 'made as proposed: its folders, MCP server, limits and instructions; the people named wait until it can find them', v.settings)
    ok(events(id).some((e) => e.type === 'settings.changed' && e.setting === 'created' && e.new?.with === 'AI Assist'), 'its record says it was made with AI Assist')
    ok(await shown(p, '.bc-connect [data-setting="slack-guide"]'), 'the chat carries on: the steps to connect it, in Slack')
    await shot(p, `${tag}bots-setup-created`)
  })

  // ---------- Connecting it, from the chat ----------
  await part('connect from the chat', async () => {
    await p.locator('.bc-connect input[placeholder="xapp-…"]').fill('xapp-test')
    await p.locator('.bc-connect input[placeholder="xoxb-…"]').fill('xoxb-test')
    await p.locator('.bc-connect form.sb-tokens button[type="submit"]').click()
    ok(!!(await connected(id)), 'its tokens pasted in the chat: connected')
    ok(await until(async () => (await assist(id)).messages.some((m) => m.kind === 'tick' && m.vars?.step === 'connected'), 15000), 'the chat says so by itself', (await assist(id)).messages.map((m) => m.kind || m.who))
    const s = await until(async () => { const x = await assist(id); return x.change?.found ? x : null }, 15000)
    ok(s && s.change.lines.some((l) => l.key === 'people' && l.after.includes('Dana') && l.after.includes('Sam')) && s.messages.some((m) => m.kind === 'in' && m.vars.channels.includes('launch')), 'once connected: Dana and Sam found, offered to add; it\'s in #launch', s)
    ok(!(await botOf(id)).settings.askers.length, 'not added until you say so')
    ok(await shown(p, '.bc-change'), 'shown as what would change')
    await shot(p, `${tag}bots-setup-found`)
    await p.locator('.bc-change .btn.primary').click()
    ok(await until(async () => (await botOf(id)).settings.askers.map((a) => a.id).sort().join() === 'U0DANA,U0SAM', 8000), 'Apply: Dana and Sam may ask', (await botOf(id)).settings.askers)
  })

  // ---------- Changes in words ----------
  await part('changes in words', async () => {
    const say = async (w) => { await p.locator('.bc-say textarea').fill(w); await p.locator('.bc-say button[type="submit"]').click() }
    await say('also answer every message in #secret-project without a mention')
    let s = await until(async () => { const x = await assist(id); return x.change ? x : null }, 15000)
    ok(s?.change.lines.some((l) => l.key === 'channels' && l.after.includes('secret-project')), 'a change in words: what would change, shown first', s?.change)
    ok(!(await botOf(id)).settings.listen.length, 'nothing changed yet')
    await p.locator('.bc-change .btn.primary').click()
    ok(await until(async () => (await botOf(id)).settings.listen.some((c) => c.id === 'C0PRIV'), 8000), 'confirmed: it answers in #secret-project without a mention', (await botOf(id)).settings.listen)
    await say('make it answer without asking')
    s = await until(async () => { const x = await assist(id); return x.change ? x : null }, 15000)
    ok(s?.change.lines.some((l) => l.key === 'auto' && l.after === true), 'another change, shown', s?.change)
    await p.locator('.bc-change .ghost-btn', { hasText: 'Leave it as it is' }).click()
    ok(await until(async () => { const x = await assist(id); return !x.change && x.messages.at(-1)?.kind === 'discarded' }, 8000) && (await botOf(id)).settings.auto === false, 'left as it is: nothing changed')
    // The whole home folder: Settings' own check refuses it, and nothing of the change goes.
    await say('let it read ~ and rename it Pricing Bot')
    s = await until(async () => { const x = await assist(id); return x.change ? x : null }, 15000)
    await p.locator('.bc-change .btn.primary').click()
    ok(await until(async () => /not the whole of it/.test(await p.locator('.bc').innerText()), 8000), 'one Settings refuses: said in the chat', await p.locator('.bc').innerText().catch(() => ''))
    const v = await botOf(id)
    ok(v.name === 'Pricing Desk' && !v.settings.readsFrom.includes('~'), 'and none of it applied, not even the new name', { name: v.name, readsFrom: v.settings.readsFrom })
    await p.locator('.bc-change .ghost-btn', { hasText: 'Leave it as it is' }).click()
  })

  // ---------- The Chief of Staff's draft ----------
  let chiefBot = null
  await part('the Chief of Staff', async () => {
    const r = chief('bot', 'draft', 'A bot called Docs Helper that answers questions about our docs folder in Discord, for anyone in the server')
    ok(r.status === 0 && /Drafted the bot Docs Helper/.test(r.stdout) && /Create/.test(r.stdout), '`bridge bot draft`: a draft, and it says it waits for you to Create it', r.stdout + r.stderr)
    chiefBot = (await kit.api('/bots')).bots.find((x) => x.name === 'Docs Helper')
    ok(chiefBot?.draft && chiefBot.from === 'chief', 'listed as a draft, from the Chief of Staff', chiefBot)
    const s = await assist(chiefBot.id)
    ok(s.proposal?.platform === 'discord' && s.proposal.who === 'channels' && fwds(s.proposal.folders).includes('~/docs') && s.messages.some((m) => m.kind === 'chief'), 'proposed from its words: Discord, anyone, its docs folder; the chat says the Chief drafted it', s.proposal)
    await kit.api(`/bots/${chiefBot.id}/try`, { text: 'hi' }).then(() => ok(false, 'a draft can\'t be asked'), (e) => ok(e.status === 409, 'nothing of it live: it can\'t be asked', e.message))
    ok(!(await kit.api('/health')).bots.some((x) => x.id === chiefBot.id), 'nor connected')
    ok(await until(async () => /Docs Helper/.test(await p.locator('.rail-bot-list').innerText()), 10000), 'in the sidebar')
    await p.locator('.rail-bot-list .bt-row', { hasText: 'Docs Helper' }).click()
    ok(await shown(p, '.bp-draft .bc-proposal') && /Chief of Staff drafted this/.test(await p.locator('.bc').innerText()), 'its page: the chat, saying where it came from, and its card to Create')
    await shot(p, `${tag}bots-setup-chief-draft`)
  })

  // ---------- MCP servers ----------
  await part('MCP servers', async () => {
    const m = await kit.api(`/bots/${id}/mcp`)
    const tr = m.servers.find((x) => x.name === 'tracker')
    ok(tr && tr.tools?.map((x) => `${x.name}:${x.readOnly}`).sort().join() === 'create_issue:false,list_issues:true,search:true', 'its MCP servers: the tracker\'s tools listed, asked of it, with which only read', m)
    ok(!JSON.stringify(m).includes('tok-tracker-123'), 'never its token')
    await kit.api(`/bots/${id}/settings`, { mcp: ['nope'] }).then(() => ok(false, 'a server you don\'t have refused'), (e) => ok(/isn't one of your MCP servers/.test(e.message), 'a server you don\'t have: refused, saying why', e.message))
    await kit.api(`/bots/${id}/settings`, { who: 'channels' })
    // Someone not named, in #launch: only the tools that read.
    await slack.ask({ user: 'U0EVE', text: '<@UBOT> what\'s open? [mcp tracker list_issues] [mcp tracker create_issue]' })
    const eve = await until(() => logOf('mcp-tries.log').filter((x) => x.tool === 'create_issue').length >= 1 && logOf('mcp-tries.log'), 25000)
    ok(eve && eve.find((x) => x.tool === 'list_issues')?.done === true && eve.find((x) => x.tool === 'create_issue')?.done === false, 'someone not named: the tool that only reads used, the other refused', eve)
    const start = logOf('helpers-started.log').find((x) => /what's open/.test(x.message))
    const args = logOf('claude-args.log').find((x) => /what's open/.test(x.message))?.args || []
    const cfg = args[args.indexOf('--mcp-config') + 1]
    ok(args.includes('--strict-mcp-config') && cfg && !(args.includes('--add-dir') && args.slice(args.indexOf('--add-dir')).includes(path.dirname(cfg))) && eve.every((x) => x.config && !x.read), 'its run: only its servers (--mcp-config, --strict-mcp-config), the config never a folder it may read', args)
    ok(args.includes('mcp__tracker__list_issues') && args.includes('mcp__tracker__search') && !args.includes('mcp__tracker') && args.slice(args.indexOf('--disallowedTools')).includes('mcp__tracker__create_issue'), 'allowed: the read-only tools; refused by name: the other', args)
    ok(!start.secrets?.length && !JSON.stringify(args).includes('tok-tracker-123'), 'its token not on its command line')
    const spaces = ((await kit.api('/fleet?all=1')).workspaces || []).map((w) => w.label)
    ok(spaces.includes('Bot Runs') && !spaces.includes('Bots'), 'its answering agents run in the Bot Runs space, not one called Bots beside the sidebar\'s Bots', spaces)
    const shown = await kit.api('/fleet')
    ok(!shown.workspaces.some((w) => w.label === 'Bot Runs') && !shown.agents.some((a) => a.helper?.list === 'desk'), 'and none of it is in the sidebar: a bot\'s runs are on its page, under Conversations', shown.workspaces.map((w) => w.label))
    // (Its folder is its session's: kept while the conversation may go on, gone once it ends.)
    const sess = await until(async () => (await kit.api('/bots/sessions')).sessions.find((x) => /what's open/.test(x.title) && x.state !== 'working'), 20000)
    ok(fs.existsSync(cfg) && !!sess, 'its MCP folder stays with its session, for its next turn', sess)
    await kit.api(`/bots/sessions/${sess.id}/end`, {})
    ok(await until(() => fs.existsSync(cfg) ? null : true, 20000), 'and is gone once the session ends')
    // Dana, named: every tool.
    await slack.ask({ user: 'U0DANA', text: '<@UBOT> file it please [mcp tracker create_issue]' })
    const dana = await until(() => logOf('mcp-tries.log').filter((x) => x.tool === 'create_issue').length >= 2 && logOf('mcp-tries.log').filter((x) => x.tool === 'create_issue').at(-1), 25000)
    ok(dana?.done === true, 'someone you named: the tool that does more than read too', dana)
    const dargs = logOf('claude-args.log').find((x) => /file it please/.test(x.message))?.args || []
    ok(dargs.includes('mcp__tracker') && !dargs.includes('--disallowedTools'), 'their run: the whole server allowed', dargs)
    const used = await until(() => { const e = events(id).filter((x) => x.type === 'run.tools'); return e.length >= 2 ? e : null }, 25000)
    ok(used && used.some((e) => e.tools.some((x) => x.server === 'tracker' && x.tool === 'list_issues')) && used.some((e) => e.tools.some((x) => x.tool === 'create_issue')), 'Activity records which MCP tools each run used', used)
    ok(events(id).some((e) => e.type === 'run.started' && e.mcp?.may === 'read-only' && e.mcp.servers[0].tools.join() === 'list_issues,search'), 'and what each run was given', events(id).filter((e) => e.type === 'run.started').map((e) => e.mcp))
    await kit.api(`/bots/${id}/settings`, { who: 'named' })
  })

  // ---------- What answers ----------
  await part('what answers', async () => {
    ollama.set([{ name: 'llama3.1:8b', context: 32768, params: '8B' }])
    await kit.api('/providers/ollama', { values: { OLLAMA_HOST: ollama.url } }, 'PUT')
    const o = await until(async () => { const x = await kit.api(`/bots/${id}/answerers?fresh=1`); return x.options.some((y) => y.id === 'model:ollama:llama3.1:8b') ? x : null }, 15000)
    ok(o && o.options.some((y) => y.id === 'model:ollama:llama3.1:8b' && y.local) && o.options.some((y) => y.id === 'model:openai:gpt-5' && !y.local) && o.options.some((y) => y.id === 'agent:claude:opus' && !y.local), 'what can answer: the agents (on a model of their own too) and every model reached, each Local or Cloud', o?.options)
    ok(o?.automatic[0] === 'agent:claude' && o.automatic.at(-1) === 'model:ollama:llama3.1:8b' && o.automatic.indexOf('model:openai:gpt-5') < o.automatic.indexOf('model:ollama:llama3.1:8b'), 'Automatic: Claude Code first, the model on this computer last', o?.automatic)
    await p.locator('.rail-bot-list .bt-row', { hasText: 'Pricing Desk' }).click()
    await p.locator('.bc-say textarea').fill('use my local model if Claude is down')
    await p.locator('.bc-say button[type="submit"]').click()
    const s = await until(async () => { const x = await assist(id); return x.change ? x : null }, 15000)
    ok(s?.change.lines.some((l) => l.key === 'answerers' && l.after.join() === 'agent:claude,model:ollama:llama3.1:8b'), 'said in words: Claude Code first, the local model to fall back on, shown first', s?.change)
    await p.locator('.bc-change .btn.primary').click()
    ok(await until(async () => (await botOf(id)).settings.answerers?.join() === 'agent:claude,model:ollama:llama3.1:8b', 8000), 'applied on confirm')
    // A post on a schedule, in words: a routine of its own once confirmed.
    await p.locator('.bc-say textarea').fill('post a summary of what changed in #launch every Monday at 9')
    await p.locator('.bc-say button[type="submit"]').click()
    const ps = await until(async () => { const x = await assist(id); return x.change ? x : null }, 15000)
    ok(ps?.change.lines.some((l) => l.key === 'posts' && l.after[0]?.channel === 'launch' && /every Monday at 9/.test(l.after[0].when)), 'a scheduled post said in words: shown first', ps?.change)
    await p.locator('.bc-change .btn.primary').click()
    const rt = await until(async () => (await kit.api('/routines')).routines?.find((r) => r.to === 'bot' && r.bot === id && r.channel?.name === 'launch'), 8000)
    ok(rt && /what changed/i.test(rt.command) && /monday/i.test(rt.says || rt.schedule || ''), 'confirmed: a scheduled post of its own in #launch', rt)
    // A token pasted as words: refused, never sent to AI Assist or kept in the chat.
    const before = model.asked(/Known folders/).length
    await p.locator('.bc-say textarea').fill('here is the token xoxb-1234567890-abcdefghij') // private-ok: a made-up token, to see one pasted as words is refused
    await p.locator('.bc-say button[type="submit"]').click()
    ok(await until(async () => /looks like a token/.test(await p.locator('.bc').innerText()), 5000), 'a token pasted as words: refused, saying where it goes')
    ok(model.asked(/Known folders/).length === before && !(await assist(id)).messages.some((m) => /xoxb-/.test(m.text || '')), 'not sent to the model, not kept in the chat')
    await p.locator('.bc-say textarea').fill('')
    await p.locator('.bp-main .sb-tabs [role="tab"]', { hasText: 'Access' }).click()
    const sec = p.locator('[data-setting="bots-answerers"]')
    await sec.scrollIntoViewIfNeeded()
    const said = await sec.innerText()
    ok(/Your own list/.test(said) && /Claude Code/.test(said) && /llama3.1:8b/.test(said) && /Local/.test(said) && /Cloud/.test(said), 'its Access: What Answers, in order, each Local or Cloud', said)
    await shot(p, `${tag}bots-setup-what-answers`)
  })

  // ---------- Try It, as it goes ----------
  await part('Try It live', async () => {
    await p.locator('.rail-bot-list .bt-row', { hasText: 'Pricing Desk' }).click()
    await p.locator('.bp-main .sb-tabs [role="tab"]', { hasText: 'Try It' }).click()
    await p.locator('.sb-try textarea').fill('Hi [answer Hello, I\'m Pricing Desk.] [work 6] [peek]')
    await p.locator('.sb-try button[type="submit"]').click()
    ok(await shown(p, '[data-setting="slack-try-live"]', 8000), 'asked: the run shows as it goes')
    const reading = await until(async () => { const tx = await p.locator('[data-setting="slack-try-live"]').innerText().catch(() => ''); return /Reading .*README\.md/.test(tx) ? tx : null }, 10000)
    ok(!!reading && /\d:\d\d/.test(reading) && /Stop/.test(reading), 'what it\'s reading, the time so far, and Stop', reading)
    await shot(p, `${tag}bots-setup-try-live`)
    ok(await until(async () => /Hello, I'm Pricing Desk\./.test(await p.locator('.sb-try-draft').innerText().catch(() => '')), 20000), 'its answer there the moment it\'s ready: "Hi" visibly gets a reply')
    ok(!(await p.locator('[data-setting="slack-try-live"]').count()), 'and the run\'s line gone')
    await p.locator('.sb-try textarea').fill('Take your time [work 30]')
    await p.locator('.sb-try button[type="submit"]').click()
    ok(await shown(p, '[data-setting="slack-try-live"] button:has-text("Stop")', 8000), 'a long one: Stop')
    await p.locator('[data-setting="slack-try-live"] button:has-text("Stop")').click()
    ok(await until(async () => /Stopped before it answered/.test(await p.locator('.sb-try-out').innerText().catch(() => '')), 15000), 'Stop: stopped, and said')
  })

  // ---------- Fallbacks, and a model answering ----------
  await part('fallbacks', async () => {
    const fb = await kit.api('/bots', { name: 'Fallback Desk' })
    await kit.api(`/bots/${fb.id}/settings`, { readsFrom: ['~/code/pricing'], answerers: ['agent:codex', 'agent:claude', 'model:ollama:llama3.1:8b', 'model:openai:gpt-5'] })
    const ask = async (text) => { const r = await kit.api(`/bots/${fb.id}/try`, { text }); return until(async () => { const x = await kit.api(`/bots/${fb.id}/try/${encodeURIComponent(r.q)}`); return x.item.state === 'draft' || x.item.state === 'stopped' ? x : null }, 45000, 400) }
    const tries = (x) => (x?.events || []).filter((e) => e.type === 'run.skipped' || e.type === 'run.passed').map((e) => `${e.answerer?.id}: ${e.why}`)
    const flag = (f, on) => (on ? fs.writeFileSync(path.join(home, f), '') : fs.rmSync(path.join(home, f), { force: true }))
    // Codex not installed, Claude Code not signed in, the local model's server not running: the key's model.
    flag('claude-signed-out', true)
    await kit.api('/accounts/claude-default/status').catch(() => {})
    ollama.stop()
    let x = await ask('What does the Team plan cost?')
    ok(/gpt-5/.test(x?.item.by || '') && /It says: The Team plan is \$12 a seat\./.test(x?.item.draft || ''), 'its first choice not installed, the next not signed in, the one on this computer not running: the next answers, from its folder', x?.item)
    const t1 = tries(x)
    ok(t1.some((w) => /^agent:codex: .*isn't installed/.test(w)) && t1.some((w) => /^agent:claude: .*isn't signed in/.test(w)) && t1.some((w) => /^model:ollama:llama3.1:8b: /.test(w)), 'each one passed over is in its record, saying why', t1)
    ok(x.events.some((e) => e.type === 'draft' && /gpt-5/.test(e.by || '')), 'and its draft says which answered')
    // Claude Code at its usage limit: tried, and passed on.
    flag('claude-signed-out', false)
    flag('claude-limited', true)
    await kit.api('/accounts/claude-default/status').catch(() => {})
    x = await ask('And the Business plan?')
    ok(/gpt-5/.test(x?.item.by || '') && tries(x).some((w) => /^agent:claude: .*usage limit/.test(w)), 'its usage limit hit: the next answers at once', tries(x))
    // A model answering, kept to its folders: a file there read, one outside refused, a link out of it too.
    fs.mkdirSync(path.join(home, 'private'), { recursive: true })
    fs.writeFileSync(path.join(home, 'private', 'secret.txt'), 'The launch code is 1234.\n')
    // (A link to a folder outside it: a junction on Windows, which needs no administrator.)
    fs.symlinkSync(path.join(home, 'private'), path.join(home, 'code', 'pricing', 'private-link'), 'junction')
    await kit.api(`/bots/${fb.id}/settings`, { answerers: ['model:openai:gpt-5'] })
    x = await ask('Read this [read README.md]')
    ok(/It says: The Team plan is \$12 a seat\./.test(x?.item.draft || '') && x.events.some((e) => e.type === 'run.read' && e.files.some((f) => /code\/pricing\/README\.md$/.test(fwd(f.what)))), 'a model answers with Bridge AI\'s tools: a file in its folder read, and in its record', x?.item.draft)
    ok(x.events.some((e) => e.type === 'run.started' && e.agent === 'model' && e.route?.enforced === true), 'kept to its folders, as Claude Code is: it may answer without asking')
    x = await ask('And this [read ~/private/secret.txt]')
    ok(/outside the folders you can read: refused/.test(x?.item.draft || '') && !/1234/.test(x?.item.draft || ''), 'a file outside its folders: refused', x?.item.draft)
    x = await ask('And this one [read private-link/secret.txt]')
    ok(/outside the folders you can read: refused/.test(x?.item.draft || '') && !/1234/.test(x?.item.draft || ''), 'a link out of its folder: refused too', x?.item.draft)
    // A provider's error: the next answers.
    await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-bad', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
    flag('claude-limited', false)
    await kit.api(`/bots/${fb.id}/settings`, { answerers: ['model:openai:gpt-5', 'agent:claude'] })
    x = await ask('Hi [answer Hello from Claude Code.]')
    ok(x?.item.by === 'Claude Code' && /Hello from Claude Code/.test(x.item.draft || '') && tries(x).some((w) => /^model:openai:gpt-5: .*(401|Incorrect API key)/.test(w)), 'its provider turns it down: the next answers', { by: x?.item.by, tries: tries(x) })
    // Every one failing: to you, with each one's reason.
    flag('claude-limited', true)
    await kit.api(`/bots/${fb.id}/settings`, { answerers: ['agent:codex', 'model:openai:gpt-5', 'agent:claude'] })
    x = await ask('Anyone there?')
    ok(x?.item.needsOwner && /Codex isn't installed/.test(x.item.why || '') && /(401|Incorrect API key)/.test(x.item.why || '') && /usage limit/.test(x.item.why || ''), 'none can answer: passed to you, with each one\'s reason', x?.item.why)
    // Fallback off: its first choice only.
    flag('claude-limited', false)
    await kit.api(`/bots/${fb.id}/settings`, { answerers: ['agent:codex', 'agent:claude'], fallback: false })
    x = await ask('One more?')
    ok(x?.item.needsOwner && /fallback is off/.test(x.item.why || '') && /Codex isn't installed/.test(x.item.why || '') && !x.events.some((e) => e.type === 'run.started'), 'fallback off: its first choice can\'t, so it\'s passed to you, nothing else tried', x?.item.why)
    await kit.api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `${model.url}/v1` } }, 'PUT')
    // A change asked for, with nothing in its list that can make one: to you, saying why.
    await kit.api(`/bots/${fb.id}/settings`, { answerers: ['agent:claude'], fallback: true, askers: [{ id: 'U0DANA', name: 'Dana' }] })
    await kit.api(`/bots/${fb.id}/settings`, { changes: 'suggest' })
    await kit.api(`/bots/${fb.id}/settings`, { answerers: ['model:openai:gpt-5'] })
    await kit.api(`/bots/${fb.id}/tokens`, { appToken: 'xapp-two', botToken: 'xoxb-two' })
    await connected(fb.id)
    await slack.ask({ user: 'U0DANA', text: '<@UBOT2> please make the Team plan $15 [change]' })
    const d = await until(async () => (await kit.api('/needs-you')).slack?.find((y) => /Team plan \$15/.test(y.text) && y.state === 'draft'), 30000)
    ok(d?.needsOwner && /asked for a change, and nothing in its list can make one: changes need Claude Code/.test(d.why || ''), 'a change asked for, nothing in its list can make it: passed to you, saying why', d)
  })

  // ---------- A folder's own Claude Code settings ----------
  await part('a folder\'s own settings', async () => {
    // Someone else's settings in a bot's folder (a shared repository's, say): reads allowed anywhere,
    // your home added as a folder, and a command run as it starts, in .claude/settings.json and
    // .claude/settings.local.json; and your own settings allowing reads anywhere in your home.
    const dir = path.join(home, 'code', 'shared')
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'README.md'), '# Shared\n\nThe Team plan is $12 a seat.\n')
    fs.writeFileSync(path.join(home, 'outside.txt'), 'The safe code is 4321.\n')
    const marker = path.join(home, 'hook-ran.log')
    const hook = (from) => ({ SessionStart: [{ hooks: [{ type: 'command', command: `"${process.execPath}" -e "require('fs').appendFileSync(process.argv[1], '${from}\\n')" "${marker}"` }] }] })
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Read(~/**)'], additionalDirectories: [home] }, hooks: hook('project') }))
    fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Read'] }, hooks: hook('local') }))
    const mine = path.join(home, '.claude', 'settings.json')
    fs.mkdirSync(path.dirname(mine), { recursive: true })
    fs.writeFileSync(mine, JSON.stringify({ permissions: { allow: ['Read(~/**)'] } }))
    const sd = await kit.api('/bots', { name: 'Shared Desk' })
    await kit.api(`/bots/${sd.id}/settings`, { readsFrom: ['~/code/shared'], answerers: ['agent:claude'] })
    const ask = async (text) => { const r = await kit.api(`/bots/${sd.id}/try`, { text }); return until(async () => { const x = await kit.api(`/bots/${sd.id}/try/${encodeURIComponent(r.q)}`); return x.item.state === 'draft' || x.item.state === 'stopped' ? x : null }, 45000, 400) }
    // A bot's run: only your own settings and Bridge AI's, which keep its reads to its folder.
    let x = await ask('What does the safe say? [try-read ~/outside.txt] [answer That is all.]')
    const s = logOf('helpers-started.log').find((y) => /What does the safe say/.test(y.message))
    const kept = s?.args.includes('--settings') ? s.args[s.args.indexOf('--settings') + 1] : ''
    ok(real(s?.cwd || '') === real(dir) && (s?.args.join(' ') || '').includes('--setting-sources user --settings ') && /\/front-desk\/mcp\/[^/]+\/settings\.json$/.test(fwd(kept)), 'a bot\'s run in that folder loads only your own settings and Bridge AI\'s (--setting-sources user, --settings: its run\'s own)', s && { cwd: s.cwd, args: s.args })
    // (As the stand-in read them: the run's file goes once it has.)
    const given = s?.given || null
    ok(given?.permissions?.blockReadsOutsideWorkingDirectories === true, 'Bridge AI\'s: no read outside its folders, whatever an allow rule says', given)
    ok(!!s && !s.settings.some((f) => real(f).startsWith(real(dir))), 'none of its folder\'s own settings loaded', s?.settings)
    ok(!/4321/.test(x?.item.draft || '') && /reading outside my folders was refused/.test(x?.item.draft || '') && logOf('answer-tries.log').some((y) => y.try === 'read' && y.done === false && real(y.cwd) === real(dir)), 'a file outside its folder isn\'t read, though its folder\'s settings and your own allow it', x?.item.draft)
    ok(!fs.existsSync(marker), 'and its folder\'s hooks never run', fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null)
    fs.rmSync(mine, { force: true })
    // An agent of your own there loads them, as before.
    const l = await kit.api('/agents/launch', { kind: 'claude', cwd: dir, label: 'Shared', newSpace: 'Shared' })
    const ran = await until(() => { const t = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : ''; return /project/.test(t) && /local/.test(t) ? t : null }, 15000)
    ok(!!ran, 'an agent of your own in that folder loads its settings as before (their hooks run)', ran)
    if (l?.tabId) await kit.api(`/tabs/${encodeURIComponent(l.tabId)}/close`, {}).catch(() => {})
    // Claude Code older than 2.1.257 (Settings › Agents looks again): no run starts, and it says why.
    fs.writeFileSync(path.join(home, 'claude-version'), '2.1.200')
    await kit.api('/agents/catalog')
    const n = logOf('helpers-started.log').length
    x = await ask('Anything new? [answer Nothing new.]')
    const why = 'Bots need Claude Code 2.1.257 or later: update it with claude update'
    ok(x?.item.needsOwner && (x.item.why || '').includes(why) && !x.events.some((e) => e.type === 'run.started'), 'Claude Code too old: no run starts, and the question comes to you saying why', x?.item)
    ok(x?.events.some((e) => e.type === 'run.skipped' && e.why === why), 'its record says why', x?.events.map((e) => e.type))
    ok(logOf('helpers-started.log').length === n, 'no agent started', logOf('helpers-started.log').length - n)
    ok((await botOf(sd.id)).answerers?.list.find((e) => e.id === 'agent:claude')?.why === why, 'and the bot\'s page says so, under What Answers', (await botOf(sd.id)).answerers)
    fs.rmSync(path.join(home, 'claude-version'), { force: true })
    await kit.api('/agents/catalog')
    x = await ask('Once more? [answer Here again.]')
    ok(/Here again\./.test(x?.item.draft || ''), 'updated: it answers again', x?.item)
  })

  // ---------- Settings › Bots opens the same ----------
  await part('Settings › Bots', async () => {
    await openSettings(p)
    await p.locator('.sb-chip', { hasText: 'Pricing Desk' }).click()
    ok(await shown(p, '.modal.settings .sb-page-link button'), 'Settings › Bots: the same bot, with Open as a page')
    await p.locator('.modal.settings .sb-page-link button').click()
    ok(await until(async () => !(await p.locator('.modal.settings').count()) && (await p.locator('.bp .bp-name').innerText().catch(() => '')) === 'Pricing Desk', 8000), 'which opens its page, Settings closed')
  })
  ok(errors.length === 0, 'no page errors', errors)
  await ctx.close()

  // ---------- Light and dark, a computer and a phone ----------
  for (const [mode, phone] of [['dark', false], ['light', true], ['dark', true]]) {
    await part(`${mode}${phone ? ', a phone' : ''}`, async () => {
      const x = await page(b, kit.url, { mode, theme: mode === 'dark' ? 'midnight' : 'sky', phone })
      const label = `${mode}${phone ? ', a phone' : ''}`
      if (!phone) {
        await x.p.locator('.rail-bot-list .bt-row', { hasText: 'Pricing Desk' }).click()
        ok(await shown(x.p, '.bp .sb-tabs'), `${label}: its page`)
        await shot(x.p, `${tag}bots-setup-page-${mode}`)
        await x.p.locator('.rail-bot-list .bt-row', { hasText: 'Docs Helper' }).click()
        ok(await shown(x.p, '.bp-draft .bc-proposal'), `${label}: a draft's page`)
        await shot(x.p, `${tag}bots-setup-draft-${mode}`)
      } else {
        await x.p.locator('.tabbar button', { hasText: 'More' }).click()
        await x.p.locator('.m-more-row[data-id="bots"]').click()
        ok(await shown(x.p, '[data-setting="phone-bots"] .m-more-row[data-id="new-bot"]'), `${label}: More › Bots, with New bot`)
        const rows = await until(async () => { const t = await x.p.locator('[data-setting="phone-bots"]').innerText(); return /Fallback Desk/.test(t) ? t : null }, 10000) || ''
        ok(/Pricing Desk/.test(rows) && /Docs Helper/.test(rows) && /draft/i.test(rows), `${label}: every bot, with how it stands`, rows)
        await sleep(300)
        let faults = await phoneFaults(x.p, '[data-setting="phone-bots"]')
        ok(!Object.keys(faults).length, `${label}: the list fits a phone`, faults)
        await shot(x.p, `${tag}bots-setup-phone-list-${mode}`)
        await x.p.locator(`[data-setting="phone-bots"] .m-more-row[data-id="${id}"]`).click()
        ok(await shown(x.p, '.bp.phone .sb-tabs'), `${label}: a bot's page`)
        await sleep(300)
        faults = await phoneFaults(x.p, '.bp.phone')
        ok(!Object.keys(faults).length, `${label}: its page fits a phone: nothing too small, off the screen or cut short`, faults)
        await shot(x.p, `${tag}bots-setup-phone-page-${mode}`)
        await x.p.locator('.bp.phone .ai-assist').click()
        await x.p.locator('.ai-menu .ai-item').first().click()
        ok(await shown(x.p, '.bp.phone .bp-chat .bc-say'), `${label}: AI Assist's chat, the whole page`)
        await sleep(300)
        faults = await phoneFaults(x.p, '.bp.phone .bp-chat')
        ok(!Object.keys(faults).length, `${label}: the chat fits a phone`, faults)
        await shot(x.p, `${tag}bots-setup-phone-chat-${mode}`)
        await x.p.locator('.m-view-back', { hasText: 'Bots' }).click()
        await x.p.locator('[data-setting="phone-bots"] .m-more-row[data-id="new-bot"]').click()
        ok(await shown(x.p, '.bp-new .bc-say'), `${label}: New bot, its chat`)
        await sleep(300)
        faults = await phoneFaults(x.p, '.bp-new')
        ok(!Object.keys(faults).length, `${label}: the new bot's chat fits a phone`, faults)
        await shot(x.p, `${tag}bots-setup-phone-new-${mode}`)
      }
      ok(!x.errors.length, `${label}: no page errors`, x.errors)
      await x.ctx.close()
    })
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
} finally {
  await b.close().catch(() => {})
  await kit.stop()
  slack.stop(); model.stop(); ollama.stop()
}
process.exit(done().fail ? 1 : 0)
