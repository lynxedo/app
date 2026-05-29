export type FieldType =
  | 'section_title'
  | 'checkbox'
  | 'date'
  | 'dropdown'
  | 'signature'
  | 'short_answer'
  | 'long_answer'

export type FormField = {
  id: string
  type: FieldType
  label: string
  required?: boolean
  options?: string[]
  placeholder?: string
  default_checked?: boolean
}

export type Form = {
  id: string
  company_id: string
  name: string
  description: string | null
  fields: FormField[]
  notification_sms_template: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export const IRRIGATION_TEMPLATE: Pick<Form, 'name' | 'description' | 'active' | 'notification_sms_template' | 'fields'> = {
  name: 'Irrigation Inspection Report',
  description: 'After-service report for irrigation system inspections',
  active: true,
  notification_sms_template:
    'Hi {customer_name}, your irrigation inspection by {tech_name} on {date} is complete. ' +
    'Your system is all set! Questions? Give us a call anytime.',
  fields: [
    { id: 'f1', type: 'section_title', label: 'System Overview' },
    { id: 'f2', type: 'date', label: 'Date of Inspection', required: true },
    { id: 'f3', type: 'short_answer', label: 'Controller Make / Model', placeholder: 'e.g. Rachio 3, Hunter Pro-C' },
    { id: 'f4', type: 'short_answer', label: 'Total Number of Zones', placeholder: 'e.g. 8' },

    { id: 'f5', type: 'section_title', label: 'Zone-by-Zone Inspection' },
    { id: 'f6', type: 'checkbox', label: 'All zones tested' },
    { id: 'f7', type: 'long_answer', label: 'Zone issues found (describe)', placeholder: 'List any zones with problems, or leave blank if none…' },

    { id: 'f8', type: 'section_title', label: 'System Condition' },
    { id: 'f9', type: 'checkbox', label: 'Heads adjusted or replaced' },
    { id: 'f10', type: 'checkbox', label: 'System pressure within normal range' },
    { id: 'f11', type: 'checkbox', label: 'Run times adjusted' },
    { id: 'f12', type: 'checkbox', label: 'Controller programming updated' },

    { id: 'f13', type: 'section_title', label: 'Water Coverage' },
    { id: 'f14', type: 'checkbox', label: 'Coverage adequate overall' },
    { id: 'f15', type: 'long_answer', label: 'Dry areas noted (describe)', placeholder: 'Location and description of dry spots…' },
    { id: 'f16', type: 'checkbox', label: 'Runoff or puddling observed' },

    { id: 'f17', type: 'section_title', label: 'Repairs Made' },
    { id: 'f18', type: 'long_answer', label: 'Parts installed', placeholder: 'e.g. 3× Hunter PGP heads, 1× valve…' },
    { id: 'f19', type: 'long_answer', label: 'Additional repairs recommended', placeholder: 'Recommended future work…' },

    { id: 'f20', type: 'section_title', label: 'Sign-Off' },
    { id: 'f21', type: 'checkbox', label: 'System tested and functioning properly' },
    { id: 'f22', type: 'checkbox', label: 'Customer was present during inspection' },
    { id: 'f23', type: 'long_answer', label: 'Tech notes', placeholder: 'Any additional observations…' },
    { id: 'f24', type: 'signature', label: 'Customer signature' },
  ],
}

export function formatSubmissionAsText(
  form: Form,
  answers: Record<string, string | boolean>,
  meta: { techName: string; customerName?: string; submittedAt?: string }
): string {
  const lines: string[] = [
    `Form: ${form.name}`,
    `Submitted by: ${meta.techName}`,
  ]
  if (meta.submittedAt) lines.push(`Date: ${meta.submittedAt}`)
  if (meta.customerName) lines.push(`Customer: ${meta.customerName}`)

  for (const field of form.fields) {
    if (field.type === 'section_title') {
      lines.push('', `── ${field.label.toUpperCase()} ──`)
      continue
    }
    if (field.type === 'signature') {
      const v = answers[field.id]
      if (v && typeof v === 'string' && v.startsWith('data:image')) {
        lines.push(`${field.label}: [Signature captured]`)
      }
      continue
    }
    const val = answers[field.id]
    if (val === undefined || val === null || val === '') continue
    if (field.type === 'checkbox') {
      lines.push(`${val ? '✓' : '✗'} ${field.label}`)
    } else {
      lines.push(`${field.label}: ${val}`)
    }
  }
  return lines.join('\n').trim()
}

export function renderSmsTemplate(
  template: string,
  vars: { customer_name?: string; tech_name?: string; date?: string; company_name?: string }
): string {
  return template
    .replace(/\{customer_name\}/g, vars.customer_name ?? 'Customer')
    .replace(/\{tech_name\}/g, vars.tech_name ?? 'Your technician')
    .replace(/\{date\}/g, vars.date ?? new Date().toLocaleDateString())
    .replace(/\{company_name\}/g, vars.company_name ?? 'Our team')
}
