import { locale } from '../../i18n/index.js'

// A sheet's chart, drawn from its numbers: a column, bar, line, area or pie chart, as Excel would
// show it, small enough for the side of the sheet. Series take the eight colours in order (the
// same order in light and dark, each stepped for its background), with a legend when there's
// more than one; each mark says its value when pointed at.
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']
const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']
const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString(locale(), { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 0 }) : '')
const short = (n) => {
  const a = Math.abs(n)
  return a >= 1e9 ? `${fmt(n / 1e9)}B` : a >= 1e6 ? `${fmt(n / 1e6)}M` : a >= 1e4 ? `${fmt(n / 1e3)}K` : fmt(n)
}
// Round steps for the value axis: 0 and 4-5 lines up to past the largest value.
function ticks(lo, hi) {
  if (hi === lo) hi = lo + 1
  const raw = (hi - lo) / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)
  const out = []
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(+v.toPrecision(12))
  if (out[out.length - 1] < hi) out.push(+(out[out.length - 1] + step).toPrecision(12))
  return out
}

export default function SheetChart({ chart, dark = false, height = 200 }) {
  const colors = dark ? SERIES_DARK : SERIES
  const { type = 'column', cats = [], series = [] } = chart
  const W = 340, H = height, L = 44, R = 10, T = 10, B = 30
  const shown = series.slice(0, 8)
  const vals = shown.flatMap((s) => s.vals.filter(Number.isFinite))
  if (!shown.length || !vals.length) return null
  if (type === 'pie' || type === 'doughnut') {
    const s = shown[0]
    const parts = s.vals.map((v, i) => ({ v: Math.max(0, v || 0), name: String(cats[i] ?? i + 1), i })).filter((p) => p.v > 0)
    const total = parts.reduce((a, p) => a + p.v, 0) || 1
    const r = (H - 20) / 2, cx = r + 10, cy = H / 2
    let a0 = -Math.PI / 2
    return (
      <svg className="sc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chart.title || s.name || ''}>
        {parts.map((p) => {
          const a1 = a0 + (p.v / total) * Math.PI * 2
          const big = a1 - a0 > Math.PI ? 1 : 0
          const d = parts.length === 1 ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z` : `M ${cx} ${cy} L ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${big} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`
          a0 = a1
          return <path key={p.i} d={d} fill={colors[p.i % 8]} className="sc-slice"><title>{`${p.name}: ${fmt(p.v)} (${Math.round((p.v / total) * 100)}%)`}</title></path>
        })}
        {type === 'doughnut' && <circle cx={cx} cy={cy} r={r * 0.55} className="sc-hole" />}
        <g className="sc-legend">{parts.slice(0, 8).map((p, k) => <g key={p.i} transform={`translate(${2 * r + 30} ${16 + k * 20})`}><rect width="10" height="10" rx="2" fill={colors[p.i % 8]} /><text x="16" y="9">{p.name.slice(0, 22)}</text></g>)}</g>
      </svg>
    )
  }
  const horizontal = type === 'bar'
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals)
  const tk = ticks(lo, hi)
  const min = tk[0], max = tk[tk.length - 1]
  const n = Math.max(cats.length, ...shown.map((s) => s.vals.length))
  const legend = shown.length > 1
  const top = T + (legend ? 18 : 0)
  const pw = W - L - R, ph = H - top - B
  const scale = (v) => (horizontal ? L + ((v - min) / (max - min)) * pw : top + ph - ((v - min) / (max - min)) * ph)
  const band = (horizontal ? ph : pw) / n
  const zero = scale(0)
  const label = (i) => String(cats[i] ?? i + 1)
  const every = Math.max(1, Math.ceil(n / (horizontal ? 10 : 8)))
  return (
    <svg className="sc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chart.title || shown.map((s) => s.name).join(', ')}>
      {legend && <g className="sc-legend">{shown.map((s, k) => <g key={k} transform={`translate(${L + k * Math.min(96, pw / shown.length)} 2)`}><rect width="10" height="10" rx="2" fill={colors[k]} /><text x="14" y="9">{String(s.name || '').slice(0, 14)}</text></g>)}</g>}
      {tk.map((v) => (horizontal
        ? <g key={v}><line className="sc-grid" x1={scale(v)} x2={scale(v)} y1={top} y2={top + ph} /><text className="sc-axis" x={scale(v)} y={H - 8} textAnchor="middle">{short(v)}</text></g>
        : <g key={v}><line className="sc-grid" x1={L} x2={W - R} y1={scale(v)} y2={scale(v)} /><text className="sc-axis" x={L - 6} y={scale(v) + 3} textAnchor="end">{short(v)}</text></g>))}
      {Array.from({ length: n }, (_, i) => (i % every ? null : horizontal
        ? <text key={i} className="sc-axis" x={L - 6} y={top + band * i + band / 2 + 3} textAnchor="end">{label(i).slice(0, 8)}</text>
        : <text key={i} className="sc-axis" x={L + band * i + band / 2} y={H - 12} textAnchor="middle">{label(i).slice(0, 10)}</text>))}
      {(type === 'line' || type === 'area' || type === 'scatter') ? shown.map((s, k) => {
        const pts = s.vals.map((v, i) => (Number.isFinite(v) ? [L + band * i + band / 2, scale(v), v, i] : null)).filter(Boolean)
        return (
          <g key={k}>
            {type === 'area' && pts.length > 1 && <path d={`M ${pts[0][0]} ${zero} ${pts.map((p) => `L ${p[0]} ${p[1]}`).join(' ')} L ${pts[pts.length - 1][0]} ${zero} Z`} fill={colors[k]} opacity="0.18" />}
            {type !== 'scatter' && <polyline points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')} fill="none" stroke={colors[k]} strokeWidth="2" strokeLinejoin="round" />}
            {pts.map((p) => <circle key={p[3]} cx={p[0]} cy={p[1]} r={pts.length > 24 ? 2 : 3.5} fill={colors[k]} className="sc-dot"><title>{`${s.name ? `${s.name}, ` : ''}${label(p[3])}: ${fmt(p[2])}`}</title></circle>)}
          </g>
        )
      }) : shown.map((s, k) => {
        const gap = 2, inner = Math.max(1, (band * 0.72 - gap * (shown.length - 1)) / shown.length)
        return s.vals.map((v, i) => {
          if (!Number.isFinite(v)) return null
          const at = band * i + band * 0.14 + k * (inner + gap)
          const a = scale(v), lo2 = Math.min(a, zero), len = Math.max(1, Math.abs(a - zero))
          return horizontal
            ? <rect key={`${k}-${i}`} className="sc-bar" x={lo2} y={top + at} width={len} height={inner} rx={Math.min(4, inner / 2)} fill={colors[k]}><title>{`${s.name ? `${s.name}, ` : ''}${label(i)}: ${fmt(v)}`}</title></rect>
            : <rect key={`${k}-${i}`} className="sc-bar" x={L + at} y={lo2} width={inner} height={len} rx={Math.min(4, inner / 2)} fill={colors[k]}><title>{`${s.name ? `${s.name}, ` : ''}${label(i)}: ${fmt(v)}`}</title></rect>
        })
      })}
      <line className="sc-base" x1={horizontal ? zero : L} x2={horizontal ? zero : W - R} y1={horizontal ? top : zero} y2={horizontal ? top + ph : zero} />
    </svg>
  )
}

// A chart's numbers from cells: the first column the labels and the first row the series' names,
// when they're words (else every column is a series and the rows are numbered).
export function chartOfGrid(rows, type = 'column', title = '') {
  const num = (v) => (typeof v === 'number' ? v : v === '' || v == null ? NaN : Number(String(v).replace(/[,$€£%\s]/g, '')))
  if (!rows.length) return { type, title, cats: [], series: [] }
  const named = rows[0].slice(1).some((v) => v !== '' && v != null && !Number.isFinite(num(v))) || (rows[0].length === 1 && !Number.isFinite(num(rows[0][0])))
  const labelled = rows.slice(named ? 1 : 0).some((r) => r[0] !== '' && r[0] != null && !Number.isFinite(num(r[0])))
  const body = rows.slice(named ? 1 : 0)
  const first = labelled ? 1 : 0
  const width = Math.max(...rows.map((r) => r.length))
  const series = []
  for (let c = first; c < width; c++) series.push({ name: named ? String(rows[0][c] ?? '') : '', vals: body.map((r) => num(r[c])) })
  return { type, title, cats: body.map((r, i) => (labelled ? String(r[0] ?? '') : String(i + 1))), series: series.filter((s) => s.vals.some(Number.isFinite)) }
}
