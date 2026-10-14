import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { loadConfig } from './server/paths.js'

// Dev mode (npm start -- dev): this serves the UI with hot reload on the API port + 1 and passes
// /api, WebSockets included, to the server.
const { port = 7420 } = loadConfig()

export default defineConfig({
  plugins: [react()],
  // Source maps so a crash in the browser console names the real file and line.
  build: { sourcemap: true },
  server: { host: '127.0.0.1', port: port + 1, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${port}`, ws: true } } },
})
