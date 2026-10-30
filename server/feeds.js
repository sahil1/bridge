// Data sources for the trackers. Each feed caches in memory and keeps
// serving its last good value (flagged stale) if a refresh fails.
import { execFile } from 'node:child_process'
import { localBin, IS_WIN } from './paths.js'
import * as accounts from './accounts.js'
import { hiddenProvider } from './labs.js'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

export function cached(ttlMs, fn) {
  let value = null
  let at = 0
  let inflight = null
  return async (force = false) => {
    if (!force && value && Date.now() - at < ttlMs) return value
    if (inflight) return inflight
    inflight = fn()
      .then((v) => { value = { ...v, fetchedAt: new Date().toISOString(), stale: false }; at = Date.now(); return value })
      .catch((err) => {
        if (value) return { ...value, stale: true, error: err.message }
        throw err
      })
      .finally(() => { inflight = null })
    return inflight
  }
}

async function getJSON(url, timeout = 10000, ua = UA) {
  const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) })
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`)
  return res.json()
}

// ---------- Quota (quota-axi) ----------

// provider: just that one; env: added to ours (an account's config folder); allow: let macOS ask
// for the Keychain once (only when you click Allow).
function runQuotaAxi(maxAge, { provider, env, allow } = {}) {
  const bin = localBin('quota-axi')
  const args = [...(provider ? ['--provider', provider] : []), '--json', '--full', '--max-age', maxAge, ...(allow ? ['--allow-keychain-prompt'] : [])]
  return new Promise((resolve, reject) => {
    execFile(bin, args, { shell: IS_WIN, timeout: 120000, maxBuffer: 8 * 1024 * 1024, env: env ? { ...process.env, ...env } : undefined }, (err, stdout) => {
      if (err && !stdout) return reject(err)
      try { resolve(JSON.parse(stdout)) } catch (e) { reject(e) }
    })
  })
}

const STATUS_HINTS = {
  keychain_prompt_required: 'Run: npx quota-axi --provider claude --allow-keychain-prompt, then choose Always Allow',
}
// Readings macOS holds back until you allow Keychain access once (the Allow button). Unreachable:
// quota-axi couldn't tell whether the item is there without asking, which Allow does.
const NEEDS_ALLOW = new Set(['keychain_prompt_required', 'keychain_access_denied', 'keychain_prompt_timeout', 'keychain_unreachable'])

function normalizeProvider(p) {
  const avail = p.quotaSemantics?.effectiveAvailability || []
  const primary = avail.find((a) => a.scope === 'all_models' || a.scope === 'all_products') || avail[0]
  const usable = p.state?.status === 'fresh' || p.state?.status === 'stale'
  return {
    provider: p.provider,
    plan: p.plan || null,
    status: p.state?.status || 'unknown',
    error: p.state?.error || null,
    hint: STATUS_HINTS[p.state?.error] || null,
    allow: NEEDS_ALLOW.has(p.state?.error),
    notSetUp: !!p.notSetUp,
    usable,
    percentRemaining: primary?.effectivePercentRemaining ?? null,
    pace: primary?.pace?.status || null,
    runway: primary?.runway?.status || null,
    spendPriority: primary?.selection?.spendPriority ?? null,
    account: p.account ? { email: p.account.email || null, organization: p.account.organization || null } : null,
    refreshedAt: p.state?.refreshedAt || null,
    windows: (p.windows || []).map((w) => ({
      id: w.id, label: w.label, kind: w.kind, percentRemaining: w.percentRemaining, resetsAt: w.resetsAt || null,
      pace: w.pace ? {
        status: w.pace.status,
        elapsedPercent: w.pace.elapsedPercent ?? null,
        burnMultiple: w.pace.burnMultiple ?? null,
        projectedExhaustedAt: w.pace.projectedExhaustedAt || null,
      } : null,
    })),
  }
}

// providers: your usual logins, as before. accounts: every account of the agents that can have
// several (accounts.js), each with its own reading; the usual login is that kind's Default.
export function makeQuota(cfg) {
  const ttl = (cfg.quota?.ttlMinutes || 5) * 60 * 1000
  const maxAge = `${Math.max(1, cfg.quota?.ttlMinutes || 5)}m`
  // Reused (cached) quota-axi readings omit account identity; remember it from fresh reads.
  const who = {}
  const remember = (key, p) => { if (p.account) who[key] = p.account; else if (who[key]) p.account = who[key] }
  const base = cached(ttl, async () => {
    let raw = await runQuotaAxi(maxAge)
    const missing = (raw.providers || []).some((p) => p.state?.status === 'fresh' && !p.account && !who[p.provider])
    if (missing) raw = await runQuotaAxi('0s')
    for (const p of raw.providers || []) remember(p.provider, p)
    const all = (raw.providers || []).map(normalizeProvider)
    for (const kind of new Set(all.map((p) => p.provider))) if (accounts.supports(kind)) accounts.noteQuota(`${kind}-default`, all.find((p) => p.provider === kind))
    const providers = (cfg.quota?.hideNotSetUp !== false ? all.filter((p) => !p.notSetUp) : all).filter((p) => !hiddenProvider(p.provider))
    // quota-axi's spendPriority: higher means "spend this first" (use it before it resets).
    const best = providers
      .filter((p) => p.usable && p.percentRemaining > 5 && p.spendPriority != null)
      .sort((a, b) => b.spendPriority - a.spendPriority)[0]
    return { generatedAt: raw.generatedAt, providers, bestNow: best?.provider || null }
  })

  // Extra accounts: the same reading for that one agent, with the account's folder in the
  // environment so quota-axi reads its login (on macOS, its own Keychain item). Each is cached on
  // its own and read in parallel, so a new account shows up on the next look and a slow one
  // doesn't hold up the rest.
  const extra = new Map() // account id -> cached reading
  const readerOf = (t) => {
    if (!extra.has(t.id)) {
      const read = async (age) => {
        const raw = await runQuotaAxi(age, { provider: t.kind, env: t.env })
        // Codex also answers for other logins it finds (Pi's); keep this folder's own.
        const lanes = (raw.providers || []).filter((p) => p.provider === t.kind)
        const p = lanes.find((x) => x.accountKeys?.includes('codex-home')) || lanes.find((x) => !x.accountKeys?.some((k) => k.startsWith('openai-codex')))
        if (p) remember(t.id, p)
        return p ? normalizeProvider(p) : null
      }
      extra.set(t.id, cached(ttl, async () => {
        const reading = await read(maxAge)
        // Its sign-in ran out: renewed without a browser when no agent is on it, then read again.
        if (accounts.isLapsed(reading) && await accounts.renew(t.id)) return { reading: (await read('0s').catch(() => null)) || reading }
        return { reading }
      }))
    }
    return extra.get(t.id)
  }
  const failed = (e) => ({ status: 'error', error: e.message, usable: false, percentRemaining: null, windows: [] })

  // Off unless you turn it on (the Usage card, or quota.read in settings): reading how much of a
  // plan is left means asking each provider with the sign-in your agents use here, and some
  // providers' terms don't allow other apps to do that.
  const off = () => !cfg.quota?.read
  const quota = async (force = false) => {
    if (off()) return { generatedAt: null, providers: [], bestNow: null, off: true, accounts: accounts.groups() }
    const targets = accounts.quotaTargets()
    const [q, more] = await Promise.all([base(force), Promise.all(targets.map((t) => readerOf(t)(force).then((v) => v.reading, failed)))])
    targets.forEach((t, i) => accounts.noteQuota(t.id, more[i]))
    return { ...q, accounts: accounts.groups() }
  }
  // An account that just signed in: read it now, rather than keep the reading taken before its
  // login existed until the next one.
  quota.account = async (id) => {
    if (off()) return
    const t = accounts.quotaTargets().find((x) => x.id === id)
    if (t) accounts.noteQuota(t.id, await readerOf(t)(true).then((v) => v.reading, failed))
    else if (/-default$/.test(id)) await base(true)
  }
  // Allow: quota-axi once with --allow-keychain-prompt for that account, so macOS shows its
  // Keychain window (Always Allow lets later reads through without asking), then read it again.
  quota.allow = async (id) => {
    if (off()) throw new Error('Turn on plan usage first (Usage card)')
    // Your usual login of any provider (Copilot's CLI asks too), or an extra account.
    const t = /-default$/.test(id) ? { id, kind: id.replace(/-default$/, '') } : accounts.quotaTargets().find((x) => x.id === id)
    if (!t || !/^[a-z][a-z0-9-]*$/.test(t.kind)) throw new Error('No such account')
    await runQuotaAxi('0', { provider: t.kind, env: t.env, allow: true })
    await (t.env ? readerOf(t)(true) : base(true))
    return quota()
  }
  return quota
}

// ---------- Weather (Open-Meteo, no key) ----------

const WMO = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
}

export function makeWeather(cfg) {
  const { lat, lon, timezone = 'auto', label } = cfg.location || {}
  return cached(15 * 60 * 1000, async () => {
    // noLocation: the Weather card offers a city picker.
    if (lat == null || lon == null) throw Object.assign(new Error('Pick your city to see the weather.'), { code: 'noLocation' })
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m' +
      '&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max' +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(timezone)}&forecast_days=4`
    const d = await getJSON(url)
    return {
      location: label,
      current: {
        temp: Math.round(d.current.temperature_2m),
        feels: Math.round(d.current.apparent_temperature),
        humidity: d.current.relative_humidity_2m,
        wind: Math.round(d.current.wind_speed_10m),
        code: d.current.weather_code,
        summary: WMO[d.current.weather_code] || '—',
      },
      daily: d.daily.time.map((date, i) => ({
        date,
        hi: Math.round(d.daily.temperature_2m_max[i]),
        lo: Math.round(d.daily.temperature_2m_min[i]),
        code: d.daily.weather_code[i],
        summary: WMO[d.daily.weather_code[i]] || '—',
        rain: d.daily.precipitation_probability_max[i],
      })),
    }
  })
}

// ---------- Mortgage (Freddie Mac PMMS via FRED, no key) ----------

function payment(principal, ratePct, years = 30) {
  const r = ratePct / 100 / 12
  const n = years * 12
  return r === 0 ? principal / n : (principal * r * (1 + r) ** n) / ((1 + r) ** n - 1)
}

export function makeMortgage(cfg) {
  return cached(6 * 60 * 60 * 1000, async () => {
    const res = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US,MORTGAGE15US', {
      headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`FRED ${res.status}`)
    const rows = (await res.text()).trim().split('\n').slice(1)
      .map((l) => l.split(','))
      .map(([date, f30, f15]) => ({ date, fixed30: parseFloat(f30), fixed15: parseFloat(f15) }))
      .filter((r) => Number.isFinite(r.fixed30))
    // Full weekly history (since 1971) so the chart can show any range.
    const history = rows
    const latest = history.at(-1)
    const yearAgo = history.at(-53)
    const out = {
      source: 'Freddie Mac PMMS (FRED)',
      latest,
      yearAgo,
      history,
    }
    const mine = cfg.mortgage
    if (mine) {
      const refiPI = payment(mine.balance, latest.fixed30, 30)
      const monthlySavings = mine.monthlyPI - refiPI
      out.mine = {
        ...mine,
        refi30PI: Math.round(refiPI),
        // Only a lower market rate makes a refi case; otherwise savings are an artifact of re-amortizing.
        refiWorthChecking: latest.fixed30 < mine.rate && monthlySavings > 0,
        monthlySavings: Math.round(monthlySavings),
        breakevenMonths: latest.fixed30 < mine.rate && monthlySavings > 0 ? Math.ceil(mine.closingCosts / monthlySavings) : null,
        spread: +(mine.rate - latest.fixed30).toFixed(2),
      }
    }
    return out
  })
}
