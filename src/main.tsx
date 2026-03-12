import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch() {
    // Clear stale state and auto-recover (once per session to avoid loops)
    localStorage.removeItem('dcc-session-id')
    localStorage.removeItem('dcc-last-seen-activity')
    if (!sessionStorage.getItem('dcc-recovery')) {
      sessionStorage.setItem('dcc-recovery', '1')
      window.location.reload()
    }
  }
  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
