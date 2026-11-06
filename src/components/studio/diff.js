// What changed between two versions of a file, line by line (Myers' diff): [{ t: ' ' | '-' | '+',
// line }]. Lines the same on both sides at the start and the end are set aside first, so a small
// change in a long file is quick. A Word file is compared by its text (mammoth).
export function lineDiff(a, b) {
  const x = String(a).split('\n'), y = String(b).split('\n')
  let s = 0
  while (s < x.length && s < y.length && x[s] === y[s]) s++
  let e = 0
  while (e < x.length - s && e < y.length - s && x[x.length - 1 - e] === y[y.length - 1 - e]) e++
  const A = x.slice(s, x.length - e), B = y.slice(s, y.length - e)
  const head = x.slice(0, s).map((line) => ({ t: ' ', line }))
  const tail = x.slice(x.length - e).map((line) => ({ t: ' ', line }))
  const n = A.length, m = B.length, max = n + m
  if (!n || !m) return [...head, ...A.map((line) => ({ t: '-', line })), ...B.map((line) => ({ t: '+', line })), ...tail]
  // Too different to be worth working out line by line: all of one out, all of the other in.
  if (max > 20000) return [...head, ...A.map((line) => ({ t: '-', line })), ...B.map((line) => ({ t: '+', line })), ...tail]
  const v = new Int32Array(2 * max + 2)
  const trace = []
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1
      let j = i - k
      while (i < n && j < m && A[i] === B[j]) { i++; j++ }
      v[max + k] = i
      if (i >= n && j >= m) break outer
    }
  }
  const out = []
  let i = n, j = m
  for (let d = trace.length - 1; d >= 0 && (i > 0 || j > 0); d--) {
    const w = trace[d], k = i - j
    const prevK = k === -d || (k !== d && w[max + k - 1] < w[max + k + 1]) ? k + 1 : k - 1
    const pi = w[max + prevK], pj = pi - prevK
    while (i > pi && j > pj) { out.push({ t: ' ', line: A[--i] }); j-- }
    if (d > 0) { if (i === pi) out.push({ t: '+', line: B[--j] }); else out.push({ t: '-', line: A[--i] }) }
  }
  return [...head, ...out.reverse(), ...tail]
}

export async function textFor(ext, buf) {
  if (ext === '.docx') { const m = await import('mammoth/mammoth.browser.js'); return ((await (m.default || m).extractRawText({ arrayBuffer: buf })).value || '').replace(/\n{3,}/g, '\n\n') }
  if (ext === '.xlsx' || ext === '.xlsm') return sheetText(buf)
  return new TextDecoder().decode(buf)
}
export const comparable = (ext) => ['.md', '.markdown', '.txt', '.csv', '.tsv', '.html', '.htm', '.docx', '.xlsx', '.xlsm'].includes(ext)

// An Excel file by its cells, a line each: "Budget!B3  950", a formula with its result.
async function sheetText(buf) {
  const { readBook, colName } = await import('./xlsxbook.js')
  const { data } = await readBook(new Uint8Array(buf))
  const lines = []
  for (const sid of data.sheetOrder) {
    const sh = data.sheets[sid]
    const name = /^[A-Za-z_][\w.]*$/.test(sh.name) ? sh.name : `'${String(sh.name).replace(/'/g, "''")}'`
    for (const r of Object.keys(sh.cellData || {}).map(Number).sort((a, b) => a - b)) {
      const row = sh.cellData[r] || {}
      for (const c of Object.keys(row).map(Number).sort((a, b) => a - b)) {
        const cell = row[c]
        if (!cell || (cell.v == null && !cell.f)) continue
        lines.push(`${name}!${colName(c)}${r + 1}  ${cell.f ? `${cell.f} → ${cell.v ?? ''}` : cell.v}`)
      }
    }
  }
  return lines.join('\n')
}
