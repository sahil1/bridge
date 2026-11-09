// Every outside host the app contacts is in the privacy policy. Reads server/, desktop/ and
// shared/ (not running anything) for every web address in the code, comments left out, and fails on
// one that PRIVACY.md doesn't cover: by name, or by a category it states ("the model provider you
// pick", "a check on GitHub for a newer version", "links … open in your browser"), each category's
// words checked in PRIVACY.md too, so taking them out of the policy fails as well. An address made
// at run time from what someone set (their own relay, their own model server, their tailnet) is
// allowed by its category for the file it's in, never by name. Then the check itself: one made-up
// new host in a file makes it fail, naming the file and the host.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, checks } from '../lib/harness.mjs'

const { ok, done } = checks('privacy-hosts')
const PRIVACY = fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8').replace(/\r\n/g, '\n')

// What PRIVACY.md says, by category, and the hosts each covers (* is any name below).
const CATEGORIES = {
  weather: { says: /the weather \(Open-Meteo/, hosts: ['api.open-meteo.com', 'geocoding-api.open-meteo.com'] },
  markets: {
    says: /market prices and news headlines \(Yahoo Finance, the Federal\s+Reserve and public news feeds\)/,
    hosts: ['finance.yahoo.com', '*.finance.yahoo.com', 'fred.stlouisfed.org', 'www.federalreserve.gov', 'feeds.arstechnica.com', 'feeds.content.dowjones.io', 'hn.algolia.com', 'news.ycombinator.com', 'search.cnbc.com', 'simonwillison.net', 'techcrunch.com', 'www.canarymedia.com', 'www.theverge.com', 'www.utilitydive.com'],
  },
  downloads: { says: /one download each from Hugging Face/, hosts: ['huggingface.co'] },
  updates: { says: /check on\s+GitHub for a newer version[\s\S]{0,200}the new version from GitHub/, hosts: ['api.github.com', 'github.com', 'raw.githubusercontent.com'] },
  installs: { says: /When you install something from Bridge AI, it comes from where it's published/, hosts: ['nodejs.org', 'claude.ai', 'chatgpt.com', 'antigravity.google', 'cursor.com', 'gh.io', 'github.com', 'dev.meta.ai', 'raw.githubusercontent.com'] },
  models: {
    says: /API key for a model provider[\s\S]{0,300}Both go straight from your computer to that provider/,
    hosts: ['api.anthropic.com', 'api.openai.com', 'generativelanguage.googleapis.com', 'oauth2.googleapis.com', 'aiplatform.googleapis.com', 'api.mistral.ai', 'api.groq.com', 'api.x.ai', 'api.deepseek.com', 'api.perplexity.ai', 'openrouter.ai', 'api.together.xyz', 'api.together.ai', 'api.fireworks.ai', 'api.cerebras.ai', 'api.cohere.ai', 'api.cohere.com', 'api.moonshot.ai', 'api.z.ai', 'api.meta.ai', 'router.huggingface.co'],
  },
  speech: { says: /unless you pick a speech service for\s+meetings/, hosts: ['api.assemblyai.com', 'api.deepgram.com', 'api.elevenlabs.io', 'api.openai.com', 'api.groq.com', 'api.mistral.ai', 'api.together.ai', 'generativelanguage.googleapis.com'] },
  cloudAgents: { says: /When you add a key for a cloud agent/, hosts: ['api.cursor.com', 'api.github.com', 'jules.googleapis.com', 'api.anthropic.com'] },
  relay: { says: /a small Cloudflare Worker on\s+your own Cloudflare account, with your Cloudflare sign-in/, hosts: ['api.cloudflare.com', '*.workers.dev'] },
  tailscale: { says: /If you use Tailscale instead/, hosts: [] },
  links: {
    says: /Links in Bridge AI \([^)]*\) open in your browser;\s+Bridge AI doesn't fetch them itself/,
    hosts: ['console.anthropic.com', 'platform.openai.com', 'aistudio.google.com', 'console.cloud.google.com', 'console.aws.amazon.com', 'ai.azure.com', 'console.mistral.ai', 'console.groq.com', 'console.x.ai', 'console.deepgram.com', 'platform.deepseek.com', 'platform.moonshot.ai', 'platform.claude.com', 'dashboard.cohere.com', 'cloud.cerebras.ai', 'fireworks.ai', 'elevenlabs.io', 'www.assemblyai.com', 'www.perplexity.ai', 'z.ai', 'lmstudio.ai', 'ollama.com', 'dev.meta.ai', 'cursor.com', 'github.com', 'jules.google.com', 'www.google.com', 'finance.yahoo.com', 'news.ycombinator.com'],
  },
  insights: { says: /\/insights report[\s\S]{0,120}Google Fonts/, hosts: ['fonts.googleapis.com', 'fonts.gstatic.com'] },
  self: { says: /It listens only on\s+your computer/, hosts: [] },
}
// Addresses made at run time from what someone set, by file: which category covers them.
const SET_BY_YOU = {
  'server/chatmodels.js': 'models', // a model provider's endpoint you give (Azure, Bedrock, your own server)
  'server/providers.js': 'models',
  'server/machines.js': 'relay', // another of your computers, through its relay
  'server/phone.js': 'tailscale', // this computer's name on your tailnet
  'server/index.js': 'self', // the address Bridge AI itself listens on
  // ...and the ones another of your computers' pages have on it (m-<id>.localhost, its own port)
  'server/machinepages.js': 'self',
  'shared/machinehost.js': 'self',
  'desktop/senders.js': 'self',
  'shared/cloud/cursor.js': 'cloudAgents', // a repo's address Cursor gave, read for its name
}
// Web addresses in the code that are names, never fetched.
const NOT_FETCHED = [
  ['https://www.googleapis.com/auth/', 'an OAuth scope\'s name'],
  ['https://opencode.ai/config.json', 'the $schema line of a config file Bridge AI writes for opencode'],
]
// Run when the desktop app is built, on the computer building it, not by the app.
const BUILD_ONLY = new Set(['desktop/notarize-app.js', 'desktop/notarize-dmg.js', 'desktop/sign.js', 'desktop/after-pack.js', 'desktop/stage.js', 'desktop/render-icons.js'])

// The code, as files: server/, desktop/ and shared/, without what's installed or built.
function files() {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = `${d}/${e.name}`
      if (e.isDirectory()) { if (!['node_modules', 'dist', 'build', 'out', 'release'].includes(e.name) && !e.name.startsWith('.')) walk(rel) } else if (/\.(js|mjs|cjs|json)$/.test(e.name) && e.name !== 'package-lock.json' && !BUILD_ONLY.has(rel)) out.push(rel)
    }
  }
  for (const d of ['server', 'desktop', 'shared']) walk(d)
  return out
}
// Comments out: /* … */ and // to the end of the line (a // in an address follows a colon).
const uncomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;,{}()])\/\/.*$/gm, '$1')

// Each web address's host, with ${…} kept where it's made at run time.
function hosts(text) {
  const out = []
  for (const m of text.matchAll(/\b(?:https?|wss?):\/\//g)) {
    let i = m.index + m[0].length
    let h = ''
    while (i < text.length) {
      // A template's ${…} at the start of a name (https://${region}.x.com), which may hold a template
      // of its own; one straight after a name is its path (https://x.com${path}).
      if (text.startsWith('${', i) && (!h || /[.-]$/.test(h))) {
        let depth = 0
        const at = i
        for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) { i++; break } }
        h += text.slice(at, i)
      } else if (/[A-Za-z0-9.\-_~%]/.test(text[i])) h += text[i++]
      else break
    }
    out.push({ host: h.toLowerCase(), url: text.slice(m.index, m.index + m[0].length + 80) })
  }
  return out
}
const LOCAL = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[\w.-]+\.localhost)$/
const EXAMPLE = /(^|\.)example\.(com|org|net)$|\.example$|\.test$|\.invalid$/
// A host made at run time is known by the name it ends in: https://${script}.${sub}.workers.dev is
// "*.workers.dev", https://${loc}-aiplatform.googleapis.com "aiplatform.googleapis.com" and below.
// With no name after its ${…}, what it is depends on what someone set (null).
const tail = (raw) => { const t = raw.slice(raw.lastIndexOf('}') + 1); const name = t.replace(/^[.-]+/, ''); return !name.includes('.') ? null : t.startsWith('.') ? `*.${name}` : name }
const matches = (host, pattern) => host === pattern || (pattern.startsWith('*.') && host.endsWith(pattern.slice(1)))

// What isn't covered, as "file: host", for the code given (or the repo's).
function uncovered(code = Object.fromEntries(files().map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')])), privacy = PRIVACY) {
  const stated = new Set(Object.entries(CATEGORIES).filter(([, c]) => c.says.test(privacy)).map(([k]) => k))
  const out = []
  const seen = new Set()
  for (const [file, src] of Object.entries(code)) {
    for (const { host: raw, url } of hosts(uncomment(src))) {
      if (NOT_FETCHED.some(([u]) => url.startsWith(u))) continue
      let host = raw
      if (raw.includes('${')) {
        host = tail(raw)
        if (!host) { // what someone set: this file's category says what it is
          const cat = SET_BY_YOU[file]
          if (!cat) out.push(`${file}: an address made at run time (${url.split(/['"\s]/)[0]}), with no category for this file in SET_BY_YOU`)
          else if (!stated.has(cat)) out.push(`${file}: an address you set, but PRIVACY.md no longer says what ${cat} covers`)
          continue
        }
      }
      if (!host.includes('.') || LOCAL.test(host) || EXAMPLE.test(host)) continue // a placeholder, this computer, an example
      if (seen.has(`${file} ${host}`)) continue
      seen.add(`${file} ${host}`)
      if (privacy.includes(host.replace(/^\*\./, ''))) continue // named in it
      const cats = Object.entries(CATEGORIES).filter(([, c]) => c.hosts.some((p) => matches(host, p))).map(([k]) => k)
      if (!cats.length) out.push(`${file}: ${host} isn't in PRIVACY.md by name or by category`)
      else if (!cats.some((k) => stated.has(k))) out.push(`${file}: ${host} is in ${cats.join(', ')}, which PRIVACY.md no longer says`)
    }
  }
  return out
}

const all = files()
ok(all.length > 100 && all.includes('server/index.js') && all.includes('desktop/main.js') && all.includes('shared/telemetry-schema.json'), 'it reads the server\'s, the desktop app\'s and the shared code', all.length)
const found = new Set()
for (const f of all) for (const { host } of hosts(uncomment(fs.readFileSync(path.join(ROOT, f), 'utf8')))) found.add(host.includes('${') ? tail(host) : host)
ok(found.has('api.open-meteo.com') && found.has('counts.boldbridge.ai') && found.has('api.cloudflare.com') && found.has('nodejs.org'), 'and finds the hosts it contacts', [...found].slice(0, 20))
const missing = Object.entries(CATEGORIES).filter(([, c]) => !c.says.test(PRIVACY)).map(([k]) => k)
ok(!missing.length, 'PRIVACY.md says each category the hosts are covered by', missing)
const gaps = uncovered()
ok(!gaps.length, 'every outside host in the code is covered by PRIVACY.md, by name or by a category it states', gaps)
const unused = Object.entries(CATEGORIES).flatMap(([k, c]) => c.hosts.filter((p) => !found.has(p)).map((p) => `${k}: ${p}`))
ok(!unused.length, 'and no host is listed here that the code no longer has (so the lists stay what the code does)', unused)

// The check itself.
const code = { 'server/feeds.js': fs.readFileSync(path.join(ROOT, 'server', 'feeds.js'), 'utf8') }
ok(!uncovered(code).length, 'the check, on one file as it is: nothing', uncovered(code))
code['server/feeds.js'] += "\nconst more = await fetch('https://api.tracker-of-everything.io/v1/collect', { method: 'POST' })\n"
const fake = uncovered(code)
ok(fake.length === 1 && /server\/feeds\.js: api\.tracker-of-everything\.io isn't in PRIVACY\.md/.test(fake[0]), 'one made-up new host in it: it fails, naming the file and the host', fake)
ok(!uncovered({ 'server/feeds.js': '// see https://api.tracker-of-everything.io for why\nconst a = 1' }).length, 'the same address in a comment isn\'t contacted, so it passes', null)
ok(uncovered({ 'server/newthing.js': 'fetch(`https://${host}/v1`)' }).some((x) => /made at run time/.test(x)), 'an address made at run time in a file with no category for it fails too', null)
ok(uncovered({ 'server/chatmodels.js': 'fetch(`https://${h}/v1`)' }).length === 0, 'one in a file whose category covers it (a model server you set) passes, by category, not by name', null)
ok(uncovered({ 'server/x.js': "fetch('https://api.open-meteo.com/v1')" }, PRIVACY.replace('the weather (Open-Meteo', 'the weather (')).length === 1, 'and taking a category\'s words out of PRIVACY.md fails it', null)

process.exit(done().fail ? 1 : 0)
