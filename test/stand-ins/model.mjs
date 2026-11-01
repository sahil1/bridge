// A stand-in model provider for the tests, OpenAI-style, on 127.0.0.1:<port>: a model list, chat,
// and speech to text. Every chat request goes in <log> as a line of JSON, so a test can see what
// Bridge AI asked. node model.mjs <port> <log>
//   Speech to text: "Service transcript <n>." for the n-th piece. For a meeting called "Tags only"
//   (in the hint it's sent), only notes about sound for its first two: "[END]", then
//   "(keyboard clicking) [ Silence ]", as whisper writes for a stretch with no words.
//   Meeting notes, a part of a long meeting, who said what, cleaning up a transcript, AI Assist and
//   questions about meetings: fixed answers in the shape meetings.js asks for. The cleanup fixes
//   "bridge ay eye" to "Bridge AI", rewrites a line that says "rewrite me" (which meetings.js
//   turns down), and leaves out "Thanks for watching" and "drop me please"; Assist suggests a
//   question about what the files say (or the invite, without them) and a check of the last thing
//   said.
//   With tools, "EDIT <file>" runs a script (read it, change "hello" to "hello world", cat it).
//   Whiteboards' "Draw this": a flowchart in Mermaid (Start, Tests pass?, Ship, Fix), broken the
//   first time when asked for "broken"; "Change it": Start renamed Begin, Ship coloured red, a Cache
//   box beside the first shape with an arrow to it.
//   Anything else: "echo: <the last thing said>".
//   A key of sk-bad is turned down (HTTP 401), as a provider would.
import http from 'node:http'
import fs from 'node:fs'

const [port, LOG] = [Number(process.argv[2]), process.argv[3]]
const log = (o) => { if (LOG) fs.appendFileSync(LOG, `${JSON.stringify(o)}\n`) }
const call = (id, name, args) => ({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] })
const say = (content) => ({ choices: [{ message: { role: 'assistant', content } }] })
let pieces = 0
let tagged = 0

function answer(b) {
  const m = b.messages || []
  const last = [...m].reverse().find((x) => x.role === 'user')?.content || ''
  const tail = m.at(-1)
  const file = /EDIT (\S+)/.exec(last)?.[1]
  if (b.tools && file && tail.role === 'user') return call(`r${m.length}`, 'read_file', { path: file })
  if (b.tools && file && tail.role === 'tool') {
    const asked = m.flatMap((x) => x.tool_calls || []).find((c) => c.id === tail.tool_call_id)?.function.name
    if (/said no/.test(tail.content)) return say('Understood, I left it alone.')
    if (asked === 'read_file') return call(`e${m.length}`, 'edit_file', { path: file, old_text: 'hello', new_text: 'hello world' })
    if (asked === 'edit_file') return call(`x${m.length}`, 'run_command', { command: `cat ${file}` })
    if (asked === 'run_command') return say(`All done: ${tail.content.replace(/\n/g, ' | ')}`)
  }
  if (/Write meeting notes in Markdown/.test(last)) {
    return say(`## Summary\n- The beta ships on November third.\n\n## Decisions\n- Ship the beta on November third.\n\n## Action items\n- [ ] You: send the updated budget to finance (Friday)\n- [ ] Priya: fix the login bug\n\n## Notes\n- Design review done.\n\n\`\`\`terms\n${JSON.stringify({ names: ['Priya'], misheard: {}, about: { Priya: 'fixing the login bug before the beta', Zed: 'nobody in this meeting' } })}\n\`\`\``)
  }
  if (/This is part \d+ of \d+/.test(last)) return say(`- part ${/This is part (\d+)/.exec(last)[1]} key points`)
  if (/This transcript was made by speech to text/.test(last)) {
    const fix = {}, drop = []
    for (const [, n, text] of last.matchAll(/^(\d+)\. \[[^\]]+\] [^:]+: (.*)$/gm)) {
      if (/bridge ay eye/i.test(text)) fix[n] = text.replace(/bridge ay eye/gi, 'Bridge AI')
      if (/rewrite me/i.test(text)) fix[n] = 'Something else entirely, said in many more words than were ever heard on this line.'
      if (/^thanks for watching|drop me please/i.test(text)) drop.push(Number(n))
    }
    return say(JSON.stringify({ fix, drop }))
  }
  if (/This meeting is going on now/.test(last)) {
    const file = /### ([^\n]+)\n([^\n]+)/.exec(last)
    const lastSaid = [...last.matchAll(/^\[[^\]]+\] [^:]+: (.*)$/gm)].at(-1)?.[1]
    const items = [{ kind: 'question', text: file ? `Ask about "${file[2].slice(0, 40)}"` : 'Ask what they hope to get out of this', why: file ? `${file[1]}` : 'The invite' }]
    if (lastSaid) items.push({ kind: 'check', text: `Check: "${lastSaid.slice(0, 40)}"`, why: 'Just said' })
    return say(JSON.stringify({ items }))
  }
  // Who said what: the slides and the agenda are Dan's, the budget Priya's, the rest unknown.
  if (/Say who said each numbered Them line/.test(last)) {
    const out = {}
    for (const [, n, t] of last.matchAll(/^(\d+)\. \[[^\]]+\] Them: (.*)$/gm)) out[n] = /slides|agenda/i.test(t) ? 'Dan Ruiz' : /budget/i.test(t) ? 'Priya Shah' : null
    return say(`Here you go:\n${JSON.stringify(out)}`)
  }
  if (/Answer from these meetings only/.test(last)) {
    const got = [...last.matchAll(/^\[(\d+)\] "([^"]+)"/gm)].map((x) => x[2])
    // "hostile": an answer a meeting's words steered into markup, to check the page cleans it.
    const steered = /hostile/.test(last) ? '\n\n<style>body{display:none}</style>\n\n<form action="https://example.com"><input name="key"></form>\n\n![[1] <img src=x onerror=alert(1)>](x)\n\n[call](tel:123) [web](https://example.com)' : ''
    return say(`From ${got.length} meetings (${got.join('; ')}): the beta ships on November third [1].${steered}`)
  }
  if (/Answer from the meeting only/.test(last)) return say(/November/i.test(last) && /when/i.test(last) ? 'The beta ships on November third.' : 'That wasn\'t covered in the meeting.')
  if (/^Draw this as a diagram:/.test(last)) {
    if (/broken/i.test(last) && !/didn't draw/.test(last)) return say('```mermaid\nflowchart TD\n  A[Start --> B{{\n```')
    return say('Here it is:\n```mermaid\nflowchart TD\n  A[Start] --> B{Tests pass?}\n  B -->|yes| C[Ship]\n  B -->|no| D[Fix]\n  D --> B\n```')
  }
  if (/^Change this diagram:/.test(last)) {
    const scene = JSON.parse(/as JSON:\n(\{.*\})\n/.exec(last)?.[1] || '{}')
    const id = (text) => (scene.shapes || []).find((s) => s.text === text)?.id
    const first = scene.shapes?.[0]?.id
    const ops = { update: [id('Start') && { id: id('Start'), text: 'Begin' }, id('Ship') && { id: id('Ship'), fill: '#ffc9c9' }].filter(Boolean), add: first ? [{ ref: 'n1', shape: 'rectangle', text: 'Cache', near: first, side: 'right' }] : [], connect: first ? [{ from: first, to: 'n1', text: 'reads' }] : [] }
    return say(`\`\`\`json\n${JSON.stringify(ops)}\n\`\`\``)
  }
  return say(`echo: ${last} (${m.length} messages, ${b.model}, tools: ${b.tools ? b.tools.length : 0})`)
}

http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    const j = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
    // A key it turns down, as a provider does: sk-bad.
    if (/sk-bad/.test(req.headers.authorization || '')) return j(401, { error: { message: 'Incorrect API key provided.' } })
    if (req.method === 'GET' && req.url === '/v1/models') return j(200, { data: [{ id: 'gpt-5' }] })
    if (req.method === 'POST' && req.url === '/v1/audio/transcriptions') {
      const n = ++pieces
      const prompt = /name="prompt"\r\n\r\n([\s\S]*?)\r\n--/.exec(body.toString('latin1'))?.[1] || ''
      log({ stt: n, bytes: body.length, prompt: Buffer.from(prompt, 'latin1').toString('utf8') })
      const tags = /Tags only/.test(prompt) ? ['[END]', '(keyboard clicking) [ Silence ]'][tagged++] : null
      return setTimeout(() => j(200, { text: tags || `Service transcript ${n}.` }), 200)
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const b = JSON.parse(String(body) || '{}')
      log({ model: b.model, tools: (b.tools || []).map((t) => t.function.name), messages: b.messages })
      return setTimeout(() => j(200, answer(b)), 300)
    }
    j(404, { error: { message: 'not found' } })
  })
}).listen(port, '127.0.0.1')
