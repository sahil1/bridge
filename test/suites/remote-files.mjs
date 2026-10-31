// A file on another device, seen and played here. Two Bridge AIs ("Studio", where an agent works in
// a folder of renders, and "Laptop"), each on its own relay (stand-ins/relay.mjs), linked; and a
// phone paired with Studio through its relay. Checked:
//   the file route: a part of a file (Range: 206, Content-Range), a seek, a part past the end (416),
//   nothing outside the agent's folder, a download;
//   through Laptop's /m/ and through the phone's encrypted link: the same bytes, and a big file read
//   by a reader that stopped (a paused video) stays on Studio instead of piling up on the way (it
//   all came at once: 500 MB in a few seconds);
//   on a phone's network, a request made during a big download is answered in about half a second
//   (it waited behind the whole file);
//   the iPhone app (its bridgeNative stood in for): WebKit's many small asks for a video are answered
//   from a few blocks read over the link, not a trip each;
//   the viewer, on Laptop and on the phone: a video playing and seeking, a sound, a PDF, a big
//   picture, a picture or a video this browser can't show (said plainly, with the download), text,
//   anything else to download, with its progress.
// A <video> really plays in Chromium. WebKit's test build plays one too on a Mac; where it can't play
// an MP4 at all, that's skipped and said.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { startKit, startRelay, checks, until, browser, sleep, shot, TEST } from '../lib/harness.mjs'

const { ok, skip, done } = checks('remote-files')
const { b, which } = await browser()
const tag = which === 'webkit' ? 'webkit-' : ''
const say = (...a) => console.log(...a)
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const MB = 1024 * 1024

// ---------- the files ----------
// A picture 4000 by 3000, made here (a PNG of one colour, small on disk).
function png(w, h) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]) }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.alloc(1 + w * 3)
  for (let x = 0; x < w; x++) row.set([40, 120, 200], 1 + x * 3)
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
// A second of a tone, as a WAV.
function wav(seconds = 1.5, rate = 22050) {
  const n = Math.round(seconds * rate)
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), 44 + i * 2)
  return b
}
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 24 Tf 40 100 Td (Hello PDF) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
// Bytes that differ everywhere, so a part read from the wrong place shows.
const pattern = (n) => { const out = Buffer.alloc(n); let x = 1; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; out[i] = x >>> 24 } return out }

const relays = []
const kits = []
try {
  const ra = await startRelay('remote-files-studio')
  const rb = await startRelay('remote-files-laptop')
  relays.push(ra, rb)
  const kitWith = async (name, rel) => {
    const k = await startKit(`remote-files-${name.toLowerCase()}`, { env: ({ data }) => { fs.writeFileSync(path.join(data, 'relay.json'), JSON.stringify(rel.relayFile)); return { BRIDGE_COMPUTER_NAME: name } } })
    kits.push(k)
    await k.api('/setup', { name: 'Tester' })
    return k
  }
  const a = await kitWith('Studio', ra)
  const lap = await kitWith('Laptop', rb)
  ok(!!(await until(async () => (await a.api('/relay')).online && (await lap.api('/relay')).online, 20000)), 'each is connected to its own relay')
  const relayTest = (rel, what, q = '') => fetch(`${rel.url}/_test/${what}${q}`, { method: what === 'state' ? 'GET' : 'POST' }).then((r) => r.json())

  // An agent at work in a folder of renders on Studio.
  const work = path.join(a.home, 'renders')
  fs.mkdirSync(work, { recursive: true })
  const clip = fs.readFileSync(path.join(TEST, 'fixtures', 'clip.mp4'))
  const files = {
    'clip.mp4': clip,
    'tone.wav': wav(),
    'doc.pdf': Buffer.from(PDF),
    'wide.png': png(4000, 3000),
    'photo.heic': pattern(4096), // not a real HEIC: no browser shows it
    'broken.mp4': pattern(8192), // not a video at all
    'notes.md': Buffer.from('# Render notes\n\nThe *second* cut is better.\n'),
    'icon.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'),
    'pattern.bin': pattern(3 * MB),
  }
  for (const [n, buf] of Object.entries(files)) fs.writeFileSync(path.join(work, n), buf)
  const HUGE = 500 * MB
  fs.closeSync(fs.openSync(path.join(work, 'huge.bin'), 'w'))
  fs.truncateSync(path.join(work, 'huge.bin'), HUGE) // sparse where it can be: nothing written
  fs.writeFileSync(path.join(a.data, 'secret.txt'), 'not for the agent')
  try { fs.symlinkSync(a.data, path.join(work, 'escape'), process.platform === 'win32' ? 'junction' : 'dir') } catch { /* no links here */ }
  a.program('claude', fs.readFileSync(path.join(TEST, 'stand-ins', 'claude.cjs'), 'utf8'))
  await a.api('/agents/catalog') // looked for again: the server looked before the stand-in was there
  const pane = (await a.api('/agents/launch', { kind: 'claude', cwd: work, label: 'Renders', newSpace: 'Renders' })).paneId
  const enc = encodeURIComponent
  const raw = (base, name, q = '') => `${base}/api/agents/${enc(pane)}/raw?path=${enc(name)}${q}`

  // ---------- the file route ----------
  const get = async (url, headers = {}) => { const r = await fetch(url, { headers }); return { r, body: Buffer.from(await r.arrayBuffer()) } }
  let x = await get(raw(a.url, 'pattern.bin'), { range: 'bytes=10-19' })
  ok(x.r.status === 206 && x.r.headers.get('content-range') === `bytes 10-19/${3 * MB}` && x.r.headers.get('accept-ranges') === 'bytes' && x.body.equals(files['pattern.bin'].subarray(10, 20)), 'the file route answers a part of a file: 206, its range, those bytes', { s: x.r.status, cr: x.r.headers.get('content-range') })
  x = await get(raw(a.url, 'pattern.bin'), { range: `bytes=${2 * MB}-` })
  ok(x.r.status === 206 && x.body.length === MB && x.body.equals(files['pattern.bin'].subarray(2 * MB)), 'a seek: from the middle to the end, the right bytes')
  x = await get(raw(a.url, 'pattern.bin'), { range: `bytes=${5 * MB}-` })
  ok(x.r.status === 416 && x.r.headers.get('content-range') === `bytes */${3 * MB}`, 'a part past the end: 416, saying how long the file is', { s: x.r.status, cr: x.r.headers.get('content-range') })
  x = await get(raw(a.url, 'clip.mp4'), { range: 'bytes=0-1' })
  ok(x.r.headers.get('content-type') === 'video/mp4' && /media-src 'self'/.test(x.r.headers.get('content-security-policy') || ''), 'a video comes as a video (video/mp4), and may load its own parts when opened on its own', x.r.headers.get('content-type'))
  x = await get(raw(a.url, 'icon.svg'))
  ok(/sandbox/.test(x.r.headers.get('content-security-policy') || ''), 'a picture that can carry script (SVG) is still served sandboxed', x.r.headers.get('content-security-policy'))
  const outside = await Promise.all(['../.bridge-ai/secret.txt', 'escape/secret.txt', path.join(a.data, 'secret.txt')].map(async (p) => { const y = await get(raw(a.url, p)); return y.r.status === 404 && !y.body.toString().includes('not for the agent') }))
  ok(outside.every(Boolean), 'nothing outside the agent\'s folder: a path up, a link out of it, a full path', outside)
  x = await get(raw(a.url, 'pattern.bin', '&download=1'))
  ok(/attachment; filename="?pattern\.bin"?$/.test(x.r.headers.get('content-disposition') || '') && x.body.equals(files['pattern.bin']), 'a download: the whole file, saved under its name', x.r.headers.get('content-disposition'))
  const kinds = {}
  for (const n of ['clip.mp4', 'tone.wav', 'photo.heic', 'huge.bin', 'doc.pdf']) kinds[n] = (await a.api(`/agents/${enc(pane)}/file?path=${enc(n)}`)).kind
  ok(kinds['clip.mp4'] === 'video' && kinds['tone.wav'] === 'audio' && kinds['photo.heic'] === 'image' && kinds['huge.bin'] === 'binary' && kinds['doc.pdf'] === 'pdf', 'the viewer is told what each is: a video, a sound, a picture, a PDF, anything else', kinds)

  // ---------- Laptop: Studio's files through the link (/m/) ----------
  const p = (await a.api('/relay/pair', {})).pairing
  await lap.api('/machines', { link: `${ra.url} ${p.code}` })
  const studio = await until(async () => (await lap.api('/machines')).machines.find((m) => m.name === 'Studio' && m.online), 30000, 300)
  ok(!!studio, 'Laptop is linked to Studio')
  const M = `${lap.url}/m/${studio.id}`
  x = await get(raw(M, 'pattern.bin'), { range: 'bytes=1000000-1000999' })
  ok(x.r.status === 206 && x.r.headers.get('content-range') === `bytes 1000000-1000999/${3 * MB}` && x.body.equals(files['pattern.bin'].subarray(1000000, 1001000)), 'through the link: a part of the file, the right bytes', { s: x.r.status, cr: x.r.headers.get('content-range') })
  x = await get(raw(M, 'pattern.bin'))
  ok(x.r.status === 200 && sha(x.body) === sha(files['pattern.bin']) && Number(x.r.headers.get('content-length')) === 3 * MB, 'through the link: the whole file, the same bytes, its length said first (a download\'s progress)', { s: x.r.status, len: x.r.headers.get('content-length') })
  // A reader that stops (a paused video): what Studio sends stops too, a little ahead of it.
  await relayTest(ra, 'count')
  const paused = await new Promise((resolve) => {
    const req = http.get(raw(M, 'huge.bin'), (res) => {
      let got = 0
      res.on('data', (c) => { got += c.length; if (got > 128 * 1024) res.pause() })
      setTimeout(async () => { const st = await relayTest(ra, 'state'); res.destroy(); resolve({ s: res.statusCode, sent: st.sent.downBytes }) }, 4000)
    })
    req.on('error', (e) => resolve({ error: e.message }))
  })
  say(`Laptop, a reader that stopped: Studio sent ${(paused.sent / MB).toFixed(1)} MB of 500`)
  ok(paused.s === 200 && paused.sent < 24 * MB, `a reader that stopped: Studio sent ${(paused.sent / MB).toFixed(1)} MB of the 500 MB file, not all of it (limit 24)`, paused)
  await sleep(1500)
  const after = (await relayTest(ra, 'state')).sent.downBytes
  await sleep(1500)
  ok((await relayTest(ra, 'state')).sent.downBytes - after < MB, 'and once it goes, Studio stops sending')

  // ---------- the phone, paired with Studio ----------
  const code = (await a.api('/relay/pair', {})).pairing.code
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: which === 'chromium', hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true })
  await ctx.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-appearance', JSON.stringify({ mode: 'light', theme: 'sky', text: 'm' })) } catch { /* no storage */ } })
  const phone = await ctx.newPage()
  const errors = []
  phone.on('pageerror', (e) => errors.push(e.message))
  await phone.goto(`${ra.url}/#pair=${code}`, { waitUntil: 'commit' })
  const app = () => phone.frames().find((f) => f !== phone.mainFrame() && f.url().startsWith(ra.url))
  ok(!!(await until(() => app()?.evaluate(() => fetch('/api/version').then((r) => r.ok)), 30000, 200)), 'the phone is paired and Bridge AI is open in it')
  const fromPhone = (u, range) => app().evaluate(async ({ u, range }) => {
    const r = await fetch(u, { headers: range ? { range } : {} })
    const buf = new Uint8Array(await r.arrayBuffer())
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((v) => v.toString(16).padStart(2, '0')).join('')
    return { s: r.status, cr: r.headers.get('content-range'), n: buf.byteLength, hash }
  }, { u, range })
  const rel = (name, q) => raw('', name, q)
  x = await fromPhone(rel('pattern.bin'), 'bytes=2000000-2099999')
  ok(x.s === 206 && x.cr === `bytes 2000000-2099999/${3 * MB}` && x.hash === sha(files['pattern.bin'].subarray(2000000, 2100000)), 'on the phone, through the encrypted link: a part of the file, the right bytes', x)
  x = await fromPhone(rel('pattern.bin'))
  ok(x.s === 200 && x.hash === sha(files['pattern.bin']), 'and the whole file, the same bytes', x)

  // A reader on the phone that stopped. Chromium takes in only so much ahead of it; WebKit reads a
  // service worker's answer as fast as it comes whatever the page does (its video player stops by
  // itself), so there it's not a measure of the link.
  if (which === 'chromium') {
    await relayTest(ra, 'count')
    await app().evaluate((u) => fetch(u).then(async (r) => { const rd = r.body.getReader(); await rd.read(); window.__stopped = rd }), rel('huge.bin'))
    await sleep(5000)
    const sent = (await relayTest(ra, 'state')).sent.downBytes
    await app().evaluate(() => window.__stopped?.cancel())
    say(`phone, a reader that stopped: ${(sent / MB).toFixed(1)} MB came of 500`)
    ok(sent < 150 * MB, `a reader on the phone that stopped: ${(sent / MB).toFixed(1)} MB of the 500 MB file came, not all of it (limit 150)`, sent)
  } else skip('a reader on the phone that stopped', 'WebKit reads a service worker\'s answer as fast as it comes, whatever the page does')

  // A phone's network: a request made during a big download isn't stuck behind it.
  await relayTest(ra, 'net', '?ms=60&host=15&kbps=8000')
  await sleep(500)
  const asks = () => app().evaluate(async () => { const t = []; for (let i = 0; i < 4; i++) { const c = new AbortController(); const tm = setTimeout(() => c.abort(), 6000); const t0 = performance.now(); try { await (await fetch('/api/version', { signal: c.signal })).arrayBuffer(); t.push(performance.now() - t0) } catch { t.push(6000) } clearTimeout(tm) } return t.map(Math.round) })
  const quiet = await asks()
  await app().evaluate((u) => { window.__got = 0; window.__dl = new AbortController(); window.__t0 = performance.now(); fetch(u, { signal: window.__dl.signal }).then(async (r) => { const rd = r.body.getReader(); for (;;) { const y = await rd.read(); if (y.done) break; window.__got += y.value.byteLength } }).catch(() => {}) }, rel('huge.bin'))
  await sleep(2500)
  const busy = await asks()
  const rate = await app().evaluate(() => { const r = (window.__got * 8) / (performance.now() - window.__t0) / 1000; window.__dl.abort(); return r })
  await relayTest(ra, 'net')
  const avg = (l) => Math.round(l.reduce((s, v) => s + v, 0) / l.length)
  say(`phone's network: a request takes ${avg(quiet)} ms, ${avg(busy)} ms during a download going at ${rate.toFixed(1)} Mbit/s`)
  ok(avg(busy) < 1500, `during a big download, a request is answered in ${avg(busy)} ms (${avg(quiet)} without it; limit 1500)`, busy)
  ok(rate > 3, `and the download still goes at ${rate.toFixed(1)} Mbit/s of the 8 there are (limit 3)`, rate)
  await sleep(1500)

  // A <video> from Studio, on the phone: it plays and seeks.
  const plays = (frame, u) => frame.evaluate(async (u) => {
    const v = document.createElement('video')
    if (!v.canPlayType('video/mp4')) return { none: true }
    v.muted = true
    v.playsInline = true
    v.src = u
    document.body.append(v)
    const ev = (name, ms = 12000) => new Promise((res) => { const t = setTimeout(() => res(false), ms); v.addEventListener(name, () => { clearTimeout(t); res(true) }, { once: true }); v.addEventListener('error', () => { clearTimeout(t); res(false) }, { once: true }) })
    const started = v.play().then(() => true, () => false)
    const playing = await ev('playing')
    await started
    await new Promise((r) => setTimeout(r, 800))
    const at = v.currentTime
    v.currentTime = 2.2
    const seeked = await ev('seeked')
    const out = { playing, at, seeked, after: v.currentTime, error: v.error?.code || null }
    v.remove()
    return out
  }, u)
  x = await plays(app(), rel('clip.mp4'))
  if (x.none) skip('a video from Studio plays on the phone', `this ${which} build plays no MP4`)
  else ok(x.playing && x.at > 0.2 && x.seeked && x.after >= 2, 'a video from Studio plays on the phone, and seeks', x)

  // ---------- the iPhone app (stood in for), and WebKit's small asks ----------
  {
    const c = await b.newContext({ viewport: { width: 390, height: 844 } })
    await c.addInitScript(() => { if (window !== window.top) return; window.__posts = []; window.bridgeNative = { platform: 'ios', bundled: [], relay: location.origin, pairing: null, computers: [], post: (m) => window.__posts.push(m) } })
    await c.route('**/*', (r) => (r.request().isNavigationRequest() && r.request().frame().parentFrame() ? r.fulfill({ contentType: 'text/html', body: '<p>Bridge AI</p>' }) : r.continue()))
    const ip = await c.newPage()
    await ip.goto(`${ra.url}/#pair=${(await a.api('/relay/pair', {})).pairing.code}`)
    const paired = await until(() => ip.evaluate(() => window.__posts.some((m) => m.type === 'keep' && m.pairing?.hostKey)), 20000, 200)
    ok(!!paired, 'the iPhone app (stood in for) is paired with Studio')
    // As WebKit asks for a video: two bytes, then piece after piece, each a few kilobytes.
    await relayTest(ra, 'count')
    const asked = await ip.evaluate(async (u) => {
      const one = (rid, range) => new Promise((res) => {
        const parts = []
        let head = null
        const t = setInterval(() => {
          for (const m of window.__posts.splice(0)) {
            if (m.type !== 'res') continue
            if (m.id !== rid) { window.__posts.push(m); continue }
            if (m.head) head = m.head
            else if (m.chunk) parts.push(Uint8Array.from(atob(m.chunk), (ch) => ch.charCodeAt(0)))
            else if (m.end || m.error) { clearInterval(t); const n = parts.reduce((s, p) => s + p.length, 0); const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length } res({ head, body: all, error: m.error || null }) }
          }
        }, 5)
        window.bridgeTunnel(rid, { m: 'GET', u, h: [['Accept', '*/*'], ['Range', range]] })
      })
      const out = []
      let rid = 1000
      const ranges = ['bytes=0-1', ...Array.from({ length: 120 }, (_, i) => `bytes=${i * 6000}-${i * 6000 + 5999}`), `bytes=${3 * 1048576 - 100}-${3 * 1048576 - 1}`]
      for (const r of ranges) {
        const y = await one(rid++, r)
        out.push({ r, s: y.head?.s, cr: (y.head?.h || []).find(([k]) => k.toLowerCase() === 'content-range')?.[1], n: y.body.length, first: y.body[0], last: y.body[y.body.length - 1], error: y.error })
      }
      return out
    }, rel('pattern.bin'))
    const pat = files['pattern.bin']
    const right = asked.every((y) => { const [, s, e] = /bytes=(\d+)-(\d+)/.exec(y.r).map(Number); return y.s === 206 && y.cr === `bytes ${s}-${e}/${3 * MB}` && y.n === e - s + 1 && y.first === pat[s] && y.last === pat[e] })
    const up = (await relayTest(ra, 'state')).sent.up
    say(`the iPhone app: ${asked.length} small asks, ${up} messages to Studio`)
    ok(right, `${asked.length} small asks of a file, as WebKit makes them for a video: each answered 206 with its own bytes`, asked.filter((y) => y.s !== 206).slice(0, 3))
    ok(up < 40, `and they took ${up} messages to Studio, not one trip each (limit 40)`, up)
    await c.close()
  }

  // ---------- the viewer ----------
  // On a page: open the agent's Files at a file.
  const openAt = async (frame, name) => {
    await frame.evaluate(({ pane, name }) => window.dispatchEvent(new CustomEvent('cc-set-view', { detail: { paneId: pane, view: 'files', path: name } })), { pane, name })
    return frame.locator('.viewer .crumbs b', { hasText: name }).first().waitFor({ timeout: 15000 }).then(() => true, () => false)
  }
  const viewer = async (frame, label, prefix) => {
    const where = `${label}: `
    await frame.waitForFunction(() => !!document.querySelector('.app'), null, { timeout: 30000 }).catch(() => {})
    await frame.evaluate((pane) => window.dispatchEvent(new CustomEvent('bridge-open-agent', { detail: { paneId: pane } })), pane)
    await sleep(800)
    // A video: the browser's own player, playing from Studio.
    ok(await openAt(frame, 'clip.mp4'), `${where}the viewer opens the video`)
    const v = frame.locator('.media-view video')
    await v.waitFor({ timeout: 15000 }).catch(() => {})
    const vid = await v.evaluate(async (el) => {
      if (!el.canPlayType('video/mp4')) return { none: true }
      el.muted = true
      await el.play().catch(() => {})
      const t0 = Date.now()
      while (el.currentTime < 0.3 && !el.error && Date.now() - t0 < 12000) await new Promise((r) => setTimeout(r, 100))
      return { t: el.currentTime, controls: el.controls, error: el.error?.code || null, w: el.videoWidth }
    }).catch((e) => ({ error: e.message }))
    if (vid.none) skip(`${where}the video plays in the viewer`, `this ${which} build plays no MP4`)
    else ok(vid.t >= 0.3 && vid.controls && vid.w === 160, `${where}the video plays in the viewer, with the browser's controls`, vid)
    await shot(frame.page(), `${tag}${prefix}-video`)
    // A sound.
    await openAt(frame, 'tone.wav')
    const snd = await frame.locator('.media-view audio').evaluate(async (el) => {
      const t0 = Date.now()
      while (!(el.duration > 0) && !el.error && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100))
      return { d: el.duration, error: el.error?.code || null, controls: el.controls }
    }).catch((e) => ({ error: e.message }))
    ok(snd.d > 1.4 && snd.d < 1.6 && snd.controls, `${where}a sound, in the browser's own player`, snd)
    // A PDF and a big picture.
    await openAt(frame, 'doc.pdf')
    ok(await frame.locator('iframe.pdf-view').waitFor({ timeout: 10000 }).then(() => true, () => false), `${where}a PDF, in the browser's own viewer`)
    await openAt(frame, 'wide.png')
    const pic = await until(() => frame.locator('.img-view img').evaluate((el) => (el.complete && el.naturalWidth ? el.naturalWidth : 0)).catch(() => 0), 15000, 200)
    ok(pic === 4000, `${where}a picture 4000 wide`, pic)
    // What this browser can't show: said plainly, with the download.
    await openAt(frame, 'photo.heic')
    const heic = await frame.locator('.media-cant').innerText({ timeout: 10000 }).catch(() => '')
    ok(/can't show HEIC pictures/.test(heic) && /Download to this device|Save to Files/.test(heic), `${where}a picture this browser can't show says so, and offers it`, heic)
    await openAt(frame, 'broken.mp4')
    const cant = await frame.locator('.media-cant').innerText({ timeout: 15000 }).catch(() => '')
    ok(/can't play MP4 files like this one/.test(cant) && /Download to this device/.test(cant), `${where}a video this browser can't play says so, and offers it`, cant)
    await openAt(frame, 'notes.md')
    ok(await frame.locator('.md-view h1', { hasText: 'Render notes' }).waitFor({ timeout: 10000 }).then(() => true, () => false), `${where}Markdown, as it reads`)
    // Anything else: Download to this device.
    await openAt(frame, 'huge.bin')
    const other = await frame.locator('.other-file').innerText({ timeout: 10000 }).catch(() => '')
    ok(/huge\.bin/.test(other) && /500\.0 MB/.test(other) && /Download to this device/.test(other), `${where}any other file: what it is, how big, and Download to this device`, other)
    const wide = await frame.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    ok(wide <= 1, `${where}nothing wider than the window`, wide)
  }

  // Laptop's window, Studio's agent in it (/m/), at a desktop's width.
  const desk = await b.newContext({ viewport: { width: 1280, height: 820 }, acceptDownloads: true })
  await desk.addInitScript(() => { try { localStorage.setItem('cc-toured', JSON.stringify({ desktop: true, phone: true })); localStorage.setItem('cc-appearance', JSON.stringify({ mode: 'light', theme: 'sky', text: 'm' })) } catch { /* no storage */ } })
  // Where the browser can write a file you pick (Chromium), that's stood in for: it keeps what's written.
  await desk.addInitScript(() => {
    if (typeof window.showSaveFilePicker !== 'function') return
    window.__saved = { n: 0, closed: false, name: null }
    window.showSaveFilePicker = async ({ suggestedName }) => {
      window.__saved.name = suggestedName
      return { createWritable: async () => ({ write: async (b) => { window.__saved.n += b.byteLength; window.__saved.parts = (window.__saved.parts || 0) + 1 }, close: async () => { window.__saved.closed = true }, abort: async () => {} }) }
    }
  })
  const lp = await desk.newPage()
  lp.on('pageerror', (e) => errors.push(e.message))
  await lp.goto(`${M}/`)
  await viewer(lp.mainFrame(), 'on Laptop', 'remote-files-laptop')
  // Download to this device, with its progress.
  await openAt(lp.mainFrame(), 'pattern.bin')
  if (await lp.evaluate(() => !!window.__saved)) {
    await lp.locator('.other-file button', { hasText: 'Download to this device' }).click()
    const saved = await until(() => lp.evaluate(() => (window.__saved.closed ? window.__saved : null)), 20000, 100)
    const said = await lp.locator('.other-file').innerText().catch(() => '')
    ok(saved?.n === 3 * MB && saved.name === 'pattern.bin' && /Downloaded/.test(said), 'Download to this device: written where you picked, all of it, then "Downloaded"', { saved, said })
  } else {
    const dl = lp.waitForEvent('download', { timeout: 20000 }).catch(() => null)
    await lp.locator('.other-file button', { hasText: 'Download to this device' }).click()
    const d = await dl
    const file = d && await d.path().catch(() => null)
    ok(!!file && d.suggestedFilename() === 'pattern.bin' && sha(fs.readFileSync(file)) === sha(files['pattern.bin']), 'Download to this device: the browser\'s own download, the whole file under its name', d?.suggestedFilename())
  }

  // Open in new tab: the video on its own, playing (its player asks for it again, in parts).
  const tab = await desk.newPage()
  await tab.goto(raw(M, 'clip.mp4'))
  const own = await tab.evaluate(async () => {
    const v = document.querySelector('video')
    if (!v || !v.canPlayType('video/mp4')) return { none: true }
    v.muted = true
    await v.play().catch(() => {})
    const t0 = Date.now()
    while (v.currentTime < 0.3 && !v.error && Date.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 100))
    return { t: v.currentTime, error: v.error?.code || null }
  }).catch((e) => ({ error: e.message }))
  if (own.none) skip('the video opened in a tab of its own plays', `this ${which} build plays no MP4`)
  else ok(own.t >= 0.3, 'Open in new tab: the video on its own plays there', own)
  await tab.close()

  // The phone: the same viewer, at a phone's width, in the phone page's frame.
  await viewer(app(), 'on the phone', 'remote-files-phone')
  ok(!errors.length, 'no page errors', errors.slice(0, 3))
} catch (e) {
  ok(false, `crashed: ${e.stack}`)
  for (const k of kits) console.log(k.log().slice(-1500))
} finally {
  for (const k of kits) k.stop()
  for (const r of relays) r.stop()
  await b.close().catch(() => {})
}
process.exit(done().fail ? 1 : 0)
