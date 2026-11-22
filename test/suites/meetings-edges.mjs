// Meetings at their edges, in Chromium and WebKit: Start recording pressed twice before the first
// has started (a double click, or the floating card and the window at once) is one recording, which
// Stop stops; Bridge AI closing while a meeting's notes or its transcript's cleanup are being written
// (the notes written again once it's back, the cleanup saying it was cut off, neither left "being
// written" for ever with Summarize greyed out), and a meeting stopped just before it closed getting
// its notes; a meeting's page whose meeting isn't there any more (merged into another, or deleted,
// on another device or in another tab), saying so with the way on, open or opened afresh, on a
// computer and a phone; what a merge says on the merged meeting, on a phone's width, its icon
// beside its words; a meeting the computer records, paused and stopped from a phone; and the
// summary's Template in German.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { startKit, startModel, checks, until, sleep, browser, page, reload, shot, withoutCutOff, freePort } from '../lib/harness.mjs'

const { ok, done } = checks('meetings-edges')
const model = await startModel('meetings-edges')
// The model, held back while hold.on (its answer never comes, as one that's slow when Bridge AI
// closes), else the stand-in's.
const hold = { on: false }
const held = []
const proxy = http.createServer((req, res) => {
  const body = []
  req.on('data', (c) => body.push(c))
  req.on('end', async () => {
    if (hold.on && /chat\/completions/.test(req.url)) { held.push(res); return }
    try {
      const r = await fetch(`${model.url}${req.url}`, { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'POST' ? Buffer.concat(body) : undefined })
      res.writeHead(r.status, { 'content-type': 'application/json' })
      res.end(Buffer.from(await r.arrayBuffer()))
    } catch { res.destroy() }
  })
})
const proxyPort = await freePort()
await new Promise((r) => proxy.listen(proxyPort, '127.0.0.1', r))
const kit = await startKit('meetings-edges')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const api = kit.api
const dirOf = (id) => path.join(kit.data, 'meetings', id)
const said = (id, text) => fs.appendFileSync(path.join(dirOf(id), 'transcript.jsonl'), `${JSON.stringify({ src: 'you', t0: 1, t1: 4, text, engine: 'test' })}\n`)
const meta = (id) => JSON.parse(fs.readFileSync(path.join(dirOf(id), 'meeting.json'), 'utf8'))
// A meeting recorded and stopped, with a line said in it.
const recorded = async (title, text) => {
  const x = await api('/meetings', { title, call: false })
  await api(`/meetings/${x.id}/stop`, {})
  await until(async () => (await api(`/meetings/${x.id}`)).status === 'done', 10000)
  if (text) said(x.id, text)
  return x.id
}
const open = (p, id) => p.evaluate((mid) => window.dispatchEvent(new CustomEvent('bridge-open-meeting', { detail: { id: mid } })), id)
// WebKit's mic is a tone (it has no fake one): Start recording records it.
const tone = (c) => c.addInitScript(() => {
  const md = window.MediaDevices?.prototype
  if (md && !navigator.userAgent.includes('Chrome')) md.getUserMedia = async () => { const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream }
})

try {
  await api('/setup', { name: 'Tester' })
  await api('/providers/openai', { values: { OPENAI_API_KEY: 'sk-test', OPENAI_BASE_URL: `http://127.0.0.1:${proxyPort}/v1` } }, 'PUT')
  await api('/settings', { meetings: { engine: 'openai', model: 'openai:gpt-5', autoSummary: false, cleanup: false, nameSpeakers: false } }, 'PATCH')

  // ---------- Start recording, twice at once ----------
  // A double click on Start recording, and the floating card's Take notes with the window's at the
  // same moment: one meeting records, not two (the second's mic nothing could stop), and Stop stops it.
  {
    const { ctx, p, errors } = await page(b, kit.url, { store: { 'cc-rail-meetings': true }, before: tone })
    await p.waitForSelector('.rail-nav-row', { timeout: 15000 })
    await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).click()
    const start = p.locator('.mt-view .pane-head button', { hasText: 'Start recording' })
    await start.waitFor({ timeout: 10000 })
    const recordingNow = async () => (await api('/meetings')).meetings.filter((x) => x.status === 'recording')
    await start.dblclick()
    await p.waitForSelector('.mt-recbar', { timeout: 15000 }).catch(() => {})
    await sleep(2500)
    let now = await recordingNow()
    ok(now.length === 1, 'Start recording double-clicked: one meeting records, not two', now.map((x) => x.id))
    await p.locator('.mt-recbar button', { hasText: 'Stop' }).click()
    ok(!!(await until(async () => (await recordingNow()).length === 0, 10000)), 'and Stop stops it: nothing is left recording', (await recordingNow()).map((x) => x.id))
    const n0 = (await api('/meetings')).meetings.length
    await p.evaluate(() => { for (let i = 0; i < 2; i++) window.dispatchEvent(new CustomEvent('bridge-meeting-start', { detail: { title: 'Card and window' } })) })
    await p.waitForSelector('.mt-recbar', { timeout: 15000 }).catch(() => {})
    await sleep(2500)
    now = await recordingNow()
    ok(now.length === 1 && (await api('/meetings')).meetings.length === n0 + 1, 'the card\'s Take notes and the window\'s at once: one meeting', now.map((x) => x.title))
    await p.locator('.mt-recbar button', { hasText: 'Stop' }).click()
    ok(!!(await until(async () => (await recordingNow()).length === 0, 10000)), 'which Stop stops')
    ok(withoutCutOff(errors).length === 0, 'twice at once: no page errors', errors)
    await ctx.close()
  }

  // ---------- Stop while a screen is being picked ----------
  // Watch a screen, its picker never answering (macOS's, closed without a word), then Stop: the
  // pick is let go, and the next recording doesn't say that no screen has been picked yet.
  {
    const { ctx, p, errors } = await page(b, kit.url, { store: { 'cc-rail-meetings': true }, before: async (c) => {
      await tone(c)
      await c.addInitScript(() => {
        window.__bridgePickWait = 2500
        const md = window.MediaDevices?.prototype
        if (md) md.getDisplayMedia = () => new Promise(() => {})
      })
    } })
    await p.waitForSelector('.rail-nav-row', { timeout: 15000 })
    const startHere = async () => {
      await p.locator('.rail-nav-btn', { hasText: 'Meetings' }).click()
      await p.locator('.mt-view .pane-head button', { hasText: 'Start recording' }).click({ timeout: 10000 })
      await p.waitForSelector('.mt-recbar', { timeout: 15000 }).catch(() => {})
    }
    await startHere()
    await p.locator('.mt-recbar button', { hasText: 'Watch a screen' }).click()
    ok(!!(await until(async () => (await p.locator('.mt-recbar .mt-picking-btn').count()) === 1, 5000)), 'Watch a screen: Picking a screen…')
    await p.locator('.mt-recbar button', { hasText: 'Stop' }).click()
    await sleep(3500) // (past the picker's wait)
    await startHere()
    await sleep(1500)
    const bar = await p.locator('.mt-recbar').innerText().catch(() => '')
    ok(/Recording/.test(bar) && !/picked|picker/i.test(bar) && (await p.locator('.mt-recbar .mt-picking-btn').count()) === 0, 'stopped while it was picked: the next recording says nothing about that screen', bar)
    await p.locator('.mt-recbar button', { hasText: 'Stop' }).click()
    await until(async () => !(await api('/meetings')).meetings.some((x) => x.status === 'recording'), 10000)
    ok(withoutCutOff(errors).length === 0, 'stopped while picking: no page errors', errors)
    await ctx.close()
  }

  // ---------- Bridge AI closing while notes are being written ----------
  // Its summary was being written (the model slow to answer) when Bridge AI closed: opened again,
  // the meeting doesn't say it's being written for ever with Summarize greyed out; the notes are
  // written again, by themselves, in a moment. A cleanup cut off the same way says so, with Try
  // again. A meeting stopped just before Bridge AI closed (its last words still being transcribed),
  // with summaries written by themselves, has its notes written once it's back.
  {
    const S = await recorded('Summary cut off', 'We agreed to ship on Friday.')
    const C = await recorded('Cleanup cut off', 'bridge ay eye ships on Friday.')
    said(C, 'Second line about pricing.')
    said(C, 'Third line about the launch.')
    hold.on = true
    api(`/meetings/${S}/summary`, {}).catch(() => {})
    api(`/meetings/${C}/cleanup`, {}).catch(() => {})
    ok(!!(await until(() => meta(S).summarizing === true && meta(C).cleaning === true, 10000)), 'the summary and a cleanup are being written', { s: meta(S).summarizing, c: meta(C).cleaning })
    // One whose last words were being transcribed as it closed.
    const T = await recorded('Stopped as it closed', 'Rollout starts Monday.')
    await kit.restart(() => {
      fs.writeFileSync(path.join(dirOf(T), 'meeting.json'), JSON.stringify({ ...meta(T), status: 'transcribing' }, null, 2))
      fs.writeFileSync(path.join(kit.data, 'config.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(kit.data, 'config.json'), 'utf8')), meetings: { ...JSON.parse(fs.readFileSync(path.join(kit.data, 'config.json'), 'utf8')).meetings, autoSummary: true } }))
    })
    for (const r of held.splice(0)) r.destroy()
    hold.on = false
    let s = await api(`/meetings/${S}`)
    const c = await api(`/meetings/${C}`)
    ok(!s.summarizing || !!s.summaryRetryAt, 'opened again: the summary isn\'t said to be being written by nothing', { summarizing: s.summarizing, retry: s.summaryRetryAt })
    ok(!c.cleaning && /Bridge AI closed before it was done/.test(c.cleanError || ''), 'the cleanup cut off says so (with Try again on the page), not Cleaning up for ever', { cleaning: c.cleaning, error: c.cleanError })
    s = await until(async () => { const x = await api(`/meetings/${S}`); return x.summary && !x.summarizing && x }, 20000)
    ok(!!s && /## Summary/.test(s.summary), 'and the notes are written again by themselves', s && { summary: s.summary?.slice(0, 80) })
    const t = await until(async () => { const x = await api(`/meetings/${T}`); return x.summary && !x.summarizing && x }, 20000)
    ok(!!t && t.status === 'done', 'a meeting stopped just before it closed has its notes written once it\'s back', t && { status: t.status, summary: !!t.summary })
    // On its page: not Writing the summary…, and Summarize can be pressed.
    hold.on = true
    const W = await recorded('Still cut off', 'Pricing goes up in March.')
    api(`/meetings/${W}/summary`, {}).catch(() => {})
    await until(() => meta(W).summarizing === true, 10000)
    await kit.restart(() => {
      const conf = JSON.parse(fs.readFileSync(path.join(kit.data, 'config.json'), 'utf8'))
      fs.writeFileSync(path.join(kit.data, 'config.json'), JSON.stringify({ ...conf, meetings: { ...conf.meetings, autoSummary: false } }))
    })
    for (const r of held.splice(0)) r.destroy()
    // (The model stays slow: what the page says while it's written again, and once that's done.)
    const { ctx, p, errors } = await page(b, kit.url)
    await p.waitForSelector('.rail-nav-row', { timeout: 15000 })
    await open(p, W)
    await p.waitForSelector('.mt-view .mt-title', { timeout: 10000 }).catch(() => {})
    await sleep(1500)
    hold.on = false
    for (const r of held.splice(0)) r.destroy()
    ok(!!(await until(async () => { const x = await api(`/meetings/${W}`); return !x.summarizing && (x.summary || x.summaryError) }, 20000)), 'written again once it\'s back, or said why not')
    ok(!!(await until(async () => !(await p.locator('.mt-working', { hasText: 'Writing the summary' }).count()) && !(await p.locator('.mt-tool.lead').isDisabled().catch(() => true)), 10000)), 'its page: not Writing the summary… for ever, and Summarize can be pressed', await p.locator('.mt-notes').first().innerText().catch(() => ''))
    await shot(p, `${tag}edges-summary-after-close`)
    ok(withoutCutOff(errors).length === 0, 'notes cut off: no page errors', errors)
    await ctx.close()
  }

  // ---------- A meeting that isn't there any more ----------
  // Its page open while it's merged into another (on another device), and opened afresh after:
  // it says it was merged, into which, with Open it; one deleted says so, with All meetings. Not
  // the meeting as it was, nor Loading… for ever.
  {
    const A = await recorded('Pricing call', 'We start with the price list.')
    const B = await recorded('Pricing call', 'Then the discounts for schools.')
    const D = await recorded('Deleted elsewhere', 'Something said.')
    for (const look of [{}, { phone: true, mode: 'dark' }]) {
      const { ctx, p, errors } = await page(b, kit.url, { store: { 'cc-rail-meetings': true }, ...look })
      await p.waitForSelector(look.phone ? '.tabbar button' : '.rail-nav-row', { timeout: 15000 }).catch(() => {})
      const size = look.phone ? 'phone' : 'computer'
      if (!look.phone) {
        await open(p, B)
        await p.waitForSelector('.mt-merge-hint', { timeout: 10000 }).catch(() => {})
        await api(`/meetings/${B}/merge`, { id: A })
        const gone = p.locator('.mt-gone')
        ok(!!(await until(async () => /This meeting isn't here any more\. It was merged into Pricing call\./.test(await gone.innerText().catch(() => '')), 10000)), `${size}: its page open as it's merged into another: it says so, and into which`, await p.locator('.mt-view').first().innerText().catch(() => ''))
        await shot(p, `${tag}edges-merged-away`)
        await reload(p, errors)
        await p.waitForSelector('.rail-nav-row', { timeout: 15000 }).catch(() => {})
        ok(!!(await until(async () => /merged into Pricing call/.test(await gone.innerText().catch(() => '')), 10000)), `${size}: opened afresh, the same (not Loading… for ever)`, await p.locator('.mt-view').first().innerText().catch(() => ''))
        await gone.locator('button', { hasText: 'Open it' }).click()
        ok(!!(await until(async () => (await p.locator('.mt-title').inputValue().catch(() => '')) === 'Pricing call' && /We start with the price list[\s\S]*discounts for schools/.test(await p.locator('.mt-view').first().innerText().catch(() => '')), 10000)), `${size}: Open it opens the meeting it's part of now`, await p.locator('.mt-view').first().innerText().catch(() => ''))
        await api(`/meetings/${A}/separate`, { id: B })
      }
      await open(p, D)
      await p.waitForSelector('.mt-view .mt-title', { timeout: 10000 }).catch(() => {})
      if (!look.phone) await api(`/meetings/${D}`, null, 'DELETE')
      const gone = p.locator('.mt-gone')
      ok(!!(await until(async () => /This meeting isn't here any more\. It was deleted, here or on another of your devices\./.test(await gone.innerText().catch(() => '')), 10000)), `${size}: one deleted elsewhere says so`, await p.locator('.mt-view').first().innerText().catch(() => ''))
      const box = await gone.boundingBox().catch(() => null)
      const vw = await p.evaluate(() => innerWidth)
      ok(!!box && box.x >= 0 && box.x + box.width <= vw + 1, `${size}: within the screen`, { box, vw })
      await shot(p, `${tag}edges-deleted-${size}`)
      await gone.locator('button', { hasText: 'All meetings' }).click()
      ok(!!(await until(async () => (await p.locator('.mt-gone').count()) === 0, 8000)), `${size}: All meetings goes to the list`)
      ok(withoutCutOff(errors).length === 0, `${size}: gone meetings, no page errors`, errors)
      await ctx.close()
    }
  }

  // ---------- What a merge says, on a phone ----------
  // On the merged meeting, at a phone's width: the icon beside the start of its words, and Separate
  // after them, not each on a line of its own.
  {
    const A = await recorded('Roadmap check with the whole design team', 'First half.')
    const B = await recorded('Roadmap check with the whole design team', 'Second half.')
    await api(`/meetings/${B}/merge`, { id: A })
    await api(`/meetings/${A}/assist`, { on: true })
    const { ctx, p, errors } = await page(b, kit.url, { phone: true })
    await sleep(1500)
    await open(p, A)
    const line = p.locator('.mt-merged')
    await line.waitFor({ timeout: 10000 }).catch(() => {})
    const at = await line.evaluate((el) => {
      const icon = el.querySelector('svg').getBoundingClientRect()
      const words = el.querySelector('span').getClientRects()[0]
      const link = el.querySelector('button').getBoundingClientRect()
      const rects = el.querySelector('span').getClientRects(), last = rects[rects.length - 1]
      return { icon: { top: icon.top, bottom: icon.bottom, right: icon.right }, words: { top: words.top, bottom: words.bottom, left: words.left }, end: { right: last.right, mid: (last.top + last.bottom) / 2 }, link: { left: link.left, mid: (link.top + link.bottom) / 2 }, left: el.getBoundingClientRect().left }
    }).catch((e) => ({ error: e.message }))
    ok(!at.error && at.icon.top < at.words.bottom && at.icon.bottom > at.words.top && at.words.left >= at.icon.right, 'a phone: the merge\'s icon is beside the start of its words', at)
    ok(!at.error && at.link.left > at.left + 40 && (Math.abs(at.link.mid - at.end.mid) > 8 || at.link.left >= at.end.right + 2), 'and Separate follows the words, with a space, not on a line of its own', at)
    // Its header with five views (Suggestions among them): AI Assist beside the name and ⋯, not on
    // a row of its own under the views.
    const hd = await p.evaluate(() => {
      const h = document.querySelector('.mt-view > .pane-head')
      const r = (e) => e?.getBoundingClientRect()
      const seg = r(h.querySelector('.seg')), wand = r(h.querySelector('.mt-ai-btn')), more = r(h.querySelector('.win-btn[aria-label="More actions"]'))
      return { views: h.querySelectorAll('.seg > button').length, seg: seg && { top: seg.top, bottom: seg.bottom }, wand: wand && { top: wand.top, bottom: wand.bottom, right: wand.right }, more: more && { top: more.top }, width: innerWidth }
    })
    ok(hd.views === 5 && !!hd.wand && hd.wand.bottom <= hd.seg.top + 1 && Math.abs(hd.wand.top - hd.more.top) < 6 && hd.wand.right <= hd.width, 'a phone, five views: AI Assist beside ⋯ on the name\'s row, not on a row of its own', hd)
    await shot(p, `${tag}edges-merged-phone`)
    ok(withoutCutOff(errors).length === 0, 'merged on a phone: no page errors', errors)
    await ctx.close()
  }

  // ---------- Recording on the computer, seen from a phone ----------
  // The phone's page of a meeting the computer records: Pause and Stop there too, and the
  // computer's recording follows (paused, then stopped, its mic let go).
  {
    const pc = await page(b, kit.url, { store: { 'cc-rail-meetings': true }, before: tone })
    await pc.p.waitForSelector('.rail-nav-row', { timeout: 15000 })
    await pc.p.locator('.rail-nav-btn', { hasText: 'Meetings' }).click()
    await pc.p.locator('.mt-view .pane-head button', { hasText: 'Start recording' }).click({ timeout: 10000 })
    await pc.p.waitForSelector('.mt-recbar', { timeout: 15000 }).catch(() => {})
    const R = (await until(async () => (await api('/meetings')).meetings.find((x) => x.status === 'recording'), 10000))?.id
    const ph = await page(b, kit.url, { phone: true })
    await ph.p.waitForSelector('.tabbar button', { timeout: 15000 }).catch(() => {})
    await sleep(5000) // (the computer's page follows the server once its recording has been going a few seconds)
    await open(ph.p, R)
    const there = ph.p.locator('.mt-elsewhere')
    ok(!!(await until(async () => (await there.locator('button', { hasText: 'Stop' }).count()) === 1 && (await there.locator('button', { hasText: 'Pause' }).count()) === 1, 10000)), 'the phone: a meeting the computer records has Pause and Stop', await ph.p.locator('.mt-view').first().innerText().catch(() => ''))
    const tops = await there.locator('button').evaluateAll((bs) => bs.map((x) => Math.round(x.getBoundingClientRect().top)))
    ok(tops.length === 2 && tops[0] === tops[1], 'side by side', tops)
    await shot(ph.p, `${tag}edges-elsewhere-phone`)
    await there.locator('button', { hasText: 'Pause' }).click()
    ok(!!(await until(async () => /Paused/.test(await pc.p.locator('.mt-recbar').innerText().catch(() => '')), 10000)), 'Pause on the phone: the computer\'s recording pauses', await pc.p.locator('.mt-recbar').innerText().catch(() => ''))
    await there.locator('button', { hasText: 'Stop' }).click()
    ok(!!(await until(async () => (await pc.p.locator('.mt-recbar').count()) === 0 && !(await api('/meetings')).meetings.some((x) => x.status === 'recording' || x.status === 'paused'), 12000)), 'Stop on the phone: the computer stops recording', await pc.p.locator('.mt-view').first().innerText().catch(() => ''))
    ok(withoutCutOff([...pc.errors, ...ph.errors]).length === 0, 'from the phone: no page errors', [...pc.errors, ...ph.errors])
    await pc.ctx.close(); await ph.ctx.close()
  }

  // ---------- In another language ----------
  // The summary's Template, in German: the kinds of meeting by their German names, none in English.
  {
    const K = await recorded('Kundengespräch mit Northwind', 'Wir beginnen mit der Preisliste.')
    const { ctx, p, errors } = await page(b, kit.url, { store: { 'cc-lang': 'de' } })
    await p.waitForSelector('.rail-nav-row', { timeout: 15000 })
    await open(p, K)
    await p.locator('.seg button[data-view="summary"]').click({ timeout: 8000 }).catch(() => {})
    const names = await until(async () => { const o = await p.locator('.mt-tools select option[value="customer"]').count() ? await p.locator('.mt-tools select:has(option[value="customer"]) option').allInnerTexts() : null; return o?.length ? o : null }, 8000)
    const en = ['Any meeting', 'Standup', 'Customer call', 'Interview', 'Brainstorm']
    ok(!!names && names.length === 6 && names.includes('Allgemein') && names.includes('Kundengespräch') && !names.some((x) => en.includes(x)), 'German: the Template\'s kinds of meeting in German, none in English', names)
    // The header in German, in a 1280 px window: the views' longer names would squeeze the meeting's
    // name out of it, so they go to icons; wider, they come back, with room for the name too.
    const head = async () => p.evaluate(() => {
      const h = document.querySelector('.mt-view > .pane-head')
      return { title: Math.round(h.querySelector('.pane-title').getBoundingClientRect().width), name: h.querySelector('.mt-title')?.value || '', names: [...h.querySelectorAll('.seg button span')].filter((s) => s.offsetWidth > 0).length, over: h.scrollWidth > h.clientWidth + 1 }
    })
    await p.setViewportSize({ width: 1280, height: 900 })
    let h = await until(async () => { const x = await head(); return x.title >= 140 && x }, 5000)
    ok(!!h && /Kundengespräch/.test(h.name) && h.names === 0 && !h.over, 'German at 1280 px: the views as icons, the meeting\'s name kept in the header', h || await head())
    await shot(p, `${tag}edges-header-de-1280`)
    await p.setViewportSize({ width: 1700, height: 900 })
    h = await until(async () => { const x = await head(); return x.names > 0 && x }, 5000)
    ok(!!h && h.title >= 140 && !h.over, 'and at 1700 px, the views\' names again, with the name', h || await head())
    ok(withoutCutOff(errors).length === 0, 'German: no page errors', errors)
    await ctx.close()
  }
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  console.log(kit.log().slice(-1500))
} finally {
  await b.close()
  for (const r of held.splice(0)) r.destroy()
  proxy.close()
  kit.stop(); model.stop()
}
process.exit(done().fail ? 1 : 0)
