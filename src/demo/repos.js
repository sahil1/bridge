// The demo's made-up projects: three small repos on a made-up computer, as the agents find them.
// Everything here is invented.
export const HOME = '/Users/you'
export const code = (name) => `${HOME}/code/${name}`
export const CHIEF_DIR = `${HOME}/.bridge-ai/chief`
export const CSV_TREE = `${HOME}/.bridge-ai/worktrees/acme-shop-add-csv-export`

const ACME = {
  'package.json': `{
  "name": "acme-shop",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "vite": "^7.0.0",
    "vitest": "^3.2.0"
  }
}
`,
  'README.md': `# acme-shop

The storefront for Acme Goods: products, cart, checkout and order history.

## Run it

\`\`\`sh
pnpm install
pnpm dev
\`\`\`

Tests: \`pnpm test\`.
`,
  'src/auth/redirect.ts': `// Where to send someone after they sign in.
const HOME = '/'

export function afterSignIn(params: URLSearchParams): string {
  return HOME
}
`,
  'src/auth/session.ts': `export type User = { id: string; name: string }

let current: User | null = null

export async function signIn(email: string, password: string): Promise<User> {
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error('Wrong email or password')
  current = await res.json()
  return current
}

export const user = () => current
`,
  'src/pages/Login.tsx': `import { useState } from 'react'
import { signIn } from '../auth/session'
import { afterSignIn } from '../auth/redirect'

export function Login() {
  const [error, setError] = useState('')

  async function submit(form: FormData) {
    try {
      await signIn(String(form.get('email')), String(form.get('password')))
      location.assign(afterSignIn(new URLSearchParams()))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <form action={submit}>
      <input name="email" type="email" placeholder="Email" />
      <input name="password" type="password" placeholder="Password" />
      <button>Sign in</button>
      {error && <p role="alert">{error}</p>}
    </form>
  )
}
`,
  'src/pages/Orders.tsx': `import { useState } from 'react'
import { useOrders, type Status } from '../api/orders'

const FILTERS: Status[] = ['all', 'open', 'shipped', 'returned']

export function Orders() {
  const [filter, setFilter] = useState<Status>('all')
  const orders = useOrders(filter)

  return (
    <section>
      <header>
        <h1>Orders</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Status)}>
          {FILTERS.map((f) => <option key={f}>{f}</option>)}
        </select>
      </header>
      <table>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}><td>{o.number}</td><td>{o.date}</td><td>{o.total}</td><td>{o.status}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
`,
  'src/api/orders.ts': `import { useEffect, useState } from 'react'

export type Status = 'all' | 'open' | 'shipped' | 'returned'
export type Order = { id: string; number: string; date: string; total: string; status: Status }

export function useOrders(filter: Status): Order[] {
  const [orders, setOrders] = useState<Order[]>([])
  useEffect(() => {
    fetch(\`/api/orders?status=\${filter}\`).then((r) => r.json()).then(setOrders)
  }, [filter])
  return orders
}
`,
  'tests/orders.test.ts': `import { describe, expect, it } from 'vitest'
import type { Order } from '../src/api/orders'

describe('orders', () => {
  it('has a number for every order', () => {
    const o: Order = { id: '1', number: 'A-1001', date: '2026-10-01', total: '$42.00', status: 'open' }
    expect(o.number).toMatch(/^A-\\d+$/)
  })
})
`,
}

const BILLING = {
  'pyproject.toml': `[project]
name = "billing-api"
version = "0.4.0"
requires-python = ">=3.11"
dependencies = ["fastapi>=0.115", "httpx>=0.27"]

[tool.pytest.ini_options]
testpaths = ["tests"]
`,
  'README.md': `# billing-api

Invoices, taxes and payment webhooks for Acme Goods.

    uv run fastapi dev billing/app.py
    uv run pytest
`,
  'billing/__init__.py': '',
  'billing/invoices.py': `from decimal import Decimal, ROUND_HALF_UP

TAX_RATES = {"US-CA": Decimal("0.0725"), "US-NY": Decimal("0.04"), "US-TX": Decimal("0.0625")}


def subtotal(lines):
    return sum(Decimal(str(line["price"])) * line["qty"] for line in lines)


def tax(lines, region):
    rate = TAX_RATES.get(region, Decimal("0"))
    return (subtotal(lines) * rate).quantize(Decimal("0.01"))


def total(lines, region):
    return subtotal(lines) + tax(lines, region)
`,
  'billing/webhooks.py': `from fastapi import APIRouter, Request

router = APIRouter()


@router.post("/webhooks/payments")
async def payment_event(request: Request):
    event = await request.json()
    # TODO: verify the signature before trusting the event
    return {"received": event.get("id")}
`,
  'tests/test_invoices.py': `from decimal import Decimal

from billing.invoices import subtotal, tax, total


def test_subtotal():
    lines = [{"sku": "MUG-01", "price": 12.5, "qty": 2}, {"sku": "TEE-02", "price": 19.99, "qty": 1}]
    assert subtotal(lines) == Decimal("44.99")


def test_tax_california():
    lines = [{"sku": "MUG-01", "price": 12.5, "qty": 2}, {"sku": "TEE-02", "price": 19.99, "qty": 1}]
    assert tax(lines, "US-CA") == Decimal("3.26")


def test_tax_new_york():
    lines = [{"sku": "MUG-01", "price": 12.5, "qty": 2}, {"sku": "TEE-02", "price": 19.99, "qty": 1}]
    assert tax(lines, "US-NY") == Decimal("1.80")


def test_total():
    lines = [{"sku": "MUG-01", "price": 12.5, "qty": 2}, {"sku": "TEE-02", "price": 19.99, "qty": 1}]
    assert total(lines, "US-CA") == Decimal("48.25")
`,
}

const DOCS = {
  'package.json': `{
  "name": "docs-site",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "check-links": "lychee --offline dist"
  }
}
`,
  'README.md': `# docs-site

Docs for the Acme Goods developer API.

Install with \`npm install docs-site\` and run \`npm start\`.
`,
  'docs/getting-started.md': `# Getting started

1. Ask for an API key in your Acme Goods dashboard.
2. Send it in the \`Authorization\` header of every request.
3. Try it: \`curl https://api.example.com/v1/products\`

See [Orders](orders.md) and [Webhooks](webhook.md).
`,
  'docs/orders.md': `# Orders

\`GET /v1/orders\` lists orders, newest first. Filter with \`?status=open\`.
`,
  'docs/webhooks.md': `# Webhooks

Acme Goods sends a POST to your endpoint when a payment succeeds or fails.
Check the \`Acme-Signature\` header before trusting an event.
`,
}

const CHIEF = {
  'INSTRUCTIONS.md': `# Chief of staff

You are the one agent your person talks to. Send each request to the agent already working on
that topic, start a new one in the right space when nothing fits, and report back when work is
done.
`,
  'state/ledger.md': `# Ledger

- acme-shop: login redirect fix (Fix login redirect), CSV export (Add CSV export, own branch)
- billing-api: test cleanup (Refactor billing tests), webhook rate limits (Rate limit webhooks)
- docs-site: README quick start (Update README), link check (Check broken links)
`,
  'work/monday-update/update.md': `# Monday update

- **acme-shop:** the login redirect is fixed and merged. CSV export for orders is under way on its own branch.
- **billing-api:** the billing tests are cleaned up; webhook rate limits are next.
- **docs-site:** the README quick start is rewritten; the broken link check found 3 links to fix.
`,
  'work/error-trackers/comparison.md': `# Error trackers for acme-shop

| | Sentry | Bugsnag | Rollbar |
| --- | --- | --- | --- |
| Free tier | 5k errors/mo | 7.5k events/mo | 5k events/mo |
| Python SDK | Yes | Yes | Yes |
| Release tracking | Yes | Yes | Paid plans |

Sentry fits best: the free tier covers our volume, and the team knows it. Bugsnag is a close second.
`,
}

// The repos, by folder: the last commit's files (head) and what's on disk now (work). Agents'
// edits change work; Changes shows the difference; commit makes it the new head.
export function makeRepos() {
  const repo = (root, files, o = {}) => ({ root, head: { ...files }, work: { ...files }, branch: 'main', remote: 'origin', upstream: 'origin/main', ahead: 0, lastCommit: { hash: '4e1d2c7', subject: 'Show order totals with tax', when: '2 days ago' }, ...o })
  return {
    [code('acme-shop')]: repo(code('acme-shop'), ACME),
    [CSV_TREE]: repo(CSV_TREE, ACME, { branch: 'bridge/add-csv-export', upstream: null, worktreeOf: code('acme-shop') }),
    [code('billing-api')]: repo(code('billing-api'), BILLING, { lastCommit: { hash: 'b81f0a3', subject: 'Add Texas tax rate', when: 'yesterday' } }),
    [code('docs-site')]: repo(code('docs-site'), DOCS, { lastCommit: { hash: '9c33e10', subject: 'Webhooks page', when: '4 days ago' } }),
    [CHIEF_DIR]: { root: CHIEF_DIR, head: { ...CHIEF }, work: { ...CHIEF }, notGit: true },
  }
}

// ---------- The edits the agents make ----------
// Each takes the file as it is and returns it changed. Agents apply them through their scripts.
export const EDITS = {
  redirectTest: () => `import { describe, expect, it } from 'vitest'
import { afterSignIn } from '../src/auth/redirect'

describe('afterSignIn', () => {
  it('goes back to the page you came from', () => {
    expect(afterSignIn(new URLSearchParams('returnTo=/orders'))).toBe('/orders')
  })

  it("won't send you to another site", () => {
    expect(afterSignIn(new URLSearchParams('returnTo=//evil.example.com'))).not.toContain('evil')
  })
})
`,
  redirectFix: (where) => () => `// Where to send someone after they sign in: back to the page they came from, if it's one of
// ours. Otherwise ${where.why}.
const FALLBACK = '${where.path}'

export function afterSignIn(params: URLSearchParams): string {
  const to = params.get('returnTo')
  if (!to || !to.startsWith('/') || to.startsWith('//')) return FALLBACK
  return to
}
`,
  loginParams: (t) => t.replace('afterSignIn(new URLSearchParams())', 'afterSignIn(new URLSearchParams(location.search))'),
  csvLib: () => `// Orders as CSV, for spreadsheets. Fields with commas, quotes or line breaks are quoted.
import type { Order } from '../api/orders'

const COLUMNS: (keyof Order)[] = ['number', 'date', 'total', 'status']

const field = (v: string) => (/[",\\n]/.test(v) ? \`"\${v.replaceAll('"', '""')}"\` : v)

export function toCsv(orders: Order[]): string {
  const rows = orders.map((o) => COLUMNS.map((c) => field(String(o[c]))).join(','))
  return [COLUMNS.join(','), ...rows].join('\\n') + '\\n'
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}
`,
  csvButton: (t) => t
    .replace("import { useOrders, type Status } from '../api/orders'", "import { useOrders, type Status } from '../api/orders'\nimport { toCsv, download } from '../lib/csv'")
    .replace('        </select>\n', '        </select>\n        <button onClick={() => download(`orders-${filter}.csv`, toCsv(orders))} disabled={!orders.length}>\n          Export CSV\n        </button>\n'),
  csvTest: () => `import { describe, expect, it } from 'vitest'
import { toCsv } from '../src/lib/csv'

const order = { id: '1', number: 'A-1001', date: '2026-10-01', total: '$42.00', status: 'open' as const }

describe('toCsv', () => {
  it('starts with a header row', () => {
    expect(toCsv([]).split('\\n')[0]).toBe('number,date,total,status')
  })

  it('writes one row per order', () => {
    expect(toCsv([order]).trim().split('\\n')).toHaveLength(2)
  })

  it('quotes fields with commas', () => {
    expect(toCsv([{ ...order, total: '$1,042.00' }])).toContain('"$1,042.00"')
  })
})
`,
  conftest: () => `import pytest


@pytest.fixture
def cart():
    return [
        {"sku": "MUG-01", "price": 12.5, "qty": 2},
        {"sku": "TEE-02", "price": 19.99, "qty": 1},
    ]
`,
  invoiceTests: () => `from decimal import Decimal

import pytest

from billing.invoices import subtotal, tax, total


def test_subtotal(cart):
    assert subtotal(cart) == Decimal("44.99")


@pytest.mark.parametrize("region, expected", [
    ("US-CA", Decimal("3.26")),
    ("US-NY", Decimal("1.80")),
    ("US-TX", Decimal("2.81")),
    ("EU-DE", Decimal("0.00")),
])
def test_tax(cart, region, expected):
    assert tax(cart, region) == expected


def test_total(cart):
    assert total(cart, "US-CA") == Decimal("48.25")


def test_tax_rounds_half_up():
    # 2.00 at 6.25% is 0.125: half a cent rounds up, as on a receipt.
    assert tax([{"sku": "PIN-03", "price": 2.0, "qty": 1}], "US-TX") == Decimal("0.13")
`,
  roundHalfUp: (t) => t.replace('.quantize(Decimal("0.01"))', '.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)'),
  // Answers to review comments.
  redirectQueryTest: (t) => (t.includes('query string') ? t : t.replace(/\n}\)\n$/, `

  it('keeps the query string of the page you came from', () => {
    expect(afterSignIn(new URLSearchParams('returnTo=/orders?status=open'))).toBe('/orders?status=open')
  })
})
`)),
  csvQuoteTest: (t) => (t.includes('doubles quotes') ? t : t.replace(/\n}\)\n$/, `

  it('doubles quotes inside a field', () => {
    expect(toCsv([{ ...order, number: 'A-"1"' }])).toContain('"A-""1"""')
  })
})
`)),
  csvButtonLabel: (t) => t.replace('          Export CSV\n', '          Export {orders.length} as CSV\n'),
  taxDoc: (t) => (t.includes('half up') ? t : t.replace('def tax(lines, region):\n', 'def tax(lines, region):\n    """Tax at the region\'s rate, to the cent, rounded half up as on a receipt."""\n')),
  readmeNode: (t) => (t.includes('Node 20') ? t : t.replace('## Quick start\n', '## Quick start\n\nYou need Node 20 or newer.\n')),
  testsNamed: (t) => t.replace('def test_tax(cart, region, expected):', 'def test_tax_by_region(cart, region, expected):'),
  rateLimit: () => `import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()

# At most LIMIT events per sender in any WINDOW seconds; more get a 429 and are retried later.
LIMIT = 60
WINDOW = 60
seen = defaultdict(deque)


def allow(sender: str, now: float | None = None) -> bool:
    now = time.monotonic() if now is None else now
    q = seen[sender]
    while q and now - q[0] > WINDOW:
        q.popleft()
    if len(q) >= LIMIT:
        return False
    q.append(now)
    return True


@router.post("/webhooks/payments")
async def payment_event(request: Request):
    if not allow(request.client.host if request.client else "unknown"):
        raise HTTPException(status_code=429, detail="Too many events, retry later")
    event = await request.json()
    # TODO: verify the signature before trusting the event
    return {"received": event.get("id")}
`,
  readme: () => `# docs-site

Docs for the Acme Goods developer API, built with Astro.

## Quick start

\`\`\`sh
git clone <this repo>
cd docs-site
npm install
npm run dev
\`\`\`

Then open http://localhost:4321.

## Writing docs

Pages live in \`docs/\`, one Markdown file each. Link to other pages by file name.

## Checks

\`npm run check-links\` finds broken links in the built site.
`,
}
