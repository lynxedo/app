'use client'

/**
 * Per-tab error boundary for the kept-alive workspace-tab stack. A crash inside
 * one tab's screen must NOT white-screen the whole Hub — it's contained here and
 * shown as an in-tab message (the rail, strip, and every other tab keep working).
 * Also surfaces the error text so a beta tester can report exactly what broke.
 *
 * `resetKey` (the tab id) resets the boundary if the tab is reused for a
 * different instance, so a fixed/new tab renders fresh.
 */

import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode; label: string; resetKey: string; onReload?: () => void }
type State = { error: Error | null; shownFor: string }

export default class WorkspaceTabErrorBoundary extends Component<Props, State> {
  state: State = { error: null, shownFor: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // A new tab instance in the same slot → clear a stale error.
    if (props.resetKey !== state.shownFor) return { error: null, shownFor: props.resetKey }
    return null
  }

  componentDidCatch(error: Error, info: unknown) {
    // Full detail to the console for diagnosis (message survives prod builds).
    console.error(`[WorkspaceTab] "${this.props.label}" crashed:`, error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-sm text-white/75">“{this.props.label}” hit an error and couldn’t open.</div>
          <div className="text-xs text-white/40 max-w-lg break-words font-mono">{this.state.error.message || String(this.state.error)}</div>
          <button
            type="button"
            onClick={() => { this.setState({ error: null }); this.props.onReload?.() }}
            className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-sm text-white/80 transition-colors"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
