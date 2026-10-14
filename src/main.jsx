import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './styles.css'
import { apply } from './appearance.js'

apply()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary name="Bridge AI">
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
