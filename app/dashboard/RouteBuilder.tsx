'use client'

import { useEffect, useState } from 'react'

interface JobberUser {
  id: string
  name: string
}

interface Visit {
  stopNumber: number
  id: string
  clientName: string
  phone: string | null
  addressString: string
  services: string
  totalPrice: number
  jobTitle: string
  startAt: string | null
}

interface OptimizedVisit extends Visit {
  eta: string
  driveMinutes: number
  distanceKm: number
  startAtISO: string | null
  endAtISO: string | null
}

interface Leg {
  distanceKm: number
  driveMinutes: number
  arrivalTime: string
  startAtISO: string | null
  endAtISO: string | null
}

interface SendResult {
  visitId: string
  success: boolean
  error?: string
}

function todayLocal() {
  const d = new Date()
  return d.toISOString().split('T')[0]
}

export default function RouteBuilder() {
  const [users, setUsers] = useState<JobberUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)

  const [date, setDate] = useState(todayLocal())
  const [selectedUserId, setSelectedUserId] = useState('')
  const [startTime, setStartTime] = useState('08:00')  // HH:MM

  const [visits, setVisits] = useState<Visit[] | null>(null)
  const [visitsLoading, setVisitsLoading] = useState(false)
  const [visitsError, setVisitsError] = useState<string | null>(null)

  const [optimizedVisits, setOptimizedVisits] = useState<OptimizedVisit[] | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  const [geocodeFailed, setGeocodeFailed] = useState<number[]>([])

  // Send to Jobber state
  const [reassignUserId, setReassignUserId] = useState<string>('__keep__')
  const [sending, setSending] = useState(false)
  const [sendResults, setSendResults] = useState<SendResult[] | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  // Load users on mount
  useEffect(() => {
    fetch('/api/users')
      .then(r => r.json())
      .then(data => {
        if (data.error) { setUsersError(data.error); return }
        setUsers(data.users)
        if (data.users.length > 0) setSelectedUserId(data.users[0].id)
      })
      .catch(e => setUsersError(e.message))
      .finally(() => setUsersLoading(false))
  }, [])

  async function loadVisits() {
    if (!selectedUserId) return
    setVisitsLoading(true)
    setVisitsError(null)
    setVisits(null)
    setOptimizedVisits(null)
    setOptimizeError(null)
    setGeocodeFailed([])
    setSendResults(null)
    setSendError(null)
    try {
      const res = await fetch(`/api/visits?date=${date}&userId=${encodeURIComponent(selectedUserId)}`)
      const data = await res.json()
      if (data.error) { setVisitsError(data.error); return }
      setVisits(data.visits)
    } catch (e) {
      setVisitsError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setVisitsLoading(false)
    }
  }

  async function optimizeRoute() {
    if (!visits || visits.length === 0) return
    setOptimizing(true)
    setOptimizeError(null)
    setGeocodeFailed([])
    setSendResults(null)
    setSendError(null)
    try {
      const addresses = visits.map(v => v.addressString)
      const [hh, mm] = startTime.split(':').map(Number)
      const startHour = hh + mm / 60

      const res = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses, startHour, date }),
      })
      const data: { order: number[]; legs: Leg[]; geocodeFailed: number[]; error?: string } = await res.json()
      if (data.error) { setOptimizeError(data.error); return }

      setGeocodeFailed(data.geocodeFailed ?? [])

      const reordered: OptimizedVisit[] = data.order.map((originalIdx, newPos) => ({
        ...visits[originalIdx],
        stopNumber: newPos + 1,
        eta: data.legs[newPos].arrivalTime,
        driveMinutes: data.legs[newPos].driveMinutes,
        distanceKm: data.legs[newPos].distanceKm,
        startAtISO: data.legs[newPos].startAtISO,
        endAtISO: data.legs[newPos].endAtISO,
      }))
      setOptimizedVisits(reordered)
    } catch (e) {
      setOptimizeError(e instanceof Error ? e.message : 'Optimization failed')
    } finally {
      setOptimizing(false)
    }
  }

  async function sendToJobber() {
    if (!optimizedVisits) return
    setSending(true)
    setSendError(null)
    setSendResults(null)

    const visitsPayload = optimizedVisits
      .filter(v => v.startAtISO && v.endAtISO)
      .map(v => ({ visitId: v.id, startAt: v.startAtISO!, endAt: v.endAtISO! }))

    if (visitsPayload.length === 0) {
      setSendError('No visits have timestamps — re-optimize to generate times.')
      setSending(false)
      return
    }

    try {
      const res = await fetch('/api/send-to-jobber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visits: visitsPayload,
          assignedUserId: reassignUserId === '__keep__' ? null : reassignUserId,
        }),
      })
      const data: { results: SendResult[]; allOk: boolean; error?: string } = await res.json()
      if (data.error) { setSendError(data.error); return }
      setSendResults(data.results)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Failed to send to Jobber')
    } finally {
      setSending(false)
    }
  }

  const displayVisits = optimizedVisits ?? visits
  const sendResultMap = new Map(sendResults?.map(r => [r.visitId, r]) ?? [])
  const sendSuccessCount = sendResults?.filter(r => r.success).length ?? 0
  const sendAllOk = sendResults !== null && sendResults.every(r => r.success)

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h3 className="font-semibold text-lg mb-4">Quick Route</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Date picker */}
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setOptimizedVisits(null); setSendResults(null) }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* Tech dropdown */}
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Team Member</label>
            {usersLoading ? (
              <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-500">
                Loading users…
              </div>
            ) : usersError ? (
              <div className="text-red-400 text-sm py-2">Error: {usersError}</div>
            ) : (
              <select
                value={selectedUserId}
                onChange={e => setSelectedUserId(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Start time */}
          <div className="w-32">
            <label className="block text-xs text-gray-400 mb-1">Start Time</label>
            <input
              type="time"
              value={startTime}
              onChange={e => { setStartTime(e.target.value); setOptimizedVisits(null); setSendResults(null) }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
            />
          </div>

          {/* Load button */}
          <div className="flex items-end">
            <button
              onClick={loadVisits}
              disabled={visitsLoading || !selectedUserId}
              className="w-full sm:w-auto px-5 py-2 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {visitsLoading ? 'Loading…' : 'Load Visits'}
            </button>
          </div>
        </div>
      </div>

      {/* Errors */}
      {visitsError && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
          {visitsError}
        </div>
      )}
      {optimizeError && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
          Optimization failed: {optimizeError}
        </div>
      )}
      {geocodeFailed.length > 0 && visits && (
        <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-3 text-sm">
          Could not geocode {geocodeFailed.length} address{geocodeFailed.length !== 1 ? 'es' : ''}
          {' '}({geocodeFailed.map(i => visits[i]?.clientName).join(', ')}) — those stops were excluded from optimization.
        </div>
      )}

      {/* Visit list */}
      {displayVisits !== null && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold">
                {displayVisits.length === 0
                  ? 'No visits found'
                  : `${displayVisits.length} stop${displayVisits.length !== 1 ? 's' : ''}`}
              </h3>
              {optimizedVisits && (
                <span className="text-xs bg-green-900/50 text-green-400 border border-green-800 px-2 py-0.5 rounded-full">
                  Optimized
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {displayVisits.length > 0 && (
                <span className="text-xs text-gray-500">
                  ${displayVisits.reduce((s, v) => s + v.totalPrice, 0).toFixed(2)} total
                </span>
              )}
              {visits && visits.length > 1 && !optimizedVisits && (
                <button
                  onClick={optimizeRoute}
                  disabled={optimizing}
                  className="px-4 py-1.5 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  {optimizing ? 'Optimizing…' : '⚡ Optimize Route'}
                </button>
              )}
              {optimizedVisits && !sendResults && (
                <button
                  onClick={() => { setOptimizedVisits(null); setGeocodeFailed([]) }}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-xs font-medium transition-colors"
                >
                  Reset Order
                </button>
              )}
            </div>
          </div>

          {displayVisits.length === 0 ? (
            <p className="px-6 py-8 text-gray-500 text-sm text-center">
              No visits scheduled for this tech on this date.
            </p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {displayVisits.map(v => {
                const optimized = v as OptimizedVisit
                const hasEta = 'eta' in v && optimized.eta
                const result = sendResultMap.get(v.id)
                return (
                  <li key={v.id} className="px-6 py-4 flex gap-4 items-start">
                    <span className="text-2xl font-bold text-gray-600 w-8 shrink-0 text-right mt-0.5">
                      {v.stopNumber}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white truncate">{v.clientName}</p>
                      <p className="text-sm text-gray-400 truncate">{v.addressString}</p>
                      {v.services && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{v.services}</p>
                      )}
                      {hasEta && (
                        <p className="text-xs text-orange-400 mt-1">
                          ⏱ {optimized.driveMinutes} min drive · arrive ~{optimized.eta}
                        </p>
                      )}
                      {result && !result.success && (
                        <p className="text-xs text-red-400 mt-1">✗ {result.error}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {v.totalPrice > 0 && (
                        <span className="text-sm text-gray-400">${v.totalPrice.toFixed(2)}</span>
                      )}
                      {result?.success && <span className="text-green-400 text-sm">✓</span>}
                      {result && !result.success && <span className="text-red-400 text-sm">✗</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Send to Jobber panel */}
      {optimizedVisits && optimizedVisits.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h3 className="font-semibold text-lg mb-1">Send to Jobber</h3>
          <p className="text-sm text-gray-400 mb-4">
            Sets appointment times on each visit in Jobber based on the optimized order.
          </p>

          {sendAllOk && (
            <div className="mb-4 bg-green-900/40 border border-green-700 text-green-300 rounded-lg px-4 py-3 text-sm">
              ✓ {sendSuccessCount}/{sendResults!.length} visits updated in Jobber
            </div>
          )}
          {sendResults && !sendAllOk && (
            <div className="mb-4 bg-yellow-900/40 border border-yellow-700 text-yellow-300 rounded-lg px-4 py-3 text-sm">
              {sendSuccessCount}/{sendResults.length} updated — {sendResults.length - sendSuccessCount} failed (see stops above)
            </div>
          )}
          {sendError && (
            <div className="mb-4 bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
              {sendError}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">Reassign to</label>
              <select
                value={reassignUserId}
                onChange={e => setReassignUserId(e.target.value)}
                disabled={sending || sendAllOk}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500 disabled:opacity-50"
              >
                <option value="__keep__">Keep current assignment</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>

            <button
              onClick={sendToJobber}
              disabled={sending || sendAllOk}
              className="px-6 py-2 bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            >
              {sending ? 'Sending…' : sendAllOk ? '✓ Sent' : sendResults ? 'Retry Failed' : 'Send to Jobber →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
