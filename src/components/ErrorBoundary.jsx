import { Component } from 'react'

// One broken view shouldn't blank the whole app: show what failed, in place, with a way out.
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error(`[${this.props.name || 'view'}]`, error, info?.componentStack) }
  componentDidUpdate(prev) { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }) }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash">
        <b>{this.props.name ? `${this.props.name} hit an error` : 'Something broke here'}</b>
        <code>{String(error.message || error)}</code>
        <div className="crash-actions">
          <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="ghost-btn" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    )
  }
}
