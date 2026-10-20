import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Solo from './components/Solo.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './styles.css'
import { apply } from './appearance.js'
import { registerServiceWorker } from './pwa.js'

apply()
// ?window=<pane>: one agent in a window of its own.
const solo = new URLSearchParams(location.search).get('window')
registerServiceWorker()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary name="Bridge AI">
      {solo ? <Solo paneId={solo} /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
