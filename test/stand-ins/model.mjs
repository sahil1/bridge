// A stand-in model provider for the tests, OpenAI-style, on 127.0.0.1:<port>: a model list, chat,
// and speech to text. Every chat request goes in <log> as a line of JSON, so a test can see what
// Bridge AI asked. node model.mjs <port> <log>
//   Speech to text: "Service transcript <n>." for the n-th piece. For a meeting called "Tags only"
//   (in the hint it's sent), only notes about sound for its first two: "[END]", then
//   "(keyboard clicking) [ Silence ]", as whisper writes for a stretch with no words.
//   Meeting notes, a part of a long meeting, who said what (on a call, or the voices in a room: the
//   first is the one recording, the second the first one invited), cleaning up a transcript, AI Assist and
//   questions about meetings: fixed answers in the shape meetings.js asks for. The cleanup fixes
//   "bridge ay eye" to "Bridge AI", rewrites a line that says "rewrite me" (which meetings.js
//   turns down), and leaves out "Thanks for watching" and "drop me please"; Assist suggests a
//   question about what the files say (or the invite, without them) and a check of the last thing
//   said. AI Assist's meeting prep, before a meeting: a goal from the invite, a follow-up on what's still open
//   and a question about the newest email, from what it was sent.
//   Edit by voice ("Instruction: … Text: …"): the text with "teh" spelled right and its first letter a
//   capital, in quotes and a code fence (which Bridge AI takes off).
//   Dictation to tidy ("<dictation>…</dictation>"): "you know" taken out, in quotes; a model that
//   falls for what it's told, so "write a poem" in it is answered with a poem; "take your time"
//   answers after 8 s, and "fail on purpose" with an error (HTTP 500).
//   With tools, "EDIT <file>" runs a script (read it, change "hello" to "hello world", cat it).
//   Whiteboards' "Draw this": a flowchart in Mermaid (Start, Tests pass?, Ship, Fix), broken the
//   first time when asked for "broken"; for "AWS" or "3-tier", a diagram spec (users, a load
//   balancer, two app servers in private subnets and RDS, in a region and a VPC) with two arrows
//   left without labels; for "office network", a network spec laid out top to bottom. A local
//   model asked for "local" answers wrong the first time (no nodes), right when told why.
//   Refine ("You drew a diagram for"): labels the first arrow without a label, saying so, and says
//   {"ok":true} once every arrow has one. "Change it": Start renamed Begin, Ship coloured red, a
//   Cache box beside the first shape with an arrow to it; its review says ok. Ask about these
//   ("A question about …"): the shapes it was sent, named in quotes, and whether it saw a picture.
//   The meeting moves: a timeline (Dan's design review, Priya's beta, your launch), Priya's and
//   your action items, and notes grouped by theme (Pricing, Sign-in, and Team for the rest). A
//   board written up as a document: its name, what it was sent, and a next step.
//   AI Assist's Sign this, "Explain this document": a mutual NDA between Northwind Labs and Contoso
//   Ltd, a fee, a renewal worth a look on page 1 ("renews automatically").
//   A sheet's AI Assist ("In the spreadsheet …"): the change asked for, as JSON (sheetChange).
//   Studio's decks: a deck of four slides (its title from what it's about, or the document's first
//   line), a slide rewritten as big numbers ("Rewritten"), a new slide of next steps.
//   Ollama's own API (a model server on this computer, when OLLAMA_HOST points here): its models
//   (llama3.1:8b, and llama3.2-vision:11b, which can see), what each can do, none running, and
//   /api/chat answering as Ollama does (its message, pictures as base64 in `images`) with the same
//   answers as above, logged with path '/api/chat'.
//   Mail's How You Write: a profile saying how many emails and meeting lines it read, with the first
//   email as its example. AI Assist's Draft a reply: a reply in a code fence (which Bridge AI takes off) with the
//   free times it was given, a nudge, and the draft shorter, warmer or more direct.
//   Ask a Model in AI Assist's look at a folder ("Suggest how to organize this folder."): a Screenshots folder with the
//   first screenshot in the list it was sent as its example, an Installers folder, and two steps.
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

// The words of a message (a message with a picture is a list of parts).
const words = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text || '').join('\n') : '')
const dictated = (text) => /^<dictation>\n([\s\S]*)\n<\/dictation>$/.exec(text)?.[1] ?? null
const ARCH = { direction: 'LR', groups: [{ id: 'aws', label: 'AWS us-east-1', kind: 'region' }, { id: 'vpc', label: 'VPC', kind: 'vpc', parent: 'aws' }, { id: 'pub', label: 'Public subnet', kind: 'subnet', parent: 'vpc' }, { id: 'privA', label: 'Private subnet A', kind: 'subnet', parent: 'vpc' }, { id: 'privB', label: 'Private subnet B', kind: 'subnet', parent: 'vpc' }],
  nodes: [{ id: 'users', label: 'Users', shape: 'users' }, { id: 'lb', label: 'Load balancer', shape: 'aws.elb', group: 'pub' }, { id: 'app1', label: 'App server 1', shape: 'aws.ec2', group: 'privA' }, { id: 'app2', label: 'App server 2', shape: 'aws.ec2', group: 'privB' }, { id: 'db', label: 'RDS', shape: 'aws.rds', group: 'privB' }],
  edges: [{ from: 'users', to: 'lb', label: 'HTTPS' }, { from: 'lb', to: 'app1' }, { from: 'lb', to: 'app2' }, { from: 'app1', to: 'db', label: 'SQL' }, { from: 'app2', to: 'db', label: 'SQL' }] }
const NET = { direction: 'TB', groups: [{ id: 'lan', label: 'Office LAN', kind: 'vpc' }], nodes: [{ id: 'inet', label: 'Internet', shape: 'internet' }, { id: 'fw', label: 'Firewall', shape: 'firewall' }, { id: 'sw', label: 'Switch', shape: 'switch', group: 'lan' }, { id: 'srv', label: 'File server', shape: 'server', group: 'lan' }, { id: 'pc', label: 'Desktops', shape: 'client', group: 'lan' }],
  edges: [{ from: 'inet', to: 'fw', label: 'WAN' }, { from: 'fw', to: 'sw', label: '1 Gbps' }, { from: 'sw', to: 'srv', label: 'LAN' }, { from: 'sw', to: 'pc', label: 'LAN' }] }

// The meeting moves: a timeline of three steps with owners and dates, and two people's action items.
const TIMELINE = { direction: 'LR', groups: [], nodes: [{ id: 't1', label: 'Design review · Dan · 3 Nov', shape: 'process' }, { id: 't2', label: 'Beta ships · Priya · 10 Nov', shape: 'process' }, { id: 't3', label: 'Launch · You · 1 Dec', shape: 'start' }], edges: [{ from: 't1', to: 't2' }, { from: 't2', to: 't3' }] }
const ACTIONS = { direction: 'LR', groups: [{ id: 'priya', label: 'Priya', kind: 'group' }, { id: 'you', label: 'You', kind: 'group' }], nodes: [{ id: 'a1', label: 'Fix the login bug · Friday', shape: 'note', group: 'priya' }, { id: 'a2', label: 'Send the budget to finance · Friday', shape: 'note', group: 'you' }], edges: [] }

// AI Assist's suggestion for a folder, from the names it was sent.
function filesPlan(text) {
  const names = [...text.matchAll(/^(\S[^\n]*?)  \d/gm)].map((x) => x[1])
  const shot = names.find((n) => /screenshot/i.test(n)) || names[0] || ''
  return `\`\`\`json\n${JSON.stringify({ summary: 'Put the screenshots in a folder of their own and clear out the installers.', folders: [{ name: 'Screenshots', holds: 'Every screenshot, by year', examples: [shot] }, { name: 'Installers', holds: 'Apps to install, until they are', examples: [] }], steps: ['Make a Screenshots folder and move the screenshots in.', 'Delete the installers of apps you have installed.'] })}\n\`\`\``
}

// A sheet's AI Assist, from the cells it was sent (a row of column letters, then each row's number
// and values): a formula doubling column B into the column after them for each row (C at least),
// the first column's words trimmed
// and capitalised, a summary of the numbers, a column chart of the cells picked; "not a change"
// answers in words, which isn't the JSON asked for.
function sheetChange(text) {
  const grid = /"""\n([\s\S]*?)\n"""/.exec(text)?.[1] || ''
  const [head, ...rows] = grid.split('\n').filter((l) => /^\d*\t/.test(l))
  const cols = (head || '').split('\t').slice(1)
  const cells = rows.map((l) => { const [r, ...v] = l.split('\t'); return { r: Number(r), v } })
  const sheet = /on the sheet "([^"]+)"/.exec(text)?.[1]
  const where = /The cells I picked \(([A-Z]+\d+(?::[A-Z]+\d+)?) on /.exec(text)?.[1] || 'A1:B3'
  const json = (o) => `\`\`\`json\n${JSON.stringify(o)}\n\`\`\``
  if (/not a change/i.test(text)) return 'I would double the costs, I think.'
  if (/Write a formula/.test(text)) {
    const to = String.fromCharCode(Math.max(66, (cols.at(-1) || 'A').charCodeAt(0)) + 1)
    return json({ summary: `Doubled each cost in column ${to}`, sheet, cells: Object.fromEntries([[`${to}1`, 'Doubled'], ...cells.filter((c) => c.r > 1).map((c) => [`${to}${c.r}`, `=B${c.r}*2`])]) })
  }
  if (/Clean up the values/.test(text)) {
    const fixed = cells.filter((c) => c.r > 1).map((c) => [`${cols[0]}${c.r}`, c.v[0], c.v[0].trim().replace(/\s+/g, ' ').replace(/^./, (x) => x.toUpperCase())]).filter((x) => x[1] !== x[2])
    return json({ summary: `Trimmed and capitalised ${fixed.length} names`, sheet, cells: Object.fromEntries(fixed.map((x) => [x[0], x[2]])) })
  }
  if (/^Summarise the cells/m.test(text) || /Summarise the cells I picked/.test(text)) {
    const nums = cells.flatMap((c) => c.v.map(Number).filter((n) => Number.isFinite(n) && n !== 0))
    return json({ summary: 'A summary of the cells picked', answer: `${nums.length} numbers come to ${nums.reduce((a, n) => a + n, 0)}; the highest is ${Math.max(...nums)}.` })
  }
  if (/Make a chart/.test(text)) return json({ summary: 'A column chart of the costs', chart: { type: 'column', title: 'Costs', range: where } })
  return json({ summary: 'Nothing to do', answer: 'echo' })
}

function answer(b) {
  const m = b.messages || []
  const last = words([...m].reverse().find((x) => x.role === 'user')?.content)
  const first = words(m.find((x) => x.role === 'user')?.content)
  if (/^Draw this as a diagram:/.test(first) && /Answer with JSON only, in this shape \(an example\)/.test(first)) {
    if (/\blocal\b/i.test(first) && m.filter((x) => x.role === 'user').length === 1) return say('{"nodes": "a load balancer and a server"}')
    if (/aws|3-tier|\blocal\b/i.test(first)) return say(`\`\`\`json\n${JSON.stringify(ARCH)}\n\`\`\``)
    if (/office network/i.test(first)) return say(JSON.stringify(NET))
    if (/Make it a timeline/.test(first)) return say(JSON.stringify(TIMELINE))
    if (/Make it the action items for each person/.test(first)) return say(JSON.stringify(ACTIONS))
  }
  // A board written up as a document: its name as the title, what it was sent, and a next step.
  const board = /^Write a document from the whiteboard "([^"]+)"/.exec(first)
  if (board) {
    const lines = (/"""\n([\s\S]*?)\n"""/.exec(first)?.[1] || '').split('\n')
    return say(['```markdown', `# ${board[1]}`, '', '## What the board shows', '', ...lines, '', '## Next', '', '- **Priya** fixes the login bug by Friday.', '```'].join('\n'))
  }
  // Group by theme: pricing notes, sign-in notes, and the rest as the team's.
  if (/^Group these notes from a whiteboard by theme/.test(first)) {
    const notes = JSON.parse(/The notes, as JSON:\n(\[.*\])\n/.exec(first)?.[1] || '[]')
    const of = (re) => notes.filter((x) => re.test(x.text)).map((x) => x.id)
    const pricing = of(/pric|plan|cheap/i), signin = of(/login|sign-in/i)
    return say(JSON.stringify({ groups: [{ theme: 'Pricing', ids: pricing }, { theme: 'Sign-in', ids: signin }, { theme: 'Team', ids: notes.map((x) => x.id).filter((id) => !pricing.includes(id) && !signin.includes(id)) }] }))
  }
  if (/^You drew a diagram for:/.test(first)) {
    const spec = JSON.parse(/Your diagram, as JSON:\n(\{.*\})\n/.exec(first)?.[1] || '{}')
    const bare = (spec.edges || []).find((e) => !e.label)
    if (!bare) return say('{"ok":true}')
    bare.label = 'HTTP'
    const name = (id) => spec.nodes.find((n) => n.id === id)?.label || id
    return say(JSON.stringify({ ok: false, ...spec, changes: [`Labelled the arrow from ${name(bare.from)} to ${name(bare.to)} with HTTP, so it says what goes along it.`] }))
  }
  if (/^You changed this diagram as asked:/.test(first)) return say('{"ok":true}')
  // Ask about these: the shapes it was sent, named in quotes, and whether it had a picture.
  if (/^A question about /.test(first)) {
    const scene = JSON.parse(/as JSON[^\n]*:\n(\{.*\})\n/.exec(first)?.[1] || '{}')
    const shapes = (scene.shapes || []).filter((s) => s.text)
    const saw = m.find((x) => x.role === 'user' && Array.isArray(x.content) && x.content.some((p) => p.image_url))
    return say(JSON.stringify({ answer: `${shapes.length === 1 ? 'One shape' : `${shapes.length} shapes`}: ${shapes.map((s) => `"${s.text}"`).join(', ')}. Nothing between them is missing.${saw ? ' I looked at the picture too.' : ''}`, shapes: shapes.map((s) => s.id) }))
  }
  // AI Assist's Sign this, "What you're signing": a mutual NDA, in the shape it asks for.
  if (/^Explain this document, which I have been asked to sign\./.test(first)) {
    return say(`\`\`\`json\n${JSON.stringify({ kind: 'Mutual NDA', what: 'Two companies agree to keep what they share with each other secret for two years.', parties: [{ name: 'Northwind Labs', role: 'shares and receives' }, { name: 'Contoso Ltd', role: 'shares and receives' }], money: ['A fee of $1,200 a year, paid by Contoso Ltd'], dates: ['Starts on signing; lasts two years'], obligations: ['Keep the other side\'s information secret', 'Return or destroy it when asked'], renewal: 'It renews by itself every year unless either side says no 30 days before.', termination: 'Either side can end it with 30 days\' notice.', watch: [{ what: 'It renews by itself unless you say no in time.', page: 1, quote: 'renews automatically' }] })}\n\`\`\``)
  }
  if (/^Suggest how to organize this folder\./.test(first)) return say(filesPlan(first))
  if (/^In the spreadsheet /.test(first)) return say(sheetChange(first))
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
  const edit = /^Instruction: [\s\S]*?\n\nText:\n([\s\S]*)$/.exec(last)
  if (edit) { const t = edit[1].replace(/\bteh\b/g, 'the'); return say('```\n"' + t.charAt(0).toUpperCase() + t.slice(1) + '"\n```') }
  const said = dictated(last)
  if (said != null) {
    if (/write a poem/i.test(said)) return say('The sea rolls in with silver light,\nIt hums a tune into the night,\nAnd every wave that finds the shore\nCalls softly back for something more.')
    return say(`"${said.replace(/,?\s*\byou know\b,?/gi, '').replace(/\s{2,}/g, ' ').trim()}"`)
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
  // AI Assist's meeting prep, before a meeting: a goal from the invite, a follow-up on what's still open from last
  // time (theirs first), and a question about the newest email with them, each from what it was sent.
  if (/^Prepare me for a meeting:/.test(last)) {
    const invite = /^The invite says: (.+)$/m.exec(last)?.[1]
    const open = /^Still open, theirs: ([^;\n]+)/m.exec(last)?.[1] || /^Still open, mine: ([^;\n]+)/m.exec(last)?.[1]
    const mail = /^- From ([^,\n]+), [^:\n]+: "([^"\n]+)"/m.exec(last)
    const items = []
    if (invite) items.push({ kind: 'goal', text: `Agree on: ${invite}`, why: 'The invite' })
    if (open) items.push({ kind: 'follow-up', text: `Settle "${open}"`, why: 'Last time' })
    if (mail) items.push({ kind: 'question', text: `Ask ${mail[1]} about "${mail[2]}"`, why: `Email from ${mail[1]}` })
    if (!items.length) items.push({ kind: 'question', text: 'Ask what they hope to get out of this', why: 'Nothing else to go on' })
    return say(JSON.stringify({ items }))
  }
  // Who said what: the slides and the agenda are Dan's, the budget Priya's, the rest unknown.
  if (/Say who said each numbered Them line/.test(last)) {
    const out = {}
    for (const [, n, t] of last.matchAll(/^(\d+)\. \[[^\]]+\] Them: (.*)$/gm)) out[n] = /slides|agenda/i.test(t) ? 'Dan Ruiz' : /budget/i.test(t) ? 'Priya Shah' : null
    return say(`Here you go:\n${JSON.stringify(out)}`)
  }
  // A deck of a meeting: its name on the title slide, and a slide for what it was about.
  if (/Write a slide deck of this meeting/.test(last)) {
    const title = (/^Meeting: (.+?), /m.exec(last)?.[1] || 'Meeting').trim()
    return say(['```markdown', '---', 'marp: true', 'paginate: true', '---', '', `# ${title}`, '', '---', '', '# What we covered', '', '- The pricing page', '- Who does what', '', '<!-- Start with the numbers -->', '```'].join('\n'))
  }
  // Studio's decks: a deck (from what it's about, or a document's words: its first line becomes the
  // title), slide n rewritten as big numbers, a new slide of next steps.
  if (/^Write a slide deck(: | from the document)/m.test(last)) {
    const doc = /The document \([^)]*\), to make it from:\n"""\n(?:- )?([^\n]+)/.exec(last)?.[1]
    const title = (doc || /^Write a slide deck: (.+?)\.?$/m.exec(last)?.[1] || 'A deck').slice(0, 40)
    return say(['```markdown', '<!-- _class: title -->', '', `# ${title}`, '', '## Written for the test', '', '---', '', '# Why now', '', '- Customers asked', '- It is ready', '', '<!-- Say why -->', '', '---', '', '<!-- _class: stats -->', '', '# What changed', '', '- **42%** of trials convert', '- **3x** more seats', '', '---', '', '<!-- _class: section -->', '', '# Next', '```'].join('\n'))
  }
  if (/^Rewrite slide \d+/m.test(last)) return say('<!-- _class: stats -->\n\n# Rewritten\n\n- **42%** shorter\n- **3x** clearer\n\n<!-- The new notes -->')
  if (/^Write one new slide to go after slide \d+/m.test(last)) return say('# Next steps\n\n- Ship it\n- Tell customers')
  // Who each voice on a call is: Speaker 1 the first one invited, Speaker 2 the second.
  if (/Say who each voice on the call is/.test(last)) {
    const invited = (/^Invited, besides You: (.+)$/m.exec(last)?.[1] || '').split(', ').filter(Boolean)
    return say(JSON.stringify({ 1: invited[0] || null, 2: invited[1] || null }))
  }
  // Who each voice in a room is: Speaker 1 is the one recording, Speaker 2 the first one invited.
  if (/Say who each speaker is/.test(last)) {
    const invited = (/^Invited, besides the person recording: (.+)$/m.exec(last)?.[1] || '').split(', ').filter(Boolean)
    return say(JSON.stringify({ 1: 'me', 2: invited[0] || null }))
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
  // How You Write (mailassist.js): a profile from what it was given, and the first email as the example.
  if (/Describe how they write email/.test(last)) {
    const emails = (last.match(/^E\d+ \(/gm) || []).length, lines = (last.match(/^M\d+ \(/gm) || []).length
    const profile = [`Greets with "${/\bHey\b/.test(last) ? 'Hey' : 'Hi'}" and the first name`, /Cheers/.test(last) ? 'Signs off with "Cheers"' : 'Signs off with their name', 'Short replies, two or three sentences', `Read ${emails} emails and ${lines} meeting lines`]
    return say(JSON.stringify({ profile, examples: emails ? ['E1'] : [] }))
  }
  // AI Assist's Draft a reply: a reply, a nudge, or the draft so far shorter, warmer or more direct. The times it
  // was given go in as they were said.
  if (/reply to the email below|Write a short, friendly follow-up/.test(last)) {
    const first = (/The email[^(]*\(from "?([^\s<"]+)/.exec(last)?.[1] || 'there')
    if (/Make it shorter/.test(last)) return say(`Hi ${first},\n\nYes, today.\n\nCheers`)
    if (/Make it warmer/.test(last)) return say(`Hi ${first},\n\nThanks so much for sending this! I'll look at it today.\n\nCheers`)
    if (/Make it more direct/.test(last)) return say(`${first}, I'll review it by 5 today.`)
    if (/Write a short, friendly follow-up/.test(last)) return say(`Hi ${first},\n\nJust checking in on this.\n\nCheers`)
    const times = /Times they're free[^\n]*\n((?:- [^\n]+\n?)+)/.exec(last)?.[1]
    return say(`\`\`\`\nHi ${first},\n\nThanks, I'll review the launch plan today.${times ? `\n\nI could meet at any of these:\n${times.trim()}` : ''}\n\nCheers\n\`\`\``)
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
    // Ollama's own API: its models, and what one can do (llama3.2-vision can see).
    if (req.method === 'GET' && req.url === '/api/tags') return j(200, { models: [{ name: 'llama3.1:8b' }, { name: 'llama3.2-vision:11b' }] })
    if (req.method === 'POST' && req.url === '/api/show') {
      const name = JSON.parse(String(body) || '{}').model || ''
      return j(200, { capabilities: /vision/.test(name) ? ['completion', 'vision'] : ['completion', 'tools'], details: { parameter_size: /11b/.test(name) ? '10.7B' : '8.0B' } })
    }
    if (req.method === 'GET' && req.url === '/api/ps') return j(200, { models: [] })
    if (req.method === 'POST' && req.url === '/api/chat') {
      const b = JSON.parse(String(body) || '{}')
      log({ path: '/api/chat', model: b.model, tools: (b.tools || []).map((t) => t.function.name), messages: b.messages, num_ctx: b.options?.num_ctx, ...(b.format ? { format: typeof b.format === 'object' ? 'json_schema' : b.format } : {}) })
      const a = answer(b).choices[0].message
      const calls = (a.tool_calls || []).map((c) => ({ function: { name: c.function.name, arguments: JSON.parse(c.function.arguments || '{}') } }))
      return setTimeout(() => j(200, { model: b.model, created_at: new Date().toISOString(), message: { role: 'assistant', content: a.content || '', ...(calls.length ? { tool_calls: calls } : {}) }, done: true, done_reason: 'stop' }), 300)
    }
    if (req.method === 'POST' && req.url === '/v1/audio/transcriptions') {
      const n = ++pieces
      const prompt = /name="prompt"\r\n\r\n([\s\S]*?)\r\n--/.exec(body.toString('latin1'))?.[1] || ''
      log({ stt: n, bytes: body.length, prompt: Buffer.from(prompt, 'latin1').toString('utf8') })
      const tags = /Tags only/.test(prompt) ? ['[END]', '(keyboard clicking) [ Silence ]'][tagged++] : null
      return setTimeout(() => j(200, { text: tags || `Service transcript ${n}.` }), 200)
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const b = JSON.parse(String(body) || '{}')
      log({ model: b.model, tools: (b.tools || []).map((t) => t.function.name), messages: b.messages, ...(b.response_format ? { format: b.response_format.type } : {}) })
      const said = dictated(words([...(b.messages || [])].reverse().find((x) => x.role === 'user')?.content)) || ''
      if (/fail on purpose/i.test(said)) return j(500, { error: { message: 'The server had an error while processing your request.' } })
      return setTimeout(() => j(200, answer(b)), /take your time/i.test(said) ? 8000 : 300)
    }
    j(404, { error: { message: 'not found' } })
  })
}).listen(port, '127.0.0.1')
