'use client'

import { useState } from 'react'

type UserProfile = {
  id: string
  role: string
  can_access_routing: boolean
  can_access_lawn: boolean
  can_access_call_log: boolean
  can_access_responder: boolean
  can_access_timesheet: boolean
  can_access_books: boolean
  can_access_tracker: boolean
  can_access_hub: boolean
}

type User = {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  profile: UserProfile | null
}

const TOOLS: { key: keyof UserProfile; label: string }[] = [
  { key: 'can_access_routing', label: 'Routing' },
  { key: 'can_access_lawn', label: 'Lawn' },
  { key: 'can_access_call_log', label: 'Call Log' },
  { key: 'can_access_responder', label: 'Responder' },
  { key: 'can_access_timesheet', label: 'Timesheet' },
  { key: 'can_access_books', label: 'Financial Dashboard' },
  { key: 'can_access_tracker', label: 'Lead Tracker' },
  { key: 'can_access_hub', label: 'Hub' },
]

export default function AdminPanel({
  currentUserId,
  initialUsers,
}: {
  currentUserId: string
  initialUsers: User[]
}) {
  const [users, setUsers] = useState(initialUsers)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [inviteError, setInviteError] = useState('')

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteStatus('loading')
    setInviteError('')
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail }),
    })
    if (res.ok) {
      setInviteStatus('success')
      setInviteEmail('')
      setTimeout(() => setInviteStatus('idle'), 4000)
    } else {
      const data = await res.json()
      setInviteStatus('error')
      setInviteError(data.error || 'Failed to send invite')
    }
  }

  async function handleChange(userId: string, field: string, value: boolean | string) {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (res.ok) {
      const { profile } = await res.json()
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, profile } : u))
    }
  }

  async function handleDelete(userId: string, email: string) {
    if (!confirm(`Remove ${email} from Lynxedo?\n\nThey will lose access immediately.`)) return
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
    if (res.ok) setUsers(prev => prev.filter(u => u.id !== userId))
  }

  return (
    <div className="space-y-8">

      {/* Invite */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Invite New User</h2>
        <p className="text-gray-500 text-sm mb-4">They'll receive a magic link by email to set up their account.</p>
        <form onSubmit={handleInvite} className="flex gap-3">
          <input
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="colleague@heroeslawntx.com"
            required
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={inviteStatus === 'loading'}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors whitespace-nowrap"
          >
            {inviteStatus === 'loading' ? 'Sending…' : 'Send Invite'}
          </button>
        </form>
        {inviteStatus === 'success' && (
          <p className="text-green-400 text-sm mt-3">Invite sent. New users start with all tools off — enable access below after they accept.</p>
        )}
        {inviteStatus === 'error' && (
          <p className="text-red-400 text-sm mt-3">{inviteError}</p>
        )}
      </div>

      {/* User list */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-lg">Users <span className="text-gray-500 font-normal text-base">({users.length})</span></h2>
        </div>
        <div className="divide-y divide-gray-800">
          {users.map(user => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === currentUserId}
              onChange={handleChange}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </div>

    </div>
  )
}

function UserRow({
  user,
  isSelf,
  onChange,
  onDelete,
}: {
  user: User
  isSelf: boolean
  onChange: (userId: string, field: string, value: boolean | string) => void
  onDelete: (userId: string, email: string) => void
}) {
  const profile = user.profile
  if (!profile) return null

  const lastSeen = user.last_sign_in_at
    ? new Date(user.last_sign_in_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Never'

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{user.email}</span>
            {isSelf && (
              <span className="text-xs bg-blue-500/15 text-blue-400 border border-blue-500/25 px-2 py-0.5 rounded-full">You</span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">Last sign in: {lastSeen}</div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={profile.role}
            onChange={e => onChange(user.id, 'role', e.target.value)}
            disabled={isSelf}
            className="bg-gray-800 border border-gray-700 text-sm rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          {!isSelf && (
            <button
              onClick={() => onDelete(user.id, user.email)}
              title="Remove user"
              className="text-gray-600 hover:text-red-400 transition-colors text-base leading-none px-1"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        {TOOLS.map(({ key, label }) => {
          const enabled = profile[key] as boolean
          return (
            <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
              <button
                role="switch"
                aria-checked={enabled}
                onClick={() => onChange(user.id, key, !enabled)}
                className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none ${enabled ? 'bg-blue-600' : 'bg-gray-700'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
              <span className="text-sm text-gray-300">{label}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
