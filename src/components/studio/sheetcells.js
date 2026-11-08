// What a cell says and keeps, on a sheet (editors/SheetEditor.jsx), through Univer's own services.
// A formula's error (#DIV/0!, #N/A, #NAME?…) says what went wrong in plain words when its cell is
// picked: Univer's own alert there, given these words in place of its "Divide by zero error". And
// what's typed keeps the cell's own colour: Univer's cell editor gives new text its theme's ink
// (#1B1C1F) as a colour of its own, which the file would then keep on every cell typed in, and
// which made a word added to a cell's text a run of rich text.
import { SheetInterceptorService, AFTER_CELL_EDIT } from '@univerjs/preset-sheets-core'
import { ThemeService } from '@univerjs/presets'
import { t } from '../../i18n/index.js'

// Univer's words for a formula's errors (its sheets-formula-ui locale), in the app's language.
export const formulaErrorWords = () => ({
  'sheets-formula-ui': {
    error: {
      title: t('What went wrong'),
      divByZero: t('#DIV/0!: it divides by zero, or by an empty cell. IFERROR(…, 0) shows something else instead.'),
      na: t("#N/A: a lookup (VLOOKUP, XLOOKUP, MATCH) didn't find what it looked for. Check that it's there, written the same way."),
      name: t('#NAME?: it uses a name Studio doesn\'t know, a function or named range spelled another way, or words that need "quotes".'),
      ref: t("#REF!: it points at a cell that isn't there any more, as a row, column or sheet it used was deleted."),
      value: t('#VALUE!: something it uses is the wrong kind, text where a number is needed, say.'),
      num: t("#NUM!: the answer is too big or too small, or can't be worked out (the square root of a negative number, say)."),
      null: t("#NULL!: two ranges with a space between them don't overlap. A comma or a colon was probably meant."),
      spill: t('#SPILL!: its answer fills more cells, and something is in the way. Clear the cells below or beside it.'),
      calc: t('#CALC!: it has no answer to show, FILTER finding nothing, say.'),
      error: t('#ERROR!: the formula can\'t be read. Check its brackets, commas and "quotes".'),
    },
  },
})

export function sheetCells(univer) {
  const injector = univer.__getInjector()
  const offs = []
  try {
    const ink = String(injector.get(ThemeService).getColorFromTheme('gray.900') || '').toLowerCase()
    const isInk = (cl) => !!ink && String(cl?.rgb || '').toLowerCase() === ink
    const interceptors = injector.get(SheetInterceptorService)
    offs.push(interceptors.writeCellInterceptor.intercept(AFTER_CELL_EDIT, {
      priority: 100,
      handler: (cell, ctx, next) => {
        if (!cell || !ink) return next(cell)
        const was = ctx.worksheet.getCellRaw(ctx.row, ctx.col)
        const wasStyle = typeof was?.s === 'string' ? ctx.workbook.getStyles().get(was.s) : was?.s
        if (wasStyle?.cl) return next(cell)
        const out = { ...cell }
        const unInk = (style) => { const s = { ...style }; delete s.cl; return s }
        if (out.s && typeof out.s === 'object' && isInk(out.s.cl)) { const s = unInk(out.s); out.s = Object.keys(s).length ? s : null }
        // Rich text only for what's really styled: with the ink gone, one line of plain text is
        // a plain value again (a number, too, once Univer's own number reading has it).
        const body = out.p?.body
        if (body?.textRuns?.length) {
          const runs = body.textRuns.map((r) => (isInk(r.ts?.cl) ? { ...r, ts: unInk(r.ts) } : r)).filter((r) => r.ts && Object.keys(r.ts).length)
          if (!runs.length && (body.paragraphs || []).length <= 1 && !body.customRanges?.length && !body.customBlocks?.length) { out.v = body.dataStream.replace(/\r\n$/, ''); out.p = null }
          else out.p = { ...out.p, body: { ...body, textRuns: runs } }
        }
        return next(out)
      },
    }))
  } catch { /* a Univer without this point: typed text keeps Univer's own colour */ }
  return { dispose: () => { for (const o of offs) { try { o() } catch { /* gone */ } } } }
}
