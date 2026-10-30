// Markets: fixed indices from config + an editable watchlist shared by every device.
// Quotes, ranges, symbol search and news all come from Yahoo Finance (no key).
import fs from 'node:fs'
import path from 'node:path'
import { cacheFile } from './paths.js'

const FILE = cacheFile('watchlist.json')
const UA = 'Mozilla/5.0'

async function yjson(pathAndQuery) {
  for (const host of ['query2', 'query1']) {
    try {
      const res = await fetch(`https://${host}.finance.yahoo.com${pathAndQuery}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
      if (res.ok) return await res.json()
    } catch { /* try the other host */ }
  }
  throw new Error('Yahoo Finance unavailable')
}

// ---------- links ----------
const GOOGLE_EXCHANGE = { NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ', NAS: 'NASDAQ', NYQ: 'NYSE', ASE: 'NYSEAMERICAN', PCX: 'NYSEARCA', BTS: 'BATS' }
const GOOGLE_INDEX = { '^GSPC': '.INX:INDEXSP', '^IXIC': '.IXIC:INDEXNASDAQ', '^DJI': '.DJI:INDEXDJX', '^RUT': 'RUT:INDEXRUSSELL', '^VIX': 'VIX:INDEXCBOE' }

export function links(symbol, exchange, type) {
  const yahoo = `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`
  let google = null
  if (GOOGLE_INDEX[symbol]) google = `https://www.google.com/finance/quote/${GOOGLE_INDEX[symbol]}`
  else if (type === 'CRYPTOCURRENCY') google = `https://www.google.com/finance/quote/${symbol}`
  else if (GOOGLE_EXCHANGE[exchange]) google = `https://www.google.com/finance/quote/${symbol}:${GOOGLE_EXCHANGE[exchange]}`
  return { google, yahoo }
}

// ---------- watchlist ----------
function defaults(cfg) {
  const m = cfg.market || {}
  const crypto = (m.crypto || []).map((id) => ({ bitcoin: 'BTC-USD', ethereum: 'ETH-USD', solana: 'SOL-USD' }[id] || id))
  return [...(m.stocks || []).map(([s]) => s), ...(m.metals || []).map(([s]) => s), ...crypto]
}

export function readWatchlist(cfg) {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).symbols } catch { return defaults(cfg) }
}

function writeWatchlist(symbols) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify({ symbols, updatedAt: new Date().toISOString() }, null, 2))
}

// ---------- quotes ----------
async function quote(symbol, nameOverride) {
  const d = await yjson(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`)
  const r = d.chart?.result?.[0]
  const m = r?.meta
  if (!m || m.regularMarketPrice == null) throw new Error(`No data for ${symbol}`)
  const closes = (r.indicators?.quote?.[0]?.close || []).filter((v) => v != null)
  const times = (r.timestamp || []).filter((_, i) => r.indicators?.quote?.[0]?.close?.[i] != null)
  const price = m.regularMarketPrice
  const prior = closes.length >= 2 ? closes.at(-2) : (m.previousClose ?? price)
  const change = price - prior
  const monthAgo = closes.length > 22 ? closes.at(-23) : closes[0]
  return {
    symbol,
    name: nameOverride || m.shortName || m.longName || symbol,
    type: m.instrumentType,
    exchange: m.exchangeName,
    exchangeName: m.fullExchangeName,
    currency: m.currency,
    price,
    change,
    changePercent: prior ? (change / prior) * 100 : 0,
    monthChangePercent: monthAgo ? ((price - monthAgo) / monthAgo) * 100 : null,
    dayHigh: m.regularMarketDayHigh ?? null,
    dayLow: m.regularMarketDayLow ?? null,
    yearHigh: m.fiftyTwoWeekHigh ?? null,
    yearLow: m.fiftyTwoWeekLow ?? null,
    volume: m.regularMarketVolume ?? null,
    asOf: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    spark: closes.slice(-22),
    history: closes.map((c, i) => ({ t: times[i] ? times[i] * 1000 : null, c })),
    links: links(symbol, m.exchangeName, m.instrumentType),
  }
}

const settle = async (p) => { try { return await p } catch { return null } }

// Price history for the chart's range picker. 60d is cut from 3 months of daily closes.
const RANGES = { '1mo': ['1mo', '1d'], '60d': ['3mo', '1d', 60], '3mo': ['3mo', '1d'], '6mo': ['6mo', '1d'], ytd: ['ytd', '1d'], '1y': ['1y', '1d'], '5y': ['5y', '1wk'], max: ['max', '1mo'] }
const histCache = new Map()
export async function history(symbol, range = '3mo') {
  const r = RANGES[range]
  if (!r || !/^[\w.^=-]{1,20}$/.test(symbol || '')) throw new Error('Bad symbol or range')
  const key = `${symbol}|${range}`
  const hit = histCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value
  const d = await yjson(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${r[1]}&range=${r[0]}`)
  const res = d.chart?.result?.[0]
  const q = res?.indicators?.quote?.[0]?.close || []
  let points = (res?.timestamp || []).map((t, i) => ({ t: t * 1000, c: q[i] })).filter((p) => p.c != null)
  if (r[2]) points = points.filter((p) => p.t >= Date.now() - r[2] * 864e5)
  const value = { symbol, range, points }
  histCache.set(key, { at: Date.now(), value })
  if (histCache.size > 200) histCache.delete(histCache.keys().next().value)
  return value
}

export function makeMarket(cfg) {
  let cache = null
  let at = 0
  const load = async () => {
    const indices = cfg.market?.indices || []
    const watch = readWatchlist(cfg)
    const [idx, wl] = await Promise.all([
      Promise.all(indices.map(([s, n]) => settle(quote(s, n)))),
      Promise.all(watch.map((s) => settle(quote(s)))),
    ])
    const out = { indices: idx.filter(Boolean), watchlist: wl.map((q, i) => q || { symbol: watch[i], error: true }), fetchedAt: new Date().toISOString(), stale: false }
    if (!out.indices.length && !out.watchlist.some((q) => !q.error)) throw new Error('No market data returned')
    return out
  }
  const get = async (force = false) => {
    if (!force && cache && Date.now() - at < 5 * 60 * 1000) return cache
    try { cache = await load(); at = Date.now() } catch (e) { if (cache) return { ...cache, stale: true, error: e.message }; throw e }
    return cache
  }
  get.invalidate = () => { at = 0 }
  return get
}

// ---------- edit, search, news ----------
export async function addSymbol(cfg, raw) {
  const symbol = String(raw || '').trim().toUpperCase()
  if (!/^[\^A-Z0-9.=\-]{1,15}$/.test(symbol)) throw new Error('That does not look like a ticker')
  const list = readWatchlist(cfg)
  if (list.includes(symbol)) return { symbols: list }
  const q = await quote(symbol) // validates the symbol exists
  writeWatchlist([...list, symbol])
  return { symbols: [...list, symbol], added: q.name }
}

export function removeSymbol(cfg, symbol) {
  const list = readWatchlist(cfg).filter((s) => s !== String(symbol).toUpperCase())
  writeWatchlist(list)
  return { symbols: list }
}

export function moveSymbol(cfg, symbol, dir) {
  const list = readWatchlist(cfg)
  const i = list.indexOf(String(symbol).toUpperCase())
  const j = i + (dir === 'up' ? -1 : 1)
  if (i < 0 || j < 0 || j >= list.length) return { symbols: list }
  ;[list[i], list[j]] = [list[j], list[i]]
  writeWatchlist(list)
  return { symbols: list }
}

export async function search(q) {
  const d = await yjson(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`)
  return (d.quotes || []).filter((x) => x.symbol && x.quoteType !== 'OPTION')
    .map((x) => ({ symbol: x.symbol, name: x.shortname || x.longname || x.symbol, exchange: x.exchDisp || x.exchange, type: x.quoteType }))
}

const newsCache = new Map()
// Yahoo's news search matches tickers. Crypto searches well by name (Bitcoin);
// futures have no news of their own, so use the matching ETF's coverage.
const FUTURES_PROXY = { 'GC=F': 'GLD', 'SI=F': 'SLV', 'HG=F': 'CPER', 'PL=F': 'PPLT', 'CL=F': 'USO', 'BZ=F': 'BNO', 'NG=F': 'UNG' }
function newsQuery(symbol, name) {
  if (FUTURES_PROXY[symbol]) return FUTURES_PROXY[symbol]
  if (!/-USD$|=F$|^\^/.test(symbol)) return symbol
  return (name || symbol).replace(/\s+USD$/i, '').replace(/\s+[A-Z][a-z]{2}\s+\d{2}$/, '').trim() || symbol
}

export async function news(symbols, nameOf = () => null) {
  const out = []
  await Promise.all(symbols.slice(0, 12).map(async (s) => {
    const hit = newsCache.get(s)
    let items = hit && Date.now() - hit.at < 15 * 60 * 1000 ? hit.items : null
    if (!items) {
      const d = await settle(yjson(`/v1/finance/search?q=${encodeURIComponent(newsQuery(s, nameOf(s)))}&quotesCount=0&newsCount=6`))
      items = (d?.news || []).map((n) => ({
        id: n.uuid || n.link, title: n.title, publisher: n.publisher, url: n.link,
        time: n.providerPublishTime ? n.providerPublishTime * 1000 : null,
        tickers: n.relatedTickers || [],
        thumb: n.thumbnail?.resolutions?.find((r) => r.width >= 100 && r.width <= 200)?.url || null,
      }))
      if (items.length) newsCache.set(s, { at: Date.now(), items }) // never cache a failed or empty lookup
    }
    for (const n of items) out.push({ ...n, symbol: s })
  }))
  // One entry per article, tagged with every watched symbol it came up for.
  const byId = new Map()
  for (const n of out) {
    const key = (n.title || n.id).toLowerCase().replace(/\W+/g, ' ').trim()
    const cur = byId.get(key)
    if (cur) { if (!cur.symbols.includes(n.symbol)) cur.symbols.push(n.symbol) }
    else byId.set(key, { ...n, symbols: [n.symbol] })
  }
  return [...byId.values()].sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 40)
}
