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
  display_name: string | null
  avatar_url: string | null
  invite_sent_at: string | null
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

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return parts[0][0].toUpperCase()
  }
  return email[0].toUpperCase()
}

function Avatar({ userId, avatarUrl, name, email }: { userId: string; avatarUrl: string | null; name: string | null; email: string }) {
  const [errored, setErrored] = useState(false)
  const hasR2Avatar = avatarUrl && !avatarUrl.startsWith('http')
  const showImg = hasR2Avatar && !errored

  if (showImg) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/profile/avatar/${userId}`}
        alt={name ?? email}
        className="w-9 h-9 rounded-full object-cover border border-gray-700 flex-shrink-0"
        onError={() => setErrored(true)}
      />
    )
  }

  return (
    <div className="w-9 h-9 rounded-full bg-blue-600/20 border border-gray-700 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-blue-400">{getInitials(name, email)}</span>
    </div>
  )
}

export default function AdminPanel({
  currentUserId,
  initialUsers,
}: {
  currentUserId: string
  initialUsers: User[]
}) {
  const [users, setUsers] = useState(initialUsers)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteDisplayName, setInviteDisplayName] = useState('')
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'loading' | 'success' | 'deferred' | 'error'>('idle')
  const [inviteError, setInviteError] = useState('')

  async function handleAddUser(deferred: boolean) {
    setInviteStatus('loading')
    setInviteError('')
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, display_name: inviteDisplayName || undefined, deferred }),
    })
    if (res.ok) {
      const data = await res.json()
      // Add new user to list with pending status if deferred
      if (data.user) {
        const newUser: User = {
          id: data.user.id,
          email: data.user.email ?? inviteEmail,
          created_at: data.user.created_at ?? new Date().toISOString(),
          last_sign_in_at: null,
          display_name: inviteDisplayName || null,
          avatar_url: null,
          invite_sent_at: deferred ? null : new Date().toISOString(),
          profile: {
            id: data.user.id,
            role: 'user',
            can_access_routing: false,
            can_access_lawn: false,
            can_access_call_log: false,
            can_access_responder: false,
            can_access_timesheet: false,
            can_access_books: false,
            can_access_tracker: false,
            can_access_hub: false,
          },
        }
        setUsers(prev => [...prev, newUser])
      }
      setInviteStatus(deferred ? 'deferred' : 'success')
      setInviteEmail('')
      setInviteDisplayName('')
      setTimeout(() => setInviteStatus('idle'), 4000)
    } else {
      const data = await res.json()
      setInviteStatus('error')
      setInviteError(data.error || 'Failed to add user')
    }
  }

  async function handleSendInvite(userId: string) {
    const res = await fetch(`/api/admin/users/${userId}/invite`, { method: 'POST' })
    if (res.ok) {
      setUsers(prev => prev.map(u =>
        u.id === userId ? { ...u, invite_sent_at: new Date().toISOString() } : u
      ))
    } else {
      const data = await res.json()
      alert(data.error || 'Failed to send invite')
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

      {/* Add user form */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
        <h2 className="font-semibold text-lg mb-1">Add New User</h2>
        <p className="text-gray-500 text-sm mb-4">
          Use <span className="text-white font-medium">Send Invite</span> to email them a login link now,
          or <span className="text-white font-medium">Add Without Inviting</span> to create the account first and send the invite later.
        </p>
        <div className="space-y-3">
          <input
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="colleague@heroeslawntx.com"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            value={inviteDisplayName}
            onChange={e => setInviteDisplayName(e.target.value)}
            placeholder="Display name (optional)"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-3">
            <button
              onClick={() => handleAddUser(true)}
              disabled={!inviteEmail || inviteStatus === 'loading'}
              className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
            >
              {inviteStatus === 'loading' ? 'Adding…' : 'Add Without Inviting'}
            </button>
            <button
              onClick={() => handleAddUser(false)}
              disabled={!inviteEmail || inviteStatus === 'loading'}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors whitespace-nowrap"
            >
              {inviteStatus === 'loading' ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
        </div>
        {inviteStatus === 'success' && (
          <p className="text-green-400 text-sm mt-3">Invite sent. New users start with all tools off — enable access below after they log in.</p>
        )}
        {inviteStatus === 'deferred' && (
          <p className="text-yellow-400 text-sm mt-3">Account created. You can send the invite from the user list when ready.</p>
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
              onSendInvite={handleSendInvite}
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
  onSendInvite,
}: {
  user: User
  isSelf: boolean
  onChange: (userId: string, field: string, value: boolean | string) => void
  onDelete: (userId: string, email: string) => void
  onSendInvite: (userId: string) => void
}) {
  const profile = user.profile
  if (!profile) return null

  const [sendingInvite, setSendingInvite] = useState(false)
  const [invited, setInvited] = useState(!!user.invite_sent_at)

  const isPending = !invited

  const lastSeen = user.last_sign_in_at
    ? new Date(user.last_sign_in_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Never'

  const handleInvite = async () => {
    setSendingInvite(true)
    await onSendInvite(user.id)
    setInvited(true)
    setSendingInvite(false)
  }

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar userId={user.id} avatarUrl={user.avatar_url} name={user.display_name} email={user.email} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {user.display_name ? (
                <span className="font-medium text-sm">{user.display_name}</span>
              ) : null}
              <span className={`text-sm ${user.display_name ? 'text-gray-400' : 'font-medium'}`}>{user.email}</span>
              {isSelf && (
                <span className="text-xs bg-blue-500/15 text-blue-400 border border-blue-500/25 px-2 py-0.5 rounded-full">You</span>
              )}
              {isPending && (
                <span className="text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/25 px-2 py-0.5 rounded-full">Pending Invite</span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">Last sign in: {lastSeen}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isPending && !isSelf && (
            <button
              onClick={handleInvite}
              disabled={sendingInvite}
              className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 disabled:opacity-50 text-blue-400 rounded-lg text-xs font-medium border border-blue-600/30 transition-colors whitespace-nowrap"
            >
              {sendingInvite ? 'Sending…' : 'Send Invite'}
            </button>
          )}
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
