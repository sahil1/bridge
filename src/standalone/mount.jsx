import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App.jsx'
import Solo from '../components/Solo.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import '../styles.css'
import { apply } from '../appearance.js'
import { serve } from './serve.js'

// Starts the UI on a backend in the page (serve.js). The same as main.jsx, less what only makes
// sense with a computer: the service worker (notifications) and saying you're at the computer.
// `extra` is drawn next to the app, outside it (the demo's bar).
export function mount(backend, extra = null) {
  serve(backend)
  apply()
  // ?window=<pane>: one agent in a window of its own.
  const solo = new URLSearchParams(location.search).get('window')
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorBoundary name="Bridge AI">
        {solo ? <Solo paneId={solo} /> : <App />}
      </ErrorBoundary>
      {extra}
    </StrictMode>,
  )
}
