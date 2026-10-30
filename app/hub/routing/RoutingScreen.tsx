'use client'

import RouteBuilder from '@/app/dashboard/RouteBuilder'

// The Route Optimizer screen, shared by the real /hub/routing page and its
// Workspace Tab twin (components/hub/workspace/RoutingTab.tsx). One component
// on purpose — a twin that copied this markup would drift from the page.
export default function RoutingScreen({
  jobberConnected,
  canConnectJobber,
  justConnected = false,
  connectError,
}: {
  jobberConnected: boolean
  canConnectJobber: boolean
  justConnected?: boolean
  connectError?: string
}) {
  return (
    <div className="flex-1 min-h-0 overflow-auto">
      {/* RouteBuilder flips data-mode; Dispatch drops the width cap so it fills
          a big/ultra-wide window (Ben, Oct 2026). Basic/Advanced keep 7xl. */}
      <div data-route-shell className="max-w-7xl data-[mode=dispatch]:max-w-none mx-auto px-4 md:px-6 py-6 md:py-10">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">⚡ Route Optimizer</h1>
          {jobberConnected && (
            <span className="text-xs text-green-400 font-medium flex items-center gap-2">
              ● Jobber Connected
              {canConnectJobber && (
                <a
                  href="/api/auth/jobber"
                  target="_top"
                  className="text-gray-500 hover:text-orange-400 transition-colors"
                  title="Reconnect Jobber"
                  aria-label="Reconnect Jobber"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </a>
              )}
            </span>
          )}
        </div>

        {justConnected && (
          <div className="mb-6 bg-green-900/40 border border-green-700 text-green-300 rounded-lg px-4 py-3 text-sm">
            Jobber connected successfully ✓
          </div>
        )}
        {connectError && (
          <div className="mb-6 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
            {connectError === 'jobber_denied' && 'Jobber authorization was cancelled.'}
            {connectError === 'invalid_state' && 'Security check failed — please try again.'}
            {connectError === 'token_exchange_failed' && 'Could not get tokens from Jobber. Try again.'}
            {connectError === 'db_error' && 'Could not save connection. Try again.'}
            {!['jobber_denied','invalid_state','token_exchange_failed','db_error'].includes(connectError)
              && `Error: ${connectError}`}
          </div>
        )}

        {!jobberConnected && (
          <div className="text-center py-16">
            <h2 className="text-3xl font-bold mb-3">Connect Jobber</h2>
            {canConnectJobber ? (
              <>
                <p className="text-gray-400 mb-8">Connect your Jobber account to load visits and optimize routes.</p>
                <a
                  href="/api/auth/jobber"
                  target="_top"
                  className="inline-block px-6 py-3 bg-orange-500 hover:bg-orange-400 text-[#fff] rounded-xl text-sm font-medium transition-colors"
                >
                  Connect Jobber →
                </a>
              </>
            ) : (
              <p className="text-gray-400">
                Jobber isn&apos;t connected for your company yet. Ask an admin to connect it in
                Admin → Integrations, then reload this page.
              </p>
            )}
          </div>
        )}

        {jobberConnected && <RouteBuilder />}
      </div>
    </div>
  )
}
