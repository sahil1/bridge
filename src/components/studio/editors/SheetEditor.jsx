import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import { UniverSheetsCorePreset, IconManager, SheetsUIMenuSchema, SheetsNumfmtUIMenuSchema } from '@univerjs/preset-sheets-core'
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort'
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter'
import { UniverSheetsConditionalFormattingPreset, SheetsConditionalFormattingUIMenuSchema } from '@univerjs/preset-sheets-conditional-formatting'
import { UniverSheetsDataValidationPreset, SheetsDataValidationUIMenuSchema } from '@univerjs/preset-sheets-data-validation'
import { UniverSheetsFindReplacePreset } from '@univerjs/preset-sheets-find-replace'
import { UniverSheetsHyperLinkPreset } from '@univerjs/preset-sheets-hyper-link'
import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/preset-sheets-sort/lib/index.css'
import '@univerjs/preset-sheets-filter/lib/index.css'
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css'
import '@univerjs/preset-sheets-data-validation/lib/index.css'
import '@univerjs/preset-sheets-find-replace/lib/index.css'
import '@univerjs/preset-sheets-hyper-link/lib/index.css'
import Icon from '../../Icon.jsx'
import { api as call, useFleet } from '../../../api.js'
import { t, tx, currentLang } from '../../../i18n/index.js'
import { withKeys } from '../keys.js'
import { readSheet, writeSheet } from '../xlsx.js'
import { ENCODINGS } from '../csv.js'
import SheetChart, { chartOfGrid } from '../sheetchart.jsx'
import '../sheet.css'

// A sheet: Univer (Apache-2.0, what GenOffice's Sheets is built on too) with its ribbon, formula
// bar, sheet tabs, number formats, freeze, sort, filter, conditional formatting, data validation,
// find and replace, and links; read from and written back to the file's own kind (xlsx.js), in the
// app's light or dark look and its language where Univer has it. Ask AI (the ribbon's first
// button, or the page's Ask an agent) sends the cells picked to one of your agents, which answers
// with the change rather than making it: it's shown on the sheet, and kept or not. Charts the file
// has are drawn beside it, from its cells. handle: save() gives { bytes, notKept }, selection() the
// cells picked ("B2:D9 on Budget") with their values, ask() opens Ask AI.
const dark = () => { const m = document.documentElement.getAttribute('data-theme'); return m ? m === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches }
const narrowNow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches

// Univer's own words, in the app's language where it has them (each pack loaded only when picked).
const UNIVER_LANG = { de: 'de-DE', es: 'es-ES', fr: 'fr-FR', ja: 'ja-JP', 'pt-BR': 'pt-BR', 'zh-CN': 'zh-CN' }
const LOCALE_TYPE = { 'en-US': LocaleType.EN_US, 'de-DE': LocaleType.DE_DE, 'es-ES': LocaleType.ES_ES, 'fr-FR': LocaleType.FR_FR, 'ja-JP': LocaleType.JA_JP, 'pt-BR': LocaleType.PT_BR, 'zh-CN': LocaleType.ZH_CN }
const PRESET_LOCALES = [
  import.meta.glob('/node_modules/@univerjs/preset-sheets-core/lib/es/locales/{en-US,de-DE,es-ES,fr-FR,ja-JP,pt-BR,zh-CN}.js'),
  import.meta.glob('/node_modules/@univerjs/preset-sheets-sort/lib/es/locales/{en-US,de-DE,es-ES,fr-FR,ja-JP,pt-BR,zh-CN}.js'),
  import.meta.glob('/node_modules/@univerjs/preset-sheets-filter/lib/es/locales/{en-US,de-DE,es-ES,fr-FR,ja-JP,pt-BR,zh-CN}.js'),
  import.meta.glob('/node_modules/@univerjs/preset-sheets-conditional-formatting/lib/es/locales/{en-US,de-DE,es-ES,fr-FR,ja-JP,pt-BR,zh-CN}.js'),
  import.meta.glob('/node_modules/@univerjs/preset-sheets-data-validation/lib/es/locales/{en-US,de-DE,es-ES,fr-FR,ja-JP,pt-BR,zh-CN}.js'),
  import.meta.glob('/node_modules/@univerjs/preset-sheets-find-replace/lib/es/locales/{en-US,de-DE,es-ES,fr-FR,ja-JP,pt-BR,zh-CN}.js'),
  import.meta.glob('/node_modules/@univerjs/preset-sheets-hyper-link/lib/es/locales/{en-US,de-DE,es-ES,fr-FR,ja-JP,pt-BR,zh-CN}.js'),
]
async function univerWords() {
  const code = UNIVER_LANG[currentLang()] || 'en-US'
  const packs = await Promise.all(PRESET_LOCALES.map((g) => {
    const load = Object.entries(g).find(([k]) => k.endsWith(`/${code}.js`))?.[1] || Object.entries(g).find(([k]) => k.endsWith('/en-US.js'))?.[1]
    return load ? load().then((m) => m.default || m) : {}
  }))
  return { code, words: mergeLocales(...packs) }
}

// Rows and columns added, removed or moved, as they happen (undo and redo too): the writer moves
// what the file keeps beside the cells (charts, pictures, notes, names) with them.
const OPS = {
  'sheet.mutation.insert-row': (p) => ({ op: 'insert-rows', start: p.range.startRow, count: p.range.endRow - p.range.startRow + 1 }),
  'sheet.mutation.remove-rows': (p) => ({ op: 'remove-rows', start: p.range.startRow, count: p.range.endRow - p.range.startRow + 1 }),
  'sheet.mutation.insert-col': (p) => ({ op: 'insert-cols', start: p.range.startColumn, count: p.range.endColumn - p.range.startColumn + 1 }),
  'sheet.mutation.remove-col': (p) => ({ op: 'remove-cols', start: p.range.startColumn, count: p.range.endColumn - p.range.startColumn + 1 }),
  'sheet.mutation.move-rows': (p) => ({ op: 'move-rows', from: p.sourceRange.startRow, count: p.sourceRange.endRow - p.sourceRange.startRow + 1, to: p.targetRange.startRow }),
  'sheet.mutation.move-columns': (p) => ({ op: 'move-cols', from: p.sourceRange.startColumn, count: p.sourceRange.endColumn - p.sourceRange.startColumn + 1, to: p.targetRange.startColumn }),
}

// The ribbon's tools for what a CSV can't hold: fonts, colours, borders, alignment, merged cells,
// number formats, conditional formats and validation.
const itemsOf = (schema, tab, group) => Object.keys(schema?.[tab]?.[group] || {})
const CSV_HIDDEN = [
  ...itemsOf(SheetsUIMenuSchema, 'ribbon.start', 'ribbon.start.format'),
  ...itemsOf(SheetsUIMenuSchema, 'ribbon.start', 'ribbon.start.layout'),
  ...itemsOf(SheetsNumfmtUIMenuSchema, 'ribbon.start', 'ribbon.start.number'),
  ...itemsOf(SheetsConditionalFormattingUIMenuSchema, 'ribbon.data', 'ribbon.data.rules'),
  ...itemsOf(SheetsDataValidationUIMenuSchema, 'ribbon.data', 'ribbon.data.rules'),
]

const colName = (c) => { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
// The cells picked, as an agent reads them: column letters across, row numbers down, a formula
// with its result. Its columns' headings come first when they're above what's picked.
function gridText(sheet, range) {
  const r0 = range.getRow(), c0 = range.getColumn(), h = range.getHeight(), w = range.getWidth()
  const rows = Math.min(h, 200), cols = Math.min(w, 26)
  const part = sheet.getRange(r0, c0, rows, cols)
  const vals = part.getValues()
  const fs = part.getFormulas()
  const cell = (v, f) => (f ? `${f} → ${v ?? ''}` : v == null ? '' : String(v))
  const head = `\t${Array.from({ length: cols }, (_, j) => colName(c0 + j)).join('\t')}`
  const lines = vals.map((row, i) => `${r0 + i + 1}\t${row.map((v, j) => cell(v, fs[i]?.[j])).join('\t')}`)
  if (r0 > 0) {
    const top = sheet.getRange(0, c0, 1, cols).getValues()[0]
    if (top.some((v) => v != null && v !== '')) lines.unshift(`1\t${top.map((v) => (v == null ? '' : String(v))).join('\t')}`)
  }
  const more = h > rows || w > cols ? `\n(${t('and more: {n} cells in all', { n: h * w })})` : ''
  return `${head}\n${lines.join('\n')}${more}`
}

export default function SheetEditor({ file, data, onDirty, onStats, handle, readOnly = false }) {
  const host = useRef(null)
  const univer = useRef(null) // the facade, univerAPI
  const book = useRef(null) // what was read (xlsx.js readSheet)
  const ops = useRef([])
  const [added, setAdded] = useState([]) // charts kept from Ask AI, written in on save
  const [picked, setPicked] = useState({ sep: null, enc: null }) // a CSV's separator and encoding, when picked
  const [info, setInfo] = useState(null) // { lost, charts, csv }
  const [err, setErr] = useState(null)
  const [ready, setReady] = useState(false)
  const [panel, setPanel] = useState(null) // 'ask' | 'charts'
  const [sel, setSel] = useState(null) // { a1, sheet, sheetId, rows, cols }
  const [isDark, setDark] = useState(dark)
  const [empty, setEmpty] = useState(false) // a new sheet with nothing in it yet
  const dirty = useRef(false)
  const setPanelRef = useRef(setPanel)
  setPanelRef.current = setPanel
  const changed = useCallback((d) => { dirty.current = d; onDirty(d) }, [onDirty])

  // The app's light or dark look, followed while it's open.
  useEffect(() => {
    const look = () => { const d = dark(); setDark(d); try { univer.current?.toggleDarkMode(d) } catch { /* not ready */ } }
    const mo = new MutationObserver(look)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener?.('change', look)
    return () => { mo.disconnect(); mq.removeEventListener?.('change', look) }
  }, [])

  useEffect(() => {
    let on = true
    let made = null
    const offs = []
    setReady(false); setErr(null); ops.current = []
    Promise.all([readSheet(data, file.name, file.ext, picked), univerWords()]).then(([wb, { code, words }]) => {
      if (!on || !host.current) return
      book.current = wb
      setInfo({ lost: wb.lost, charts: wb.charts || [], csv: wb.csv || null })
      const n = wb.data.sheetOrder.length
      onStats?.({ text: n === 1 ? t('1 sheet') : t('{n} sheets', { n }) })
      const narrow = narrowNow()
      // Ask AI first in the ribbon. A CSV keeps only values, so the tools for formats, merged
      // cells, conditional formats and validation aren't offered there (as the other editors do).
      const menu = { 'ribbon.start.ai': { order: -1 } }
      if (wb.kind === 'csv') for (const id of CSV_HIDDEN) menu[id] = { hidden: true }
      made = createUniver({
        locale: LOCALE_TYPE[code],
        locales: { [LOCALE_TYPE[code]]: words },
        darkMode: dark(),
        presets: [
          UniverSheetsCorePreset({ container: host.current, header: !readOnly, toolbar: !readOnly, ribbonType: narrow ? 'simple' : 'grid', menu, footer: { sheetBar: true, statisticBar: !narrow, menus: false, zoomSlider: !narrow } }),
          UniverSheetsSortPreset(), UniverSheetsFilterPreset(), UniverSheetsConditionalFormattingPreset(),
          UniverSheetsDataValidationPreset(), UniverSheetsFindReplacePreset(), UniverSheetsHyperLinkPreset(),
        ],
      })
      const u = made.univerAPI
      univer.current = u
      // Ask AI and Charts, as the ribbon's own buttons (Ask AI first, as large as Paste).
      if (!readOnly) {
        try {
          const icons = made.univer.__getInjector().get(IconManager)
          icons.register('BridgeAskAiIcon', ({ style }) => <Icon name="sparkle" size={style?.width || 16} className="sh-ribbon-icon" />)
          icons.register('BridgeChartsIcon', ({ style }) => <Icon name="trend" size={style?.width || 16} className="sh-ribbon-icon" />)
          u.createMenu({ id: 'bridge.sheet.ask-ai', title: t('Ask AI'), tooltip: t('Ask one of your agents about the cells you picked: a formula, a cleaned-up column, a summary or a chart. You see the change before it\'s made.'), icon: 'BridgeAskAiIcon', action: () => setPanelRef.current('ask'), order: -10, gridLayout: { row: 1, column: 1, rowSpan: 2, showLabel: true } }).appendTo(['ribbon.start', 'ribbon.start.ai'])
          u.createMenu({ id: 'bridge.sheet.charts', title: t('Charts'), tooltip: t('The charts in this file, drawn from its cells'), icon: 'BridgeChartsIcon', action: () => setPanelRef.current((p) => (p === 'charts' ? null : 'charts')), order: 0, gridLayout: { row: 1, column: 1, rowSpan: 2, showLabel: true } }).appendTo(['ribbon.insert', 'ribbon.insert.charts'])
          u.createMenu({ id: 'bridge.sheet.ask-ai-here', title: t('Ask AI about these cells'), icon: 'BridgeAskAiIcon', action: () => setPanelRef.current('ask'), order: -10 }).appendTo('contextMenu.mainArea')
        } catch { /* a Univer without these menus: Ask an agent in the page's header still opens it */ }
      }
      u.createWorkbook(wb.data)
      setEmpty(!readOnly && Object.values(wb.data.sheets).every((s) => !Object.keys(s.cellData || {}).length))
      setReady(true)
      if (readOnly) u.getActiveWorkbook()?.setEditable?.(false)
      // Changed once something's edited after it opened (the first mutations are its own setting up).
      let settled = false
      const settle = setTimeout(() => { settled = true }, 600)
      offs.push({ dispose: () => clearTimeout(settle) })
      // What's picked, for Ask AI (a moment after it stops changing): however it's picked (the
      // mouse, the keys, the name box) it's set by the same operation.
      let tick = null
      const look = () => { clearTimeout(tick); tick = setTimeout(() => on && setSel(selectionOf(u)), 120) }
      offs.push(u.onCommandExecuted?.((cmd) => {
        if (settled && cmd?.type === 2) { changed(true); setEmpty(false) }
        const op = OPS[cmd?.id]
        if (op && cmd.params?.subUnitId) ops.current.push({ sheet: cmd.params.subUnitId, ...op(cmd.params) })
        if (cmd?.id === 'sheet.operation.set-selections' || cmd?.id === 'sheet.command.set-worksheet-activate') look()
      }))
      look()
    }, (e) => on && setErr(e.message))
    return () => { on = false; for (const o of offs) { try { o?.dispose?.() } catch { /* gone */ } } try { made?.univer?.dispose() } catch { /* gone */ } univer.current = null }
  }, [data, readOnly, picked]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    const now = univer.current.getActiveWorkbook().save()
    return writeSheet(book.current, now, { ops: ops.current, charts: added })
  }, [added])
  handle.current = {
    save,
    selection: () => {
      try {
        const sheet = univer.current.getActiveWorkbook().getActiveSheet()
        const range = sheet.getSelection()?.getActiveRange()
        if (!range) return null
        return { text: gridText(sheet, range), where: t('{range} on {sheet}', { range: range.getA1Notation(), sheet: sheet.getSheetName() }) }
      } catch { return null }
    },
    ask: () => setPanel('ask'),
  }

  // A CSV read again another way: the file isn't changed until it's saved.
  const repick = (next) => {
    if (dirty.current && !window.confirm(t('Read it again that way? Your unsaved changes here are lost.'))) return
    setPicked((p) => ({ ...p, ...next }))
    changed(false)
  }
  const sheetCharts = useMemo(() => [...(info?.charts || []), ...added.map((c) => ({ ...c, added: true }))], [info, added])

  if (err) return <div className="sd-empty" role="alert"><Icon name="alert" size={18} /><b>{t("Couldn't read this sheet: {error}", { error: err })}</b><span className="muted small">{t('The file is as it was. Download it to open it in Excel, or put back an earlier version.')}</span></div>
  return (
    <div className={`sd-sheet${panel ? ' with-side' : ''}`}>
      {info?.csv && !readOnly && <CsvBar csv={info.csv} ext={file.ext} onPick={repick} />}
      {info?.lost?.length > 0 && <p className="muted small sd-note sh-note"><Icon name="info" size={12} /> {t('This file also has {what}: they aren\'t shown here, and saving here keeps them as they are.', { what: info.lost.map((x) => t(x)).join(', ') })}</p>}
      <div className="sh-body">
        <div ref={host} className="sd-univer" />
        {empty && ready && !panel && (
          <div className="sh-start" role="note">
            <Icon name="grid" size={18} />
            <span><b>{t('An empty sheet')}</b><small className="muted">{t('Type in any cell or paste a table, or have an agent start it: "a budget for a team of five".')}</small></span>
            <button type="button" className="btn small" onClick={() => setPanel('ask')}><Icon name="sparkle" size={12} /> {t('Ask AI')}</button>
            <button type="button" className="win-btn" onClick={() => setEmpty(false)} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={12} /></button>
          </div>
        )}
        {panel === 'ask' && <AskPanel file={file} univer={univer} sel={sel} dark={isDark} onDirty={changed} onChart={(c) => setAdded((a) => [...a, c])} onClose={() => setPanel(null)} />}
        {panel === 'charts' && <ChartsPanel charts={sheetCharts} univer={univer} sel={sel} dark={isDark} onAsk={() => setPanel('ask')} onClose={() => setPanel(null)} />}
      </div>
      {!ready && <div className="sd-empty sd-loading sd-over" role="status"><Icon name="refresh" size={16} className="spin" /><span className="muted">{t('Opening {name}…', { name: file.name })}</span></div>}
    </div>
  )
}

function selectionOf(u) {
  try {
    const sheet = u.getActiveWorkbook().getActiveSheet()
    const range = sheet.getSelection()?.getActiveRange()
    if (!range) return null
    return { a1: range.getA1Notation(), sheet: sheet.getSheetName(), sheetId: sheet.getSheetId(), row: range.getRow(), col: range.getColumn(), rows: range.getHeight(), cols: range.getWidth() }
  } catch { return null }
}

// ---------- A CSV's separator and encoding ----------
// What Studio found, said plainly, and picked again when it found wrong (the file is read again).
const SEP_LABEL = { ',': tx('Commas'), ';': tx('Semicolons'), '\t': tx('Tabs'), '|': tx('Pipes') }
const ENC_LABEL = { 'utf-8': 'UTF-8', 'utf-8-bom': tx('UTF-8 with BOM'), 'utf-16le': 'UTF-16 LE', 'utf-16be': 'UTF-16 BE', 'windows-1252': tx('Western (Windows-1252)'), shift_jis: tx('Japanese (Shift JIS)'), gbk: tx('Chinese, Simplified (GBK)'), big5: tx('Chinese, Traditional (Big5)'), 'euc-kr': tx('Korean (EUC-KR)') }
function CsvBar({ csv, ext, onPick }) {
  const kind = ext === '.tsv' ? 'TSV' : 'CSV'
  return (
    <div className="sh-csv" role="group" aria-label={t('How this {kind} file is read and saved', { kind })}>
      <label>{t('Separated by')}
        <select value={csv.sep} onChange={(e) => onPick({ sep: e.target.value })} title={t('What separates the values on each line. Saved the same way.')}>
          {Object.keys(SEP_LABEL).map((s) => <option key={s} value={s}>{t(SEP_LABEL[s])}</option>)}
        </select>
      </label>
      <label>{t('Encoding')}
        <select value={csv.enc} onChange={(e) => onPick({ enc: e.target.value })} title={t('How its letters are stored. Saved the same way.')}>
          {ENCODINGS.map((e) => <option key={e} value={e}>{t(ENC_LABEL[e])}</option>)}
        </select>
      </label>
      <span className="muted small sh-csv-eol">{csv.eol === '\r\n' ? t('Windows line endings') : t('Unix line endings')} · {csv.sniffed.sep && csv.sniffed.enc ? t('found by Studio, and kept when it\'s saved') : t('kept when it\'s saved')}</span>
    </div>
  )
}

// ---------- Ask AI ----------
// The cells picked, what to do with them (a formula, a cleaned-up column, a summary, a chart, or
// anything said), to the agent working in the file's folder, another there, or a new one. Its
// answer comes back as a change (studio.takeProposal), shown on the sheet marked out, to keep or
// put back; an answer to a question is shown here.
const QUICK = [
  { id: 'formula', icon: 'braces', label: tx('Write a formula'), text: tx('Write a formula for the cells I picked that ') },
  { id: 'clean', icon: 'check', label: tx('Clean this column'), text: tx('Clean up the values in the column I picked: trim spaces, write the same thing the same way, fix obvious typos and formats, and keep what each one means.') },
  { id: 'summary', icon: 'list', label: tx('Summarise'), text: tx('Summarise the cells I picked in a few sentences: totals, the highest and lowest, and anything unusual.') },
  { id: 'chart', icon: 'trend', label: tx('Chart this'), text: tx('Make a chart of the cells I picked that shows them best.') },
]
const WAIT_MS = 20 * 60_000
function AskPanel({ file, univer, sel, dark, onDirty, onChart, onClose }) {
  const { fleet } = useFleet()
  const here = fleet?.agents?.find((a) => a.paneId === file.root)
  const agents = (fleet?.agents || []).filter((a) => !a.chief && !a.plainChat && !a.cloudOnly && a.kind !== 'chat' && (!here || a.cwd === here.cwd))
  const [pick, setTo] = useState(null)
  const to = pick ?? (here && here.kind !== 'chat' ? here.paneId : agents[0]?.paneId || 'new')
  const [text, setText] = useState('')
  const [state, setState] = useState({ step: 'idle' }) // idle, sending, waiting, late, shown, kept, error
  const box = useRef(null)
  const lit = useRef(null)
  const live = useRef(true)
  useEffect(() => () => { live.current = false; try { lit.current?.dispose() } catch { /* gone */ } }, [])
  const f = { root: file.root, path: file.path }

  const send = async (e) => {
    e?.preventDefault()
    if (!fleet || !text.trim() || state.step === 'sending' || state.step === 'waiting') return
    const sheet = univer.current?.getActiveWorkbook()?.getActiveSheet()
    const range = sheet?.getSelection()?.getActiveRange()
    setState({ step: 'sending' })
    try {
      const where = range ? t('{range} on {sheet}', { range: range.getA1Notation(), sheet: sheet.getSheetName() }) : null
      const r = await call('/studio/ask', { method: 'POST', body: { ...f, kind: 'sheet', propose: true, instruction: text, selection: range ? gridText(sheet, range) : null, where, ...(to !== 'new' ? { pane: to } : {}) } })
      if (live.current) setState({ step: 'waiting', name: r.name, since: Date.now(), sheet: sheet?.getSheetName() })
    } catch (x) { if (live.current) setState({ step: 'error', message: t("Couldn't send it: {error}", { error: x.message }) }) }
  }

  // Waiting: the agent's change is looked for every two seconds, for twenty minutes.
  useEffect(() => {
    if (state.step !== 'waiting') return undefined
    const id = setInterval(async () => {
      if (Date.now() - state.since > WAIT_MS) { setState((s) => ({ ...s, step: 'late' })); return }
      const r = await call(`/studio/proposal?root=${encodeURIComponent(f.root)}&path=${encodeURIComponent(f.path)}`).catch(() => null)
      if (!live.current || !r) return
      if (r.error) setState({ step: 'error', message: r.error })
      else if (r.proposal) show(r.proposal, state)
    }, 2000)
    return () => clearInterval(id)
  }, [state]) // eslint-disable-line react-hooks/exhaustive-deps

  // Shown: put on the sheet, what was there kept to put back, and marked out.
  const show = (p, asked) => {
    try {
      if (!p || typeof p !== 'object') throw new Error(t('it isn\'t a change'))
      const wb = univer.current.getActiveWorkbook()
      if (p.sheet && !wb.getSheetByName(String(p.sheet))) throw new Error(t('there\'s no sheet named {name}', { name: String(p.sheet) }))
      const sheet = (p.sheet && wb.getSheetByName(String(p.sheet))) || (asked.sheet && wb.getSheetByName(asked.sheet)) || wb.getActiveSheet()
      const cells = Object.entries(p.cells && typeof p.cells === 'object' ? p.cells : {}).slice(0, 5000)
      const bad = cells.find(([ref]) => !/^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}$/i.test(ref))
      if (bad) throw new Error(t('"{ref}" isn\'t a cell', { ref: bad[0] }))
      const chart = p.chart && typeof p.chart === 'object' && p.chart.range ? chartFrom(sheet, p.chart) : null
      if (wb.getActiveSheet().getSheetId() !== sheet.getSheetId()) wb.setActiveSheet(sheet)
      const before = []
      for (const [ref, val] of cells) {
        const at = ref.replace(/\$/g, '').toUpperCase()
        const r = sheet.getRange(at)
        const was = r.getCellData() || {}
        before.push({ ref: at, f: was.f || null, v: was.v ?? null })
        setCell(r, val)
      }
      if (before.length) {
        try { lit.current = sheet.highlightRanges(before.map((b) => sheet.getRange(b.ref)), { stroke: '#7c5cff', fill: 'rgba(124, 92, 255, 0.16)', strokeWidth: 2 }) } catch { /* shown without the marks */ }
        onDirty(true)
      }
      setState({ step: 'shown', proposal: p, before, chart, sheetId: sheet.getSheetId(), name: asked.name })
    } catch (x) { setState({ step: 'error', message: t("Couldn't show {name}'s change: {error}", { name: asked.name, error: x.message }) }) }
  }
  const unmark = () => { try { lit.current?.dispose() } catch { /* gone */ } lit.current = null }
  const keep = () => {
    unmark()
    if (state.chart) { onChart(state.chart.spec); onDirty(true) }
    setState({ step: 'kept', chart: !!state.chart })
  }
  const putBack = () => {
    unmark()
    try {
      const sheet = univer.current.getActiveWorkbook().getSheetBySheetId(state.sheetId)
      for (const b of [...state.before].reverse()) {
        const r = sheet.getRange(b.ref)
        if (b.f) r.setFormula(b.f)
        else if (b.v != null && b.v !== '') r.setValue(b.v)
        else r.clearContent()
      }
    } catch { /* the sheet's gone: nothing to put back */ }
    setState({ step: 'idle' })
  }
  const quick = (q) => { setText(t(q.text)); setTimeout(() => { box.current?.focus(); const n = box.current?.value.length || 0; box.current?.setSelectionRange(n, n) }, 0) }
  const busy = state.step === 'sending' || state.step === 'waiting'
  const p = state.proposal
  return (
    <aside className="sh-side sh-ask" aria-label={t('Ask AI')}>
      <div className="sd-panel-head"><Icon name="sparkle" size={13} /><b>{t('Ask AI')}</b><span className="sd-grow" /><button type="button" className="win-btn" onClick={() => { if (state.step === 'shown') putBack(); onClose() }} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={13} /></button></div>
      <div className="sh-side-body">
        <p className="sh-picked">{sel ? <><b>{sel.a1}</b> <span className="muted">{t('on {sheet}', { sheet: sel.sheet })} · {sel.rows * sel.cols === 1 ? t('1 cell') : t('{n} cells', { n: (sel.rows * sel.cols).toLocaleString() })}</span></> : <span className="muted">{t('Pick the cells to ask about, or ask about the whole sheet.')}</span>}</p>
        {state.step !== 'shown' && <>
          <div className="sh-quick">
            {QUICK.map((q) => <button key={q.id} type="button" className="sh-chip" onClick={() => quick(q)} disabled={busy}><Icon name={q.icon} size={12} /> {t(q.label)}</button>)}
          </div>
          <form onSubmit={send} className="sh-ask-form">
            <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={4} disabled={busy} placeholder={t('What to do with them: "a column for the total of each row", "which month spent most?"')} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(e) }} aria-label={t('What to do with them')} />
            <label className="sh-to">{t('To')}
              <select value={to} onChange={(e) => setTo(e.target.value)} disabled={busy}>
                {agents.map((a) => <option key={a.paneId} value={a.paneId}>{a.title || a.kindLabel} · {a.kindLabel}{a.status === 'working' ? ` (${t('working')})` : ''}</option>)}
                <option value="new">{t('A new agent in this folder')}</option>
              </select>
            </label>
            <button type="submit" className="btn small primary sh-send" disabled={busy || !text.trim() || !fleet} title={withKeys(t('Ask'), 'mod', 'enter')}><Icon name="send" size={12} /> {state.step === 'sending' ? t('Sending…') : t('Ask')}</button>
          </form>
        </>}
        {state.step === 'waiting' && <div className="sh-wait" role="status"><Icon name="refresh" size={13} className="spin" /><span>{t('Asked {name}. Its change shows here, to keep or not, before anything in the file changes.', { name: state.name })}</span><button type="button" className="link-btn" onClick={() => setState({ step: 'idle' })}>{t('Stop waiting')}</button></div>}
        {state.step === 'late' && <div className="sh-wait bad" role="alert"><Icon name="alert" size={13} /><span>{t('No answer from {name} in 20 minutes. It may still be working, or waiting for you: look at its chat.', { name: state.name })}</span><button type="button" className="link-btn" onClick={() => setState({ ...state, step: 'waiting', since: Date.now() })}>{t('Keep waiting')}</button></div>}
        {state.step === 'error' && <div className="sh-wait bad" role="alert"><Icon name="alert" size={13} /><span>{state.message}</span><button type="button" className="link-btn" onClick={() => setState({ step: 'idle' })}>{t('OK')}</button></div>}
        {state.step === 'kept' && <div className="sh-wait ok" role="status"><Icon name="check" size={13} /><span>{state.chart ? t('Kept, with its chart (in Charts). Save to write it to the file.') : t('Kept. Save to write it to the file; undo takes it back.')}</span></div>}
        {state.step === 'shown' && (
          <div className="sh-change">
            <small className="muted">{t('{name}\'s change, not made yet', { name: state.name })}</small>
            {p.summary && <b className="sh-sum">{String(p.summary)}</b>}
            {p.answer && <p className="sh-answer">{String(p.answer)}</p>}
            {state.before.length > 0 && (
              <div className="sh-cells">
                <small className="muted">{state.before.length === 1 ? t('1 cell, marked on the sheet') : t('{n} cells, marked on the sheet', { n: state.before.length })}</small>
                <ul>{Object.entries(p.cells || {}).slice(0, 8).map(([ref, v]) => <li key={ref}><code>{ref.toUpperCase()}</code> <span>{String(v)}</span></li>)}</ul>
                {state.before.length > 8 && <small className="muted">{t('and {n} more', { n: state.before.length - 8 })}</small>}
              </div>
            )}
            {state.chart && <figure className="sh-fig"><figcaption>{state.chart.spec.title || t('Chart')}</figcaption><SheetChart chart={state.chart.view} dark={dark} /></figure>}
            {p.answer && !state.before.length && !state.chart
              ? <div className="sh-acts"><button type="button" className="btn small" onClick={() => navigator.clipboard?.writeText(String(p.answer))}><Icon name="copy" size={12} /> {t('Copy')}</button><button type="button" className="ghost-btn" onClick={() => setState({ step: 'idle' })}>{t('Done')}</button></div>
              : <div className="sh-acts"><button type="button" className="btn small primary" onClick={keep}><Icon name="check" size={12} /> {t('Keep')}</button><button type="button" className="btn small" onClick={putBack}>{state.before.length ? t('Put back') : t('Leave it')}</button></div>}
          </div>
        )}
      </div>
    </aside>
  )
}
// A value the agent gave: a formula, a number, true or false, words, or "" to empty the cell.
function setCell(range, val) {
  if (val == null || val === '') return range.clearContent()
  if (typeof val === 'string' && val.startsWith('=')) return range.setFormula(val)
  if (typeof val === 'number' || typeof val === 'boolean') return range.setValue(val)
  return range.setValue(String(val))
}
const CHART_TYPES = ['column', 'bar', 'line', 'pie']
function chartFrom(sheet, c) {
  const ref = String(c.range).replace(/\$/g, '').replace(/^.*!/, '').toUpperCase()
  if (!/^[A-Z]{1,3}[1-9]\d*:[A-Z]{1,3}[1-9]\d*$/.test(ref)) throw new Error(t('"{ref}" isn\'t a range of cells', { ref: String(c.range) }))
  const range = sheet.getRange(ref)
  const type = CHART_TYPES.includes(c.type) ? c.type : 'column'
  const view = chartOfGrid(range.getValues().map((r) => r.map((v) => (v == null ? '' : v))), type, String(c.title || ''))
  if (!view.series.length) throw new Error(t('there are no numbers in {ref} to chart', { ref }))
  const spec = { sheet: sheet.getSheetId(), sheetName: sheet.getSheetName(), type, title: String(c.title || ''), ref, at: { col: range.getColumn() + range.getWidth() + 1, row: range.getRow() }, size: { cols: 8, rows: 16 } }
  return { spec, view }
}

// ---------- Charts ----------
// The file's charts on the sheet in view (and ones kept from Ask AI), drawn from its cells as they
// are now; each picks its cells when its name is clicked. A chart is changed in Excel, or by Ask AI.
function ChartsPanel({ charts, univer, sel, dark, onAsk, onClose }) {
  const here = charts.filter((c) => !sel || c.sheet === sel.sheetId || c.sheetName === sel.sheet)
  const view = (c) => {
    try {
      const u = univer.current
      if (c.added) return chartOfGrid(u.getActiveWorkbook().getSheetBySheetId(c.sheet).getRange(c.ref).getValues().map((r) => r.map((v) => (v == null ? '' : v))), c.type, c.title)
      // Its series' cells as they are now, where Studio can read them; else the numbers saved with it.
      const series = c.series.map((s) => { const live = refValues(u, s.valRef); return { name: s.name, vals: live ? live.map((v) => (v === '' ? NaN : Number(v))) : s.vals } })
      const cats = refValues(u, c.series[0]?.catRef) || c.series[0]?.cats || []
      return { type: c.type === 'other' ? 'column' : c.type, title: c.title, cats: cats.map(String), series }
    } catch { return null }
  }
  const pick = (c) => {
    try {
      const at = String((c.added ? c.ref : c.series[0]?.valRef) || '').replace(/\$/g, '')
      const bang = at.lastIndexOf('!')
      const name = bang >= 0 ? at.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'") : null
      const wb = univer.current.getActiveWorkbook()
      const sheet = name ? wb.getSheetByName(name) : wb.getSheetBySheetId(c.sheet)
      if (sheet) { wb.setActiveSheet(sheet); sheet.getRange(at.slice(bang + 1)).activate() }
    } catch { /* nothing to pick */ }
  }
  return (
    <aside className="sh-side sh-charts" aria-label={t('Charts')}>
      <div className="sd-panel-head"><Icon name="trend" size={13} /><b>{t('Charts')}</b><span className="muted small">{sel ? t('on {sheet}', { sheet: sel.sheet }) : ''}</span><span className="sd-grow" /><button type="button" className="win-btn" onClick={onClose} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={13} /></button></div>
      <div className="sh-side-body">
        {!here.length && <div className="sh-none"><Icon name="trend" size={18} /><b>{t('No charts on this sheet')}</b><span className="muted small">{t('Pick the cells to chart, then Chart this in Ask AI: you see it before it\'s added, and it\'s saved as an Excel chart.')}</span><button type="button" className="btn small" onClick={onAsk}><Icon name="sparkle" size={12} /> {t('Ask AI')}</button></div>}
        {here.map((c, i) => {
          const v = view(c)
          return (
            <figure key={i} className="sh-fig">
              <figcaption><button type="button" className="link-btn" onClick={() => pick(c)} title={t('Pick its cells')}>{c.title || v?.series?.[0]?.name || t('Chart {n}', { n: i + 1 })}</button>{c.added && <small className="muted"> · {t('added, saved with the file')}</small>}</figcaption>
              {v ? <SheetChart chart={v} dark={dark} /> : <small className="muted">{t('This kind of chart can\'t be drawn here; it\'s kept in the file as it is.')}</small>}
            </figure>
          )
        })}
      </div>
    </aside>
  )
}
// A reference's values ('Budget'!$C$5:$C$16), read from the sheet as it is now.
function refValues(u, ref) {
  if (!ref) return null
  try {
    const at = String(ref).replace(/\$/g, '')
    const bang = at.lastIndexOf('!')
    const name = bang >= 0 ? at.slice(0, bang).replace(/^'|'$/g, '').replace(/''/g, "'") : null
    const sheet = name ? u.getActiveWorkbook().getSheetByName(name) : u.getActiveWorkbook().getActiveSheet()
    if (!sheet) return null
    return sheet.getRange(at.slice(bang + 1)).getValues().flat().map((v) => (v == null ? '' : v))
  } catch { return null }
}
