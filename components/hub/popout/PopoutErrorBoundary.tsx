'use client'

// Guards the pop-out window's body. A render error in a thread view must never
// (a) show a bare white window, or (b) propagate to the main React root and take
// the whole Hub page down with it — an unhandled throw in a portal does exactly
// that without a boundary here. Instead we catch it, keep the main app alive, and
// show the actual error so it's diagnosable from inside the floating window.

import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export default class PopoutErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Surface to the console too, so the full stack is available in devtools.
    console.error('[popout] render error', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <div className="flex flex-1 flex-col gap-2 overflow-auto p-4 text-sm text-red-200">
          <div className="font-semibold text-red-300">This conversation couldn’t load in the pop-out.</div>
          <div className="break-words font-mono text-[11px] text-red-200/80">
            {error.name}: {error.message}
          </div>
          <div className="whitespace-pre-wrap break-words font-mono text-[10px] text-white/40">
            {(error.stack || '').split('\n').slice(0, 6).join('\n')}
          </div>
          <div className="text-xs text-white/50">The full conversation still works on the main page.</div>
        </div>
      )
    }
    return this.props.children
  }
}
