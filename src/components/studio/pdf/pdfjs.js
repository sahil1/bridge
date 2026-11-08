// pdf.js (Mozilla's PDF reader, Apache-2.0), its legacy build so older phone browsers read PDFs
// too, loaded the first time a PDF opens. Its reader runs in a worker of its own. What it reads on
// demand comes with the app (its character maps for Chinese, Japanese and Korean text that
// doesn't carry its own, the two symbol fonts, and its decoders for scanned pages' pictures), so
// nothing is fetched from anywhere else.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

const FILES = import.meta.glob([
  '/node_modules/pdfjs-dist/cmaps/*.bcmap',
  '/node_modules/pdfjs-dist/standard_fonts/Foxit{Symbol,Dingbats}.pfb',
  '/node_modules/pdfjs-dist/wasm/{openjpeg,jbig2}.wasm',
], { query: '?url', import: 'default' })
const DIRS = { cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts', wasmUrl: 'wasm' }

// What pdf.js asks for by name, from the files built in with the app.
class BuiltIn {
  async fetch({ kind, filename }) {
    const get = FILES[`/node_modules/pdfjs-dist/${DIRS[kind]}/${filename}`]
    if (!get) throw new Error(`pdf.js asked for ${filename}, which isn't built in`)
    const r = await fetch(await get())
    if (!r.ok) throw new Error(`Couldn't load ${filename} (${r.status})`)
    return new Uint8Array(await r.arrayBuffer())
  }
}

let loading = null
export function loadPdfjs() {
  loading ||= (async () => {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    lib.GlobalWorkerOptions.workerSrc = workerUrl
    // The viewer reads pdf.js from here (its own build expects it so).
    globalThis.pdfjsLib = lib
    const viewer = await import('pdfjs-dist/legacy/web/pdf_viewer.mjs')
    return { lib, viewer }
  })()
  loading.catch(() => { loading = null })
  return loading
}

// Only as much of a PDF as its first page needs, asked for in parts (the file route answers Range):
// Files' pictures of PDFs, which mustn't read a whole big file for one.
export function openPdfAt(lib, url) {
  return lib.getDocument({ url, disableAutoFetch: true, disableStream: true, rangeChunkSize: 65536, BinaryDataFactory: BuiltIn, cMapUrl: 'cmaps/', standardFontDataUrl: 'standard_fonts/', wasmUrl: 'wasm/' })
}

// Opening a PDF's bytes (copied: pdf.js hands them to its worker). onPassword(retry, wrong): it's
// locked with a password, asked of you.
export function openPdf(lib, data, { onPassword } = {}) {
  const task = lib.getDocument({
    data: new Uint8Array(data.slice(0)),
    BinaryDataFactory: BuiltIn, cMapUrl: 'cmaps/', standardFontDataUrl: 'standard_fonts/', wasmUrl: 'wasm/',
  })
  if (onPassword) task.onPassword = (retry, reason) => onPassword(retry, reason === lib.PasswordResponses.INCORRECT_PASSWORD)
  return task
}
