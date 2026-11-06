import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo)
    this.setState({ error, errorInfo })
  }

  handleReload = () => {
    try {
      localStorage.removeItem('glaze_session')
    } catch {}
    window.location.reload()
  }

  handleResetStorage = () => {
    try {
      localStorage.clear()
    } catch {}
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-[var(--surface-0)] text-white p-8 select-none">
          <div className="max-w-md w-full bg-white/[0.04] border border-white/10 rounded-3xl p-8 shadow-2xl backdrop-blur-2xl text-center space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-red-500/20 text-red-400 border border-red-500/30 flex items-center justify-center mx-auto text-2xl shadow-lg">
              ⚠️
            </div>
            
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-white mb-1">Something went wrong</h2>
              <p className="text-xs text-white/50">
                Glaze Music encountered an unexpected rendering issue.
              </p>
            </div>

            <div className="text-left bg-black/50 border border-white/5 rounded-xl p-3.5 max-h-40 overflow-y-auto font-mono text-[11px] text-red-300 select-text custom-scrollbar">
              {this.state.error?.toString() || 'Unknown Error'}
            </div>

            <div className="flex flex-col gap-2.5 pt-2">
              <button
                onClick={this.handleReload}
                className="on-accent w-full py-3 rounded-xl bg-red-500 hover:bg-red-600 font-bold text-sm text-white shadow-lg shadow-red-500/20 transition-all cursor-pointer"
              >
                Reload Player
              </button>
              <button
                onClick={this.handleResetStorage}
                className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-white/60 hover:text-white transition-all cursor-pointer"
              >
                Reset Cache & Reload
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
