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
  can_access_fleet: boolean
  can_access_zone_sizer: boolean
  can_access_dialer: boolean
  can_post_shout_outs: boolean
  can_admin_people: boolean
  can_admin_hub: boolean
  can_admin_routing: boolean
  can_admin_timesheet: boolean
  can_admin_fleet: boolean
  can_admin_daily_log: boolean
  can_admin_zone_sizer: boolean
  can_admin_dialer: boolean
  can_admin_contacts: boolean
}

type User = {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  full_name: string | null
  display_name: string | null
  avatar_url: string | null
  invite_sent_at: string | null
  profile: UserProfile | null
}

type RosterEmployee = {
  id: string
  first_name: string
  last_name: string
  preferred_name: string | null
  department: string | null
  job_title: string | null
  pay_type: string | null
  email: string | null
  user_id: string | null
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
  { key: 'can_access_fleet', label: 'Fleet Tracker' },
  { key: 'can_access_zone_sizer', label: 'Zone Sizer' },
  { key: 'can_access_dialer', label: 'Dialer' },
  { key: 'can_post_shout_outs', label: 'Post Shout Outs' },
]

const ADMIN_GRANTS: { key: keyof UserProfile; label: string }[] = [
  { key: 'can_admin_people', label: 'People' },
  { key: 'can_admin_hub', label: 'Hub' },
  { key: 'can_admin_routing', label: 'Routing' },
  { key: 'can_admin_timesheet', label: 'Time Records' },
  { key: 'can_admin_fleet', label: 'Fleet' },
  { key: 'can_admin_daily_log', label: 'Daily Log' },
  { key: 'can_admin_zone_sizer', label: 'Zone Sizer' },
  { key: 'can_admin_dialer', label: 'Dialer' },
  { key: 'can_admin_contacts', label: 'Contacts' },
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

const inputCls = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 w-full'

export default function AdminPanel({
  currentUserId,
  isSuperAdmin,
  initialUsers,
  initialEmployees,
}: {
  currentUserId: string
  isSuperAdmin: boolean
  initialUsers: User[]
  initialEmployees: RosterEmployee[]
}) {
  const [users, setUsers] = useState(initialUsers)
  const [employees, setEmployees] = useState(initialEmployees)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviteDisplayName, setInviteDisplayName] = useState('')
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'loading' | 'success' | 'deferred' | 'error'>('idle')
  const [inviteError, setInviteError] = useState('')

  async function handleAddUser(deferred: boolean) {
    setInviteStatus('loading')
    setInviteError('')
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: inviteEmail,
        full_name: inviteFullName || undefined,
        display_name: inviteDisplayName || undefined,
        deferred,
      }),
    })
    if (res.ok) {
      const data = await res.json()
      if (data.user) {
        const newUser: User = {
          id: data.user.id,
          email: data.user.email ?? inviteEmail,
          created_at: data.user.created_at ?? new Date().toISOString(),
          last_sign_in_at: null,
          full_name: inviteFullName || null,
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
            can_access_fleet: false,
            can_access_zone_sizer: false,
            can_access_dialer: false,
            can_post_shout_outs: false,
            can_admin_people: false,
            can_admin_hub: false,
            can_admin_routing: false,
            can_admin_timesheet: false,
            can_admin_fleet: false,
            can_admin_daily_log: false,
            can_admin_zone_sizer: false,
            can_admin_dialer: false,
            can_admin_contacts: false,
          },
        }
        setUsers(prev => [...prev, newUser])
      }
      setInviteStatus(deferred ? 'deferred' : 'success')
      setInviteEmail('')
      setInviteFullName('')
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

  async function handleSaveName(userId: string, fullName: string, displayName: string) {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName || null, display_name: displayName || null }),
    })
    if (res.ok) {
      setUsers(prev => prev.map(u =>
        u.id === userId
          ? { ...u, full_name: fullName || null, display_name: displayName || null }
          : u
      ))
    } else {
      const data = await res.json()
      alert(data.error || 'Failed to save names')
    }
  }

  async function handleDelete(userId: string, email: string) {
    if (!confirm(`Remove ${email} from Lynxedo?\n\nThey will lose access immediately.`)) return
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
    if (res.ok) setUsers(prev => prev.filter(u => u.id !== userId))
  }

  async function handleLinkEmployee(empId: string, userId: string) {
    const res = await fetch(`/api/admin/employees/${empId}/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    if (res.ok) {
      setEmployees(prev => prev.filter(e => e.id !== empId))
    } else {
      const data = await res.json()
      alert(data.error || 'Failed to link employee')
    }
  }

  async function handleInviteEmployee(empId: string, workEmail: string, fullName: string, displayName: string) {
    const res = await fetch(`/api/admin/employees/${empId}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ work_email: workEmail }),
    })
    if (res.ok) {
      const data = await res.json()
      if (data.user) {
        const newUser: User = {
          id: data.user.id,
          email: workEmail,
          created_at: data.user.created_at ?? new Date().toISOString(),
          last_sign_in_at: null,
          full_name: fullName || null,
          display_name: displayName || null,
          avatar_url: null,
          invite_sent_at: new Date().toISOString(),
          profile: {
            id: data.user.id,
            role: 'user',
            can_access_routing: false,
            can_access_lawn: false,
            can_access_call_log: false,
            can_access_responder: false,
            can_access_timesheet: true,
            can_access_books: false,
            can_access_tracker: false,
            can_access_hub: false,
            can_access_fleet: false,
            can_access_zone_sizer: false,
            can_access_dialer: false,
            can_post_shout_outs: false,
            can_admin_people: false,
            can_admin_hub: false,
            can_admin_routing: false,
            can_admin_timesheet: false,
            can_admin_fleet: false,
            can_admin_daily_log: false,
            can_admin_zone_sizer: false,
            can_admin_dialer: false,
            can_admin_contacts: false,
          },
        }
        setUsers(prev => [...prev, newUser])
        setEmployees(prev => prev.filter(e => e.id !== empId))
      }
    } else {
      const data = await res.json()
      alert(data.error || 'Failed to create account')
    }
  }

  async function handleDeleteEmployee(emp: RosterEmployee) {
    if (!confirm(`Remove ${emp.first_name} ${emp.last_name} from the employee roster?\n\nThis does not affect Gusto. You can re-sync from Gusto to restore them.`)) return
    const res = await fetch(`/api/admin/employees/${emp.id}`, { method: 'DELETE' })
    if (res.ok) {
      setEmployees(prev => prev.filter(e => e.id !== emp.id))
    } else {
      const data = await res.json()
      alert(data.error || 'Failed to remove employee')
    }
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
            value={inviteFullName}
            onChange={e => setInviteFullName(e.target.value)}
            placeholder="Full name (e.g. Ben Simpson)"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <input
            type="text"
            value={inviteDisplayName}
            onChange={e => setInviteDisplayName(e.target.value)}
            placeholder="Display name in Hub (e.g. Ben S.)"
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

      {/* Unified people list */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-lg">
            People{' '}
            <span className="text-gray-500 font-normal text-base">({users.length + employees.length})</span>
          </h2>
        </div>
        <div className="divide-y divide-gray-800">
          {users.map(user => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === currentUserId}
              isSuperAdmin={isSuperAdmin}
              onChange={handleChange}
              onDelete={handleDelete}
              onSendInvite={handleSendInvite}
              onSaveName={handleSaveName}
            />
          ))}
          {employees.map(emp => (
            <EmployeeRow
              key={emp.id}
              employee={emp}
              users={users}
              onLink={handleLinkEmployee}
              onInvite={handleInviteEmployee}
              onDelete={handleDeleteEmployee}
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
  isSuperAdmin,
  onChange,
  onDelete,
  onSendInvite,
  onSaveName,
}: {
  user: User
  isSelf: boolean
  isSuperAdmin: boolean
  onChange: (userId: string, field: string, value: boolean | string) => void
  onDelete: (userId: string, email: string) => void
  onSendInvite: (userId: string) => void
  onSaveName: (userId: string, fullName: string, displayName: string) => Promise<void>
}) {
  const profile = user.profile
  if (!profile) return null

  const [sendingInvite, setSendingInvite] = useState(false)
  const [invited, setInvited] = useState(!!user.invite_sent_at)
  const [editing, setEditing] = useState(false)
  const [editFull, setEditFull] = useState(user.full_name ?? '')
  const [editDisplay, setEditDisplay] = useState(user.display_name ?? '')
  const [saving, setSaving] = useState(false)

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

  const handleSave = async () => {
    setSaving(true)
    await onSaveName(user.id, editFull, editDisplay)
    setSaving(false)
    setEditing(false)
  }

  const handleEditOpen = () => {
    setEditFull(user.full_name ?? '')
    setEditDisplay(user.display_name ?? '')
    setEditing(true)
  }

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar userId={user.id} avatarUrl={user.avatar_url} name={user.display_name || user.full_name} email={user.email} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {user.full_name ? (
                <span className="font-medium text-sm">{user.full_name}</span>
              ) : user.display_name ? (
                <span className="font-medium text-sm">{user.display_name}</span>
              ) : null}
              {user.display_name && user.full_name && user.display_name !== user.full_name && (
                <span className="text-xs text-gray-500">({user.display_name})</span>
              )}
              <span className={`text-sm ${(user.full_name || user.display_name) ? 'text-gray-400' : 'font-medium'}`}>{user.email}</span>
              {isSelf && (
                <span className="text-xs bg-blue-500/15 text-blue-400 border border-blue-500/25 px-2 py-0.5 rounded-full">You</span>
              )}
              {isPending && (
                <span className="text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/25 px-2 py-0.5 rounded-full">Pending Invite</span>
              )}
              <button
                onClick={handleEditOpen}
                className="px-2 py-0.5 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded transition-colors"
              >
                Edit
              </button>
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
            disabled={isSelf || !isSuperAdmin}
            className="bg-gray-800 border border-gray-700 text-sm rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <option value="user">User</option>
            <option value="manager">Manager</option>
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

      {/* Inline name editor */}
      {editing && (
        <div className="mb-4 p-3 bg-gray-800/60 border border-gray-700 rounded-xl space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Full name</label>
              <input
                value={editFull}
                onChange={e => setEditFull(e.target.value)}
                placeholder="Legal name"
                className={inputCls}
                autoFocus
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Display name (Hub)</label>
              <input
                value={editDisplay}
                onChange={e => setEditDisplay(e.target.value)}
                placeholder="Name shown in messages"
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

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

      {isSuperAdmin && (profile.role === 'manager' || profile.role === 'admin') && (
        <div className="mt-4 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">Admin Access</span>
            {profile.role === 'admin' && (
              <span className="text-[11px] text-gray-500">Full admin — all areas granted automatically</span>
            )}
            {profile.role === 'manager' && (
              <span className="text-[11px] text-gray-500">Pick which admin areas this manager can access</span>
            )}
          </div>
          <div className="flex flex-wrap gap-4">
            {ADMIN_GRANTS.map(({ key, label }) => {
              const isAdminRole = profile.role === 'admin'
              const enabled = isAdminRole ? true : (profile[key] as boolean)
              return (
                <label key={key} className={`flex items-center gap-2 select-none ${isAdminRole ? 'cursor-default opacity-70' : 'cursor-pointer'}`}>
                  <button
                    role="switch"
                    aria-checked={enabled}
                    disabled={isAdminRole}
                    onClick={() => !isAdminRole && onChange(user.id, key, !enabled)}
                    className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none ${enabled ? 'bg-amber-500' : 'bg-gray-700'} ${isAdminRole ? 'cursor-default' : ''}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-sm text-gray-300">{label}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function EmployeeRow({
  employee,
  users,
  onLink,
  onInvite,
  onDelete,
}: {
  employee: RosterEmployee
  users: User[]
  onLink: (empId: string, userId: string) => Promise<void>
  onInvite: (empId: string, workEmail: string, fullName: string, displayName: string) => Promise<void>
  onDelete: (emp: RosterEmployee) => void
}) {
  const name = employee.preferred_name
    ? `${employee.preferred_name} ${employee.last_name}`
    : `${employee.first_name} ${employee.last_name}`
  const fullName = `${employee.first_name} ${employee.last_name}`
  const displayName = employee.preferred_name ?? employee.first_name
  const initials = (employee.first_name[0] + employee.last_name[0]).toUpperCase()

  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<'choose' | 'link' | 'invite'>('choose')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [workEmail, setWorkEmail] = useState(employee.email ?? '')
  const [working, setWorking] = useState(false)

  const handleLink = async () => {
    if (!selectedUserId) return
    setWorking(true)
    await onLink(employee.id, selectedUserId)
    setWorking(false)
  }

  const handleInvite = async () => {
    if (!workEmail) return
    setWorking(true)
    await onInvite(employee.id, workEmail, fullName, displayName)
    setWorking(false)
  }

  const open = (m: 'link' | 'invite') => {
    setMode(m)
    setExpanded(true)
    setSelectedUserId('')
    setWorkEmail(employee.email ?? '')
  }

  const close = () => {
    setExpanded(false)
    setMode('choose')
  }

  return (
    <div className="px-6 py-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-gray-700 border border-gray-600 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-gray-300">{initials}</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{name}</span>
              <span className="text-xs bg-gray-700/60 text-gray-400 border border-gray-600/50 px-2 py-0.5 rounded-full">Employee Only</span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {[employee.job_title, employee.department].filter(Boolean).join(' · ')}
              {employee.email && <span className="ml-2 text-gray-600">{employee.email}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!expanded && (
            <>
              <button
                onClick={() => open('link')}
                className="px-3 py-1.5 bg-gray-700/60 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium border border-gray-600/50 transition-colors whitespace-nowrap"
              >
                Link account
              </button>
              <button
                onClick={() => open('invite')}
                className="px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg text-xs font-medium border border-blue-600/30 transition-colors whitespace-nowrap"
              >
                Invite to Lynxedo
              </button>
            </>
          )}
          {expanded && (
            <button onClick={close} className="text-gray-500 hover:text-white transition-colors text-sm px-1">
              Cancel
            </button>
          )}
          <button
            onClick={() => onDelete(employee)}
            title="Remove from roster"
            className="text-gray-600 hover:text-red-400 transition-colors text-base leading-none px-1"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Expanded action panel */}
      {expanded && (
        <div className="mt-3 p-3 bg-gray-800/60 border border-gray-700 rounded-xl">
          {mode === 'link' && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">Link <span className="text-white">{name}</span> to an existing Lynxedo account:</p>
              <div className="flex gap-2">
                <select
                  value={selectedUserId}
                  onChange={e => setSelectedUserId(e.target.value)}
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="">— Select a user —</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.full_name || u.display_name || u.email}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleLink}
                  disabled={!selectedUserId || working}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  {working ? 'Linking…' : 'Link'}
                </button>
              </div>
            </div>
          )}

          {mode === 'invite' && (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">
                Send a Lynxedo invite to <span className="text-white">{name}</span>.
                Use their <span className="text-white">@heroeslawntx.com</span> work email — personal emails cannot log in.
              </p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={workEmail}
                  onChange={e => setWorkEmail(e.target.value)}
                  placeholder="name@heroeslawntx.com"
                  className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleInvite}
                  disabled={!workEmail || working}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  {working ? 'Sending…' : 'Send Invite'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
