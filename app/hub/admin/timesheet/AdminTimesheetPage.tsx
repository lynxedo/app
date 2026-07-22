'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useConfirm } from '@/components/ui'
import { formatDurationMs } from '@/lib/format'

type Employee = {
  id: string
  gusto_uuid: string | null
  first_name: string
  last_name: string
  preferred_name: string | null
  email: string | null
  phone: string | null
  department: string
  job_title: string
  pay_type: 'hourly' | 'salary'
  flsa_status: 'Exempt' | 'Nonexempt'
  hourly_rate: number | null
  gusto_synced_at: string | null
  user_id: string | null
  is_active: boolean | null
}

type LynxedoUser = { id: string; email: string }

const BLANK_ADD_FORM = {
  first_name: '', last_name: '', preferred_name: '',
  email: '', phone: '', job_title: '', department: '',
  pay_type: 'hourly' as 'hourly' | 'salary', hourly_rate: '',
}

type TimeEntry = {
  id: string
  employee_id: string
  date: string
  clock_in: string
  clock_out: string | null
  total_hours: number | null
  regular_hours: number | null
  overtime_hours: number | null
}

type TimePunch = {
  id: string
  employee_id: string
  punch_type: 'in' | 'out'
  punched_at: string
  note: string | null
  edit_reason: string | null
  original_punched_at: string | null
  lat: number | null
  lng: number | null
}

type OpenPunch = {
  id: string
  employee_id: string
  punched_at: string
  employees: { first_name: string; last_name: string; preferred_name: string | null }
}

type EditRequest = {
  id: string
  employee_id: string
  time_entry_id: string
  new_clock_in: string | null
  new_clock_out: string | null
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  employees: { first_name: string; last_name: string; preferred_name: string | null } | null
  time_entries: { id: string; date: string; clock_in: string; clock_out: string | null } | null
}

type MatchDiff = {
  field: 'job_title' | 'department' | 'pay_type' | 'hourly_rate'
  label: string
  current: string
  incoming: string
}

type EmployeeMatch = {
  employee_id: string
  name: string
  gusto_uuid: string
  matched_by: 'gusto' | 'email' | 'name'
  diffs: MatchDiff[]
  up_to_date: boolean
}

type MatchPreview = {
  connected: boolean
  matches?: EmployeeMatch[]
  unmatched_roster?: { id: string; name: string }[]
  unmatched_gusto?: { name: string; title: string | null }[]
  error?: string
}

type PaidHoliday = {
  id: string
  name: string
  date: string
  hours: number
  is_active: boolean
}

type HolidayOverride = {
  id: string
  employee_id: string
  holiday_id: string
  pay_period_start: string
  custom_hours: number | null
  notes: string | null
}

type PtoRequest = {
  id: string
  employee_id: string
  request_date: string
  hours: number
  type: 'paid' | 'unpaid'
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  admin_note: string | null
  created_at: string
  employees?: { first_name: string; last_name: string; preferred_name: string | null } | null
}

type PtoPolicy = {
  id: string
  employee_id: string
  annual_hours: number
  anniversary_date: string | null
  accrual_notes: string | null
}

// ── helpers ──────────────────────────────────────────────────────────────────

// TS7 — pay week start is configurable per company (timesheet_settings.
// pay_period_start_day, JS getDay() convention: 0=Sun…6=Sat). Defaults to 1
// (Monday) so every call is unchanged until a company sets otherwise.
function getWeekStart(date: Date = new Date(), startDay = 1): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - ((day - startDay + 7) % 7))
  d.setHours(0, 0, 0, 0)
  return d
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

function formatWeekRange(start: Date): string {
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const s = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const e = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${s} – ${e}`
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

// Format a stored UTC instant as a LOCAL wall-clock value for a <input type="datetime-local">.
function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

// Parse a datetime-local value (local wall-clock, no zone) into a correct UTC instant.
function fromLocalInputValue(v: string): string | null {
  if (!v) return null
  const d = new Date(v) // datetime-local strings parse as LOCAL time
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function formatDateShort(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Blocking validation for a clock-in/out pair (mirrors the server guard in
// lib/timesheet-recompute). Returns an error string, or null if OK to save.
function punchTimeError(clockInIso: string, clockOutIso: string): string | null {
  const inT = new Date(clockInIso).getTime()
  const outT = new Date(clockOutIso).getTime()
  if (isNaN(inT)) return 'Enter a valid clock-in time.'
  if (isNaN(outT)) return 'Enter a valid clock-out time.'
  if (outT <= inT) return 'Clock-out must be after clock-in.'
  if ((outT - inT) / 3600000 > 24) return 'A single shift cannot exceed 24 hours.'
  return null
}

// Non-blocking warnings — odd but possible times the admin should eyeball.
function punchTimeWarnings(clockInIso: string, clockOutIso: string): string[] {
  const warnings: string[] = []
  const inD = new Date(clockInIso)
  const outD = new Date(clockOutIso)
  const beforeFive = (d: Date) => !isNaN(d.getTime()) && d.getHours() < 5
  if (beforeFive(inD)) warnings.push('Clock-in is before 5 AM — double-check AM vs PM.')
  if (beforeFive(outD)) warnings.push('Clock-out is before 5 AM — double-check AM vs PM.')
  const inT = inD.getTime(), outT = outD.getTime()
  if (!isNaN(inT) && !isNaN(outT) && outT > inT && (outT - inT) / 3600000 > 16) {
    warnings.push('This shift is over 16 hours — make sure that’s right.')
  }
  return warnings
}

function formatDuration(sinceTs: string): string {
  return formatDurationMs(Date.now() - new Date(sinceTs).getTime(), { style: 'verbose' })
}

function displayName(e: Employee): string {
  return e.preferred_name || e.first_name
}

function weekSummary(entries: TimeEntry[], weeklyOtThreshold = 40) {
  const total = entries.reduce((s, e) => s + (e.total_hours ?? 0), 0)
  const dailyOT = entries.reduce((s, e) => s + (e.overtime_hours ?? 0), 0)
  const weeklyOT = Math.max(0, total - weeklyOtThreshold)
  const ot = Math.max(dailyOT, weeklyOT)
  const regular = Math.max(0, total - ot)
  return { total: Math.round(total * 100) / 100, regular: Math.round(regular * 100) / 100, ot: Math.round(ot * 100) / 100 }
}

function exportPayPeriodCSV(employees: Employee[], entries: TimeEntry[], weekStart: Date, weeklyOtThreshold = 40) {
  const end = new Date(weekStart)
  end.setDate(weekStart.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const periodStart = weekStart.toISOString().split('T')[0]
  const periodEnd = end.toISOString().split('T')[0]

  const rows: string[][] = [[
    'First Name', 'Last Name', 'Gusto Employee ID',
    'Pay Period Start', 'Pay Period End',
    'Regular Hours', 'Overtime Hours', 'Total Hours', 'Est. Wages',
  ]]

  for (const emp of employees.filter(e => e.pay_type === 'hourly')) {
    const s = weekSummary(entries.filter(e => e.employee_id === emp.id), weeklyOtThreshold)
    const estPay = emp.hourly_rate
      ? (s.regular * emp.hourly_rate + s.ot * emp.hourly_rate * 1.5).toFixed(2)
      : ''
    rows.push([
      emp.first_name, emp.last_name, emp.gusto_uuid ?? '',
      periodStart, periodEnd,
      s.regular.toFixed(2), s.ot.toFixed(2), s.total.toFixed(2), estPay,
    ])
  }

  const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `gusto-hours-${fmt(weekStart).replace(/[, ]+/g, '-')}-to-${fmt(end).replace(/[, ]+/g, '-')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── main component ────────────────────────────────────────────────────────────

export default function AdminTimesheetPage() {
  const confirmDialog = useConfirm()
  const [weekStart, setWeekStart] = useState(() => getWeekStart())
  const [employees, setEmployees] = useState<Employee[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [openPunches, setOpenPunches] = useState<OpenPunch[]>([])
  const [pendingRequests, setPendingRequests] = useState<EditRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [clockingId, setClockingId] = useState<string | null>(null)
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null)
  const [editWeekStart, setEditWeekStart] = useState(() => getWeekStart())
  const [editPunches, setEditPunches] = useState<TimePunch[]>([])
  const [editPunchesLoading, setEditPunchesLoading] = useState(false)
  const [editingPunch, setEditingPunch] = useState<{ id: string; time: string; reason: string } | null>(null)
  const [addingPunch, setAddingPunch] = useState<{ type: 'in' | 'out'; datetime: string; note: string } | null>(null)
  // Per-day inline editor (Summary tab) — edit one day's shift without the
  // all-week punch modal.
  const [dayEdit, setDayEdit] = useState<
    { entryId: string; employeeId: string; date: string; clockIn: string; clockOut: string; reason: string } | null
  >(null)
  const [dayEditSaving, setDayEditSaving] = useState(false)
  const [dayEditError, setDayEditError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [tab, setTab] = useState<'week' | 'summary' | 'employees' | 'holidays' | 'pto' | 'settings'>('week')

  // TS7 — company timesheet policy (pay period, weekly OT, GPS). Defaults match
  // Heroes' hardcoded policy so behavior is unchanged until a company edits them.
  const [tsSettings, setTsSettings] = useState<{
    pay_period_start_day: number
    overtime_threshold_weekly: number
    gps_enabled: boolean
  }>({ pay_period_start_day: 1, overtime_threshold_weekly: 40, gps_enabled: true })
  const [tsSettingsSave, setTsSettingsSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const tsSettingsAppliedRef = useRef(false)
  const [matchPreview, setMatchPreview] = useState<MatchPreview | null>(null)
  const [matchLoading, setMatchLoading] = useState(false)
  const [matchSelections, setMatchSelections] = useState<Set<string>>(new Set())
  const [matchApplying, setMatchApplying] = useState(false)
  const [matchResult, setMatchResult] = useState<{ updated: number; errors: string[] } | null>(null)
  const [gustoConnected, setGustoConnected] = useState<boolean | null>(null)
  const [rosterFilter, setRosterFilter] = useState<'active' | 'inactive' | 'all'>('active')
  const [rosterAll, setRosterAll] = useState<Employee[] | null>(null)
  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [addForm, setAddForm] = useState(BLANK_ADD_FORM)
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')
  const [editEmp, setEditEmp] = useState<Employee | null>(null)
  const [editForm, setEditForm] = useState(BLANK_ADD_FORM)
  const [editActive, setEditActive] = useState(true)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [linkingEmployee, setLinkingEmployee] = useState<Employee | null>(null)
  const [lynxedoUsers, setLynxedoUsers] = useState<LynxedoUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [linkSaving, setLinkSaving] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [reviewingId, setReviewingId] = useState<string | null>(null)

  // Holiday + PTO state
  const [weekHolidays, setWeekHolidays] = useState<PaidHoliday[]>([])
  const [holidayOverrides, setHolidayOverrides] = useState<HolidayOverride[]>([])
  const [weekPtoRequests, setWeekPtoRequests] = useState<PtoRequest[]>([])
  const [overrideEmpId, setOverrideEmpId] = useState<string | null>(null)
  const [overrideValues, setOverrideValues] = useState<Record<string, string>>({})
  const [savingOverride, setSavingOverride] = useState(false)
  const [reviewingPtoId, setReviewingPtoId] = useState<string | null>(null)

  // Holidays tab state
  const [allHolidays, setAllHolidays] = useState<PaidHoliday[]>([])
  const [holidaysLoaded, setHolidaysLoaded] = useState(false)
  const [holidayForm, setHolidayForm] = useState<{ name: string; date: string; hours: string } | null>(null)
  const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null)
  const [savingHoliday, setSavingHoliday] = useState(false)
  const [holidayError, setHolidayError] = useState('')

  // PTO Policy tab state
  const [ptoPolicies, setPtoPolicies] = useState<PtoPolicy[]>([])
  const [policiesLoaded, setPoliciesLoaded] = useState(false)
  const [editingPolicyEmpId, setEditingPolicyEmpId] = useState<string | null>(null)
  const [policyForm, setPolicyForm] = useState<{ annual_hours: string; anniversary_date: string; accrual_notes: string } | null>(null)
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [policyError, setPolicyError] = useState('')

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  // TS7 — load the company timesheet policy once, then re-align the visible week
  // to the company's pay-period start day. Heroes is Monday (start_day=1), so the
  // re-align is a no-op there; a company with a different start day lands on the
  // right week instead of the default Monday.
  useEffect(() => {
    let cancelled = false
    fetch('/api/timesheet/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d?.settings) return
        const s = d.settings
        const next = {
          pay_period_start_day: typeof s.pay_period_start_day === 'number' ? s.pay_period_start_day : 1,
          overtime_threshold_weekly: s.overtime_threshold_weekly != null ? Number(s.overtime_threshold_weekly) : 40,
          gps_enabled: s.gps_enabled ?? true,
        }
        setTsSettings(next)
        if (!tsSettingsAppliedRef.current) {
          tsSettingsAppliedRef.current = true
          if (next.pay_period_start_day !== 1) {
            const aligned = getWeekStart(new Date(), next.pay_period_start_day)
            setWeekStart(prev => (toDateStr(prev) === toDateStr(aligned) ? prev : aligned))
          }
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [empRes, entRes, editRes, holRes, overRes, ptoRes] = await Promise.all([
      fetch(`/api/timesheet/employees?period_start=${toDateStr(weekStart)}&period_end=${toDateStr(weekEnd)}`),
      fetch(`/api/timesheet/entries?start=${toDateStr(weekStart)}&end=${toDateStr(weekEnd)}`),
      fetch('/api/timesheet/punch-edits'),
      fetch(`/api/timesheet/holidays?start=${toDateStr(weekStart)}&end=${toDateStr(weekEnd)}`),
      fetch(`/api/timesheet/holiday-overrides?period_start=${toDateStr(weekStart)}`),
      fetch(`/api/timesheet/pto-requests?start=${toDateStr(weekStart)}&end=${toDateStr(weekEnd)}`),
    ])
    const [empData, entData, editData, holData, overData, ptoData] = await Promise.all([
      empRes.json(), entRes.json(), editRes.json(), holRes.json(), overRes.json(), ptoRes.json(),
    ])
    setEmployees(empData.employees ?? [])
    setEntries(entData.entries ?? [])
    setOpenPunches(entData.open_punches ?? [])
    setPendingRequests(editData.requests ?? [])
    setWeekHolidays(holData.holidays ?? [])
    setHolidayOverrides(overData.overrides ?? [])
    setWeekPtoRequests(ptoData.requests ?? [])
    setLoading(false)
  }, [weekStart]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (tab === 'holidays' && !holidaysLoaded) loadAllHolidays()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (tab === 'pto' && !policiesLoaded) loadPolicies()
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── data helpers ──────────────────────────────────────────────────────────

  function empHolidayHours(empId: string): number {
    return weekHolidays
      .filter(h => h.is_active)
      .reduce((sum, h) => {
        const ov = holidayOverrides.find(o => o.employee_id === empId && o.holiday_id === h.id)
        return sum + (ov ? (ov.custom_hours ?? h.hours) : h.hours)
      }, 0)
  }

  function empApprovedPtoHours(empId: string): number {
    return weekPtoRequests
      .filter(r => r.employee_id === empId && r.status === 'approved')
      .reduce((sum, r) => sum + r.hours, 0)
  }

  const activeWeekHolidays = weekHolidays.filter(h => h.is_active)
  const pendingPtoCount = weekPtoRequests.filter(r => r.status === 'pending').length

  // ── clock actions ─────────────────────────────────────────────────────────

  async function clockAction(employee: Employee, action: 'in' | 'out') {
    setClockingId(employee.id)
    await fetch('/api/timesheet/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: employee.id, action }),
    })
    setClockingId(null)
    loadData()
  }

  async function loadEditPunches(employee: Employee, ws: Date) {
    setEditPunchesLoading(true)
    const we = new Date(ws)
    we.setDate(ws.getDate() + 6)
    const res = await fetch(
      `/api/timesheet/admin/punches?employee_id=${employee.id}&start=${toDateStr(ws)}&end=${toDateStr(we)}`
    )
    const data = await res.json()
    setEditPunches(data.punches ?? [])
    setEditingPunch(null)
    setAddingPunch(null)
    setEditPunchesLoading(false)
  }

  async function openEditPunches(employee: Employee) {
    const ws = getWeekStart()
    setEditEmployee(employee)
    setEditWeekStart(ws)
    loadEditPunches(employee, ws)
  }

  function navigateEditWeek(delta: number) {
    if (!editEmployee) return
    setEditWeekStart(prev => {
      const next = new Date(prev)
      next.setDate(prev.getDate() + delta * 7)
      loadEditPunches(editEmployee, next)
      return next
    })
  }

  async function savePunchEdit() {
    if (!editingPunch || !editEmployee) return
    await fetch(`/api/timesheet/admin/punch/${editingPunch.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ punched_at: editingPunch.time, edit_reason: editingPunch.reason }),
    })
    setEditingPunch(null)
    loadEditPunches(editEmployee, editWeekStart)
    loadData()
  }

  async function saveDayEdit() {
    if (!dayEdit) return
    if (punchTimeError(dayEdit.clockIn, dayEdit.clockOut)) return
    if (!dayEdit.reason.trim()) { setDayEditError('Please add a short reason for the edit.'); return }
    setDayEditSaving(true)
    setDayEditError(null)
    const res = await fetch('/api/timesheet/admin/day', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: dayEdit.employeeId,
        date: dayEdit.date,
        clock_in: dayEdit.clockIn,
        clock_out: dayEdit.clockOut,
        edit_reason: dayEdit.reason.trim(),
      }),
    })
    setDayEditSaving(false)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Could not save' }))
      setDayEditError(err.error ?? 'Could not save')
      return
    }
    setDayEdit(null)
    loadData()
  }

  async function deletePunch(id: string) {
    if (!(await confirmDialog({ message: 'Delete this punch? This cannot be undone.', danger: true }))) return
    await fetch(`/api/timesheet/admin/punches?id=${id}`, { method: 'DELETE' })
    if (editEmployee) loadEditPunches(editEmployee, editWeekStart)
    loadData()
  }

  async function addPunch() {
    if (!addingPunch || !editEmployee) return
    await fetch('/api/timesheet/admin/punches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: editEmployee.id,
        punch_type: addingPunch.type,
        punched_at: addingPunch.datetime,
        note: addingPunch.note || null,
      }),
    })
    setAddingPunch(null)
    loadEditPunches(editEmployee, editWeekStart)
    loadData()
  }

  async function reviewEditRequest(id: string, action: 'approve' | 'reject') {
    setReviewingId(id)
    await fetch(`/api/timesheet/admin/punch-edits/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setReviewingId(null)
    loadData()
  }

  // ── holiday overrides ─────────────────────────────────────────────────────

  function openOverrideEditor(empId: string) {
    const vals: Record<string, string> = {}
    for (const h of activeWeekHolidays) {
      const ov = holidayOverrides.find(o => o.employee_id === empId && o.holiday_id === h.id)
      vals[h.id] = String(ov ? (ov.custom_hours ?? h.hours) : h.hours)
    }
    setOverrideValues(vals)
    setOverrideEmpId(empId)
    setExpandedRows(prev => { const n = new Set(prev); n.add(empId); return n })
  }

  async function saveHolidayOverrides() {
    if (!overrideEmpId) return
    setSavingOverride(true)
    await Promise.all(
      activeWeekHolidays.map(h =>
        fetch('/api/timesheet/holiday-overrides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employee_id: overrideEmpId,
            holiday_id: h.id,
            pay_period_start: toDateStr(weekStart),
            custom_hours: overrideValues[h.id] !== '' ? Number(overrideValues[h.id]) : null,
          }),
        })
      )
    )
    setSavingOverride(false)
    setOverrideEmpId(null)
    loadData()
  }

  // ── PTO review ────────────────────────────────────────────────────────────

  async function reviewPtoRequest(id: string, action: 'approve' | 'reject') {
    setReviewingPtoId(id)
    await fetch(`/api/timesheet/admin/pto-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setReviewingPtoId(null)
    loadData()
  }

  // ── Holidays tab ──────────────────────────────────────────────────────────

  async function loadAllHolidays() {
    const res = await fetch('/api/timesheet/holidays')
    const data = await res.json()
    setAllHolidays(data.holidays ?? [])
    setHolidaysLoaded(true)
  }

  async function saveHoliday() {
    if (!holidayForm) return
    setSavingHoliday(true)
    setHolidayError('')
    const isEdit = !!editingHolidayId
    const res = await fetch(
      isEdit ? `/api/timesheet/holidays/${editingHolidayId}` : '/api/timesheet/holidays',
      {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: holidayForm.name,
          date: holidayForm.date,
          hours: Number(holidayForm.hours),
        }),
      }
    )
    const data = await res.json()
    setSavingHoliday(false)
    if (!res.ok) { setHolidayError(data.error ?? 'Save failed'); return }
    setHolidayForm(null)
    setEditingHolidayId(null)
    loadAllHolidays()
    loadData()
  }

  async function toggleHolidayActive(h: PaidHoliday) {
    await fetch(`/api/timesheet/holidays/${h.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: !h.is_active }),
    })
    loadAllHolidays()
    loadData()
  }

  async function deleteHoliday(id: string) {
    if (!(await confirmDialog({ message: 'Delete this holiday? This cannot be undone.', danger: true }))) return
    await fetch(`/api/timesheet/holidays/${id}`, { method: 'DELETE' })
    loadAllHolidays()
    loadData()
  }

  function openAddHoliday() {
    setEditingHolidayId(null)
    setHolidayForm({ name: '', date: '', hours: '8' })
    setHolidayError('')
  }

  function openEditHoliday(h: PaidHoliday) {
    setEditingHolidayId(h.id)
    setHolidayForm({ name: h.name, date: h.date, hours: String(h.hours) })
    setHolidayError('')
  }

  // ── PTO Policies tab ──────────────────────────────────────────────────────

  async function loadPolicies() {
    const res = await fetch('/api/timesheet/pto-policies')
    const data = await res.json()
    setPtoPolicies(data.policies ?? [])
    setPoliciesLoaded(true)
  }

  function openEditPolicy(emp: Employee) {
    const existing = ptoPolicies.find(p => p.employee_id === emp.id)
    setPolicyForm({
      annual_hours: existing ? String(existing.annual_hours) : '0',
      anniversary_date: existing?.anniversary_date ?? '',
      accrual_notes: existing?.accrual_notes ?? '',
    })
    setEditingPolicyEmpId(emp.id)
    setPolicyError('')
  }

  async function savePolicy() {
    if (!policyForm || !editingPolicyEmpId) return
    setSavingPolicy(true)
    setPolicyError('')
    const res = await fetch('/api/timesheet/pto-policies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: editingPolicyEmpId,
        annual_hours: Number(policyForm.annual_hours),
        anniversary_date: policyForm.anniversary_date || null,
        accrual_notes: policyForm.accrual_notes || null,
      }),
    })
    const data = await res.json()
    setSavingPolicy(false)
    if (!res.ok) { setPolicyError(data.error ?? 'Save failed'); return }
    setEditingPolicyEmpId(null)
    setPolicyForm(null)
    loadPolicies()
  }

  // ── Roster + Match with Gusto ─────────────────────────────────────────────

  // The Roster tab shows active + deactivated rows (status filter); the other
  // tabs keep the default active-only list from loadData.
  useEffect(() => {
    if (tab !== 'employees') return
    fetch('/api/timesheet/employees?include=all')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d) setRosterAll(d.employees ?? []) })
      .catch(() => {})
    fetch('/api/timesheet/gusto-match?status=1')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setGustoConnected(!!d?.connected))
      .catch(() => setGustoConnected(false))
  }, [tab, employees])

  async function fetchMatchPreview() {
    setMatchLoading(true)
    setMatchResult(null)
    const res = await fetch('/api/timesheet/gusto-match')
    const data = await res.json()
    if (!res.ok) {
      setMatchPreview({ connected: true, error: data.error ?? 'Match failed' })
      setMatchLoading(false)
      return
    }
    setMatchPreview(data)
    const initial = new Set<string>()
    for (const m of (data.matches ?? []) as EmployeeMatch[]) {
      for (const d of m.diffs) initial.add(`${m.employee_id}|${d.field}`)
    }
    setMatchSelections(initial)
    setMatchLoading(false)
  }

  async function applyMatch() {
    if (!matchPreview?.matches) return
    setMatchApplying(true)
    const changes = matchPreview.matches
      .map(m => ({
        employee_id: m.employee_id,
        gusto_uuid: m.gusto_uuid,
        name: m.name,
        fields: m.diffs.map(d => d.field).filter(f => matchSelections.has(`${m.employee_id}|${f}`)),
      }))
      .filter(c => c.fields.length > 0)
    const res = await fetch('/api/timesheet/gusto-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes }),
    })
    const data = await res.json()
    setMatchResult(res.ok ? data.results : { updated: 0, errors: [data.error ?? 'Apply failed'] })
    setMatchApplying(false)
    if (res.ok) {
      setMatchPreview(null)
      setRosterAll(null)
      loadData()
    }
  }

  function toggleMatchField(key: string) {
    setMatchSelections(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  function openEditEmployee(emp: Employee) {
    setEditEmp(emp)
    setEditForm({
      first_name: emp.first_name,
      last_name: emp.last_name,
      preferred_name: emp.preferred_name ?? '',
      email: emp.email ?? '',
      phone: emp.phone ?? '',
      job_title: emp.job_title ?? '',
      department: emp.department ?? '',
      pay_type: emp.pay_type,
      hourly_rate: emp.hourly_rate != null ? String(emp.hourly_rate) : '',
    })
    setEditActive(emp.is_active !== false)
    setEditError('')
  }

  async function saveEmployeeEdit() {
    if (!editEmp) return
    setEditSaving(true)
    setEditError('')
    const res = await fetch(`/api/timesheet/employees/${editEmp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: editForm.first_name.trim(),
        last_name: editForm.last_name.trim(),
        preferred_name: editForm.preferred_name.trim() || null,
        email: editForm.email.trim() || null,
        phone: editForm.phone.trim() || null,
        job_title: editForm.job_title.trim() || null,
        department: editForm.department.trim() || null,
        pay_type: editForm.pay_type,
        hourly_rate: editForm.pay_type === 'hourly' && editForm.hourly_rate ? parseFloat(editForm.hourly_rate) : null,
        is_active: editActive,
      }),
    })
    const data = await res.json()
    setEditSaving(false)
    if (!res.ok) {
      setEditError(data.error ?? 'Save failed')
      return
    }
    setEditEmp(null)
    setRosterAll(null)
    loadData()
  }

  async function saveNewEmployee() {
    setAddSaving(true)
    setAddError('')
    const res = await fetch('/api/timesheet/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addForm),
    })
    const data = await res.json()
    if (!res.ok) { setAddError(data.error ?? 'Failed to add employee'); setAddSaving(false); return }
    setShowAddEmployee(false)
    setAddForm(BLANK_ADD_FORM)
    setAddSaving(false)
    loadData()
  }

  async function openLinkModal(emp: Employee) {
    setLinkingEmployee(emp)
    setSelectedUserId('')
    setLinkError(null)
    const res = await fetch('/api/admin/users')
    const data = await res.json()
    const linkedIds = new Set(employees.map(e => e.user_id).filter(Boolean))
    const unlinked = (data.users ?? []).filter((u: LynxedoUser) => !linkedIds.has(u.id))
    setLynxedoUsers(unlinked)
  }

  async function saveLink() {
    if (!linkingEmployee || !selectedUserId) return
    setLinkSaving(true)
    setLinkError(null)
    try {
      const linkRes = await fetch(`/api/timesheet/employees/${linkingEmployee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: selectedUserId }),
      })
      if (!linkRes.ok) {
        const body = await linkRes.json().catch(() => ({}))
        throw new Error(body.error || `Link failed (${linkRes.status})`)
      }
      const permRes = await fetch(`/api/admin/users/${selectedUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ can_access_timesheet: true }),
      })
      if (!permRes.ok) {
        const body = await permRes.json().catch(() => ({}))
        throw new Error(`Linked, but could not grant timesheet access: ${body.error || permRes.status}`)
      }
      setLinkingEmployee(null)
      loadData()
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLinkSaving(false)
    }
  }

  const isClockedIn = (emp: Employee) => openPunches.some(p => p.employee_id === emp.id)
  const openPunch = (emp: Employee) => openPunches.find(p => p.employee_id === emp.id)
  const empEntries = (emp: Employee) => entries.filter(e => e.employee_id === emp.id)
  // TS7 — apply the company weekly-OT threshold to every summary in this view.
  const summarize = (es: TimeEntry[]) => weekSummary(es, tsSettings.overtime_threshold_weekly)

  // TS7 — auto-save a timesheet-settings field on change (admin-gated PATCH).
  const saveTsSettings = async (patch: Partial<typeof tsSettings>) => {
    setTsSettings(prev => ({ ...prev, ...patch }))
    setTsSettingsSave('saving')
    try {
      const res = await fetch('/api/timesheet/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      setTsSettingsSave(res.ok ? 'saved' : 'error')
      if (res.ok) setTimeout(() => setTsSettingsSave('idle'), 1500)
    } catch {
      setTsSettingsSave('error')
    }
  }
  const empPendingRequests = (emp: Employee) => pendingRequests.filter(r => r.employee_id === emp.id)
  const hasPending = (emp: Employee) => empPendingRequests(emp).length > 0
  const empPendingPto = (empId: string) => weekPtoRequests.filter(r => r.employee_id === empId && r.status === 'pending')

  const liveCount = openPunches.length
  const isCurrentWeek = toDateStr(weekStart) === toDateStr(getWeekStart())

  function toggleExpandedRow(empId: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(empId) ? next.delete(empId) : next.add(empId)
      return next
    })
  }

  const showWeekNav = tab === 'week' || tab === 'summary' || tab === 'employees'

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-gray-950 text-white">
      <main className="max-w-5xl mx-auto px-4 py-6">

        {/* Pending punch-edit requests banner */}
        {pendingRequests.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3 mb-3 flex items-center gap-3">
            <span className="text-amber-400 text-lg">⚠</span>
            <div>
              <span className="text-amber-400 text-sm font-medium">
                {pendingRequests.length} pending time edit {pendingRequests.length === 1 ? 'request' : 'requests'}
              </span>
              <span className="text-gray-400 text-sm ml-2">— expand an employee row in the Pay Period tab to review</span>
            </div>
            <button
              onClick={() => setTab('summary')}
              className="ml-auto text-xs text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
            >Review →</button>
          </div>
        )}

        {/* Pending PTO requests banner */}
        {pendingPtoCount > 0 && (
          <div className="bg-violet-500/10 border border-violet-500/25 rounded-xl px-4 py-3 mb-3 flex items-center gap-3">
            <span className="text-violet-400 text-lg">🌴</span>
            <div>
              <span className="text-violet-400 text-sm font-medium">
                {pendingPtoCount} pending PTO {pendingPtoCount === 1 ? 'request' : 'requests'}
              </span>
              <span className="text-gray-400 text-sm ml-2">— expand an employee row in the Pay Period tab to review</span>
            </div>
            <button
              onClick={() => setTab('summary')}
              className="ml-auto text-xs text-violet-400 border border-violet-500/30 hover:bg-violet-500/10 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
            >Review →</button>
          </div>
        )}

        {/* Week nav + tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          {showWeekNav ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-sm"
              >‹</button>
              <div className="text-center">
                <div className="font-semibold">{formatWeekRange(weekStart)}</div>
                {isCurrentWeek && <div className="text-xs text-blue-400">Current Week</div>}
              </div>
              <button
                onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-sm"
              >›</button>
            </div>
          ) : (
            <div className="text-lg font-semibold">
              {tab === 'holidays' ? 'Paid Holidays' : tab === 'settings' ? 'Settings' : 'PTO Policies'}
            </div>
          )}
          <div className="flex gap-1 bg-gray-900 rounded-lg p-1 border border-gray-800 self-start sm:self-auto flex-wrap">
            {([
              ['week', 'Employees'],
              ['summary', 'Pay Period'],
              ['employees', 'Roster'],
              ['holidays', 'Holidays'],
              ['pto', 'PTO Policy'],
              ['settings', 'Settings'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`relative px-3 py-1.5 rounded-md text-sm transition-colors ${tab === key ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                {label}
                {key === 'summary' && (pendingRequests.length > 0 || pendingPtoCount > 0) && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full" />
                )}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-gray-500 text-sm py-8 text-center">Loading…</div>
        ) : tab === 'week' ? (
          <>
            {/* Live status bar */}
            {liveCount > 0 && isCurrentWeek && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 mb-5 flex flex-wrap gap-3 items-center">
                <span className="text-green-400 text-sm font-medium">🟢 {liveCount} clocked in</span>
                {openPunches.map(p => {
                  void now
                  return (
                    <span key={p.id} className="text-sm text-gray-300">
                      {p.employees.preferred_name || p.employees.first_name} since {formatTime(p.punched_at)} ({formatDuration(p.punched_at)})
                    </span>
                  )
                })}
              </div>
            )}

            {/* Employee cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {employees.map(emp => {
                const clockedIn = isClockedIn(emp)
                const punch = openPunch(emp)
                const summary = summarize(empEntries(emp))
                const isClocking = clockingId === emp.id
                const pendingCount = empPendingRequests(emp).length

                return (
                  <div key={emp.id} className={`bg-gray-900 border rounded-xl p-4 flex flex-col gap-3 ${clockedIn ? 'border-green-500/30' : pendingCount > 0 ? 'border-amber-500/25' : 'border-gray-800'}`}>
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="font-semibold">{emp.first_name} {emp.last_name}</div>
                          {pendingCount > 0 && (
                            <span className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/25 px-1.5 py-0.5 rounded-full">
                              {pendingCount} pending
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">{emp.job_title}</div>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${clockedIn ? 'bg-green-500/15 text-green-400 border border-green-500/25' : 'bg-gray-800 text-gray-500 border border-gray-700'}`}>
                        {clockedIn ? 'In' : 'Out'}
                      </span>
                    </div>
                    {clockedIn && punch && isCurrentWeek && (
                      <div className="text-xs text-green-400">
                        Since {formatTime(punch.punched_at)} · {formatDuration(punch.punched_at)}
                        <span className="text-transparent">{now}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-lg font-bold">{summary.total.toFixed(1)}</div>
                        <div className="text-xs text-gray-500">Total</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold">{summary.regular.toFixed(1)}</div>
                        <div className="text-xs text-gray-500">Regular</div>
                      </div>
                      <div>
                        <div className={`text-lg font-bold ${summary.ot > 0 ? 'text-amber-400' : ''}`}>{summary.ot.toFixed(1)}</div>
                        <div className="text-xs text-gray-500">OT {summary.ot > 0 ? '⚠️' : ''}</div>
                      </div>
                    </div>
                    {emp.pay_type === 'hourly' && emp.hourly_rate && (
                      <div className="text-xs text-gray-500">
                        ${emp.hourly_rate}/hr · est. ${((summary.regular * emp.hourly_rate) + (summary.ot * emp.hourly_rate * 1.5)).toFixed(0)}
                      </div>
                    )}
                    <div className="flex gap-2 mt-auto pt-1">
                      {isCurrentWeek && (
                        <button
                          onClick={() => clockAction(emp, clockedIn ? 'out' : 'in')}
                          disabled={isClocking}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${clockedIn ? 'bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25' : 'bg-green-500/15 text-green-400 border border-green-500/25 hover:bg-green-500/25'}`}
                        >
                          {isClocking ? '…' : clockedIn ? 'Clock Out' : 'Clock In'}
                        </button>
                      )}
                      <button
                        onClick={() => openEditPunches(emp)}
                        className="px-3 py-2 rounded-lg text-sm text-gray-400 border border-gray-700 hover:border-gray-600 hover:text-white transition-colors"
                        title="Edit punches"
                      >✎</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        ) : tab === 'summary' ? (
          // ── Pay Period Summary ───────────────────────────────────────────────
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Pay Period Summary</h2>
                <p className="text-xs text-gray-500 mt-0.5">{formatWeekRange(weekStart)}</p>
              </div>
              <button
                onClick={() => exportPayPeriodCSV(employees, entries, weekStart, tsSettings.overtime_threshold_weekly)}
                className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >↓ Export CSV</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wide">
                    <th className="text-left px-5 py-3 w-8" />
                    <th className="text-left px-2 py-3">Employee</th>
                    <th className="text-right px-4 py-3">$/hr</th>
                    <th className="text-right px-4 py-3">Regular</th>
                    <th className="text-right px-4 py-3">OT</th>
                    <th className="text-right px-4 py-3">Holiday</th>
                    <th className="text-right px-4 py-3">PTO</th>
                    <th className="text-right px-4 py-3">Total</th>
                    <th className="text-right px-4 py-3">Est. Wages</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {employees.map(emp => {
                    const summary = summarize(empEntries(emp))
                    const holidayHrs = empHolidayHours(emp.id)
                    const ptoHrs = empApprovedPtoHours(emp.id)
                    const estPay = emp.hourly_rate
                      ? (summary.regular * emp.hourly_rate) + (summary.ot * emp.hourly_rate * 1.5)
                      : null
                    const isExpanded = expandedRows.has(emp.id)
                    const empPending = empPendingRequests(emp)
                    const empDailyEntries = empEntries(emp).sort((a, b) => a.date.localeCompare(b.date))
                    const ptoRequests = empPendingPto(emp.id)
                    const isEditingOverride = overrideEmpId === emp.id

                    return [
                      <tr key={emp.id} className={`hover:bg-gray-800/50 transition-colors ${isExpanded ? 'bg-gray-800/30' : ''}`}>
                        <td className="px-3 py-3 text-center">
                          <button
                            onClick={() => toggleExpandedRow(emp.id)}
                            className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-gray-700 transition-colors text-xs"
                          >{isExpanded ? '▾' : '▸'}</button>
                        </td>
                        <td className="px-2 py-3">
                          <div className="font-medium flex items-center gap-1.5">
                            {emp.first_name} {emp.last_name}
                            {empPending.length > 0 && (
                              <span className="text-xs bg-amber-500/15 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-full">⚠ {empPending.length}</span>
                            )}
                            {ptoRequests.length > 0 && (
                              <span className="text-xs bg-violet-500/15 text-violet-400 border border-violet-500/20 px-1.5 py-0.5 rounded-full">🌴 {ptoRequests.length}</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">{emp.department}</div>
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums text-gray-400">
                          {emp.hourly_rate ? `$${Number(emp.hourly_rate).toFixed(2)}` : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums">{summary.regular.toFixed(2)}h</td>
                        <td className={`text-right px-4 py-3 tabular-nums ${summary.ot > 0 ? 'text-amber-400 font-medium' : ''}`}>
                          {summary.ot.toFixed(2)}h
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums">
                          {activeWeekHolidays.length > 0 ? (
                            <button
                              onClick={() => isEditingOverride ? setOverrideEmpId(null) : openOverrideEditor(emp.id)}
                              className={`tabular-nums text-sm underline-offset-2 ${isEditingOverride ? 'text-blue-400' : 'text-emerald-400 hover:underline'}`}
                              title="Click to override"
                            >
                              {holidayHrs.toFixed(2)}h
                            </button>
                          ) : (
                            <span className="text-gray-700">—</span>
                          )}
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums">
                          {ptoHrs > 0
                            ? <span className="text-violet-400">{ptoHrs.toFixed(2)}h</span>
                            : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="text-right px-4 py-3 tabular-nums font-medium">{summary.total.toFixed(2)}h</td>
                        <td className="text-right px-4 py-3 tabular-nums">
                          {estPay !== null ? `$${estPay.toFixed(2)}` : <span className="text-gray-600">—</span>}
                        </td>
                      </tr>,

                      // Expanded row
                      isExpanded && (
                        <tr key={`${emp.id}-expanded`} className="bg-gray-800/20">
                          <td colSpan={9} className="px-4 py-3">
                            <div className="space-y-3">

                              {/* Holiday override editor */}
                              {isEditingOverride && activeWeekHolidays.length > 0 && (
                                <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3">
                                  <p className="text-xs font-semibold text-blue-400 mb-2">Override holiday hours for {displayName(emp)}</p>
                                  <div className="space-y-2">
                                    {activeWeekHolidays.map(h => (
                                      <div key={h.id} className="flex items-center gap-3">
                                        <span className="text-sm text-gray-300 flex-1">{h.name} ({formatDateShort(h.date)})</span>
                                        <span className="text-xs text-gray-500">default {h.hours}h</span>
                                        <input
                                          type="number"
                                          step="0.25"
                                          min="0"
                                          value={overrideValues[h.id] ?? ''}
                                          onChange={e => setOverrideValues(v => ({ ...v, [h.id]: e.target.value }))}
                                          className="w-20 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white text-right focus:outline-none focus:border-blue-500"
                                        />
                                        <span className="text-xs text-gray-500">h</span>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex gap-2 mt-3">
                                    <button
                                      onClick={saveHolidayOverrides}
                                      disabled={savingOverride}
                                      className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[#fff] text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                                    >{savingOverride ? 'Saving…' : 'Save overrides'}</button>
                                    <button
                                      onClick={() => setOverrideEmpId(null)}
                                      className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
                                    >Cancel</button>
                                  </div>
                                </div>
                              )}

                              {/* Daily time entries */}
                              {empDailyEntries.length === 0 && ptoRequests.length === 0 && !isEditingOverride && (
                                <p className="text-xs text-gray-600 py-1">No time entries or PTO requests this week.</p>
                              )}

                              {empDailyEntries.map(entry => {
                                const pendingReq = empPending.find(r => r.time_entry_id === entry.id)
                                const isReviewing = reviewingId === pendingReq?.id

                                return (
                                  <div key={entry.id} className={`rounded-lg border px-4 py-2.5 ${pendingReq ? 'border-amber-500/30 bg-amber-500/5' : 'border-gray-700 bg-gray-900/50'}`}>
                                    <div className="flex items-start justify-between gap-4">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-3">
                                          <span className="text-sm font-medium text-gray-300">{formatDateShort(entry.date)}</span>
                                          <span className="text-xs text-gray-500">
                                            {formatTime(entry.clock_in)} → {entry.clock_out ? formatTime(entry.clock_out) : <span className="text-green-400">ongoing</span>}
                                          </span>
                                          <span className="text-xs tabular-nums text-gray-400">{entry.total_hours?.toFixed(2)}h</span>
                                          {(entry.overtime_hours ?? 0) > 0 && (
                                            <span className="text-xs text-amber-400">{entry.overtime_hours?.toFixed(2)}h OT</span>
                                          )}
                                        </div>
                                        {pendingReq && (
                                          <div className="mt-2 space-y-1">
                                            <p className="text-xs text-amber-300 font-medium">Edit requested by {displayName({ ...emp, preferred_name: pendingReq.employees?.preferred_name ?? null, first_name: pendingReq.employees?.first_name ?? emp.first_name, last_name: pendingReq.employees?.last_name ?? emp.last_name })}</p>
                                            <div className="flex items-center gap-2 text-xs text-gray-400">
                                              <span>New times:</span>
                                              <span className="text-white">
                                                {pendingReq.new_clock_in ? formatTime(pendingReq.new_clock_in) : formatTime(entry.clock_in)}
                                                {' → '}
                                                {pendingReq.new_clock_out ? formatTime(pendingReq.new_clock_out) : (entry.clock_out ? formatTime(entry.clock_out) : '—')}
                                              </span>
                                            </div>
                                            <p className="text-xs text-gray-400">Reason: <span className="text-gray-300">&ldquo;{pendingReq.reason}&rdquo;</span></p>
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        {pendingReq ? (
                                          <>
                                            <button onClick={() => reviewEditRequest(pendingReq.id, 'approve')} disabled={isReviewing} className="text-xs bg-green-600 hover:bg-green-500 disabled:opacity-50 text-[#fff] px-3 py-1.5 rounded-lg transition-colors font-medium">{isReviewing ? '…' : '✓ Approve'}</button>
                                            <button onClick={() => reviewEditRequest(pendingReq.id, 'reject')} disabled={isReviewing} className="text-xs bg-gray-700 hover:bg-red-900/40 hover:border-red-500/30 disabled:opacity-50 text-gray-300 hover:text-red-400 border border-gray-600 px-3 py-1.5 rounded-lg transition-colors">Reject</button>
                                          </>
                                        ) : (
                                          <button
                                            onClick={() => {
                                              setDayEditError(null)
                                              setDayEdit(dayEdit?.entryId === entry.id ? null : {
                                                entryId: entry.id,
                                                employeeId: entry.employee_id,
                                                date: entry.date,
                                                clockIn: entry.clock_in,
                                                clockOut: entry.clock_out ?? entry.clock_in,
                                                reason: '',
                                              })
                                            }}
                                            className={`text-xs border px-2 py-1.5 rounded-lg transition-colors ${dayEdit?.entryId === entry.id ? 'text-white border-blue-500 bg-blue-500/10' : 'text-gray-500 hover:text-white border-gray-700 hover:border-gray-500'}`}
                                            title="Edit this day"
                                          >✎ Edit</button>
                                        )}
                                      </div>
                                    </div>

                                    {/* Per-day inline editor */}
                                    {dayEdit?.entryId === entry.id && (() => {
                                      const err = punchTimeError(dayEdit.clockIn, dayEdit.clockOut)
                                      const warnings = err ? [] : punchTimeWarnings(dayEdit.clockIn, dayEdit.clockOut)
                                      return (
                                        <div className="mt-3 pt-3 border-t border-gray-700/60 space-y-3">
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <label className="block">
                                              <span className="text-xs text-gray-500">Clock In</span>
                                              <input
                                                type="datetime-local"
                                                value={toLocalInputValue(dayEdit.clockIn)}
                                                onChange={e => { const iso = fromLocalInputValue(e.target.value); if (iso) setDayEdit(d => d ? { ...d, clockIn: iso } : d) }}
                                                className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                              />
                                            </label>
                                            <label className="block">
                                              <span className="text-xs text-gray-500">Clock Out</span>
                                              <input
                                                type="datetime-local"
                                                value={toLocalInputValue(dayEdit.clockOut)}
                                                onChange={e => { const iso = fromLocalInputValue(e.target.value); if (iso) setDayEdit(d => d ? { ...d, clockOut: iso } : d) }}
                                                className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                              />
                                            </label>
                                          </div>
                                          <input
                                            type="text"
                                            placeholder="Reason for edit *"
                                            value={dayEdit.reason}
                                            onChange={e => setDayEdit(d => d ? { ...d, reason: e.target.value } : d)}
                                            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                          />
                                          {err && <p className="text-xs text-red-400">⚠ {err}</p>}
                                          {warnings.map((w, i) => <p key={i} className="text-xs text-amber-400">⚠ {w}</p>)}
                                          {dayEditError && <p className="text-xs text-red-400">{dayEditError}</p>}
                                          <div className="flex gap-2">
                                            <button
                                              onClick={saveDayEdit}
                                              disabled={!!err || !dayEdit.reason.trim() || dayEditSaving}
                                              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-[#fff] text-sm px-4 py-1.5 rounded-lg transition-colors"
                                            >{dayEditSaving ? 'Saving…' : 'Save'}</button>
                                            <button onClick={() => { setDayEdit(null); setDayEditError(null) }} className="text-gray-500 hover:text-white text-sm px-3 py-1.5 transition-colors">Cancel</button>
                                          </div>
                                        </div>
                                      )
                                    })()}
                                  </div>
                                )
                              })}

                              {/* PTO requests for this week */}
                              {ptoRequests.map(req => {
                                const isReviewing = reviewingPtoId === req.id
                                return (
                                  <div key={req.id} className="rounded-lg border border-violet-500/30 bg-violet-500/5 px-4 py-2.5">
                                    <div className="flex items-start justify-between gap-4">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-3">
                                          <span className="text-sm font-medium text-violet-300">🌴 PTO Request</span>
                                          <span className="text-xs text-gray-400">{formatDateShort(req.request_date)}</span>
                                          <span className="text-xs tabular-nums text-gray-300">{req.hours}h</span>
                                          <span className={`text-xs px-2 py-0.5 rounded-full ${req.type === 'paid' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-700 text-gray-400'}`}>{req.type}</span>
                                        </div>
                                        {req.note && <p className="text-xs text-gray-400 mt-1">&ldquo;{req.note}&rdquo;</p>}
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <button onClick={() => reviewPtoRequest(req.id, 'approve')} disabled={isReviewing} className="text-xs bg-green-600 hover:bg-green-500 disabled:opacity-50 text-[#fff] px-3 py-1.5 rounded-lg transition-colors font-medium">{isReviewing ? '…' : '✓ Approve'}</button>
                                        <button onClick={() => reviewPtoRequest(req.id, 'reject')} disabled={isReviewing} className="text-xs bg-gray-700 hover:bg-red-900/40 hover:border-red-500/30 disabled:opacity-50 text-gray-300 hover:text-red-400 border border-gray-600 px-3 py-1.5 rounded-lg transition-colors">Reject</button>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      ),
                    ].filter(Boolean)
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-700 bg-gray-800/50 font-semibold">
                    <td /><td className="px-2 py-3 text-gray-400 text-xs uppercase">Totals</td><td />
                    {(() => {
                      const hourlyEmps = employees.filter(e => e.pay_type === 'hourly')
                      const totReg = hourlyEmps.reduce((s, e) => s + summarize(empEntries(e)).regular, 0)
                      const totOT = hourlyEmps.reduce((s, e) => s + summarize(empEntries(e)).ot, 0)
                      const totHoliday = employees.reduce((s, e) => s + empHolidayHours(e.id), 0)
                      const totPto = employees.reduce((s, e) => s + empApprovedPtoHours(e.id), 0)
                      const totHrs = hourlyEmps.reduce((s, e) => s + summarize(empEntries(e)).total, 0)
                      const totPay = hourlyEmps.reduce((s, e) => {
                        const sum = summarize(empEntries(e))
                        return s + (e.hourly_rate ? sum.regular * e.hourly_rate + sum.ot * e.hourly_rate * 1.5 : 0)
                      }, 0)
                      return (
                        <>
                          <td className="text-right px-4 py-3 tabular-nums">{totReg.toFixed(2)}h</td>
                          <td className={`text-right px-4 py-3 tabular-nums ${totOT > 0 ? 'text-amber-400' : ''}`}>{totOT.toFixed(2)}h</td>
                          <td className="text-right px-4 py-3 tabular-nums text-emerald-400">{totHoliday > 0 ? `${totHoliday.toFixed(2)}h` : '—'}</td>
                          <td className="text-right px-4 py-3 tabular-nums text-violet-400">{totPto > 0 ? `${totPto.toFixed(2)}h` : '—'}</td>
                          <td className="text-right px-4 py-3 tabular-nums">{totHrs.toFixed(2)}h</td>
                          <td className="text-right px-4 py-3 tabular-nums">${totPay.toFixed(2)}</td>
                        </>
                      )
                    })()}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : tab === 'employees' ? (
          // ── Roster ────────────────────────────────────────────────────────────
          <div className="space-y-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold">Employee Roster</h2>
                  <div className="flex gap-1 bg-gray-800 rounded-lg p-1 border border-gray-700">
                    {([['active', 'Active'], ['inactive', 'Deactivated'], ['all', 'All']] as const).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setRosterFilter(key)}
                        className={`px-2.5 py-1 rounded-md text-xs transition-colors ${rosterFilter === key ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowAddEmployee(true); setAddForm(BLANK_ADD_FORM); setAddError('') }}
                    className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
                  >+ Add Employee</button>
                  {gustoConnected === false ? (
                    <a
                      href="/api/admin/gusto/connect"
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-[#fff] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >🔗 Connect Gusto</a>
                  ) : (
                    <button
                      onClick={fetchMatchPreview}
                      disabled={matchLoading || gustoConnected === null}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-[#fff] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      {matchLoading ? <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : '⇄'}
                      Match with Gusto
                    </button>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wide">
                      <th className="text-left px-5 py-3">Name</th>
                      <th className="text-left px-4 py-3">Title</th>
                      <th className="text-left px-4 py-3">Dept</th>
                      <th className="text-center px-4 py-3">Type</th>
                      <th className="text-right px-4 py-3">$/hr</th>
                      <th className="text-center px-4 py-3">Account</th>
                      <th className="text-right px-4 py-3">Gusto Synced</th>
                      <th className="text-right px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {(rosterAll ?? employees)
                      .filter(emp =>
                        rosterFilter === 'all' ? true : rosterFilter === 'inactive' ? emp.is_active === false : emp.is_active !== false
                      )
                      .map(emp => (
                      <tr key={emp.id} className={`hover:bg-gray-800/40 transition-colors ${emp.is_active === false ? 'opacity-50' : ''}`}>
                        <td className="px-5 py-3 font-medium">
                          {emp.first_name} {emp.last_name}
                          {emp.is_active === false && rosterFilter === 'all' && (
                            <span className="ml-2 text-xs bg-gray-800 text-gray-500 border border-gray-700 px-1.5 py-0.5 rounded-full">Deactivated</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{emp.job_title}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{emp.department}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${emp.pay_type === 'hourly' ? 'bg-blue-500/15 text-blue-400' : 'bg-gray-800 text-gray-500'}`}>{emp.pay_type}</span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {emp.hourly_rate ? <span className="font-medium">${Number(emp.hourly_rate).toFixed(2)}</span> : <span className="text-gray-700">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {emp.user_id ? (
                            <span className="text-xs bg-green-500/15 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">Linked</span>
                          ) : (
                            <button onClick={() => openLinkModal(emp)} className="text-xs text-gray-500 hover:text-blue-400 border border-gray-700 hover:border-blue-500/40 px-2 py-0.5 rounded-full transition-colors">Link</button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-gray-600">
                          {emp.gusto_synced_at ? new Date(emp.gusto_synced_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => openEditEmployee(emp)}
                            className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-2 py-1 rounded-lg transition-colors"
                            title="Edit employee"
                          >✎ Edit</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {matchResult && (
              <div className={`${matchResult.errors.length > 0 ? 'bg-amber-500/10 border-amber-500/25' : 'bg-green-500/10 border-green-500/25'} border rounded-xl px-5 py-3`}>
                <div className="flex items-center justify-between">
                  <span className={`${matchResult.errors.length > 0 ? 'text-amber-400' : 'text-green-400'} text-sm`}>
                    Match complete — {matchResult.updated} {matchResult.updated === 1 ? 'change' : 'changes'} applied from Gusto
                  </span>
                  <button onClick={() => setMatchResult(null)} className="text-gray-500 hover:text-white text-lg leading-none" aria-label="Dismiss">×</button>
                </div>
                {matchResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-amber-400 mt-1">{e}</p>
                ))}
              </div>
            )}
          </div>
        ) : tab === 'holidays' ? (
          // ── Holidays ──────────────────────────────────────────────────────────
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Paid Holidays</h2>
                <p className="text-xs text-gray-500 mt-0.5">Set which dates are paid holidays and how many hours each is worth</p>
              </div>
              <button
                onClick={openAddHoliday}
                className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors"
              >+ Add Holiday</button>
            </div>

            {/* Add/Edit form */}
            {holidayForm && (
              <div className="px-5 py-4 border-b border-gray-800 bg-gray-800/30">
                <p className="text-xs font-semibold text-gray-400 mb-3">{editingHolidayId ? 'Edit Holiday' : 'New Holiday'}</p>
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Name *</label>
                    <input
                      value={holidayForm.name}
                      onChange={e => setHolidayForm(f => f ? { ...f, name: e.target.value } : f)}
                      placeholder="Christmas"
                      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 w-48"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Date *</label>
                    <input
                      type="date"
                      value={holidayForm.date}
                      onChange={e => setHolidayForm(f => f ? { ...f, date: e.target.value } : f)}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Hours *</label>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={holidayForm.hours}
                      onChange={e => setHolidayForm(f => f ? { ...f, hours: e.target.value } : f)}
                      className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 w-24"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={saveHoliday}
                      disabled={savingHoliday || !holidayForm.name || !holidayForm.date || !holidayForm.hours}
                      className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[#fff] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >{savingHoliday ? 'Saving…' : 'Save'}</button>
                    <button
                      onClick={() => { setHolidayForm(null); setEditingHolidayId(null); setHolidayError('') }}
                      className="border border-gray-700 text-gray-400 hover:text-white text-sm px-3 py-2 rounded-lg transition-colors"
                    >Cancel</button>
                  </div>
                </div>
                {holidayError && <p className="text-xs text-red-400 mt-2">{holidayError}</p>}
              </div>
            )}

            {/* Holiday list */}
            {!holidaysLoaded ? (
              <div className="px-5 py-8 text-center text-gray-500 text-sm">Loading…</div>
            ) : allHolidays.length === 0 && !holidayForm ? (
              <div className="px-5 py-8 text-center">
                <p className="text-gray-500 text-sm">No holidays configured yet.</p>
                <p className="text-gray-600 text-xs mt-1">Click "+ Add Holiday" to create your first paid holiday.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase tracking-wide">
                      <th className="text-left px-5 py-3">Name</th>
                      <th className="text-left px-4 py-3">Date</th>
                      <th className="text-right px-4 py-3">Hours</th>
                      <th className="text-center px-4 py-3">Active</th>
                      <th className="text-right px-5 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {allHolidays.map(h => (
                      <tr key={h.id} className={`hover:bg-gray-800/40 transition-colors ${!h.is_active ? 'opacity-50' : ''}`}>
                        <td className="px-5 py-3 font-medium">{h.name}</td>
                        <td className="px-4 py-3 text-gray-400">{formatDateShort(h.date)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{h.hours}h</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => toggleHolidayActive(h)}
                            className={`w-10 h-5 rounded-full transition-colors relative ${h.is_active ? 'bg-emerald-500' : 'bg-gray-700'}`}
                            title={h.is_active ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                          >
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${h.is_active ? 'right-0.5' : 'left-0.5'}`} />
                          </button>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openEditHoliday(h)}
                              className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-2 py-1 rounded-lg transition-colors"
                            >Edit</button>
                            <button
                              onClick={() => deleteHoliday(h.id)}
                              className="text-xs text-gray-600 hover:text-red-400 border border-gray-800 hover:border-red-500/30 px-2 py-1 rounded-lg transition-colors"
                            >Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : tab === 'settings' ? (
          // ── Settings (TS7) ────────────────────────────────────────────────────
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden max-w-2xl">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Timesheet Settings</h2>
                <p className="text-xs text-gray-500 mt-0.5">Pay-period, overtime, and GPS rules for this company.</p>
              </div>
              <span className="text-xs text-gray-500 min-w-[60px] text-right">
                {tsSettingsSave === 'saving' ? 'Saving…' : tsSettingsSave === 'saved' ? 'Saved ✓' : tsSettingsSave === 'error' ? 'Save failed' : ''}
              </span>
            </div>
            <div className="px-5 py-5 space-y-6">
              {/* Pay period */}
              <div>
                <label className="block text-sm font-medium text-white mb-1">Week starts on</label>
                <p className="text-xs text-gray-500 mb-2">The pay week used across the timesheet and the Gusto CSV export.</p>
                <select
                  value={tsSettings.pay_period_start_day}
                  onChange={e => {
                    const v = Number(e.target.value)
                    void saveTsSettings({ pay_period_start_day: v })
                    setWeekStart(getWeekStart(new Date(), v))
                  }}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand transition-colors"
                >
                  {[['1', 'Monday'], ['0', 'Sunday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday']].map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Weekly overtime */}
              <div className="border-t border-gray-800 pt-5">
                <label className="block text-sm font-medium text-white mb-1">Weekly overtime after</label>
                <p className="text-xs text-gray-500 mb-2">Hours over this in a pay week count as overtime (1.5×) in summaries and the export.</p>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={tsSettings.overtime_threshold_weekly}
                    onChange={e => setTsSettings(p => ({ ...p, overtime_threshold_weekly: Number(e.target.value) }))}
                    onBlur={() => void saveTsSettings({ overtime_threshold_weekly: tsSettings.overtime_threshold_weekly })}
                    className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-brand transition-colors"
                  />
                  <span className="text-sm text-gray-400">hours / week</span>
                </div>
              </div>

              {/* GPS */}
              <div className="border-t border-gray-800 pt-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-white">Capture GPS on mobile clock-in</p>
                    <p className="text-xs text-gray-500 mt-0.5">Records where an employee was when they clock in on a phone. Desktop is never tracked.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={tsSettings.gps_enabled}
                    aria-label="Capture GPS on mobile clock-in"
                    onClick={() => void saveTsSettings({ gps_enabled: !tsSettings.gps_enabled })}
                    className={`relative flex-none w-10 h-6 rounded-full transition-colors ${tsSettings.gps_enabled ? 'bg-brand' : 'bg-gray-700'}`}
                  >
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${tsSettings.gps_enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          // ── PTO Policy ────────────────────────────────────────────────────────
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800">
              <h2 className="font-semibold">PTO Policies</h2>
              <p className="text-xs text-gray-500 mt-0.5">Set annual PTO hours per employee. No automatic accrual — update manually when someone hits a milestone.</p>
            </div>
            {!policiesLoaded ? (
              <div className="px-5 py-8 text-center text-gray-500 text-sm">Loading…</div>
            ) : (
              <div className="divide-y divide-gray-800">
                {employees.map(emp => {
                  const policy = ptoPolicies.find(p => p.employee_id === emp.id)
                  const isEditing = editingPolicyEmpId === emp.id

                  return (
                    <div key={emp.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{emp.first_name} {emp.last_name}</div>
                          <div className="text-xs text-gray-500">{emp.job_title}</div>
                          {!isEditing && policy && (
                            <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-gray-400">
                              <span className="text-emerald-400 font-medium">{policy.annual_hours}h / year</span>
                              {policy.anniversary_date && <span>Anniversary: {formatDateShort(policy.anniversary_date)}</span>}
                              {policy.accrual_notes && <span className="text-gray-500 truncate max-w-xs">{policy.accrual_notes}</span>}
                            </div>
                          )}
                          {!isEditing && !policy && (
                            <div className="mt-1 text-xs text-gray-600">No PTO policy set</div>
                          )}
                        </div>
                        {!isEditing && (
                          <button
                            onClick={() => openEditPolicy(emp)}
                            className="text-xs text-gray-500 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors shrink-0"
                          >{policy ? 'Edit' : '+ Set policy'}</button>
                        )}
                      </div>

                      {isEditing && policyForm && (
                        <div className="mt-3 bg-gray-800/40 rounded-xl p-4 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Annual PTO Hours *</label>
                              <input
                                type="number"
                                step="1"
                                min="0"
                                value={policyForm.annual_hours}
                                onChange={e => setPolicyForm(f => f ? { ...f, annual_hours: e.target.value } : f)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                                placeholder="80"
                              />
                              <p className="text-xs text-gray-600 mt-0.5">e.g. 80h = 10 days</p>
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Anniversary Date</label>
                              <input
                                type="date"
                                value={policyForm.anniversary_date}
                                onChange={e => setPolicyForm(f => f ? { ...f, anniversary_date: e.target.value } : f)}
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Accrual Notes</label>
                              <input
                                value={policyForm.accrual_notes}
                                onChange={e => setPolicyForm(f => f ? { ...f, accrual_notes: e.target.value } : f)}
                                placeholder="e.g. After 3 years: 120h"
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                              />
                            </div>
                          </div>
                          {policyError && <p className="text-xs text-red-400">{policyError}</p>}
                          <div className="flex gap-2">
                            <button
                              onClick={savePolicy}
                              disabled={savingPolicy}
                              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[#fff] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                            >{savingPolicy ? 'Saving…' : 'Save policy'}</button>
                            <button
                              onClick={() => { setEditingPolicyEmpId(null); setPolicyForm(null); setPolicyError('') }}
                              className="border border-gray-700 text-gray-400 hover:text-white text-sm px-4 py-2 rounded-lg transition-colors"
                            >Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* Match with Gusto review */}
      {matchPreview && (() => {
        const matches = matchPreview.matches ?? []
        const withDiffs = matches.filter(m => m.diffs.length > 0)
        const upToDate = matches.filter(m => m.up_to_date)
        const totalDiffs = withDiffs.reduce((s, m) => s + m.diffs.length, 0)
        return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setMatchPreview(null) }}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
              <h3 className="font-semibold">Match with Gusto</h3>
              <button onClick={() => setMatchPreview(null)} className="text-gray-500 hover:text-white transition-colors text-xl leading-none" aria-label="Close">×</button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4">
              {!matchPreview.connected ? (
                <div className="text-center py-6 space-y-4">
                  <div className="text-3xl">🔗</div>
                  <p className="text-sm font-medium text-gray-300">Gusto not connected</p>
                  <a
                    href="/api/admin/gusto/connect"
                    className="inline-block bg-blue-600 hover:bg-blue-500 text-[#fff] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >Connect Gusto</a>
                </div>
              ) : matchPreview.error ? (
                <p className="text-sm text-red-400 py-4">{matchPreview.error}</p>
              ) : (
                <div className="space-y-5">
                  {withDiffs.length === 0 && (
                    <div className="text-center py-4 space-y-2">
                      <div className="text-3xl">✅</div>
                      <p className="text-sm font-medium text-gray-300">Roster matches Gusto</p>
                    </div>
                  )}

                  {withDiffs.length > 0 && (
                    <div className="flex gap-3 text-xs">
                      <button
                        onClick={() => {
                          const all = new Set<string>()
                          for (const m of withDiffs) for (const d of m.diffs) all.add(`${m.employee_id}|${d.field}`)
                          setMatchSelections(all)
                        }}
                        className="text-blue-400 hover:text-blue-300"
                      >Select all</button>
                      <span className="text-gray-700">·</span>
                      <button onClick={() => setMatchSelections(new Set())} className="text-gray-500 hover:text-gray-400">Deselect all</button>
                      <span className="ml-auto text-gray-600">{matchSelections.size} of {totalDiffs} selected</span>
                    </div>
                  )}

                  {withDiffs.map(m => (
                    <div key={m.employee_id} className="border border-gray-800 rounded-xl overflow-hidden">
                      <div className="px-3 py-2 bg-gray-800/50 flex items-center gap-2">
                        <span className="text-sm font-medium">{m.name}</span>
                        {m.matched_by !== 'gusto' && (
                          <span className="text-[11px] text-gray-500">matched by {m.matched_by}</span>
                        )}
                      </div>
                      <div className="divide-y divide-gray-800/60">
                        {m.diffs.map(d => {
                          const key = `${m.employee_id}|${d.field}`
                          return (
                            <label key={key} className="flex items-center gap-3 py-2 px-3 hover:bg-gray-800 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={matchSelections.has(key)}
                                onChange={() => toggleMatchField(key)}
                                className="w-4 h-4 rounded accent-blue-500 shrink-0"
                              />
                              <span className="text-xs text-gray-500 w-20 shrink-0">{d.label}</span>
                              <span className="text-sm min-w-0">
                                <span className="text-gray-400">{d.current}</span>
                                <span className="text-gray-600 mx-1.5">→</span>
                                <span className="text-white font-medium">{d.incoming}</span>
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}

                  {upToDate.length > 0 && withDiffs.length > 0 && (
                    <p className="text-xs text-gray-600">✓ Already matching Gusto: {upToDate.map(m => m.name).join(', ')}</p>
                  )}

                  {(matchPreview.unmatched_gusto?.length ?? 0) > 0 && (
                    <div className="border border-gray-800 rounded-xl px-3 py-2.5">
                      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">In Gusto, not on the roster</div>
                      {matchPreview.unmatched_gusto!.map((g, i) => (
                        <div key={i} className="text-sm text-gray-400">{g.name}{g.title ? <span className="text-gray-600"> · {g.title}</span> : null}</div>
                      ))}
                      <p className="text-xs text-gray-600 mt-1.5">Add people to the roster with the Employee Roster toggle in Admin → People.</p>
                    </div>
                  )}

                  {(matchPreview.unmatched_roster?.length ?? 0) > 0 && (
                    <div className="border border-amber-500/25 bg-amber-500/5 rounded-xl px-3 py-2.5">
                      <div className="text-xs font-semibold text-amber-400 uppercase tracking-wide mb-1.5">On the roster, not found in Gusto</div>
                      {matchPreview.unmatched_roster!.map(r => (
                        <div key={r.id} className="text-sm text-gray-400">{r.name}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {matchPreview.connected && !matchPreview.error && withDiffs.length > 0 && (
              <div className="px-5 py-4 border-t border-gray-800 flex gap-3 shrink-0">
                <button
                  onClick={applyMatch}
                  disabled={matchApplying || matchSelections.size === 0}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[#fff] font-medium py-2.5 rounded-xl transition-colors text-sm"
                >
                  {matchApplying ? 'Applying…' : `Apply ${matchSelections.size} ${matchSelections.size === 1 ? 'change' : 'changes'}`}
                </button>
                <button onClick={() => setMatchPreview(null)} className="px-5 py-2.5 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
              </div>
            )}
          </div>
        </div>
        )
      })()}

      {/* Edit Employee modal */}
      {editEmp && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setEditEmp(null) }}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
              <h3 className="font-semibold">Edit Employee</h3>
              <button onClick={() => setEditEmp(null)} className="text-gray-500 hover:text-white text-xl leading-none" aria-label="Close">×</button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">First Name *</label>
                  <input value={editForm.first_name} onChange={e => setEditForm(f => ({ ...f, first_name: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Last Name *</label>
                  <input value={editForm.last_name} onChange={e => setEditForm(f => ({ ...f, last_name: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Preferred Name</label>
                <input value={editForm.preferred_name} onChange={e => setEditForm(f => ({ ...f, preferred_name: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Email</label>
                  <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Phone</label>
                  <input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Job Title</label>
                  <input value={editForm.job_title} onChange={e => setEditForm(f => ({ ...f, job_title: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Department</label>
                  <input value={editForm.department} onChange={e => setEditForm(f => ({ ...f, department: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Pay Type *</label>
                  <select value={editForm.pay_type} onChange={e => setEditForm(f => ({ ...f, pay_type: e.target.value as 'hourly' | 'salary' }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                    <option value="hourly">Hourly</option>
                    <option value="salary">Salary</option>
                  </select>
                </div>
                {editForm.pay_type === 'hourly' && (
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Hourly Rate</label>
                    <input type="number" step="0.01" min="0" value={editForm.hourly_rate} onChange={e => setEditForm(f => ({ ...f, hourly_rate: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-sm text-gray-300">Active on roster</span>
                <button
                  role="switch"
                  aria-checked={editActive}
                  onClick={() => setEditActive(v => !v)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${editActive ? 'bg-emerald-500' : 'bg-gray-700'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${editActive ? 'right-0.5' : 'left-0.5'}`} />
                </button>
              </div>
              {editError && <p className="text-red-400 text-xs">{editError}</p>}
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex gap-3 shrink-0">
              <button onClick={saveEmployeeEdit} disabled={editSaving || !editForm.first_name || !editForm.last_name} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[#fff] font-medium py-2.5 rounded-xl transition-colors text-sm">
                {editSaving ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditEmp(null)} className="px-5 py-2.5 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Employee modal */}
      {showAddEmployee && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setShowAddEmployee(false) }}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
              <h3 className="font-semibold">Add Employee</h3>
              <button onClick={() => setShowAddEmployee(false)} className="text-gray-500 hover:text-white text-xl leading-none" aria-label="Close">×</button>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">First Name *</label>
                  <input value={addForm.first_name} onChange={e => setAddForm(f => ({ ...f, first_name: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="Jane" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Last Name *</label>
                  <input value={addForm.last_name} onChange={e => setAddForm(f => ({ ...f, last_name: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="Smith" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Preferred Name</label>
                <input value={addForm.preferred_name} onChange={e => setAddForm(f => ({ ...f, preferred_name: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="Optional nickname" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Email</label>
                  <input type="email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="jane@example.com" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Phone</label>
                  <input value={addForm.phone} onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="555-555-5555" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Job Title</label>
                  <input value={addForm.job_title} onChange={e => setAddForm(f => ({ ...f, job_title: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="Crew Leader" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Department</label>
                  <input value={addForm.department} onChange={e => setAddForm(f => ({ ...f, department: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="Field" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Pay Type *</label>
                  <select value={addForm.pay_type} onChange={e => setAddForm(f => ({ ...f, pay_type: e.target.value as 'hourly' | 'salary' }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none">
                    <option value="hourly">Hourly</option>
                    <option value="salary">Salary</option>
                  </select>
                </div>
                {addForm.pay_type === 'hourly' && (
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Hourly Rate</label>
                    <input type="number" step="0.01" min="0" value={addForm.hourly_rate} onChange={e => setAddForm(f => ({ ...f, hourly_rate: e.target.value }))} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="18.00" />
                  </div>
                )}
              </div>
              {addError && <p className="text-red-400 text-xs">{addError}</p>}
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex gap-3 shrink-0">
              <button onClick={saveNewEmployee} disabled={addSaving || !addForm.first_name || !addForm.last_name} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[#fff] font-medium py-2.5 rounded-xl transition-colors text-sm">
                {addSaving ? 'Saving…' : 'Add Employee'}
              </button>
              <button onClick={() => setShowAddEmployee(false)} className="px-5 py-2.5 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Link Account modal */}
      {linkingEmployee && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setLinkingEmployee(null) }}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md flex flex-col">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
              <div>
                <h3 className="font-semibold">Link Lynxedo Account</h3>
                <p className="text-xs text-gray-500 mt-0.5">{linkingEmployee.first_name} {linkingEmployee.last_name}</p>
              </div>
              <button onClick={() => setLinkingEmployee(null)} className="text-gray-500 hover:text-white text-xl leading-none" aria-label="Close">×</button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <p className="text-xs text-gray-500 leading-relaxed">Select the Lynxedo login that belongs to this employee. They&apos;ll get timesheet access automatically.</p>
              {lynxedoUsers.length === 0 ? (
                <p className="text-sm text-gray-600 text-center py-4">No unlinked Lynxedo users found.</p>
              ) : (
                <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500">
                  <option value="">Select a user…</option>
                  {lynxedoUsers.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
                </select>
              )}
              {linkError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{linkError}</p>}
            </div>
            <div className="px-5 py-4 border-t border-gray-800 flex gap-3 shrink-0">
              <button onClick={saveLink} disabled={linkSaving || !selectedUserId} className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[#fff] font-medium py-2.5 rounded-xl transition-colors text-sm">
                {linkSaving ? 'Linking…' : 'Link Account'}
              </button>
              <button onClick={() => setLinkingEmployee(null)} className="px-5 py-2.5 rounded-xl border border-gray-700 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit punches panel */}
      {editEmployee && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setEditEmployee(null) }}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-gray-800 shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Punches — {editEmployee.first_name} {editEmployee.last_name}</h3>
                <button onClick={() => setEditEmployee(null)} className="text-gray-500 hover:text-white transition-colors text-xl leading-none" aria-label="Close">×</button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => navigateEditWeek(-1)} className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 transition-colors text-sm">‹</button>
                <span className="flex-1 text-center text-xs text-gray-400">{formatWeekRange(editWeekStart)}</span>
                <button onClick={() => navigateEditWeek(1)} disabled={toDateStr(editWeekStart) >= toDateStr(getWeekStart())} className="w-7 h-7 flex items-center justify-center rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm">›</button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
              {editPunchesLoading && <p className="text-sm text-gray-500">Loading…</p>}
              {!editPunchesLoading && editPunches.length === 0 && <p className="text-sm text-gray-500">No punches this week.</p>}
              {editPunches.map(punch => (
                <div key={punch.id} className="flex items-center gap-3 group">
                  <span className={`text-xs font-semibold w-8 text-center py-0.5 rounded ${punch.punch_type === 'in' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {punch.punch_type === 'in' ? 'IN' : 'OUT'}
                  </span>
                  {editingPunch?.id === punch.id ? (
                    <div className="flex-1 flex gap-2">
                      <input type="datetime-local" value={toLocalInputValue(editingPunch.time)} onChange={e => { const iso = fromLocalInputValue(e.target.value); if (iso) setEditingPunch(p => p ? { ...p, time: iso } : p) }} className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500" />
                      <input type="text" placeholder="Reason *" value={editingPunch.reason} onChange={e => setEditingPunch(p => p ? { ...p, reason: e.target.value } : p)} className="w-28 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500" />
                      <button onClick={savePunchEdit} className="text-green-400 hover:text-green-300 text-sm px-2">✓</button>
                      <button onClick={() => setEditingPunch(null)} className="text-gray-500 hover:text-white text-sm px-1" aria-label="Close">✕</button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-medium tabular-nums">
                        {formatTime(punch.punched_at)}
                        <span className="text-gray-600 text-xs ml-2">{new Date(punch.punched_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                        {punch.edit_reason && <span className="text-xs text-amber-500/70 ml-2" title={`Edited: ${punch.edit_reason}`}>✎</span>}
                        {punch.lat && punch.lng && <a href={`https://maps.google.com/?q=${punch.lat},${punch.lng}`} target="_blank" rel="noopener noreferrer" className="text-xs ml-2" title={`${punch.lat.toFixed(5)}, ${punch.lng.toFixed(5)}`}>📍</a>}
                      </span>
                      <button onClick={() => setEditingPunch({ id: punch.id, time: punch.punched_at, reason: '' })} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-white transition-all text-sm px-1" title="Edit time">✎</button>
                      <button onClick={() => deletePunch(punch.id)} className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-red-400 transition-all text-sm px-1" title="Delete punch" aria-label="Remove">✕</button>
                    </>
                  )}
                </div>
              ))}
              {addingPunch ? (
                <div className="border border-dashed border-gray-700 rounded-lg p-3 space-y-2">
                  <div className="flex gap-2">
                    <select value={addingPunch.type} onChange={e => setAddingPunch(p => p ? { ...p, type: e.target.value as 'in' | 'out' } : p)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none">
                      <option value="in">Clock In</option>
                      <option value="out">Clock Out</option>
                    </select>
                    <input type="datetime-local" value={toLocalInputValue(addingPunch.datetime)} onChange={e => { const iso = fromLocalInputValue(e.target.value); if (iso) setAddingPunch(p => p ? { ...p, datetime: iso } : p) }} className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" />
                  </div>
                  <input type="text" placeholder="Note (optional)" value={addingPunch.note} onChange={e => setAddingPunch(p => p ? { ...p, note: e.target.value } : p)} className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" />
                  {new Date(addingPunch.datetime).getHours() < 5 && (
                    <p className="text-xs text-amber-400">⚠ This time is before 5 AM — double-check AM vs PM.</p>
                  )}
                  <div className="flex gap-2">
                    <button onClick={addPunch} className="bg-blue-600 hover:bg-blue-500 text-[#fff] text-sm px-4 py-1.5 rounded-lg transition-colors">Add</button>
                    <button onClick={() => setAddingPunch(null)} className="text-gray-500 hover:text-white text-sm px-3 py-1.5 transition-colors">Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    const isCurrentEditWeek = toDateStr(editWeekStart) === toDateStr(getWeekStart())
                    const defaultDt = isCurrentEditWeek ? new Date() : new Date(editWeekStart)
                    defaultDt.setHours(8, 0, 0, 0)
                    setAddingPunch({ type: 'in', datetime: defaultDt.toISOString(), note: '' })
                  }}
                  className="w-full border border-dashed border-gray-700 hover:border-gray-600 rounded-lg py-2 text-sm text-gray-500 hover:text-gray-400 transition-colors"
                >+ Add Punch</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
