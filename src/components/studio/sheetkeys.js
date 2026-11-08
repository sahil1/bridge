// The keys someone coming from Google Sheets reaches for, on a sheet (editors/SheetEditor.jsx),
// that Univer doesn't bind itself: each runs Univer's own commands, so it's undone like any
// other change. ⌘ on a Mac and Ctrl elsewhere, except where Google Sheets uses Ctrl on a Mac too
// (the number formats, and selecting a column), whose ⌘ versions macOS keeps for screenshots.
//   Home, End                    the row's first cell, its last filled one
//   ⌘Home, ⌘End                  the sheet's first cell, its last filled one
//   Page Up, Page Down           a screen up or down
//   ⌥↑, ⌥↓ (Ctrl+PgUp, PgDn)     the sheet before or after
//   Shift+Space, Ctrl+Space      the whole rows or columns picked
//   ⇧⌘V                          paste the values only
//   Ctrl+Shift+1 to 6            number, time, date, currency, percent, scientific
//   ⌘;, ⇧⌘;                      today's date, the time now
//   ⌘\                           clear the formatting
//   ⇧⌘7                          a border round what's picked
//   ⇧⌘H                          find and replace (⌘H hides the app on a Mac)
//   ⇧F2                          a note on the cell
//   ⌘/                           every shortcut (Univer's list, which has these too)
//   ⌘P                           print, or save as PDF
import { IShortcutService, KeyCode, MetaKeys, whenSheetEditorFocused, SheetPasteValueCommand } from '@univerjs/preset-sheets-core'
import { ICommandService, CommandType, RANGE_TYPE, excelDateSerial } from '@univerjs/presets'
import { t } from '../../i18n/index.js'

const PAGE_UP = 33
const PAGE_DOWN = 34
const SEMICOLON = 186
const SLASH = 191
const { SHIFT, ALT, CTRL_COMMAND: MOD, MAC_CTRL } = MetaKeys
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
// Ctrl itself: on a Mac that's ⌃ (MAC_CTRL); elsewhere Univer's CTRL_COMMAND is Ctrl.
const CTRL = MAC ? MAC_CTRL : MOD

// The date and time as this computer writes them (m/d/yyyy here, dd/mm/yyyy there).
function datePattern() {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(2026, 10, 23))
    return parts.map((p) => (p.type === 'year' ? 'yyyy' : p.type === 'month' ? (p.value.length > 1 ? 'mm' : 'm') : p.type === 'day' ? (p.value.length > 1 ? 'dd' : 'd') : p.value)).join('')
  } catch { return 'yyyy-mm-dd' }
}
const twelveHours = () => { try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 !== false } catch { return true } }
const timePattern = () => (twelveHours() ? 'h:mm:ss AM/PM' : 'hh:mm:ss')

// container: the sheet's own element; onPrint: Print; onSay(words): what a key couldn't do.
export function googleKeys(univer, u, { container, onPrint, onSay } = {}) {
  const injector = univer.__getInjector()
  const commands = injector.get(ICommandService)
  const shortcuts = injector.get(IShortcutService)
  const offs = []
  const sheet = () => u.getActiveWorkbook()?.getActiveSheet()
  // The picked cell, and the whole selection, as Univer has them.
  const here = () => {
    const s = sheet()
    const sel = s?.getSelection()
    const cell = sel?.getCurrentCell()
    const range = sel?.getActiveRange()?.getRange()
    return s && cell && range ? { s, row: cell.actualRow, col: cell.actualColumn, range } : null
  }
  const select = (s, range, row, col) => {
    commands.syncExecuteCommand('sheet.operation.set-selections', {
      unitId: u.getActiveWorkbook().getId(),
      subUnitId: s.getSheetId(),
      selections: [{ range, primary: { startRow: row, endRow: row, startColumn: col, endColumn: col, actualRow: row, actualColumn: col, isMerged: false, isMergedMainCell: false }, style: null }],
    })
  }
  const goTo = (s, row, col) => {
    select(s, { startRow: row, endRow: row, startColumn: col, endColumn: col, rangeType: RANGE_TYPE.NORMAL }, row, col)
    commands.executeCommand('sheet.operation.scroll-to-range', { range: { startRow: row, endRow: row, startColumn: col, endColumn: col } })
  }
  // The last filled cell of a row (or the sheet's last filled column, for an empty row).
  const rowEnd = (s, row) => {
    const ws = s.getSheet()
    for (let c = s.getLastColumn(); c >= 0; c--) { const v = ws.getCellRaw(row, c); if (v && (v.v != null && v.v !== '' || v.f || v.p)) return c }
    return Math.max(0, s.getLastColumn())
  }

  const COMMANDS = [
    { id: 'bridge.sheet.go', run: ({ to }) => {
      const h = here()
      if (!h) return false
      const { s, row, col } = h
      if (to === 'row-start') goTo(s, row, 0)
      else if (to === 'row-end') goTo(s, row, rowEnd(s, row))
      else if (to === 'start') goTo(s, 0, 0)
      else if (to === 'end') goTo(s, Math.max(0, s.getLastRow()), Math.max(0, s.getLastColumn()))
      else {
        // A screen up or down: the view and the picked cell move together, as far as the sheet goes.
        const v = s.getVisibleRange()
        const n = Math.max(1, v.endRow - v.startRow - 1) * (to === 'page-down' ? 1 : -1)
        const last = s.getMaxRows() - 1
        const r = Math.min(last, Math.max(0, row + n))
        select(s, { startRow: r, endRow: r, startColumn: col, endColumn: col, rangeType: RANGE_TYPE.NORMAL }, r, col)
        s.scrollToCell(Math.min(last, Math.max(0, v.startRow + n)), v.startColumn)
      }
      return true
    } },
    { id: 'bridge.sheet.select-whole', run: ({ what }) => {
      const h = here()
      if (!h) return false
      const { s, row, col, range } = h
      const rows = what === 'rows'
      select(s, rows
        ? { startRow: range.startRow, endRow: range.endRow, startColumn: 0, endColumn: s.getMaxColumns() - 1, rangeType: RANGE_TYPE.ROW }
        : { startRow: 0, endRow: s.getMaxRows() - 1, startColumn: range.startColumn, endColumn: range.endColumn, rangeType: RANGE_TYPE.COLUMN }, row, col)
      return true
    } },
    { id: 'bridge.sheet.next-sheet', run: ({ step }) => {
      const wb = u.getActiveWorkbook()
      const all = wb?.getSheets().filter((s) => !s.isSheetHidden())
      if (!all?.length) return false
      const at = all.findIndex((s) => s.getSheetId() === wb.getActiveSheet().getSheetId())
      const next = all[at + step]
      if (next) wb.setActiveSheet(next)
      return !!next
    } },
    { id: 'bridge.sheet.number-format', run: async ({ kind }) => {
      if (kind === 'currency') return commands.executeCommand('sheet.command.numfmt.set.currency')
      if (kind === 'percent') return commands.executeCommand('sheet.command.numfmt.set.percent')
      const pattern = { number: '#,##0.00', time: timePattern(), date: datePattern(), scientific: '0.00E+00' }[kind]
      const values = []
      const s = sheet()
      for (const r of s?.getSelection()?.getActiveRangeList() || []) {
        const g = r.getRange()
        const endRow = Math.min(g.endRow, s.getMaxRows() - 1), endCol = Math.min(g.endColumn, s.getMaxColumns() - 1)
        for (let row = g.startRow; row <= endRow; row++) for (let col = g.startColumn; col <= endCol; col++) values.push({ row, col, pattern })
      }
      return values.length ? commands.executeCommand('sheet.command.numfmt.set.numfmt', { values }) : false
    } },
    // Today's date, or the time now, in the cell picked, as a date or time (not words).
    { id: 'bridge.sheet.insert-now', run: ({ what }) => {
      const h = here()
      if (!h) return false
      const now = new Date()
      const day = excelDateSerial(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())))
      const v = what === 'date' ? day : (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400
      return commands.executeCommand('sheet.command.set-range-values', { range: { startRow: h.row, endRow: h.row, startColumn: h.col, endColumn: h.col }, value: { v, t: 2, s: { n: { pattern: what === 'date' ? datePattern() : timePattern() } } } })
    } },
    { id: 'bridge.sheet.border-outside', run: () => commands.executeCommand('sheet.command.set-border-basic', { value: { type: 'outside', color: '#000000', style: 1 } }) },
    { id: 'bridge.sheet.print', run: () => { onPrint?.(); return true } },
  ]
  for (const c of COMMANDS) {
    try { offs.push(commands.registerCommand({ id: c.id, type: CommandType.COMMAND, handler: (_a, p) => c.run(p || {}) })) } catch { /* already there */ }
  }

  // Shown in Univer's own list (⌘/) under Google Sheets, where its list can write the keys.
  const group = { group: '9_bridge-google', groupTitle: t('Keys from Google Sheets') }
  const KEYS = [
    { id: 'bridge.sheet.go', binding: KeyCode.HOME, staticParameters: { to: 'row-start' }, description: t('The first cell of the row'), ...group },
    { id: 'bridge.sheet.go', binding: KeyCode.END, staticParameters: { to: 'row-end' }, description: t('The last filled cell of the row'), ...group },
    { id: 'bridge.sheet.go', binding: KeyCode.HOME | MOD, staticParameters: { to: 'start' }, description: t('The first cell of the sheet'), ...group },
    { id: 'bridge.sheet.go', binding: KeyCode.END | MOD, staticParameters: { to: 'end' }, description: t('The last filled cell of the sheet'), ...group },
    // A Mac's keyboard has no Home or End: Fn+⌘← and Fn+⌘→ are ⌘Home and ⌘End there, as above.
    { id: 'bridge.sheet.go', binding: PAGE_DOWN, staticParameters: { to: 'page-down' } },
    { id: 'bridge.sheet.go', binding: PAGE_UP, staticParameters: { to: 'page-up' } },
    { id: 'bridge.sheet.next-sheet', binding: KeyCode.ARROW_DOWN | ALT, staticParameters: { step: 1 }, description: t('The next sheet'), ...group },
    { id: 'bridge.sheet.next-sheet', binding: KeyCode.ARROW_UP | ALT, staticParameters: { step: -1 }, description: t('The sheet before'), ...group },
    { id: 'bridge.sheet.next-sheet', binding: PAGE_DOWN | CTRL, staticParameters: { step: 1 } },
    { id: 'bridge.sheet.next-sheet', binding: PAGE_UP | CTRL, staticParameters: { step: -1 } },
    { id: 'bridge.sheet.select-whole', binding: KeyCode.SPACE | SHIFT, staticParameters: { what: 'rows' }, description: t('Pick the whole rows'), ...group },
    { id: 'bridge.sheet.select-whole', binding: KeyCode.SPACE | CTRL, staticParameters: { what: 'cols' }, description: t('Pick the whole columns'), ...group },
    { id: 'bridge.sheet.number-format', binding: KeyCode.Digit1 | CTRL | SHIFT, staticParameters: { kind: 'number' }, description: t('Format as a number'), ...group },
    { id: 'bridge.sheet.number-format', binding: KeyCode.Digit2 | CTRL | SHIFT, staticParameters: { kind: 'time' }, description: t('Format as a time'), ...group },
    { id: 'bridge.sheet.number-format', binding: KeyCode.Digit3 | CTRL | SHIFT, staticParameters: { kind: 'date' }, description: t('Format as a date'), ...group },
    { id: 'bridge.sheet.number-format', binding: KeyCode.Digit4 | CTRL | SHIFT, staticParameters: { kind: 'currency' }, description: t('Format as currency'), ...group },
    { id: 'bridge.sheet.number-format', binding: KeyCode.Digit5 | CTRL | SHIFT, staticParameters: { kind: 'percent' }, description: t('Format as a percent'), ...group },
    { id: 'bridge.sheet.number-format', binding: KeyCode.Digit6 | CTRL | SHIFT, staticParameters: { kind: 'scientific' }, description: t('Format as scientific'), ...group },
    { id: 'bridge.sheet.insert-now', binding: SEMICOLON | MOD, staticParameters: { what: 'date' } },
    { id: 'bridge.sheet.insert-now', binding: SEMICOLON | MOD | SHIFT, staticParameters: { what: 'time' } },
    { id: 'sheet.command.clear-selection-format', binding: KeyCode.BACK_SLASH | MOD, description: t('Clear the formatting'), ...group, priority: 10 },
    { id: 'bridge.sheet.border-outside', binding: KeyCode.Digit7 | MOD | SHIFT, description: t('A border round the cells'), ...group },
    { id: 'ui.operation.open-replace-dialog', binding: KeyCode.H | MOD | SHIFT, description: t('Find and replace'), ...group },
    { id: 'sheet.operation.add-note-popup', binding: KeyCode.F2 | SHIFT, description: t('Add a note'), ...group },
    { id: 'base-ui.operation.toggle-shortcut-panel', binding: SLASH | MOD },
    { id: 'bridge.sheet.print', binding: KeyCode.P | MOD, description: t('Print, or save as PDF'), ...group },
  ]
  // ⌘\ is also Univer's own key for its list of shortcuts: Google Sheets clears the formatting
  // with it, which goes first (its priority), and the list is ⌘/ as there. Univer makes some of
  // these commands a few seconds after the sheet opens (the list among them): until then the key
  // does nothing rather than fail.
  const ready = (id) => (ctx) => whenSheetEditorFocused(ctx) && commands.hasCommand(id)
  for (const k of KEYS) offs.push(shortcuts.registerShortcut({ preconditions: ready(k.id), ...k }))

  // ⇧⌘V, the values only. The browser's own paste (its Paste and Match Style, which needs no leave
  // to read what was copied, which the desktop app doesn't give) goes in as Univer pastes, and
  // Univer's own Paste options › Values only then makes it values. Where the browser has no such
  // paste (Safari), Univer reads what was copied itself, and says so when that isn't allowed.
  let valuesAsked = 0
  const onKey = (e) => {
    if (!container?.contains(e.target) || !(MAC ? e.metaKey : e.ctrlKey) || !e.shiftKey || e.altKey || e.code !== 'KeyV') return
    valuesAsked = Date.now()
    setTimeout(async () => {
      if (!valuesAsked) return
      valuesAsked = 0
      try { if (!(await commands.executeCommand(SheetPasteValueCommand.id))) throw new Error(t('nothing was copied')) } catch (x) { onSay?.(t("Couldn't paste the values: {error}. Paste with {keys}, then pick Values only in the paste options by the cells.", { error: String(x.message).replace(/\.$/, ''), keys: MAC ? '⌘V' : 'Ctrl+V' })) }
    }, 400)
  }
  window.addEventListener('keydown', onKey, true)
  offs.push({ dispose: () => window.removeEventListener('keydown', onKey, true) })
  offs.push(commands.onCommandExecuted((c) => {
    if (c.id !== 'sheet.command.paste-by-short-key' || !valuesAsked || Date.now() - valuesAsked > 2000) return
    valuesAsked = 0
    commands.executeCommand('sheet.command.optional-paste', { type: 'SPECIAL_PASTE_VALUE' })
  }))
  return {
    dispose: () => {
      for (const o of offs) { try { o.dispose() } catch { /* gone */ } }
      // Univer's list of shortcuts, once opened, looks each one up again in Univer's words as
      // Univer takes its own away, after its words are gone (a page error for each): it's told
      // nothing more changes.
      try { shortcuts._shortcutChanged$?.complete() } catch { /* nothing to stop */ }
    },
  }
}
