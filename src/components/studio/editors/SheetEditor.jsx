import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets'
import { UniverSheetsCorePreset, IconManager, SheetsUIMenuSchema } from '@univerjs/preset-sheets-core'
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort'
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter'
import { UniverSheetsConditionalFormattingPreset, SheetsConditionalFormattingUIMenuSchema } from '@univerjs/preset-sheets-conditional-formatting'
import { UniverSheetsDataValidationPreset, SheetsDataValidationUIMenuSchema } from '@univerjs/preset-sheets-data-validation'
import { UniverSheetsFindReplacePreset } from '@univerjs/preset-sheets-find-replace'
import { UniverSheetsHyperLinkPreset } from '@univerjs/preset-sheets-hyper-link'
import { UniverSheetsNotePreset } from '@univerjs/preset-sheets-note'
import '@univerjs/preset-sheets-core/lib/index.css'
import '@univerjs/preset-sheets-sort/lib/index.css'
import '@univerjs/preset-sheets-filter/lib/index.css'
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css'
import '@univerjs/preset-sheets-data-validation/lib/index.css'
import '@univerjs/preset-sheets-find-replace/lib/index.css'
import '@univerjs/preset-sheets-hyper-link/lib/index.css'
import '@univerjs/preset-sheets-note/lib/index.css'
import Icon from '../../Icon.jsx'
import CopyButton from '../../CopyButton.jsx'
import { AssistHead } from '../../AiAssist.jsx'
import { api as call, useFleet } from '../../../api.js'
import { t, tx, currentLang } from '../../../i18n/index.js'
import { withKeys } from '../keys.js'
import { readSheet, writeSheet, kindWords } from '../xlsx.js'
import { ENCODINGS } from '../csv.js'
import SheetChart, { chartOfGrid } from '../sheetchart.jsx'
import { googleKeys } from '../sheetkeys.js'
import { sheetCells, formulaErrorWords } from '../sheetcells.js'
import '../sheet.css'

// A sheet: Univer (Apache-2.0, what GenOffice's Sheets is built on too) with its ribbon, formula
// bar, sheet tabs, number formats, freeze, sort, filter, conditional formatting, data validation,
// find and replace, links and notes; read from and written back to the file's own kind (xlsx.js), in the
// app's light or dark look and its language where Univer has it. AI Assist (the page's header, or
// Ask about these cells on a right-click) sends the cells picked to one of your agents, which
// answers with the change rather than making it: it's shown on the sheet, and kept or not. The
// page's Ask an agent opens it too. Charts the file has are drawn beside it, from its cells. handle:
// save() gives { bytes, notKept }, selection() the cells picked ("B2:D9 on Budget") with their
// values, ask() opens AI Assist's panel, assist() what AI Assist offers here.
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
  import.meta.glob('/node_modules/@univerjs/preset-sheets-note/lib/es/locales/{en-US,de-DE,es-ES,fr-FR,ja-JP,pt-BR,zh-CN}.js'),
]
async function univerWords() {
  const code = UNIVER_LANG[currentLang()] || 'en-US'
  const packs = await Promise.all(PRESET_LOCALES.map((g) => {
    const load = Object.entries(g).find(([k]) => k.endsWith(`/${code}.js`))?.[1] || Object.entries(g).find(([k]) => k.endsWith('/en-US.js'))?.[1]
    return load ? load().then((m) => m.default || m) : {}
  }))
  return { code, words: mergeLocales(...packs, formulaErrorWords()) }
}

// Office's fonts, drawn by their stand-ins where they aren't installed (sheet.css), ready before the
// sheet is first drawn: its canvas doesn't draw again when a font comes in later.
const officeFonts = () => (document.fonts?.load ? Promise.all(['Calibri', 'Aptos', 'Cambria'].flatMap((f) => ['', 'bold ', 'italic '].map((s) => document.fonts.load(`${s}12px "${f}"`).catch(() => null)))) : Promise.resolve())

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
// conditional formats and validation (and Insert › Chart isn't made for one). A number's format
// it keeps: it's how the number is written (1,200.50, 15%, 2026-04-01).
const itemsOf = (schema, tab, group) => Object.keys(schema?.[tab]?.[group] || schema?.[group] || {})
const CSV_HIDDEN = [
  ...itemsOf(SheetsUIMenuSchema, 'ribbon.start', 'ribbon.start.format'),
  ...itemsOf(SheetsUIMenuSchema, 'ribbon.start', 'ribbon.start.layout'),
  ...itemsOf(SheetsConditionalFormattingUIMenuSchema, 'ribbon.data', 'ribbon.data.rules'),
  ...itemsOf(SheetsDataValidationUIMenuSchema, 'ribbon.data', 'ribbon.data.rules'),
]
// The kinds of chart Insert › Chart makes, each saved as Excel's own.
const CHART_KINDS = { column: tx('Column'), bar: tx('Bar'), line: tx('Line'), pie: tx('Pie') }

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
  const [added, setAdded] = useState([]) // charts made here (Insert › Chart, AI Assist), written in on save
  const [msg, setMsg] = useState(null) // what Print or Insert › Chart couldn't do, and why
  const [picked, setPicked] = useState({ sep: null, enc: null }) // a CSV's separator and encoding, when picked
  const [info, setInfo] = useState(null) // { lost, charts, csv }
  const [err, setErr] = useState(null)
  const [ready, setReady] = useState(false)
  const [panel, setPanel] = useState(null) // 'ask' | 'charts'
  const [sel, setSel] = useState(null) // { a1, sheet, sheetId, rows, cols }
  const [isDark, setDark] = useState(dark)
  const [empty, setEmpty] = useState(false) // a new sheet with nothing in it yet
  const [asked, setAsked] = useState(false) // AI Assist's panel opened once: kept from then on
  const [preset, setPreset] = useState(null) // { q, n }: what AI Assist's menu picked, to start the panel with
  useEffect(() => { if (panel === 'ask') setAsked(true) }, [panel])
  const dirty = useRef(false)
  const setPanelRef = useRef(setPanel)
  setPanelRef.current = setPanel
  const changed = useCallback((d) => { dirty.current = d; onDirty(d) }, [onDirty])

  // Printed from a page of its own: the sheet in view as it shows (Univer's own copy of its cells,
  // formats and all), to the system's Print, where Save as PDF is too.
  const print = () => {
    try {
      const sheet = univer.current?.getActiveWorkbook()?.getActiveSheet()
      const rows = (sheet?.getLastRow() ?? -1) + 1, cols = (sheet?.getLastColumn() ?? -1) + 1
      if (!sheet || rows < 1 || cols < 1) { setMsg({ text: t('There\'s nothing on {sheet} to print yet.', { sheet: sheet?.getSheetName() || t('this sheet') }) }); return }
      const html = sheet.getRange(0, 0, rows, cols).generateHTML()
      const f = document.createElement('iframe')
      f.className = 'sh-print-frame'
      f.setAttribute('aria-hidden', 'true')
      f.srcdoc = `<!doctype html><meta charset="utf-8"><title>${`${file.name} · ${sheet.getSheetName()}`.replace(/[<&]/g, '')}</title><style>
html,body{margin:0;background:#fff;color:#000}body{padding:0}table{border-collapse:collapse;width:auto!important}td{border:0.5pt solid #d4d4d4;padding:2px 4px;vertical-align:bottom}
@page{margin:12mm}</style>${html}`
      // Print's dialog has the page while it's open; then the keys are the sheet's again.
      const back = document.activeElement
      f.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print() } finally { f.blur(); back?.focus?.(); setTimeout(() => f.remove(), 60_000) } }, 200) }
      document.body.appendChild(f)
      setMsg(null)
    } catch (e) { setMsg({ text: t("Couldn't print it: {error}", { error: e.message }), error: true }) }
  }
  const printRef = useRef(print)
  printRef.current = print

  // Insert › Chart: the cells picked, drawn in Charts beside the sheet at once, its kind and title
  // changed there, and saved as an Excel chart. What can't be charted says why.
  const insertChart = (type) => {
    try {
      const sheet = univer.current?.getActiveWorkbook()?.getActiveSheet()
      const range = sheet?.getSelection()?.getActiveRange()
      if (!range || range.getWidth() * range.getHeight() < 2) throw new Error(t('pick the cells to chart first: their labels and numbers, with the headings above them'))
      // A whole row or column picked: as far as its cells go.
      const r0 = range.getRow(), c0 = range.getColumn()
      const r1 = Math.min(r0 + range.getHeight() - 1, sheet.getLastRow()), c1 = Math.min(c0 + range.getWidth() - 1, sheet.getLastColumn())
      if (r1 < r0 || c1 < c0 || (r1 === r0 && c1 === c0)) throw new Error(t('pick the cells to chart first: their labels and numbers, with the headings above them'))
      const { spec } = chartFrom(sheet, { range: `${colName(c0)}${r0 + 1}:${colName(c1)}${r1 + 1}`, type, title: '' })
      setAdded((a) => [...a, { ...spec, id: `c${Date.now().toString(36)}` }])
      changed(true)
      setMsg(null)
      setPanel('charts')
    } catch (e) { setMsg({ text: t("Couldn't make a chart: {error}", { error: e.message }), error: true }) }
  }
  const chartRef = useRef(insertChart)
  chartRef.current = insertChart
  const editChart = (id, change) => { setAdded((a) => (change ? a.map((c) => (c.id === id ? { ...c, ...change } : c)) : a.filter((c) => c.id !== id))); changed(true) }

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
    Promise.all([readSheet(data, file.name, file.ext, picked), univerWords(), officeFonts()]).then(([wb, { code, words }]) => {
      if (!on || !host.current) return
      book.current = wb
      setInfo({ lost: wb.lost, charts: wb.charts || [], csv: wb.csv || null })
      const n = wb.data.sheetOrder.length
      onStats?.({ text: n === 1 ? t('1 sheet') : t('{n} sheets', { n }) })
      const narrow = narrowNow()
      // A CSV keeps only values, so the tools for formats, merged cells, conditional formats and
      // validation aren't offered there (as the other editors do).
      const menu = {}
      const csv = wb.kind === 'csv'
      if (csv) for (const id of CSV_HIDDEN) menu[id] = { hidden: true }
      made = createUniver({
        locale: LOCALE_TYPE[code],
        locales: { [LOCALE_TYPE[code]]: words },
        darkMode: dark(),
        // Undo goes back as far as a day's work, not Univer's 50 steps.
        undoRedoHistoryLimit: 500,
        presets: [
          // A CSV's text that looks like a number ("007", a long ID) is text on purpose, and kept
          // so: not marked as a number stored as text.
          UniverSheetsCorePreset({ container: host.current, header: !readOnly, toolbar: !readOnly, ribbonType: narrow ? 'simple' : 'grid', menu, footer: { sheetBar: true, statisticBar: !narrow, menus: false, zoomSlider: !narrow }, sheets: { disableForceStringMark: csv, disableForceStringAlert: csv } }),
          UniverSheetsSortPreset(), UniverSheetsFilterPreset(), UniverSheetsConditionalFormattingPreset(),
          UniverSheetsDataValidationPreset(), UniverSheetsFindReplacePreset(), UniverSheetsHyperLinkPreset(), UniverSheetsNotePreset(),
        ],
      })
      const u = made.univerAPI
      univer.current = u
      // Charts and Print as the ribbon's own buttons, and AI Assist's Ask about these cells on a
      // right-click (AI Assist itself is at the right end of the page's header).
      if (!readOnly) {
        try {
          const icons = made.univer.__getInjector().get(IconManager)
          icons.register('BridgeAiAssistIcon', ({ style }) => <Icon name="wand" size={style?.width || 16} className="sh-ribbon-icon sh-ai-icon" />)
          icons.register('BridgeChartsIcon', ({ style }) => <Icon name="trend" size={style?.width || 16} className="sh-ribbon-icon" />)
          icons.register('BridgeChartIcon', ({ style }) => <Icon name="bar-chart" size={style?.width || 16} />)
          icons.register('BridgePrintIcon', ({ style }) => <Icon name="printer" size={style?.width || 16} />)
          // Print beside undo and redo, as in Google Sheets' toolbar.
          u.createMenu({ id: 'bridge.sheet.print-button', title: t('Print'), tooltip: withKeys(t('Print, or save as PDF'), 'mod', 'p'), icon: 'BridgePrintIcon', action: () => printRef.current(), order: 5 }).appendTo(['ribbon.start', 'ribbon.start.history'])
          if (!csv) u.createMenu({ id: 'bridge.sheet.insert-chart', title: t('Chart'), tooltip: t('A chart of the cells you picked: their labels and numbers, with the headings above them. Saved as an Excel chart.'), icon: 'BridgeChartIcon', action: () => chartRef.current('column'), order: -1, gridLayout: { row: 1, column: 1, rowSpan: 2, showLabel: true } }).appendTo(['ribbon.insert', 'ribbon.insert.charts'])
          u.createMenu({ id: 'bridge.sheet.charts', title: t('Charts'), tooltip: t('The charts in this file, drawn from its cells'), icon: 'BridgeChartsIcon', action: () => setPanelRef.current((p) => (p === 'charts' ? null : 'charts')), order: 0, gridLayout: { row: 1, column: 1, rowSpan: 2, showLabel: true } }).appendTo(['ribbon.insert', 'ribbon.insert.charts'])
          u.createMenu({ id: 'bridge.sheet.ask-ai-here', title: t('Ask about these cells'), tooltip: t('AI Assist: ask one of your agents about the cells you picked. You see the change before it\'s made.'), icon: 'BridgeAiAssistIcon', action: () => setPanelRef.current('ask'), order: -10 }).appendTo('contextMenu.mainArea')
        } catch { /* a Univer without these menus: Ask an agent in the page's header still opens it */ }
      }
      u.createWorkbook(wb.data)
      // The keys Google Sheets users reach for (sheetkeys.js), and what's typed keeping no colour of
      // its own (sheetcells.js).
      try { offs.push(googleKeys(made.univer, u, { container: host.current, onPrint: () => printRef.current(), onSay: (text) => on && setMsg({ text, error: true }) })) } catch { /* Univer's own keys still work */ }
      try { offs.push(sheetCells(made.univer)) } catch { /* cells as Univer has them */ }
      setEmpty(!readOnly && Object.values(wb.data.sheets).every((s) => !Object.keys(s.cellData || {}).length))
      setReady(true)
      if (readOnly) u.getActiveWorkbook()?.setEditable?.(false)
      // Changed once the workbook itself changes after it opened: a mutation (type 2) to it, as an
      // edit, a format or an undo make. Not Univer's own: its setting up as it opens, its cell
      // editor's scratch document (doc.*, which a cell picked fills), or a formula's result worked
      // out again (onlyLocal). Univer's Facade gives these as its CommandExecuted event.
      let settled = false
      const settle = setTimeout(() => { settled = true }, 600)
      offs.push({ dispose: () => clearTimeout(settle) })
      // What's picked, for AI Assist (a moment after it stops changing): however it's picked (the
      // mouse, the keys, the name box) it's set by the same operation.
      let tick = null
      const look = () => { clearTimeout(tick); tick = setTimeout(() => on && setSel(selectionOf(u)), 120) }
      offs.push(u.addEvent(u.Event.CommandExecuted, (cmd) => {
        if (settled && cmd.type === 2 && !cmd.options?.onlyLocal && !String(cmd.id).startsWith('doc.')) { changed(true); setEmpty(false) }
        const op = OPS[cmd.id]
        if (op && cmd.params?.subUnitId) ops.current.push({ sheet: cmd.params.subUnitId, ...op(cmd.params) })
        if (cmd.id === 'sheet.operation.set-selections' || cmd.id === 'sheet.command.set-worksheet-activate') look()
        // A sheet added, copied or deleted: the status line counts them again.
        if (cmd.id === 'sheet.mutation.insert-sheet' || cmd.id === 'sheet.mutation.remove-sheet') { const k = u.getActiveWorkbook()?.getSheets().length || 0; onStats?.({ text: k === 1 ? t('1 sheet') : t('{n} sheets', { n: k }) }) }
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
    ask: () => { setPreset({ agent: true, n: Date.now() }); setPanel('ask') },
    assist: () => [
      ...QUICK.map((q) => ({ label: t(q.verb), hint: t(q.hint), run: () => { setPreset({ q, n: Date.now() }); setPanel('ask') } })),
      { label: t('Ask about these cells'), hint: t('Anything: "a column for the total of each row", "which month spent most?"'), on: panel === 'ask', run: () => setPanel(panel === 'ask' ? null : 'ask') },
    ],
  }

  // A CSV read again another way: the file isn't changed until it's saved.
  const repick = (next) => {
    if (dirty.current && !window.confirm(t('Read it again that way? Your unsaved changes here are lost.'))) return
    setPicked((p) => ({ ...p, ...next }))
    changed(false)
  }
  const sheetCharts = useMemo(() => [...(info?.charts || []), ...added.map((c) => ({ ...c, added: true }))], [info, added])

  if (err) return <div className="sd-empty" role="alert"><Icon name="alert" size={18} /><b>{t("Couldn't read this sheet: {error}", { error: err })}</b><span className="muted small">{t('The file is as it was. Download it to open it in Excel, or restore an earlier version.')}</span></div>
  return (
    <div className={`sd-sheet${panel ? ' with-side' : ''}`}>
      {info?.csv && !readOnly && <CsvBar csv={info.csv} ext={file.ext} onPick={repick} />}
      {(info?.lost?.length > 0 || info?.charts?.length > 0) && !readOnly && (
        <p className="muted small sd-note sh-note">
          <Icon name="info" size={12} />
          <span>
            {info.lost.length > 0 && `${t('This file also has {what}: they aren\'t shown here, and saving here keeps them as they are.', { what: info.lost.map(kindWords).join(', ') })} `}
            {info.charts.length > 0 && (info.charts.length === 1 ? t('Its chart is drawn in Charts, from its cells.') : t('Its {n} charts are drawn in Charts, from their cells.', { n: info.charts.length }))}
          </span>
          {info.charts.length > 0 && <button type="button" className="link-btn" onClick={() => setPanel('charts')}>{t('Charts')}</button>}
        </p>
      )}
      {msg && <p className={`small sd-note sh-note${msg.error ? ' error-text' : ''}`} role={msg.error ? 'alert' : 'status'}><Icon name={msg.error ? 'alert' : 'info'} size={12} /><span>{msg.text}</span><button type="button" className="link-btn" onClick={() => setMsg(null)}>{t('OK')}</button></p>}
      <div className="sh-body">
        <div ref={host} className="sd-univer" data-own-keys="mod+k" />
        {empty && ready && !panel && (
          <div className="sh-start" role="note">
            <Icon name="grid" size={18} />
            <span><b>{t('An empty sheet')}</b><small className="muted">{t('Type in any cell or paste a table, or have an agent start it: "a budget for a team of five".')}</small></span>
            <button type="button" className="btn small" onClick={() => setPanel('ask')}><Icon name="wand" size={12} /> {t('Start this sheet')}</button>
            <button type="button" className="win-btn" onClick={() => setEmpty(false)} aria-label={t('Close')} title={t('Close')}><Icon name="x" size={12} /></button>
          </div>
        )}
        {/* AI Assist's panel stays as it was (waiting for an answer, say) while Charts is open instead. */}
        {asked && <AskPanel hidden={panel !== 'ask'} preset={preset} onShow={() => setPanel('ask')} file={file} univer={univer} sel={sel} dark={isDark} onDirty={changed} onChart={(c) => setAdded((a) => [...a, { ...c, id: `c${Date.now().toString(36)}` }])} onClose={() => setPanel(null)} />}
        {panel === 'charts' && <ChartsPanel charts={sheetCharts} univer={univer} sel={sel} dark={isDark} csv={!!info?.csv} onInsert={insertChart} onEdit={editChart} onAsk={() => { setPreset({ q: QUICK.find((q) => q.id === 'chart'), n: Date.now() }); setPanel('ask') }} onClose={() => setPanel(null)} />}
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
  const found = `${csv.eol === '\r\n' ? t('Windows line endings') : t('Unix line endings')} · ${csv.sniffed.sep && csv.sniffed.enc ? t('found by Studio, and kept when it\'s saved') : t('kept when it\'s saved')}`
  return (
    <div className="sh-csv" role="group" aria-label={t('How this {kind} file is read and saved', { kind })} title={found}>
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
      <span className="muted small sh-csv-eol">{found}</span>
    </div>
  )
}

// ---------- AI Assist ----------
// The cells picked and what to do with them (a formula, a cleaned-up column, a summary, a chart, or
// anything said), answered by AI Assist's model in seconds (Studio's model: the one picked for it,
// else the one the app reaches first). Its change is a suggestion: put on the sheet outlined, what
// was there kept to put back, and kept or discarded, each on its own or all at once. Several can
// wait at once. An answer to a question is shown here, to copy. A bigger job is handed to the
// agent working in the file's folder, another there, or a new one, which writes the same change
// beside the file (studio.takeProposal), looked for every two seconds for twenty minutes. preset:
// what AI Assist's menu picked, put in to finish or send ({ q }), or Ask an agent ({ agent }).
const QUICK = [
  { id: 'formula', icon: 'braces', label: tx('Write a formula'), verb: tx('Write a formula'), hint: tx('For the cells you pick'), text: tx('Write a formula for the cells I picked that ') },
  { id: 'clean', icon: 'check', label: tx('Clean this column'), verb: tx('Clean this column'), hint: tx('Spaces, spellings and formats made the same'), text: tx('Clean up the values in the column I picked: trim spaces, write the same thing the same way, fix obvious typos and formats, and keep what each one means.') },
  { id: 'summary', icon: 'list', label: tx('Summarise'), verb: tx('Summarize these cells'), hint: tx('Totals, the highest and lowest, anything unusual'), text: tx('Summarise the cells I picked in a few sentences: totals, the highest and lowest, and anything unusual.') },
  { id: 'chart', icon: 'trend', label: tx('Chart this'), verb: tx('Make a chart'), hint: tx('Of the cells you pick, shown before it\'s added'), text: tx('Make a chart of the cells I picked that shows them best.') },
]
const WAIT_MS = 20 * 60_000
const MARK = { stroke: '#7c5cff', fill: 'rgba(124, 92, 255, 0.16)', strokeWidth: 2 }
const openProviders = () => window.dispatchEvent(new CustomEvent('bridge-open-settings', { detail: { section: 'providers' } }))
function AskPanel({ hidden, preset, onShow, file, univer, sel, dark, onDirty, onChart, onClose }) {
  const { fleet } = useFleet()
  const here = fleet?.agents?.find((a) => a.paneId === file.root)
  const agents = (fleet?.agents || []).filter((a) => !a.chief && !a.plainChat && !a.cloudOnly && a.kind !== 'chat' && (!here || a.cwd === here.cwd))
  const [pick, setTo] = useState(null)
  const to = pick ?? (here && here.kind !== 'chat' ? here.paneId : agents[0]?.paneId || 'new')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false) // AI Assist's model is answering
  const [hand, setHand] = useState(false) // Hand to an agent is open
  const [agent, setAgent] = useState({ step: 'idle' }) // the agent asked: idle, sending, waiting, late
  const [err, setErr] = useState(null) // { message, noModel }
  const [list, setList] = useState([]) // suggestions on the sheet: { id, by, proposal, before, chart, sheetId }
  const [answer, setAnswer] = useState(null) // { by, summary, text }: an answer to a question
  const [note, setNote] = useState(null) // what was kept, and what's next
  const [writer, setWriter] = useState(null) // Studio's model, and the others to pick from
  const box = useRef(null)
  const lit = useRef(new Map()) // each suggestion's marks on the sheet
  const live = useRef(true)
  useEffect(() => () => { live.current = false; for (const l of lit.current.values()) { try { l.dispose() } catch { /* gone */ } } }, [])
  // Looked at each time the panel shows: a model added in Settings meanwhile is the one it uses.
  useEffect(() => { if (!hidden) call('/studio/writer').then((w) => live.current && setWriter(w), () => live.current && setWriter((w) => w || { model: null, models: [] })) }, [hidden])
  const pickModel = async (id) => {
    setWriter((w) => ({ ...w, model: w.models.find((m) => m.id === id) || null }))
    await call('/settings', { method: 'PATCH', body: { studio: { model: id } } }).catch(() => {})
  }
  const model = writer?.model && !writer.model.missing ? writer.models.find((m) => m.id === writer.model.id) || writer.model : null
  const noModel = !!writer && !model && !writer.models.length
  const f = { root: file.root, path: file.path }
  // The cells picked, as the model or the agent reads them.
  const picked = () => {
    const wb = univer.current?.getActiveWorkbook()
    const sheet = wb?.getActiveSheet()
    const range = sheet?.getSelection()?.getActiveRange()
    const rows = (sheet?.getLastRow() ?? -1) + 1, cols = (sheet?.getLastColumn() ?? -1) + 1
    return {
      name: sheet?.getSheetName(), sheets: wb?.getSheets().map((s) => s.getSheetName()) || [],
      used: rows > 0 && cols > 0 ? `A1:${colName(cols - 1)}${rows}` : null,
      selection: range ? gridText(sheet, range) : null,
      where: range ? t('{range} on {sheet}', { range: range.getA1Notation(), sheet: sheet.getSheetName() }) : null,
    }
  }

  // Asked of AI Assist's model: its change on the sheet in seconds, to keep or not.
  const ask = async (e) => {
    e?.preventDefault()
    if (!text.trim() || busy || noModel) return
    const p = picked()
    setBusy(true); setErr(null); setNote(null)
    try {
      const r = await call('/studio/sheet/ai', { method: 'POST', body: { ...f, instruction: text, selection: p.selection, where: p.where, sheet: p.name, sheets: p.sheets, used: p.used } })
      if (!live.current) return
      if (show(r.proposal, { name: r.by, sheet: p.name })) setText('')
    } catch (x) { if (live.current) setErr({ message: x.message, noModel: x.code === 'noModel' }) } finally { if (live.current) setBusy(false) }
  }

  // Handed to an agent: it writes the change beside the file, which is looked for here.
  const send = async (e) => {
    e?.preventDefault()
    if (!fleet || !text.trim() || agent.step === 'sending' || agent.step === 'waiting') return
    const p = picked()
    setAgent({ step: 'sending' }); setErr(null); setNote(null)
    try {
      const r = await call('/studio/ask', { method: 'POST', body: { ...f, kind: 'sheet', propose: true, instruction: text, selection: p.selection, where: p.where, ...(to !== 'new' ? { pane: to } : {}) } })
      if (live.current) setAgent({ step: 'waiting', name: r.name, since: Date.now(), sheet: p.name })
    } catch (x) { if (live.current) { setAgent({ step: 'idle' }); setErr({ message: t("Couldn't send it: {error}", { error: x.message }) }) } }
  }
  // Waiting: the agent's change is looked for every two seconds, for twenty minutes.
  useEffect(() => {
    if (agent.step !== 'waiting') return undefined
    const id = setInterval(async () => {
      if (Date.now() - agent.since > WAIT_MS) { setAgent((s) => ({ ...s, step: 'late' })); return }
      const r = await call(`/studio/proposal?root=${encodeURIComponent(f.root)}&path=${encodeURIComponent(f.path)}`).catch(() => null)
      if (!live.current || !r) return
      if (r.error) { setAgent({ step: 'idle' }); setErr({ message: r.error }) } else if (r.proposal) { setAgent({ step: 'idle' }); if (show(r.proposal, agent)) setText('') }
    }, 2000)
    return () => clearInterval(id)
  }, [agent]) // eslint-disable-line react-hooks/exhaustive-deps

  // A change shown: put on the sheet, what was there kept to put back, and outlined. An answer
  // alone is said here instead. False when it can't be shown, and why.
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
      if (!cells.length && !chart) {
        if (!p.answer) throw new Error(t('it has nothing to show'))
        setAnswer({ by: asked.name, summary: p.summary ? String(p.summary) : null, text: String(p.answer) })
        onShow()
        return true
      }
      if (wb.getActiveSheet().getSheetId() !== sheet.getSheetId()) wb.setActiveSheet(sheet)
      const before = []
      for (const [ref, val] of cells) {
        const at = ref.replace(/\$/g, '').toUpperCase()
        const r = sheet.getRange(at)
        const was = r.getCellData() || {}
        before.push({ ref: at, f: was.f || null, v: was.v ?? null })
        setCell(r, val)
      }
      const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      if (before.length) {
        try { lit.current.set(id, sheet.highlightRanges(before.map((b) => sheet.getRange(b.ref)), MARK)) } catch { /* shown without the marks */ }
        onDirty(true)
      }
      setList((l) => [...l, { id, by: asked.name, proposal: p, before, chart, sheetId: sheet.getSheetId() }])
      onShow()
      return true
    } catch (x) { setErr({ message: t("Couldn't show {name}'s change: {error}", { name: asked.name, error: x.message }) }); return false }
  }
  const unmark = (s) => { try { lit.current.get(s.id)?.dispose() } catch { /* gone */ } lit.current.delete(s.id) }
  const keep = (s) => {
    unmark(s)
    if (s.chart) { onChart(s.chart.spec); onDirty(true) }
    setList((l) => l.filter((x) => x.id !== s.id))
    return !!s.chart
  }
  const putBack = (s) => {
    unmark(s)
    try {
      const sheet = univer.current.getActiveWorkbook().getSheetBySheetId(s.sheetId)
      for (const b of [...s.before].reverse()) {
        const r = sheet.getRange(b.ref)
        if (b.f) r.setFormula(b.f)
        else if (b.v != null && b.v !== '') r.setValue(b.v)
        else r.clearContent()
      }
    } catch { /* the sheet's gone: nothing to put back */ }
    setList((l) => l.filter((x) => x.id !== s.id))
  }
  const kept = (charts) => setNote(charts ? t('Kept, with its chart (in Charts). Save to write it to the file.') : t('Kept. Save to write it to the file; undo takes it back.'))
  const keepOne = (s) => kept(keep(s))
  const keepAll = () => kept(list.map(keep).some(Boolean))
  // The newest first, so each puts back what was there before it.
  const discardAll = () => { for (const s of [...list].reverse()) putBack(s) }
  const quick = (q) => { setText(t(q.text)); setTimeout(() => { box.current?.focus(); const n = box.current?.value.length || 0; box.current?.setSelectionRange(n, n) }, 0) }
  useEffect(() => {
    if (!preset) return
    if (preset.agent) setHand(true)
    if (preset.q && !busy && agent.step !== 'sending' && agent.step !== 'waiting') quick(preset.q)
  }, [preset?.n]) // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = agent.step === 'sending' || agent.step === 'waiting'
  const goes = !model ? '' : model.via === 'local' ? t('The cells picked and your words stay on this computer ({model}).', { model: model.label }) : t('The cells picked and your words go to {model} ({provider}). Nothing else leaves this computer.', { model: model.label, provider: model.provider || model.label })
  return (
    <aside className="sh-side sh-ask" aria-label={t('AI Assist')} hidden={hidden}>
      <AssistHead className="sd-panel-head" what={t('Ask about these cells')} onClose={() => { discardAll(); onClose() }} />
      <div className="sh-side-body">
        <p className="sh-picked">{sel ? <><b>{sel.a1}</b> <span className="muted">{t('on {sheet}', { sheet: sel.sheet })} · {sel.rows * sel.cols === 1 ? t('1 cell') : t('{n} cells', { n: (sel.rows * sel.cols).toLocaleString() })}</span></> : <span className="muted">{t('Pick the cells to ask about, or ask about the whole sheet.')}</span>}</p>
        <div className="sh-quick">
          {QUICK.map((q) => <button key={q.id} type="button" className="sh-chip" onClick={() => quick(q)} disabled={busy || waiting}><Icon name={q.icon} size={12} /> {t(q.label)}</button>)}
        </div>
        <form onSubmit={ask} className="sh-ask-form">
          <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} rows={4} disabled={busy || waiting} placeholder={t('What to do with them: "a column for the total of each row", "which month spent most?"')} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (noModel ? send(e) : ask(e)) }} aria-label={t('What to do with them')} />
          <div className="sh-ask-foot">
            {writer?.models?.length > 1
              ? <select className="sh-model" value={model?.id || ''} onChange={(e) => pickModel(e.target.value)} aria-label={t('Model')} title={t('The model AI Assist answers with')} disabled={busy}>
                  {!model && <option value="">—</option>}
                  {writer.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              : model && <span className="muted small sh-model-one">{model.label}</span>}
            <span className="sd-grow" />
            <button type="submit" className="btn small primary sh-send" disabled={busy || waiting || noModel || !text.trim()} title={withKeys(t('Ask'), 'mod', 'enter')}>
              <Icon name={busy ? 'refresh' : 'wand'} size={12} className={busy ? 'spin' : ''} /> {busy ? t('Asking…') : t('Ask')}
            </button>
          </div>
        </form>
        {noModel
          ? <p className="small sh-goes" role="note">{t('No model to answer with yet: sign in to an agent (Claude Code, Codex…) or add a key in Settings › Model Providers. Hand to an agent works without one.')} <button type="button" className="link-btn" onClick={openProviders}>{t('Model Providers')}</button></p>
          : goes && <p className="muted small sh-goes">{goes}</p>}
        <div className={`sh-hand${hand ? ' open' : ''}`}>
          <button type="button" className="link-btn sh-hand-toggle" onClick={() => setHand(!hand)} aria-expanded={hand}><Icon name="chevron" size={11} /> {t('Hand to an agent, for a bigger job')}</button>
          {hand && (
            <form onSubmit={send} className="sh-hand-form">
              <label className="sh-to">{t('To')}
                <select value={to} onChange={(e) => setTo(e.target.value)} disabled={waiting}>
                  {agents.map((a) => <option key={a.paneId} value={a.paneId}>{a.title || a.kindLabel} · {a.kindLabel}{a.status === 'working' ? ` (${t('working')})` : ''}</option>)}
                  <option value="new">{t('A new agent in this folder')}</option>
                </select>
              </label>
              <button type="submit" className="btn small sh-hand-send" disabled={waiting || busy || !text.trim() || !fleet}><Icon name="send" size={12} /> {agent.step === 'sending' ? t('Sending…') : t('Send to the agent')}</button>
              <small className="muted">{t('It reads the whole file and can take minutes. Its change shows here too, to keep or not.')}</small>
            </form>
          )}
        </div>
        {agent.step === 'waiting' && <div className="sh-wait" role="status"><Icon name="refresh" size={13} className="spin" /><span>{t('Asked {name}. Its change shows here, to keep or not, before anything in the file changes.', { name: agent.name })}</span><button type="button" className="link-btn" onClick={() => setAgent({ step: 'idle' })}>{t('Stop waiting')}</button></div>}
        {agent.step === 'late' && <div className="sh-wait bad" role="alert"><Icon name="alert" size={13} /><span>{t('No answer from {name} in 20 minutes. It may still be working, or waiting for you: look at its chat.', { name: agent.name })}</span><button type="button" className="link-btn" onClick={() => setAgent({ ...agent, step: 'waiting', since: Date.now() })}>{t('Keep waiting')}</button></div>}
        {busy && <div className="sh-wait" role="status"><Icon name="refresh" size={13} className="spin" /><span>{t('Asking {model}…', { model: model?.label || t('the model') })}</span></div>}
        {err && <div className="sh-wait bad" role="alert"><Icon name="alert" size={13} /><span>{err.message}{err.noModel && <> <button type="button" className="link-btn" onClick={openProviders}>{t('Model Providers')}</button></>}</span><button type="button" className="link-btn" onClick={() => setErr(null)}>{t('OK')}</button></div>}
        {note && !list.length && <div className="sh-wait ok" role="status"><Icon name="check" size={13} /><span>{note}</span></div>}
        {answer && (
          <div className="sh-change sh-answer-card">
            <small className="muted sh-by"><Icon name="wand" size={11} /> {t('By {name}', { name: answer.by })}</small>
            {answer.summary && <b className="sh-sum">{answer.summary}</b>}
            <p className="sh-answer">{answer.text}</p>
            <div className="sh-acts"><CopyButton text={answer.text} className="btn small" /><button type="button" className="ghost-btn" onClick={() => setAnswer(null)}>{t('Done')}</button></div>
          </div>
        )}
        {list.length > 1 && (
          <div className="sh-all" role="group" aria-label={t('Suggestions')}>
            <span className="small">{t('{n} suggestions, outlined on the sheet', { n: list.length })}</span>
            <button type="button" className="btn small primary" onClick={keepAll}><Icon name="check" size={12} /> {t('Keep all')}</button>
            <button type="button" className="btn small" onClick={discardAll}>{t('Discard all')}</button>
          </div>
        )}
        {list.map((s) => {
          const p = s.proposal
          return (
            <div key={s.id} className="sh-change sh-suggestion">
              <small className="muted sh-by"><Icon name="wand" size={11} /> {t('Suggested by {name}, not kept yet', { name: s.by })}</small>
              {p.summary && <b className="sh-sum">{String(p.summary)}</b>}
              {p.answer && <p className="sh-answer">{String(p.answer)}</p>}
              {s.before.length > 0 && (
                <div className="sh-cells">
                  <small className="muted">{s.before.length === 1 ? t('1 cell, outlined on the sheet') : t('{n} cells, outlined on the sheet', { n: s.before.length })}</small>
                  <ul>{Object.entries(p.cells || {}).slice(0, 8).map(([ref, v]) => <li key={ref}><code>{ref.toUpperCase()}</code> <span>{String(v)}</span></li>)}</ul>
                  {s.before.length > 8 && <small className="muted">{t('and {n} more', { n: s.before.length - 8 })}</small>}
                </div>
              )}
              {s.chart && <figure className="sh-fig"><figcaption>{s.chart.spec.title || t('Chart')}</figcaption><SheetChart chart={s.chart.view} dark={dark} /></figure>}
              <div className="sh-acts"><button type="button" className="btn small primary" onClick={() => keepOne(s)}><Icon name="check" size={12} /> {t('Keep')}</button><button type="button" className="btn small" onClick={() => putBack(s)}>{t('Discard')}</button></div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
// A value the model or the agent gave: a formula, a number, true or false, words, or "" to empty the cell.
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
  const view = chartOfGrid(cellValues(sheet, range), type, String(c.title || ''))
  if (!view.series.length) throw new Error(t('there are no numbers in {ref} to chart', { ref }))
  const spec = { sheet: sheet.getSheetId(), sheetName: sheet.getSheetName(), type, title: String(c.title || ''), ref, at: { col: range.getColumn() + range.getWidth() + 1, row: range.getRow() }, size: { cols: 8, rows: 16 } }
  return { spec, view }
}

// ---------- Charts ----------
// The file's charts on the sheet in view (and ones made here, by Insert › Chart or AI Assist),
// drawn from its cells as they are now; each picks its cells when its name is clicked. One made
// here has its kind and title to change, and goes with Remove; the file's own are changed in Excel,
// or by AI Assist.
function ChartsPanel({ charts, univer, sel, dark, csv, onInsert, onEdit, onAsk, onClose }) {
  const here = charts.filter((c) => !sel || c.sheet === sel.sheetId || c.sheetName === sel.sheet)
  const view = (c) => {
    try {
      const u = univer.current
      if (c.added) { const s = u.getActiveWorkbook().getSheetBySheetId(c.sheet); return chartOfGrid(cellValues(s, s.getRange(c.ref)), c.type, c.title) }
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
        {!here.length && <div className="sh-none"><Icon name="trend" size={18} /><b>{t('No charts on this sheet')}</b><span className="muted small">{csv ? t('Pick the cells to chart, then Make a chart: you see it before it\'s added, and it\'s saved as an Excel chart.') : t('Pick the cells to chart (their labels and numbers, with the headings above them), then Insert chart. It\'s saved as an Excel chart.')}</span><span className="sh-acts">{!csv && <button type="button" className="btn small primary" onClick={() => onInsert('column')}><Icon name="bar-chart" size={12} /> {t('Insert chart')}</button>}<button type="button" className="btn small" onClick={onAsk}><Icon name="wand" size={12} /> {t('Make a chart')}</button></span></div>}
        {here.map((c, i) => {
          const v = view(c)
          return (
            <figure key={c.id || i} className="sh-fig">
              <figcaption><button type="button" className="link-btn" onClick={() => pick(c)} title={t('Pick its cells')}>{c.title || v?.series?.[0]?.name || t('Chart {n}', { n: i + 1 })}</button>{c.added && <small className="muted"> · {t('added, saved with the file')}</small>}</figcaption>
              {v ? <SheetChart chart={v} dark={dark} /> : <small className="muted">{t('This kind of chart can\'t be drawn here; it\'s kept in the file as it is.')}</small>}
              {c.added && c.id && (
                <div className="sh-fig-tools">
                  <select value={c.type} onChange={(e) => onEdit(c.id, { type: e.target.value })} aria-label={t('Kind of chart')} title={t('Kind of chart')}>
                    {Object.entries(CHART_KINDS).map(([k, label]) => <option key={k} value={k}>{t(label)}</option>)}
                  </select>
                  <input value={c.title} onChange={(e) => onEdit(c.id, { title: e.target.value })} placeholder={t('Title')} aria-label={t('Chart title')} />
                  <button type="button" className="link-btn" onClick={() => onEdit(c.id, null)}>{t('Remove')}</button>
                </div>
              )}
            </figure>
          )
        })}
        {here.length > 0 && !csv && <p className="muted small sh-more">{t('Another chart: pick its cells, then Insert › Chart.')}</p>}
      </div>
    </aside>
  )
}
// A range's values as they are, not as they show: 900 for $900.00, 0.45 for 45% (a formula's its
// result), '' for an empty cell.
function cellValues(sheet, range) {
  const ws = sheet.getSheet()
  const r0 = range.getRow(), c0 = range.getColumn()
  const at = (r, c) => { const x = ws.getCellRaw(r, c); return x?.v ?? x?.p?.body?.dataStream?.replace(/\r\n$/, '') ?? '' }
  return Array.from({ length: range.getHeight() }, (_, i) => Array.from({ length: range.getWidth() }, (_, j) => at(r0 + i, c0 + j)))
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
    return cellValues(sheet, sheet.getRange(at.slice(bang + 1))).flat()
  } catch { return null }
}
