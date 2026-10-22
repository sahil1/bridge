// The demo's made-up agents: who runs where, what they've said so far, and what they do next.
// A conversation is a script of steps, replayed instantly for the past (with `at`, minutes ago)
// and played out live for what happens while you watch:
//   { you }        your message            { say }       the agent's reply
//   { tool, hint } a step it took          { run, out }  a command it ran
//   { edit, with } a change to a file in its folder: with(text before) -> text after
//   { doing }      what its status line says now       { wait }  a pause, in ms
//   { ask }        a question it waits on (a card in Chat)
//   { event }      a note in the chat      { at }        the time, for the past
import { CHIEF_DIR, CSV_TREE, EDITS, code } from './repos.js'

export const SPACES = [
  { id: 'w1', label: 'Chief of staff' },
  { id: 'w2', label: 'acme-shop' },
  { id: 'w3', label: 'billing-api' },
  { id: 'w4', label: 'docs-site' },
]

// Where people land after signing in, when there's nowhere to go back to.
export const LANDING = {
  tab: 'After sign-in',
  text: "When there's no page to go back to, where should people land after signing in?",
  options: [
    { label: 'Their account page', desc: 'Orders and saved addresses first', path: '/account', why: 'their account page' },
    { label: 'The home page', desc: 'The same as today', path: '/', why: 'the home page, as before' },
    { label: 'Their cart', desc: 'Handy when they signed in to check out', path: '/cart', why: 'their cart' },
  ],
}

const ago = (m) => ({ at: m })

export const AGENTS = [
  {
    paneId: 'w1:p1', tabId: 't1', workspaceId: 'w1', tab: 'Chief of staff', kind: 'claude', cwd: CHIEF_DIR, chief: true, status: 'idle',
    script: [
      ago(96), { you: 'Morning. What needs me today?' },
      { tool: 'Read', hint: 'state/ledger.md' },
      { say: "Morning. Nothing is waiting on you yet. Open from yesterday:\n\n| Task | Space |\n|---|---|\n| Fix the login redirect | acme-shop |\n| Clean up the invoice tests | billing-api |\n| Fix the README's install line | docs-site |\n\nWant me to start them?" },
      ago(94), { you: 'Yes, all three. And add a CSV export to the orders page in acme-shop.' },
      { tool: 'Bash', hint: 'node bin/bridge new --cwd ~/code/acme-shop --space "acme-shop" --name "Fix login redirect" "After sign-in, people land on the home page…"' },
      { tool: 'Bash', hint: 'node bin/bridge new --cwd ~/code/acme-shop --space "acme-shop" --name "Add CSV export" --kind codex --own-branch "Add a CSV export…"' },
      { tool: 'Bash', hint: 'node bin/bridge new --cwd ~/code/billing-api --space "billing-api" --name "Refactor billing tests" "The invoice tests repeat…"' },
      { tool: 'Bash', hint: 'node bin/bridge new --cwd ~/code/docs-site --space "docs-site" --name "Update README" "The README says…"' },
      { say: "Started four agents:\n\n- **Fix login redirect** and **Add CSV export** in acme-shop. The CSV one works on its own branch, `bridge/add-csv-export`, so the two can't clash.\n- **Refactor billing tests** in billing-api.\n- **Update README** in docs-site.\n\nI'll tell you when they finish or need you." },
      ago(31), { say: '**Update README** finished. The docs-site README has a quick start now, and the install line is gone. Nothing for you to do unless you want to read it over.' },
      ago(9), { say: "**Refactor billing tests** finished. Along the way it found a real bug: taxes rounded half to even, so 12.5 cents came out as 12. It's fixed in `billing/invoices.py`. Worth a look in its Changes tab before you commit." },
      ago(3), { say: '**Fix login redirect** has a question for you: where people should land after signing in. It\'s waiting in its chat.' },
    ],
  },
  {
    paneId: 'w2:p2', tabId: 't2', workspaceId: 'w2', tab: 'Fix login redirect', kind: 'claude', cwd: code('acme-shop'), status: 'blocked',
    script: [
      ago(93), { you: "After sign-in, people land on the home page instead of the page they were on. Fix it so they go back where they came from." },
      { tool: 'Grep', hint: 'afterSignIn' },
      { tool: 'Read', hint: '~/code/acme-shop/src/auth/redirect.ts' },
      { tool: 'Read', hint: '~/code/acme-shop/src/pages/Login.tsx' },
      { say: 'Found it. Two things lose the return page:\n\n1. `afterSignIn()` in `src/auth/redirect.ts` ignores its parameters and always returns `/`.\n2. `Login.tsx` calls it with empty parameters, so even a fixed `afterSignIn()` would never see `returnTo`.\n\nI\'ll write a test for it first.' },
      { edit: 'tests/redirect.test.ts', with: EDITS.redirectTest },
      { run: 'pnpm test redirect', out: '1 failed, 1 passed' },
      { say: 'The test fails as expected. One thing to settle before I fix it.' },
      ago(4), { ask: LANDING, then: landed },
    ],
  },
  {
    paneId: 'w2:p3', tabId: 't3', workspaceId: 'w2', tab: 'Add CSV export', kind: 'codex', cwd: CSV_TREE, status: 'working', account: null,
    worktree: { folder: CSV_TREE, repo: code('acme-shop'), branch: 'bridge/add-csv-export', base: 'main' },
    script: [
      ago(92), { you: 'Add a CSV export to the orders page: a button that downloads the orders in the current filter.' },
      { run: 'rg -n "filter" src/pages/Orders.tsx' },
      { say: "I'll add a small CSV helper in `src/lib/csv.ts`, then an **Export CSV** button on the orders page that exports what the filter shows." },
      { edit: 'src/lib/csv.ts', with: EDITS.csvLib },
      { edit: 'src/pages/Orders.tsx', with: EDITS.csvButton },
      ago(1), { doing: 'Writing tests' },
    ],
    // Played out while you watch.
    next: [
      { wait: 4000 },
      { edit: 'tests/csv.test.ts', with: EDITS.csvTest },
      { doing: 'Running tests', wait: 2500 },
      { run: 'pnpm test', out: '4 passed' },
      { say: 'Added **Export CSV** to the orders page. It exports the orders the current filter shows, as `orders-<filter>.csv`, and is disabled when there are none.\n\n- `src/lib/csv.ts` turns orders into CSV and quotes fields with commas, quotes or line breaks.\n- 3 new tests in `tests/csv.test.ts`. All 4 tests pass.\n\nIt\'s on `bridge/add-csv-export`, not committed yet.' },
    ],
  },
  {
    paneId: 'w3:p5', tabId: 't5', workspaceId: 'w3', tab: 'Refactor billing tests', kind: 'claude', cwd: code('billing-api'), status: 'done', account: 'claude-work',
    script: [
      ago(91), { you: "The invoice tests repeat the same cart in every test. Clean them up with a fixture, and check the tax rounding while you're there." },
      { tool: 'Read', hint: '~/code/billing-api/tests/test_invoices.py' },
      { tool: 'Read', hint: '~/code/billing-api/billing/invoices.py' },
      { edit: 'tests/conftest.py', with: EDITS.conftest },
      { edit: 'tests/test_invoices.py', with: EDITS.invoiceTests },
      { run: 'uv run pytest -q', out: '1 failed, 6 passed' },
      { say: 'The new rounding test fails: `tax()` rounds half to even (Python\'s default), so a tax of 0.125 becomes 0.12. Receipts round half up. Fixing that.' },
      { edit: 'billing/invoices.py', with: EDITS.roundHalfUp },
      ago(10), { run: 'uv run pytest -q', out: '7 passed' },
      { say: 'Done.\n\n- The tests share one `cart` fixture now, in `tests/conftest.py`.\n- The tax cases are one parametrized test, with Texas and a region we don\'t tax added.\n- A new test covers rounding, and it caught a real bug: `tax()` rounded half to even. It rounds half up now, in `billing/invoices.py`.\n\nAll 7 tests pass. Nothing is committed yet.' },
    ],
  },
  {
    paneId: 'w3:p6', tabId: 't6', workspaceId: 'w3', tab: 'Rate limit webhooks', kind: 'opencode', cwd: code('billing-api'), status: 'working',
    script: [
      ago(40), { you: 'Rate limit the payments webhook: at most 60 events a minute per sender, 429 after that.' },
      { tool: 'read', hint: 'billing/webhooks.py' },
      { say: "I'll keep a sliding window per sender in memory. That's enough for one server; with several you'd want Redis." },
      ago(1), { doing: 'Editing billing/webhooks.py' },
    ],
    next: [
      { wait: 9000 },
      { edit: 'billing/webhooks.py', with: EDITS.rateLimit },
      { doing: 'Running tests', wait: 6000 },
      { run: 'uv run pytest -q', out: '7 passed' },
      { say: 'Done. More than 60 events a minute from one sender now get a 429, and senders retry those. The limit and window are at the top of `billing/webhooks.py`.' },
    ],
  },
  {
    paneId: 'w4:p7', tabId: 't7', workspaceId: 'w4', tab: 'Update README', kind: 'claude', cwd: code('docs-site'), status: 'done',
    script: [
      ago(90), { you: 'The README says `npm install docs-site`, which is wrong. Give it a proper quick start.' },
      { tool: 'Read', hint: '~/code/docs-site/README.md' },
      { tool: 'Read', hint: '~/code/docs-site/package.json' },
      { edit: 'README.md', with: EDITS.readme },
      ago(32), { say: 'Rewrote the README: a quick start (clone, `npm install`, `npm run dev`), where pages live, and the link check. The old install line was for a package that doesn\'t exist; this site is cloned, not installed.' },
    ],
  },
  {
    paneId: 'w4:p8', tabId: 't8', workspaceId: 'w4', tab: 'Check broken links', kind: 'gemini', cwd: code('docs-site'), status: 'idle',
    script: [
      ago(26), { you: 'Find broken links in the docs.' },
      { run: 'grep -rn "](" docs/' },
      { say: 'One broken link: `docs/getting-started.md` links to `webhook.md`, but the page is `webhooks.md`. Everything else resolves.' },
    ],
  },
]

// A plain terminal tab: the shop's dev server.
export const SHELLS = [
  { paneId: 'w2:p4', tabId: 't4', workspaceId: 'w2', tab: 'dev server', cwd: code('acme-shop') },
]

// Tabs in each space, in order.
export const TAB_ORDER = ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']

// ---------- What happens next ----------

// The answer to LANDING: the fix, as the agent makes it.
export function landed(choice) {
  const guess = (t) => (/order/i.test(t) ? '/orders' : /cart|basket/i.test(t) ? '/cart' : /home|front/i.test(t) ? '/' : '/account')
  const fallback = choice.custom ? { path: guess(choice.custom), why: `"${choice.custom}"` } : choice
  return [
    { say: choice.custom ? `Going with "${choice.custom}": \`${fallback.path}\`.` : `${choice.label} it is.` },
    { doing: 'Editing', wait: 1500 },
    { edit: 'src/auth/redirect.ts', with: EDITS.redirectFix(fallback) },
    { edit: 'src/pages/Login.tsx', with: EDITS.loginParams },
    { doing: 'Testing', wait: 2200 },
    { run: 'pnpm test', out: '3 passed' },
    { say: `Fixed. After signing in, people go back to the page they came from. With nowhere to go back to, they land on ${fallback.why}.\n\n- \`afterSignIn()\` reads \`returnTo\` and only follows paths on this site, so a link can't send someone elsewhere.\n- \`Login.tsx\` passes the page's own parameters now.\n\nThe new tests pass, with the rest. Have a look in Changes.` },
  ]
}

// What the chief says when an agent finishes while you watch.
export const finishedNote = {
  'w2:p3': "**Add CSV export** finished: there's an Export CSV button on the orders page now, with tests. It's on its own branch, `bridge/add-csv-export`, ready for you to review.",
  'w3:p6': '**Rate limit webhooks** finished. The payments webhook answers 429 after 60 events a minute from one sender.',
}

// Small edits to answer a review, by the file commented on: the file that changes, and how.
const POLISH = {
  'tests/test_invoices.py': ['tests/test_invoices.py', EDITS.testsNamed],
  'tests/conftest.py': ['tests/test_invoices.py', EDITS.testsNamed],
  'billing/invoices.py': ['billing/invoices.py', EDITS.taxDoc],
  'src/auth/redirect.ts': ['tests/redirect.test.ts', EDITS.redirectQueryTest],
  'src/pages/Login.tsx': ['tests/redirect.test.ts', EDITS.redirectQueryTest],
  'tests/redirect.test.ts': ['tests/redirect.test.ts', EDITS.redirectQueryTest],
  'src/lib/csv.ts': ['tests/csv.test.ts', EDITS.csvQuoteTest],
  'tests/csv.test.ts': ['tests/csv.test.ts', EDITS.csvQuoteTest],
  'src/pages/Orders.tsx': ['src/pages/Orders.tsx', EDITS.csvButtonLabel],
  'README.md': ['README.md', EDITS.readmeNode],
}

const TESTS = { claude: 'Testing', codex: 'Running tests', opencode: 'Running tests', gemini: 'Running tests' }
const testCmd = (cwd) => (cwd.includes('billing') ? 'uv run pytest -q' : cwd.includes('docs') ? 'npm run check-links' : 'pnpm test')
const someFile = (cwd) => (cwd.includes('billing') ? 'billing/invoices.py' : cwd.includes('docs') ? 'README.md' : cwd === CHIEF_DIR ? 'state/ledger.md' : 'src/pages/Orders.tsx')

// A reply to anything you send an agent. Not clever: enough to show how it goes.
export function reply(agent, text, n) {
  const t = text.toLowerCase()
  if (/^i reviewed your changes/.test(t)) {
    const notes = [...text.matchAll(/^\d+\. ([^:\s]+):/gm)].map((m) => m[1])
    const fixes = new Map(notes.filter((f) => POLISH[f]).map((f) => POLISH[f]))
    const your = notes.length === 1 ? 'comment' : `${notes.length} comments`
    return [
      { doing: 'Reading your comments', wait: 1500 },
      ...[...fixes].map(([edit, fn]) => ({ edit, with: fn })),
      { run: testCmd(agent.cwd), out: 'all passed', doing: TESTS[agent.kind] },
      { say: fixes.size
        ? `Went through your ${your} and changed ${[...fixes.keys()].map((f) => `\`${f}\``).join(' and ')} to match. Tests still pass.`
        : `Read your ${your}. Nothing needed changing in the end: it already works that way, and the tests cover it.` },
    ]
  }
  if (/\bcommit/.test(t)) return [{ doing: 'Committing', wait: 1200 }, { commit: true }]
  if (/\btests?\b/.test(t)) {
    return [
      { doing: TESTS[agent.kind], wait: 2500 },
      { run: testCmd(agent.cwd), out: 'all passed' },
      { say: 'Ran the whole suite: everything passes. No warnings either.' },
    ]
  }
  const file = someFile(agent.cwd)
  const replies = [
    [{ tool: agent.kind === 'claude' ? 'Read' : 'read', hint: file, doing: 'Reading' }, { say: `Sure. I looked at \`${file}\` first: that change is small and nothing else depends on it. Done, and the tests still pass.` }],
    [{ doing: 'Thinking', wait: 1800 }, { say: "Good point. I'd keep this one small: change it here, and leave the rest for a separate task so it's easy to review. Want me to go ahead?" }],
    [{ run: testCmd(agent.cwd), doing: TESTS[agent.kind] }, { say: "Done. I checked it against the tests too, and they pass. Anything else while I'm here?" }],
  ]
  return replies[n % replies.length]
}

// The chief of staff: answers what's going on, or hands the work to the right agent.
export function chiefReply(text, agents) {
  const t = text.toLowerCase()
  const named = (a) => a.tab || a.title
  if (/status|what('s| is| needs)|need(s)? me|update|today|summary|how('s| are)/.test(t) || t.length < 4) {
    const by = (s) => agents.filter((a) => !a.chief && a.status === s).map(named)
    const parts = []
    if (by('blocked').length) parts.push(`**Needs you:** ${by('blocked').join(', ')}.`)
    if (by('working').length) parts.push(`**Working:** ${by('working').join(', ')}.`)
    if (by('done').length) parts.push(`**Finished, not looked at yet:** ${by('done').join(', ')}.`)
    if (by('idle').length) parts.push(`**Idle:** ${by('idle').join(', ')}.`)
    return { steps: [{ tool: 'Bash', hint: 'node bin/bridge agents --brief', doing: 'Checking' }, { say: parts.join('\n\n') || 'All quiet. Nothing is running.' }] }
  }
  const routes = [
    [/login|sign.?in|redirect|auth/, 'w2:p2'],
    [/csv|export|orders?\b/, 'w2:p3'],
    [/webhook|rate.?limit|429/, 'w3:p6'],
    [/billing|invoice|tax|test/, 'w3:p5'],
    [/link/, 'w4:p8'],
    [/doc|readme/, 'w4:p7'],
  ]
  const hit = routes.find(([re]) => re.test(t))
  const target = hit && agents.find((a) => a.paneId === hit[1])
  if (target) {
    return {
      to: target.paneId,
      steps: [
        { tool: 'Bash', hint: `node bin/bridge send ${target.paneId} "…"`, doing: 'Handing it over' },
        { say: `Sent that to **${target.tab}** in ${target.workspace}, since it's already working there. I'll tell you when it's done.` },
      ],
    }
  }
  return {
    launch: { space: 'w2', name: text.replace(/[^\w\s'-]/g, '').trim().split(/\s+/).slice(0, 4).join(' ') || 'New task' },
    steps: [
      { tool: 'Bash', hint: 'node bin/bridge new --cwd ~/code/acme-shop --space "acme-shop" "…"', doing: 'Starting an agent' },
      { say: 'Nothing running fits that, so I started a new agent for it in acme-shop. I\'ll report back when it\'s done.' },
    ],
  }
}
