// The phone page the apps run is their own, and Bridge AI's relay's pairing links open them (checked
// from the apps' files on any platform; the apps themselves are built by CI). Android: the build
// writes the page into the app's assets with `node relay/build.js --page`, which writes exactly the
// files the relay serves; the app serves each at the address the relay does, with the relay's
// Content-Security-Policy, lets only /_relay/health through to the relay and answers anything else
// with a 404 of its own, to the page and its service worker alike. window.bridgeAndroid is a message
// channel offered only to the relay showing now and the bundled UIs, with every call the pages make,
// and no JavaScript interface; the app answers the page only from its main frame, a frame only that
// a meeting is recording. Both apps claim *.<the hosted relay's domain> (Android verified, iOS
// with #pair= alone), with the same app ids the relay names, and pair from the link. Then, in the
// browser named by BRIDGE_TEST_BROWSER: the phone page on Bridge AI's relay (<id>.localhost, as
// when it's tried on a computer) says before pairing that its code comes from the relay, with the
// iPhone and Android apps a tap away, until it's dismissed; on a relay of your own and in the apps,
// it says nothing.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import WebSocket from 'ws'
import { ROOT, checks, startRelay, browser, until, shot } from '../lib/harness.mjs'
import { pageFiles } from '../../relay/build.js'

const { ok, skip, done } = checks('phone-apps')
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n')
const ANDROID = ['mobile', 'android', 'app']
const KT = [...ANDROID, 'src', 'main', 'java', 'dev', 'bridgeai', 'phone']
const main = read(...KT, 'MainActivity.kt')
const page = read(...KT, 'RelayPage.kt')
const gradle = read(...ANDROID, 'build.gradle.kts')
const manifest = read(...ANDROID, 'src', 'main', 'AndroidManifest.xml')
const worker = read('relay', 'worker.js')
const toml = read('relay', 'wrangler.hosted.toml')
const shell = read('relay', 'web', 'shell.js')
const yml = read('mobile', 'ios', 'project.yml')
const app = read('mobile', 'ios', 'BridgeAI', 'App.swift')
const wvc = read('mobile', 'ios', 'BridgeAI', 'WebViewController.swift')
const vars = Object.fromEntries([...toml.matchAll(/^([A-Z0-9_]+) = "([^"]*)"/gm)].map((m) => [m[1], m[2]]))
const DOMAIN = vars.HOSTED_DOMAIN

let relay = null
let host = null
let b = null
try {
  // ---------- Android: the page is the app's own ----------
  const files = pageFiles()
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-page-'))
  const built = spawnSync(process.execPath, [path.join(ROOT, 'relay', 'build.js'), '--page', path.join(out, 'relay')], { encoding: 'utf8' })
  const wrote = built.status === 0 ? fs.readdirSync(path.join(out, 'relay')).sort() : []
  const same = wrote.every((n) => { const f = files[n]; const got = fs.readFileSync(path.join(out, 'relay', n)); return f && got.equals(f.b64 ? Buffer.from(f.b64, 'base64') : Buffer.from(f.text, 'utf8')) })
  ok(built.status === 0 && wrote.join() === Object.keys(files).sort().join() && same, '`node relay/build.js --page` writes the phone page\'s files, byte for byte as the relay serves them, and nothing else', { status: built.status, err: built.stderr?.slice(-300), wrote })
  fs.rmSync(out, { recursive: true, force: true })
  ok(/class BuildRelayPage/.test(gradle) && /node relay\/build\.js --page '\$\{out\.resolve\("relay"\)\}'/.test(gradle) && /addGeneratedSourceDirectory\(page, BuildRelayPage::outputDir\)/.test(gradle) && /root\.dir\("relay\/web"\)/.test(gradle), 'the Android build writes it into the app\'s assets, under relay/, rebuilt when relay/web changes', null)
  const own = Object.fromEntries([...page.matchAll(/^\s+"(\/[^"]*)" to "([^"]+)",$/gm)].map((m) => [m[1], m[2]]))
  const served = Object.keys(files).every((n) => own[`/${n}`] === n) && own['/'] === 'index.html' && Object.values(own).every((n) => n in files)
  ok(served, 'the app serves each of those files at the address the relay serves it at, / as index.html, and no other', own)
  const csp = /'Content-Security-Policy': "([^"]+)"/.exec(worker)?.[1]
  ok(!!csp && page.includes(`const val CSP = "${csp}"`) && /if \(name == "index\.html"\) headers\["Content-Security-Policy"\] = CSP/.test(page), 'with the relay\'s own Content-Security-Policy on the page', csp)
  ok(/private val RELAYS_OWN = setOf\("\/_relay\/health"\)/.test(page) && /if \(path in RELAYS_OWN\) return null/.test(page) && /if \(name == null \|\| \(method != null && method != "GET"\)\) return missing\(\)/.test(page) && /404, "Not found"/.test(page), 'only /_relay/health goes to the relay; anything else at a relay\'s address is a 404 from the app (the WebSocket never comes here)', null)
  ok(/RelayPage\.isRelay\(this@MainActivity, request\.url\) -> RelayPage\.serve\(/.test(main) && /setServiceWorkerClient\(object : ServiceWorkerClient\(\)/.test(main) && /if \(RelayPage\.isRelay\(app, request\.url\)\) RelayPage\.serve\(app, request\.url, request\.method\)/.test(main), 'for the page and its service worker alike (sw.js, link-sw.js), at your relays\' addresses only', null)
  ok(/fun originOf/.test(page) && /relay = RelayPage\.originOf\(uri\)/.test(main), 'a relay is known by its origin, the same way the page and the app name it', null)

  // ---------- Android: window.bridgeAndroid, for the app's own pages only ----------
  ok(!/addJavascriptInterface|@JavascriptInterface/.test(main), 'there\'s no JavaScript interface: nothing every frame can reach', null)
  ok(/val rules = setOfNotNull\(own, BUNDLED_ORIGIN, CloudBridge\.ORIGIN\)/.test(main) && /WebViewCompat\.addWebMessageListener\(w, PORT, rules, PageBridge\(\)\)/.test(main) && /WebViewCompat\.addDocumentStartJavaScript\(w, bridgeJs\(own\), rules\)/.test(main), 'the channel is offered to the relay showing now and the bundled UIs alone, before each page loads', null)
  const handler = main.slice(main.indexOf('override fun onPostMessage'), main.indexOf('// The agents at work, for the lock screen'))
  const frameAt = handler.indexOf('if (!isMainFrame) return')
  const recAt = handler.indexOf('if (type == "recording")')
  ok(recAt > 0 && frameAt > recAt && handler.indexOf('"forget" ->') > frameAt && handler.indexOf('if (origin == null || origin != relay) return') > frameAt && /if \(type == "home" && showingBundled\) leaveBundled\(\)\s+return/.test(handler), 'the app answers the page only from its main frame at the relay showing now (a frame can only say a meeting is recording; a bundled UI only go back to the start)', null)
  const js = main.slice(main.indexOf('private fun bridgeJs'), main.indexOf('// The list changed'))
  const calls = new Set([...shell.matchAll(/\bandroid\.(\w+)\??\.?\(/g), ...shell.matchAll(/window\.bridgeAndroid\??\.(\w+)/g)].map((m) => m[1]))
  for (const f of ['src/App.jsx', 'src/demo/DemoBar.jsx', 'src/components/meetings/recording.jsx']) for (const m of read(f).matchAll(/window\.bridgeAndroid\??\.(\w+)/g)) calls.add(m[1])
  const missing = [...calls].filter((c) => !new RegExp(`\\b${c}[:,]`).test(js))
  ok(calls.size >= 12 && !missing.length, 'its script gives every call the pages make (relay/web/shell.js, Bridge AI\'s frame and the bundled UIs)', { calls: [...calls], missing })
  ok(/if \(window !== window\.top\) \{ window\.bridgeAndroid = \{ recording \}; return \}/.test(js) && /home: \(\) => post\('home'\), recording \}; return \}/.test(js), 'and a frame gets only recording, a bundled UI only home', null)

  // ---------- Pairing links open the apps ----------
  ok(DOMAIN === 'boldbridge.app', 'the hosted relay\'s domain', DOMAIN)
  const filter = /<intent-filter android:autoVerify="true">([\s\S]*?)<\/intent-filter>/.exec(manifest)?.[1] || ''
  ok(/android\.intent\.action\.VIEW/.test(filter) && /category\.BROWSABLE/.test(filter) && new RegExp(`<data android:scheme="https" android:host="\\*\\.${DOMAIN.replace(/\./g, '\\.')}" android:path="/" />`).test(filter), 'Android claims https://*.<domain>/, verified (autoVerify)', filter.trim())
  ok(main.includes(`private const val HOSTED_DOMAIN = "${DOMAIN}"`) && /host\.endsWith\("\.\$HOSTED_DOMAIN"\)/.test(main) && /pairingLinkIn\(intent\)\?\.let \{ return openLink\(it\) \}/.test(main) && (main.match(/pairingLinkIn\(intent\)/g) || []).length === 2, 'and takes such a link when it starts and while it runs, nothing from anywhere else', null)
  const appId = /applicationId = "([^"]+)"/.exec(gradle)?.[1]
  ok(!!appId && vars.ANDROID_PACKAGE === appId && 'ANDROID_CERT_SHA256' in vars, 'the relay names the Android app by its package (and the release key\'s SHA-256, set when it goes live)', { appId, pkg: vars.ANDROID_PACKAGE })
  ok(new RegExp(`com\\.apple\\.developer\\.associated-domains:\\s+- applinks:\\*\\.${DOMAIN.replace(/\./g, '\\.')}`).test(yml), 'iOS claims *.<domain> (project.yml entitlements)', null)
  const team = /DEVELOPMENT_TEAM: (\w+)/.exec(yml)?.[1]
  const bundle = /PRODUCT_BUNDLE_IDENTIFIER: (dev\.bridge-ai\.phone)\n/.exec(yml)?.[1]
  ok(!!team && vars.APPLE_APP_ID === `${team}.${bundle}`, 'and the relay names the iPhone app as <team>.<bundle id>', { team, bundle, set: vars.APPLE_APP_ID })
  ok(/connectionOptions\.userActivities\.first\(where: \{ \$0\.activityType == NSUserActivityTypeBrowsingWeb \}\)\?\.webpageURL/.test(app) && /func scene\(_ scene: UIScene, continue userActivity: NSUserActivity\)/.test(app) && /func openLink\(_ link: URL\) \{\s+if !usePairingLink\(link\.absoluteString\)/.test(wvc), 'the iPhone app pairs from the link, whether it starts the app or reaches it running', null)
  ok(shell.includes(`/\\.(${DOMAIN.replace(/\./g, '\\.')}|localhost)$/i`), 'the page knows the same domain for its note in a browser', null)

  // ---------- In a browser on Bridge AI's relay: the note before pairing ----------
  relay = await startRelay('phone-apps')
  // A computer on it (its connection alone), so the page shows the pairing screen, as it does when
  // the computer shows the code.
  host = new WebSocket(`${relay.url.replace(/^http/, 'ws')}/_relay/host`, { headers: { Authorization: `Bearer ${relay.token}` } })
  await new Promise((resolve, reject) => { host.once('open', resolve); host.once('error', reject) })
  ;({ b } = await browser())
  const which = process.env.BRIDGE_TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium'
  const tag = which === 'webkit' ? 'webkit-' : ''
  const errors = []
  const open = async (url, { ua } = {}) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ...(ua ? { userAgent: ua } : {}) })
    const p = await ctx.newPage()
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(url)
    return p
  }
  const pairing = (p) => until(() => p.locator('#pair').isVisible(), 15000)
  const mine = await open(`${relay.url}/`)
  ok(!!(await pairing(mine)) && (await mine.locator('#hosted-note').count()) === 0, 'on a relay of your own, the pairing screen says nothing about whose code it is', await mine.locator('#pair').innerText().catch(() => ''))
  const hosted = `http://abcdefgh2345.localhost:${relay.port}/`
  const reached = await open(hosted).catch((e) => ({ error: e.message }))
  if (reached.error) skip('the note on Bridge AI\'s relay', `${which} can't open a name under localhost here (${reached.error.slice(0, 80)})`)
  else {
    const p = reached
    const note = p.locator('#hosted-note')
    ok(!!(await pairing(p)) && !!(await until(() => note.isVisible(), 5000)), 'on Bridge AI\'s relay, in a browser, the pairing screen has the note', await p.locator('#pair').innerText().catch(() => ''))
    const text = await note.innerText()
    const links = await note.locator('a').evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href'), a.target]))
    ok(/In a browser, the code that encrypts this page comes from Bridge AI's relay\. The iPhone and Android apps carry their own\./.test(text) && !/warning|danger|unsafe|attack|steal|insecure/i.test(text), 'one calm line: the page\'s code comes from the relay, and the apps carry their own', text)
    ok(JSON.stringify(links) === JSON.stringify([['iPhone', 'https://boldbridge.ai/phone', '_blank'], ['Android', 'https://boldbridge.ai/#android', '_blank']]), 'with the iPhone and Android apps a tap away', links)
    const box = await note.boundingBox()
    ok(!!box && box.width <= 390 && (await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'it fits a 390 px phone', box)
    await shot(p, `${tag}phone-apps-hosted-note`)
    await note.getByRole('button', { name: 'Dismiss' }).click()
    ok(!!(await until(async () => (await note.count()) === 0, 3000)), 'Dismiss takes it away', null)
    await p.reload()
    await pairing(p)
    ok((await p.locator('#hosted-note').count()) === 0, 'and it stays away on that relay\'s site', null)
    const inApp = await open(hosted, { ua: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36 BridgeAIApp/3.14.0' })
    ok(!!(await pairing(inApp)) && (await inApp.locator('#hosted-note').count()) === 0, 'and in the apps (BridgeAIApp in the user agent) it never shows', null)
  }
  ok(!errors.length, 'no page errors', errors)
} catch (e) {
  ok(false, `the test ran to the end: ${e.stack}`)
} finally {
  await b?.close().catch(() => {})
  host?.terminate()
  relay?.stop()
}
process.exit(done().fail ? 1 : 0)
