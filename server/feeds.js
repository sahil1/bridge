// Data sources for the trackers. Each feed caches in memory and keeps
// serving its last good value (flagged stale) if a refresh fails.
import { execFile } from 'node:child_process'
import { localBin, IS_WIN } from './paths.js'

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

function runQuotaAxi(maxAge) {
  const bin = localBin('quota-axi')
  return new Promise((resolve, reject) => {
    execFile(bin, ['--json', '--full', '--max-age', maxAge], { shell: IS_WIN, timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(err)
      try { resolve(JSON.parse(stdout)) } catch (e) { reject(e) }
    })
  })
}

const STATUS_HINTS = {
  keychain_prompt_required: 'Run: npx quota-axi --provider claude --allow-keychain-prompt, then choose Always Allow',
}

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

export function makeQuota(cfg) {
  const ttl = (cfg.quota?.ttlMinutes || 5) * 60 * 1000
  // Reused (cached) quota-axi readings omit account identity; remember it from fresh reads.
  const accounts = {}
  return cached(ttl, async () => {
    let raw = await runQuotaAxi(`${Math.max(1, cfg.quota?.ttlMinutes || 5)}m`)
    const missing = (raw.providers || []).some((p) => p.state?.status === 'fresh' && !p.account && !accounts[p.provider])
    if (missing) raw = await runQuotaAxi('0s')
    for (const p of raw.providers || []) {
      if (p.account) accounts[p.provider] = p.account
      else if (accounts[p.provider]) p.account = accounts[p.provider]
    }
    let providers = (raw.providers || []).map(normalizeProvider)
    if (cfg.quota?.hideNotSetUp !== false) providers = providers.filter((p) => !p.notSetUp)
    // quota-axi's spendPriority: higher means "spend this first" (use it before it resets).
    const best = providers
      .filter((p) => p.usable && p.percentRemaining > 5 && p.spendPriority != null)
      .sort((a, b) => b.spendPriority - a.spendPriority)[0]
    return { generatedAt: raw.generatedAt, providers, bestNow: best?.provider || null }
  })
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
    if (lat == null || lon == null) throw new Error('Set "location" (label, lat, lon) in ~/.bridge-ai/config.json to see weather')
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
