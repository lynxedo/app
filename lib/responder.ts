export type ResponderSettings = {
  id: string
  company_id: string
  is_active: boolean
  business_days: number[]       // 0=Sun, 1=Mon … 6=Sat
  business_hours_start: string  // 'HH:MM'
  business_hours_end: string    // 'HH:MM'
  business_hours_template: string
  afterhours_template: string
  voicemail_greeting: string
}

export type ResponderCall = {
  id: string
  call_sid: string | null
  from_number: string | null
  called_at: string
  has_voicemail: boolean
  text_sent: boolean
  email_sent: boolean
  template_used: string | null
  error_message: string | null
}

export const RESPONDER_DEFAULTS: Omit<ResponderSettings, 'id' | 'company_id'> = {
  is_active: false,
  business_days: [1, 2, 3, 4, 5],
  business_hours_start: '08:00',
  business_hours_end: '17:00',
  business_hours_template:
    "Hi {first_name}, thanks for calling Heroes Lawn Care! We received your call and will get back to you shortly. Feel free to text us at this number for a faster response.",
  afterhours_template:
    "Hi {first_name}, thanks for calling Heroes Lawn Care! We're currently closed but will call you back first thing in the morning. You're welcome to text us at this number anytime.",
  voicemail_greeting:
    "Thanks for calling Heroes Lawn Care! Please leave a message after the beep and we'll get back to you soon.",
}

export function isInBusinessHours(settings: {
  business_days: number[]
  business_hours_start: string
  business_hours_end: string
}): boolean {
  const now = new Date()
  const tz = 'America/Chicago'

  const weekdayStr = now.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' })
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const dayNum = dayMap[weekdayStr] ?? -1

  const timeStr = now.toLocaleTimeString('en-US', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = timeStr.split(':')
  const currentMinutes = (parseInt(parts[0], 10) % 24) * 60 + parseInt(parts[1], 10)

  const [startH, startM] = settings.business_hours_start.split(':').map(Number)
  const [endH, endM] = settings.business_hours_end.split(':').map(Number)

  return (
    settings.business_days.includes(dayNum) &&
    currentMinutes >= startH * 60 + startM &&
    currentMinutes < endH * 60 + endM
  )
}

export function renderTemplate(template: string, vars: { first_name?: string | null }): string {
  return template.replace(/{first_name}/g, vars.first_name || 'there')
}
