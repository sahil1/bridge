// Headlines by section from public RSS/Atom feeds and Hacker News (Algolia API). No keys.
// Override the sections in config.local.json under "news": { "sections": [{ id, label, feeds: [{ name, url }] }] }.
import { cached } from './feeds.js'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

export const DEFAULT_SECTIONS = [
  { id: 'tech', label: 'Technology & AI', feeds: [
    { name: 'Hacker News', url: 'hn:front_page' },
    { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
    { name: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/' },
    { name: 'CNBC Tech', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19854910' },
    { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  ] },
  { id: 'markets', label: 'Markets & economy', feeds: [
    { name: 'CNBC', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114' },
    { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  ] },
  { id: 'energy', label: 'Energy & industry', feeds: [
    { name: 'Utility Dive', url: 'https://www.utilitydive.com/feeds/news/' },
    { name: 'Canary Media', url: 'https://www.canarymedia.com/rss.rss' },
  ] },
]

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…' }
const clean = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&(\w+);/g, (m, n) => ENT[n] ?? m)
  .replace(/\s+/g, ' ').trim()

const tag = (xml, name) => (new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml) || [])[1]

function parseFeed(xml, source) {
  const items = []
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/g) || []
  for (const b of blocks.slice(0, 25)) {
    const link = clean(tag(b, 'link')) || (/<link[^>]*href="([^"]+)"/.exec(b) || [])[1]
    const date = clean(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'))
    const t = Date.parse(date)
    items.push({
      title: clean(tag(b, 'title')),
      link,
      source,
      published: Number.isFinite(t) ? new Date(t).toISOString() : null,
      summary: clean(tag(b, 'description') || tag(b, 'summary') || '').slice(0, 220) || null,
    })
  }
  return items.filter((i) => i.title && i.link)
}

async function hn(tagName, source) {
  const res = await fetch(`https://hn.algolia.com/api/v1/search?tags=${tagName}&hitsPerPage=25`, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`HN ${res.status}`)
  const d = await res.json()
  return d.hits.map((h) => ({
    title: h.title, link: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, source,
    published: h.created_at, summary: null, points: h.points, comments: h.num_comments,
    discussion: `https://news.ycombinator.com/item?id=${h.objectID}`,
  }))
}

async function fetchFeed(f) {
  if (f.url.startsWith('hn:')) return hn(f.url.slice(3), f.name)
  const res = await fetch(f.url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, text/xml' }, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`${f.name} ${res.status}`)
  return parseFeed(await res.text(), f.name)
}

export function makeNews(cfg) {
  const sections = cfg.news?.sections || DEFAULT_SECTIONS
  return cached(20 * 60 * 1000, async () => {
    const out = await Promise.all(sections.map(async (s) => {
      const results = await Promise.allSettled(s.feeds.map(fetchFeed))
      const failed = s.feeds.filter((_, i) => results[i].status === 'rejected').map((f) => f.name)
      const seen = new Set()
      const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
        .filter((i) => { const k = i.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true })
        .sort((a, b) => (b.published || '').localeCompare(a.published || ''))
        .slice(0, 60)
      return { id: s.id, label: s.label, sources: s.feeds.map((f) => f.name), failed, items }
    }))
    if (out.every((s) => !s.items.length)) throw new Error('No news feeds reachable')
    return { sections: out }
  })
}
