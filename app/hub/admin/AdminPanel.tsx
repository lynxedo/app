'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast, useConfirm } from '@/components/ui'

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
  can_access_txt: boolean
  can_access_unified_inbox: boolean
  can_post_shout_outs: boolean
  can_admin_people: boolean
  can_admin_hub: boolean
  can_admin_guardian: boolean
  can_admin_txt: boolean
  can_admin_announcements: boolean
  can_admin_file_tags: boolean
  can_admin_routing: boolean
  can_admin_timesheet: boolean
  can_admin_fleet: boolean
  can_admin_daily_log: boolean
  can_admin_zone_sizer: boolean
  can_admin_dialer: boolean
  can_admin_contacts: boolean
  can_access_marketing: boolean
  can_admin_marketing: boolean
  can_access_email: boolean
  can_admin_email: boolean
  can_access_forms: boolean
  can_admin_forms: boolean
  can_admin_products: boolean
  can_access_daily_log_v2: boolean
  can_access_call_log2: boolean
  can_access_coaching: boolean
  can_access_scoreboards: boolean
  can_access_files: boolean
  can_access_pesticide_records: boolean
  can_access_pricer: boolean
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
  locked_at: string | null
  deactivated_at: string | null
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
  hourly_rate: number | string | null
  email: string | null
  user_id: string | null
  is_active: boolean | null
}

const TOOL_GROUPS: { title: string; items: { key: keyof UserProfile; label: string }[] }[] = [
  {
    title: 'Communication',
    items: [
      { key: 'can_access_hub', label: 'Hub' },
      { key: 'can_access_txt', label: 'Txt' },
      { key: 'can_access_unified_inbox', label: 'Unified Inbox' },
      { key: 'can_access_dialer', label: 'Dialer' },
      { key: 'can_access_call_log', label: 'Call Log' },
      { key: 'can_access_call_log2', label: 'Call Log 2' },
      { key: 'can_access_coaching', label: 'Call Coaching' },
      { key: 'can_access_responder', label: 'Responder' },
    ],
  },
  {
    title: 'Field',
    items: [
      { key: 'can_access_timesheet', label: 'Timesheet' },
      { key: 'can_access_daily_log_v2', label: 'Daily Log v2' },
      { key: 'can_access_routing', label: 'Routing' },
      { key: 'can_access_fleet', label: 'Fleet Tracker' },
      { key: 'can_access_forms', label: 'Forms' },
      { key: 'can_access_pesticide_records', label: 'Products Used' },
    ],
  },
  {
    title: 'Sales & Marketing',
    items: [
      { key: 'can_access_tracker', label: 'Lead Tracker' },
      { key: 'can_access_lawn', label: 'Lawn Sizer' },
      { key: 'can_access_zone_sizer', label: 'Zone Sizer' },
      { key: 'can_access_pricer', label: 'Pricer' },
      { key: 'can_access_marketing', label: 'Social Marketing' },
      { key: 'can_access_email', label: 'Email Marketing' },
    ],
  },
  {
    title: 'Office',
    items: [
      { key: 'can_access_books', label: 'Financial Dashboard' },
      { key: 'can_access_scoreboards', label: 'Scoreboards' },
      { key: 'can_access_files', label: 'Files' },
      { key: 'can_post_shout_outs', label: 'Post Shout Outs' },
    ],
  },
]

const ADMIN_GRANTS: { key: keyof UserProfile; label: string }[] = [
  { key: 'can_admin_people', label: 'People' },
  { key: 'can_admin_hub', label: 'Hub' },
  { key: 'can_admin_guardian', label: 'Guardian' },
  { key: 'can_admin_txt', label: 'Txt' },
  { key: 'can_admin_announcements', label: 'Announcements' },
  { key: 'can_admin_file_tags', label: 'File Tags' },
  { key: 'can_admin_contacts', label: 'Contacts' },
  { key: 'can_admin_routing', label: 'Routing' },
  { key: 'can_admin_timesheet', label: 'Time Records' },
  { key: 'can_admin_fleet', label: 'Fleet' },
  { key: 'can_admin_daily_log', label: 'Daily Log' },
  { key: 'can_admin_products', label: 'Products' },
  { key: 'can_admin_zone_sizer', label: 'Zone Sizer' },
  { key: 'can_admin_dialer', label: 'Dialer' },
  { key: 'can_admin_forms', label: 'Form Builder' },
  { key: 'can_admin_marketing', label: 'Social Marketing' },
  { key: 'can_admin_email', label: 'Email Marketing' },
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

// Client-side mirror of a freshly provisioned profile (the server sets
// can_access_hub + can_access_forms on for new users; everything else off).
function defaultProfile(id: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id,
    role: 'user',
    can_access_routing: false,
    can_access_lawn: false,
    can_access_call_log: false,
    can_access_coaching: false,
    can_access_responder: false,
    can_access_timesheet: false,
    can_access_books: false,
    can_access_tracker: false,
    can_access_hub: true,
    can_access_fleet: false,
    can_access_zone_sizer: false,
    can_access_dialer: false,
    can_access_txt: false,
    can_access_unified_inbox: false,
    can_post_shout_outs: false,
    can_admin_people: false,
    can_admin_hub: false,
    can_admin_guardian: false,
    can_admin_txt: false,
    can_admin_announcements: false,
    can_admin_file_tags: false,
    can_admin_routing: false,
    can_admin_timesheet: false,
    can_admin_fleet: false,
    can_admin_daily_log: false,
    can_admin_zone_sizer: false,
    can_admin_dialer: false,
    can_admin_contacts: false,
    can_access_marketing: false,
    can_admin_marketing: false,
    can_access_email: false,
    can_admin_email: false,
    can_access_forms: true,
    can_admin_forms: false,
    can_admin_products: false,
    can_access_daily_log_v2: false,
    can_access_call_log2: false,
    can_access_scoreboards: false,
    can_access_files: false,
    can_access_pesticide_records: false,
    can_access_pricer: false,
    ...overrides,
  }
}

function userName(u: User): string {
  return u.full_name || u.display_name || u.email
}

// One status badge per user — the panel and picker share the same logic.
function statusBadge(u: User): { label: string; cls: string } | null {
  if (u.deactivated_at) {
    return { label: 'Deactivated', cls: 'bg-gray-700/60 text-gray-400 border-gray-600/50' }
  }
  if (u.locked_at) {
    return { label: 'Locked', cls: 'bg-red-500/15 text-red-400 border-red-500/25' }
  }
  if (!u.last_sign_in_at) {
    return u.invite_sent_at
      ? { label: 'Invited', cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25' }
      : { label: 'No invite sent', cls: 'bg-gray-700/60 text-gray-400 border-gray-600/50' }
  }
  return null
}

function Switch({
  enabled,
  onClick,
  disabled = false,
  accent = 'blue',
}: {
  enabled: boolean
  onClick?: () => void
  disabled?: boolean
  accent?: 'blue' | 'amber' | 'emerald'
}) {
  const onColor = accent === 'amber' ? 'bg-amber-500' : accent === 'emerald' ? 'bg-emerald-500' : 'bg-blue-600'
  return (
    <button
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onClick}
      className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none flex-shrink-0 ${enabled ? onColor : 'bg-gray-700'} ${disabled ? 'cursor-default' : ''}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-[#ffffff] shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

type StatusFilter = 'active' | 'deactivated' | 'all'

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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [showAddUser, setShowAddUser] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviteDisplayName, setInviteDisplayName] = useState('')
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'loading' | 'success' | 'deferred' | 'error'>('idle')
  const [inviteError, setInviteError] = useState('')
  const toast = useToast()
  const confirmDialog = useConfirm()

  const filteredUsers = users
    .filter(u =>
      statusFilter === 'all' ? true : statusFilter === 'deactivated' ? !!u.deactivated_at : !u.deactivated_at
    )
    .sort((a, b) => userName(a).localeCompare(userName(b)))

  const selectedUser = filteredUsers.find(u => u.id === selectedId) ?? null
  const unlinkedEmployees = employees.filter(e => !e.user_id && e.is_active !== false)

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
          locked_at: null,
          deactivated_at: null,
          profile: defaultProfile(data.user.id),
        }
        setUsers(prev => [...prev, newUser])
        setSelectedId(newUser.id)
        setStatusFilter('active')
      }
      setInviteStatus(deferred ? 'deferred' : 'success')
      setInviteEmail('')
      setInviteFullName('')
      setInviteDisplayName('')
      setTimeout(() => {
        setInviteStatus('idle')
        setShowAddUser(false)
      }, 2500)
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
      toast.error(data.error || 'Failed to send invite')
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
      toast.error(data.error || 'Failed to save names')
    }
  }

  async function handleDelete(user: User) {
    if (!(await confirmDialog({ message: `Remove ${user.email} from Lynxedo?\n\nRemove is only for accounts that were never used (typos, tests). This cannot be undone.`, danger: true }))) return
    const res = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
    if (res.ok) {
      setUsers(prev => prev.filter(u => u.id !== user.id))
      setSelectedId(null)
    } else {
      const data = await res.json()
      toast.error(data.error || 'Failed to remove user')
    }
  }

  async function handleStatus(user: User, action: 'lock' | 'unlock' | 'deactivate' | 'reactivate') {
    const name = userName(user)
    const messages: Record<string, string> = {
      lock: `Lock ${name}'s account?\n\nThey can't sign in until unlocked and their devices stop getting notifications. Nothing is deleted — they stay in People and on the roster.`,
      unlock: `Unlock ${name}'s account? They'll be able to sign in again.`,
      deactivate: `Deactivate ${name}?\n\nSign-in is blocked, they come off the Employee Roster, and their Txt conversations transfer to the main admin. All history is kept — you can reactivate them anytime.`,
      reactivate: `Reactivate ${name}?\n\nThey'll be able to sign in again. Their access toggles are unchanged — review them after, and re-enable the Employee Roster toggle if they're back on the clock.`,
    }
    const danger = action === 'lock' || action === 'deactivate'
    if (!(await confirmDialog({ message: messages[action], danger }))) return

    const res = await fetch(`/api/admin/users/${user.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error || 'Action failed')
      return
    }
    setUsers(prev => prev.map(u =>
      u.id === user.id ? { ...u, locked_at: data.locked_at, deactivated_at: data.deactivated_at } : u
    ))
    if (action === 'deactivate') {
      setEmployees(prev => prev.map(e => e.user_id === user.id ? { ...e, is_active: false } : e))
    }
  }

  async function handleRosterToggle(user: User, enabled: boolean) {
    const name = userName(user)
    if (!enabled) {
      if (!(await confirmDialog({ message: `Take ${name} off the Employee Roster?\n\nTheir punches and pay history are kept. Turn the toggle back on to restore them.`, danger: true }))) return
    }
    const res = await fetch(`/api/admin/users/${user.id}/roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error || 'Failed to update roster')
      return
    }
    setEmployees(prev => {
      if (data.employee) {
        const exists = prev.some(e => e.id === data.employee.id)
        return exists
          ? prev.map(e => e.id === data.employee.id ? { ...e, ...data.employee } : e)
          : [...prev, data.employee]
      }
      return enabled ? prev : prev.map(e => e.user_id === user.id ? { ...e, is_active: false } : e)
    })
    if (enabled) {
      setUsers(prev => prev.map(u =>
        u.id === user.id && u.profile
          ? { ...u, profile: { ...u.profile, can_access_timesheet: true } }
          : u
      ))
    }
  }

  async function handleLinkEmployee(empId: string, userId: string) {
    const res = await fetch(`/api/admin/employees/${empId}/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    if (res.ok) {
      setEmployees(prev => prev.map(e => e.id === empId ? { ...e, user_id: userId } : e))
    } else {
      const data = await res.json()
      toast.error(data.error || 'Failed to link employee')
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
          locked_at: null,
          deactivated_at: null,
          profile: defaultProfile(data.user.id, { can_access_timesheet: true, can_access_hub: false }),
        }
        setUsers(prev => [...prev, newUser])
        setEmployees(prev => prev.map(e => e.id === empId ? { ...e, user_id: newUser.id } : e))
      }
    } else {
      const data = await res.json()
      toast.error(data.error || 'Failed to create account')
    }
  }

  async function handleDeleteEmployee(emp: RosterEmployee) {
    if (!(await confirmDialog({ message: `Remove ${emp.first_name} ${emp.last_name} from the employee roster?`, danger: true }))) return
    const res = await fetch(`/api/admin/employees/${emp.id}`, { method: 'DELETE' })
    if (res.ok) {
      setEmployees(prev => prev.filter(e => e.id !== emp.id))
    } else {
      const data = await res.json()
      toast.error(data.error || 'Failed to remove employee')
    }
  }

  const counts = {
    active: users.filter(u => !u.deactivated_at).length,
    deactivated: users.filter(u => !!u.deactivated_at).length,
    all: users.length,
  }

  return (
    <div className="space-y-6">

      {/* People */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl">
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-lg">
            People <span className="text-gray-500 font-normal text-base">({filteredUsers.length})</span>
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 bg-gray-800 rounded-lg p-1 border border-gray-700">
              {([['active', 'Active'], ['deactivated', 'Deactivated'], ['all', 'All']] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`px-2.5 py-1 rounded-md text-xs transition-colors ${statusFilter === key ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  {label}{key === 'deactivated' && counts.deactivated > 0 ? ` (${counts.deactivated})` : ''}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowAddUser(v => !v)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {showAddUser ? 'Close' : '+ Add User'}
            </button>
          </div>
        </div>

        {/* Add user form */}
        {showAddUser && (
          <div className="px-6 py-4 border-b border-gray-800 bg-gray-800/30 space-y-3">
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="colleague@heroeslawntx.com"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <div className="flex gap-3 flex-col sm:flex-row">
              <input
                type="text"
                value={inviteFullName}
                onChange={e => setInviteFullName(e.target.value)}
                placeholder="Full name"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <input
                type="text"
                value={inviteDisplayName}
                onChange={e => setInviteDisplayName(e.target.value)}
                placeholder="Display name in Hub"
                className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
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
            {inviteStatus === 'success' && <p className="text-green-400 text-sm">Invite sent.</p>}
            {inviteStatus === 'deferred' && <p className="text-yellow-400 text-sm">Account created — send the invite from their panel when ready.</p>}
            {inviteStatus === 'error' && <p className="text-red-400 text-sm">{inviteError}</p>}
          </div>
        )}

        {/* User picker */}
        <div className="px-6 py-4">
          <UserPicker users={filteredUsers} selectedId={selectedUser?.id ?? null} onSelect={setSelectedId} />
        </div>

        {selectedUser ? (
          <UserPanel
            key={selectedUser.id}
            user={selectedUser}
            rosterEmployee={employees.find(e => e.user_id === selectedUser.id) ?? null}
            isSelf={selectedUser.id === currentUserId}
            isSuperAdmin={isSuperAdmin}
            onChange={handleChange}
            onDelete={handleDelete}
            onSendInvite={handleSendInvite}
            onSaveName={handleSaveName}
            onStatus={handleStatus}
            onRosterToggle={handleRosterToggle}
          />
        ) : (
          <p className="px-6 pb-6 text-sm text-gray-500">Choose a person to manage their access.</p>
        )}
      </div>

      {/* Roster employees without a Lynxedo login */}
      {unlinkedEmployees.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="font-semibold text-lg">
              Roster only — no login{' '}
              <span className="text-gray-500 font-normal text-base">({unlinkedEmployees.length})</span>
            </h2>
          </div>
          <div className="divide-y divide-gray-800">
            {unlinkedEmployees.map(emp => (
              <EmployeeRow
                key={emp.id}
                employee={emp}
                users={users.filter(u => !u.deactivated_at)}
                onLink={handleLinkEmployee}
                onInvite={handleInviteEmployee}
                onDelete={handleDeleteEmployee}
              />
            ))}
          </div>
        </div>
      )}

      {isSuperAdmin && <DevToolsCard />}

    </div>
  )
}

function UserPicker({
  users,
  selectedId,
  onSelect,
}: {
  users: User[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const selected = users.find(u => u.id === selectedId) ?? null

  const query = q.trim().toLowerCase()
  const filtered = query
    ? users.filter(u =>
        [u.full_name, u.display_name, u.email].some(v => v?.toLowerCase().includes(query))
      )
    : users

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 bg-gray-800 border border-gray-700 hover:border-gray-600 rounded-xl px-4 py-3 text-left transition-colors"
      >
        {selected ? (
          <>
            <Avatar userId={selected.id} avatarUrl={selected.avatar_url} name={selected.display_name || selected.full_name} email={selected.email} />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{userName(selected)}</div>
              <div className="text-xs text-gray-500 truncate">{selected.email}</div>
            </div>
          </>
        ) : (
          <span className="text-sm text-gray-500 py-1.5">Choose a person…</span>
        )}
        <span className="ml-auto text-gray-500 text-sm">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setQ('') }} />
          <div className="absolute z-50 mt-2 w-full bg-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search people…"
              className="w-full bg-gray-800 border-b border-gray-700 px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none"
            />
            <div className="max-h-72 overflow-y-auto divide-y divide-gray-800">
              {filtered.map(u => {
                const badge = statusBadge(u)
                return (
                  <button
                    key={u.id}
                    onClick={() => { onSelect(u.id); setOpen(false); setQ('') }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${u.id === selectedId ? 'bg-gray-800' : 'hover:bg-gray-800/60'}`}
                  >
                    <Avatar userId={u.id} avatarUrl={u.avatar_url} name={u.display_name || u.full_name} email={u.email} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{userName(u)}</span>
                        {badge && (
                          <span className={`text-[11px] border px-1.5 py-px rounded-full whitespace-nowrap ${badge.cls}`}>{badge.label}</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{u.email}</div>
                    </div>
                  </button>
                )
              })}
              {filtered.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-gray-500">No matches</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function UserPanel({
  user,
  rosterEmployee,
  isSelf,
  isSuperAdmin,
  onChange,
  onDelete,
  onSendInvite,
  onSaveName,
  onStatus,
  onRosterToggle,
}: {
  user: User
  rosterEmployee: RosterEmployee | null
  isSelf: boolean
  isSuperAdmin: boolean
  onChange: (userId: string, field: string, value: boolean | string) => void
  onDelete: (user: User) => void
  onSendInvite: (userId: string) => Promise<void>
  onSaveName: (userId: string, fullName: string, displayName: string) => Promise<void>
  onStatus: (user: User, action: 'lock' | 'unlock' | 'deactivate' | 'reactivate') => Promise<void>
  onRosterToggle: (user: User, enabled: boolean) => Promise<void>
}) {
  const [sendingInvite, setSendingInvite] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editFull, setEditFull] = useState(user.full_name ?? '')
  const [editDisplay, setEditDisplay] = useState(user.display_name ?? '')
  const [saving, setSaving] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [rosterBusy, setRosterBusy] = useState(false)

  const profile = user.profile
  if (!profile) return null

  const signedIn = !!user.last_sign_in_at
  const locked = !!user.locked_at
  const deactivated = !!user.deactivated_at
  const badge = statusBadge(user)
  const rosterOn = !!rosterEmployee && rosterEmployee.is_active !== false

  const lastSeen = user.last_sign_in_at
    ? new Date(user.last_sign_in_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Never'

  const handleInvite = async () => {
    setSendingInvite(true)
    await onSendInvite(user.id)
    setSendingInvite(false)
  }

  const handleSave = async () => {
    setSaving(true)
    await onSaveName(user.id, editFull, editDisplay)
    setSaving(false)
    setEditing(false)
  }

  const runStatus = async (action: 'lock' | 'unlock' | 'deactivate' | 'reactivate') => {
    setStatusBusy(true)
    await onStatus(user, action)
    setStatusBusy(false)
  }

  const runRoster = async (enabled: boolean) => {
    setRosterBusy(true)
    await onRosterToggle(user, enabled)
    setRosterBusy(false)
  }

  const actionBtn = 'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap disabled:opacity-50'

  return (
    <div className="px-6 pb-6 space-y-5">

      {/* Identity */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar userId={user.id} avatarUrl={user.avatar_url} name={user.display_name || user.full_name} email={user.email} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{userName(user)}</span>
              {user.display_name && user.full_name && user.display_name !== user.full_name && (
                <span className="text-xs text-gray-500">({user.display_name})</span>
              )}
              {isSelf && (
                <span className="text-xs bg-blue-500/15 text-blue-400 border border-blue-500/25 px-2 py-0.5 rounded-full">You</span>
              )}
              {badge && (
                <span className={`text-xs border px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{user.email} · Last sign in: {lastSeen}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={profile.role}
            onChange={e => onChange(user.id, 'role', e.target.value)}
            disabled={isSelf || !isSuperAdmin || deactivated}
            className="bg-gray-800 border border-gray-700 text-sm rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <option value="user">User</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={() => { setEditFull(user.full_name ?? ''); setEditDisplay(user.display_name ?? ''); setEditing(true) }}
            className="px-2 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded-lg transition-colors"
          >
            Edit
          </button>
        </div>
      </div>

      {/* Inline name editor */}
      {editing && (
        <div className="p-3 bg-gray-800/60 border border-gray-700 rounded-xl space-y-2">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Full name</label>
              <input value={editFull} onChange={e => setEditFull(e.target.value)} className={inputCls} autoFocus />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Display name (Hub)</label>
              <input value={editDisplay} onChange={e => setEditDisplay(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
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

      {/* Account actions */}
      {!isSelf && (
        <div className="flex flex-wrap gap-2">
          {!signedIn && !deactivated && (
            <button
              onClick={handleInvite}
              disabled={sendingInvite}
              className={`${actionBtn} bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border-blue-600/30`}
            >
              {sendingInvite ? 'Sending…' : user.invite_sent_at ? 'Resend Invite' : 'Send Invite'}
            </button>
          )}
          {!deactivated && (
            locked ? (
              <button
                onClick={() => runStatus('unlock')}
                disabled={statusBusy}
                className={`${actionBtn} bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 border-emerald-600/30`}
              >
                Unlock
              </button>
            ) : (
              <button
                onClick={() => runStatus('lock')}
                disabled={statusBusy}
                className={`${actionBtn} bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700`}
              >
                🔒 Lock
              </button>
            )
          )}
          {deactivated ? (
            <button
              onClick={() => runStatus('reactivate')}
              disabled={statusBusy}
              className={`${actionBtn} bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-400 border-emerald-600/30`}
            >
              Reactivate
            </button>
          ) : (
            <button
              onClick={() => runStatus('deactivate')}
              disabled={statusBusy}
              className={`${actionBtn} bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/25`}
            >
              Deactivate
            </button>
          )}
          {!signedIn && !deactivated && (
            <button
              onClick={() => onDelete(user)}
              className={`${actionBtn} bg-transparent hover:bg-red-500/10 text-gray-500 hover:text-red-400 border-gray-800 hover:border-red-500/25`}
            >
              Remove
            </button>
          )}
        </div>
      )}

      {deactivated ? (
        <p className="text-sm text-gray-500">
          Deactivated {new Date(user.deactivated_at as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
          Sign-in is blocked and they&rsquo;re hidden from Active People and the Employee Roster. All of their history is kept.
        </p>
      ) : (
        <>
          {/* Employee Roster membership */}
          <div className="p-4 bg-gray-800/40 border border-gray-700/60 rounded-xl flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Employee Roster</div>
              {rosterOn && rosterEmployee && (
                <div className="text-xs text-gray-500 mt-0.5 truncate">
                  {[
                    rosterEmployee.job_title,
                    rosterEmployee.department,
                    rosterEmployee.pay_type === 'hourly' && rosterEmployee.hourly_rate
                      ? `$${Number(rosterEmployee.hourly_rate).toFixed(2)}/hr`
                      : rosterEmployee.pay_type,
                  ].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
            <Switch enabled={rosterOn} disabled={rosterBusy} accent="emerald" onClick={() => runRoster(!rosterOn)} />
          </div>

          {/* Tool access */}
          <div className="space-y-5">
            {TOOL_GROUPS.map(group => (
              <div key={group.title}>
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">{group.title}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5">
                  {group.items.map(({ key, label }) => {
                    const enabled = profile[key] as boolean
                    return (
                      <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                        <Switch enabled={enabled} onClick={() => onChange(user.id, key, !enabled)} />
                        <span className="text-sm text-gray-300">{label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Admin grants */}
          {isSuperAdmin && (profile.role === 'manager' || profile.role === 'admin') && (
            <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
              <div className="text-xs font-semibold uppercase tracking-wider text-amber-400 mb-3">Admin Access</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5">
                {ADMIN_GRANTS.map(({ key, label }) => {
                  const isAdminRole = profile.role === 'admin'
                  const enabled = isAdminRole ? true : (profile[key] as boolean)
                  return (
                    <label key={key} className={`flex items-center gap-2 select-none ${isAdminRole ? 'cursor-default opacity-70' : 'cursor-pointer'}`}>
                      <Switch
                        enabled={enabled}
                        disabled={isAdminRole}
                        accent="amber"
                        onClick={() => !isAdminRole && onChange(user.id, key, !enabled)}
                      />
                      <span className="text-sm text-gray-300">{label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DevToolsCard() {
  const [isStaging, setIsStaging] = useState(false)
  const [switching, setSwitching] = useState(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    setIsStaging(window.location.hostname.startsWith('staging.'))
  }, [])

  async function switchToStaging() {
    setSwitching(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token && session?.refresh_token) {
        const params = new URLSearchParams({ at: session.access_token, rt: session.refresh_token })
        window.location.replace(`https://staging.lynxedo.com/auth/staging-handoff?${params}`)
      } else {
        window.location.replace('https://staging.lynxedo.com/hub')
      }
    } catch {
      window.location.replace('https://staging.lynxedo.com/hub')
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 className="font-semibold text-lg mb-4">Dev Tools</h2>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isStaging ? 'bg-yellow-400' : 'bg-green-400'}`} />
          <span className="text-sm text-gray-300">
            Currently on: <span className="text-white font-medium">{isStaging ? 'Staging' : 'Production'}</span>
          </span>
        </div>
        {isStaging ? (
          <button
            onClick={() => { window.location.replace('https://lynxedo.com/hub') }}
            className="px-4 py-2 bg-green-700 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Switch to Production
          </button>
        ) : (
          <button
            onClick={switchToStaging}
            disabled={switching}
            className="px-4 py-2 bg-yellow-700 hover:bg-yellow-600 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {switching ? 'Switching…' : 'Switch to Staging'}
          </button>
        )}
      </div>
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
            <div className="font-medium text-sm">{name}</div>
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
            aria-label="Remove"
          >
            ✕
          </button>
        </div>
      </div>

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
                A <span className="text-white">@heroeslawntx.com</span> address can use &ldquo;Sign in with Google&rdquo;;
                any other email signs in with an emailed 6-digit code.
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
