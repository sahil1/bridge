// The whiteboard's fonts come from Bridge AI itself, never from the internet (vite.config.js).
//
// Excalidraw (src/components/whiteboard) draws text in its own fonts, which it loads from
// window.EXCALIDRAW_ASSET_PATH and, should one not load from there, from esm.sh. This puts the
// fonts in the build at assets/excalidraw/fonts/ (and serves them from node_modules in dev mode),
// and points that second try at the same place, so a whiteboard never reaches esm.sh.
//
// Xiaolai, its hand-drawn Chinese, Japanese and Korean font (12 MB in 209 pieces), is left out:
// that text is drawn in the computer's own font for those languages instead. So are the languages
// of Excalidraw's own menus that Bridge AI isn't in (it's told Bridge AI's), 1.5 MB that would
// never load.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FONTS = path.join(ROOT, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts')
const LEAVE_OUT = new Set(['Xiaolai'])
const OUT = 'assets/excalidraw/fonts'
// Excalidraw's names for Bridge AI's languages (src/components/whiteboard/Canvas.jsx), and its
// table of how much of each is translated.
const LANGS = new Set(['en', 'de-DE', 'es-ES', 'fr-FR', 'hi-IN', 'ja-JP', 'pt-BR', 'zh-CN', 'percentages'])
const LOCALE = /[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/](prod|dev)[\\/]locales[\\/]([\w-]+?)-[A-Z0-9]{8}\.js$/
// Where Excalidraw's code says to fall back to: `https://esm.sh/${…}/dist/prod/` (with another
// template string inside the ${…}).
const CDN = /`https:\/\/esm\.sh\/\$\{.*?\}\/dist\/prod\/`/g
const LOCAL = '(typeof window<"u"&&typeof window.EXCALIDRAW_ASSET_PATH=="string"?window.EXCALIDRAW_ASSET_PATH:typeof location<"u"?location.href:"http://localhost/")'

function fonts() {
  if (!fs.existsSync(FONTS)) return []
  return fs.readdirSync(FONTS, { withFileTypes: true }).filter((d) => d.isDirectory() && !LEAVE_OUT.has(d.name))
    .flatMap((d) => fs.readdirSync(path.join(FONTS, d.name)).filter((f) => f.endsWith('.woff2')).map((f) => `${d.name}/${f}`))
}

// The worker Excalidraw fits fonts into an exported SVG with (subset-worker.chunk.js) imports two
// small pieces of its code besides the font tools. Left to itself the bundler folds those into
// Excalidraw's main file, which the worker then has to load, and which can't run in a worker (it
// uses window), so every export fell back to the page. Kept in a file of their own (the font
// tools, 1.8 MB, already are), the worker loads only what it needs.
function workerPieces() {
  try {
    const dir = path.join(FONTS, '..')
    const src = fs.readFileSync(path.join(dir, 'subset-worker.chunk.js'), 'utf8')
    return [...src.matchAll(/import\s*(?:\{[^}]*\}\s*from\s*)?"\.\/(chunk-\w+\.js)"/g)].map((m) => m[1]).filter((f) => fs.statSync(path.join(dir, f)).size < 50_000)
  } catch { return [] }
}

export default function whiteboardAssets() {
  let used = false
  let pointed = 0
  return {
    name: 'bridge-whiteboard-assets',
    config() {
      const pieces = workerPieces()
      if (!pieces.length) return null
      const test = new RegExp(`[\\\\/]@excalidraw[\\\\/]excalidraw[\\\\/]dist[\\\\/]prod[\\\\/](${pieces.map((p) => p.replace(/\./g, '\\.')).join('|')})$`)
      return { build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'excalidraw-worker', test }] } } } } }
    },
    load(id) {
      const m = LOCALE.exec(id)
      return m && !LANGS.has(m[2]) ? 'export default {}' : null
    },
    transform(code, id) {
      if (!/[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/]/.test(id) || !code.includes('esm.sh')) return null
      used = true
      const out = code.replace(CDN, () => { pointed++; return LOCAL })
      return out === code ? null : { code: out, map: null }
    },
    generateBundle() {
      if (!used) return
      // Excalidraw's code changed where it falls back to: stop, rather than ship a whiteboard that
      // reaches the internet.
      if (!pointed) this.error('whiteboard-assets: Excalidraw\'s font fallback (esm.sh) wasn\'t found to point at Bridge AI. Check scripts/whiteboard-assets.js against the new version.')
      for (const f of fonts()) this.emitFile({ type: 'asset', fileName: `${OUT}/${f}`, source: fs.readFileSync(path.join(FONTS, f)) })
    },
    configureServer(server) {
      server.middlewares.use(`/${OUT}/`, (req, res, next) => {
        const rel = decodeURIComponent(String(req.url || '').split('?')[0]).replace(/^\/+/, '')
        const file = path.join(FONTS, rel)
        if (!file.startsWith(FONTS + path.sep) || LEAVE_OUT.has(rel.split('/')[0]) || !fs.existsSync(file)) return next()
        res.setHeader('Content-Type', 'font/woff2')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}
