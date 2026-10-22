import fs from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { loadConfig } from './server/paths.js'

// Dev mode (npm start -- dev): this serves the UI with hot reload on the API port + 1 and passes
// /api, WebSockets included, to the server.
const { port = 7420 } = loadConfig()

// Builds of the UI that run with no computer behind them, on a backend in the page
// (src/standalone): `vite build --mode demo` (npm run demo:build) makes the demo in dist-demo/.
// Paths are relative and nothing loads from the network, so the folder works from any address,
// and inside the phone apps.
const STANDALONE = { demo: 'src/demo/main.jsx' }

function standalone(entry) {
  return {
    name: 'bridge-standalone',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html
        .replace('/src/main.jsx', `/${entry}`)
        .replace(/\s*<link[^>]*rel="manifest"[^>]*>/g, '')
        .replace(/href="\/(mark\.svg|apple-touch-icon\.png)"/g, 'href="$1"'),
    },
    // The two pictures the page uses from public/ (the rest is for the installed app).
    generateBundle() {
      for (const name of ['mark.svg', 'apple-touch-icon.png']) this.emitFile({ type: 'asset', fileName: name, source: fs.readFileSync(`public/${name}`) })
    },
  }
}

export default defineConfig(({ mode }) => {
  const entry = STANDALONE[mode]
  return {
    plugins: [react(), entry && standalone(entry)],
    ...(entry && { base: './', publicDir: false }),
    // Source maps so a crash in the browser console names the real file and line.
    build: entry ? { outDir: `dist-${mode}`, emptyOutDir: true, sourcemap: false } : { sourcemap: true },
    server: { host: '127.0.0.1', port: port + 1, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${port}`, ws: true } } },
  }
})
