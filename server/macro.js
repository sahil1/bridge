// Rates that move money decisions: Fed target range and effective rate, 2y/10y Treasuries,
// CPI inflation, unemployment, plus the Fed's meeting calendar. FRED and federalreserve.gov, no key.
import { cached } from './feeds.js'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

async function fred(id, since) {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${since}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`FRED ${id} ${res.status}`)
  return (await res.text()).trim().split('\n').slice(1).map((l) => l.split(','))
    .map(([date, v]) => ({ date, v: parseFloat(v) })).filter((r) => Number.isFinite(r.v))
}

const ago = (days) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// "2026 FOMC Meetings" panels list month + "27-28" (or "30-1" across months, "*" = projections).
async function fomcMeetings() {
  const res = await fetch('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`federalreserve.gov ${res.status}`)
  const html = await res.text()
  const out = []
  const re = /(\d{4}) FOMC Meetings([\s\S]*?)(?=\d{4} FOMC Meetings|$)/g
  let m
  while ((m = re.exec(html))) {
    const year = Number(m[1])
    const it = /fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g
    let x
    while ((x = it.exec(m[2]))) {
      const months = x[1].trim().split('/')
      const mi = MONTHS.indexOf(months.at(-1).trim())
      const d = /(\d+)(?:\s*-\s*(\d+))?(\*)?/.exec(x[2])
      if (mi < 0 || !d) continue
      const lastDay = Number(d[2] || d[1])
      const end = new Date(year, mi, lastDay)
      out.push({ date: end.toISOString().slice(0, 10), label: `${x[1].trim()} ${x[2].replace('*', '').trim()}`, projections: !!d[3] })
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1))
}

export function makeMacro() {
  return cached(3 * 60 * 60 * 1000, async () => {
    const [upper, lower, eff, t2, t10, cpi, unrate, meetings] = await Promise.all([
      fred('DFEDTARU', ago(1100)), fred('DFEDTARL', ago(30)), fred('DFF', ago(400)),
      fred('DGS2', ago(400)), fred('DGS10', ago(400)), fred('CPIAUCSL', ago(800)), fred('UNRATE', ago(800)),
      fomcMeetings().catch(() => []),
    ])
    // Rate decisions: days the upper bound changed.
    const moves = []
    for (let i = 1; i < upper.length; i++) if (upper[i].v !== upper[i - 1].v) moves.push({ date: upper[i].date, bps: Math.round((upper[i].v - upper[i - 1].v) * 100) })
    const cpiYoY = cpi.slice(12).map((r, i) => ({ date: r.date, v: +((r.v / cpi[i].v - 1) * 100).toFixed(2) }))
    const today = new Date().toISOString().slice(0, 10)
    const weekly = (rows) => rows.filter((_, i) => i % 5 === 0 || i === rows.length - 1)
    const pick = (rows, back) => rows.at(-1 - back) || rows[0]
    return {
      fed: {
        upper: upper.at(-1)?.v, lower: lower.at(-1)?.v, effective: eff.at(-1)?.v, asOf: eff.at(-1)?.date,
        lastMove: moves.at(-1) || null, moves: moves.slice(-8),
        next: meetings.find((x) => x.date >= today) || null,
        meetings: meetings.filter((x) => x.date >= ago(200)).slice(0, 12),
        history: weekly(eff),
      },
      treasury: {
        t2: t2.at(-1)?.v, t10: t10.at(-1)?.v, asOf: t10.at(-1)?.date,
        spread: t2.length && t10.length ? +(t10.at(-1).v - t2.at(-1).v).toFixed(2) : null,
        t10WeekAgo: pick(t10, 5)?.v, t10YearAgo: t10[0]?.v,
        history10: weekly(t10), history2: weekly(t2),
      },
      inflation: { yoy: cpiYoY.at(-1)?.v, asOf: cpiYoY.at(-1)?.date, prior: cpiYoY.at(-2)?.v, history: cpiYoY },
      jobs: { unemployment: unrate.at(-1)?.v, asOf: unrate.at(-1)?.date, prior: unrate.at(-2)?.v, history: unrate.slice(-24) },
      source: 'FRED (St. Louis Fed), federalreserve.gov',
    }
  })
}
