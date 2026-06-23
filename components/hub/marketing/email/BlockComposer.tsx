'use client'

import { useState } from 'react'
import { Modal, Button, useToast } from '@/components/ui'
import { type EmailDesign, emptyDesign, normalizeDesign } from '@/lib/email-blocks'
import BlockEditor from '@/components/hub/marketing/email/BlockEditor'

export type Template = {
  id: string
  name: string
  subject: string
  design: EmailDesign
  updated_at: string
}

const BASE = '/api/hub/marketing/email/templates'

export default function BlockComposer({
  template, onClose, onSaved,
}: { template: Template | null; onClose: () => void; onSaved: (t: Template) => void }) {
  const toast = useToast()
  const [name, setName] = useState(template?.name || '')
  const [subject, setSubject] = useState(template?.subject || '')
  const [design, setDesign] = useState<EmailDesign>(
    template?.design && (template.design.blocks?.length || template.design.settings)
      ? normalizeDesign(template.design)
      : emptyDesign()
  )
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  async function save() {
    if (!name.trim()) { toast.error('Give the template a name.'); return }
    setSaving(true)
    try {
      const payload = { name: name.trim(), subject: subject.trim(), design }
      const res = template
        ? await fetch(`${BASE}/${template.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not save.'); return }
      toast.success(template ? 'Template updated.' : 'Template created.')
      onSaved(data.template)
    } finally { setSaving(false) }
  }

  async function sendTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/hub/marketing/email/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, design }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) toast.error(data.error || 'Could not send the test.')
      else toast.success(`Test sent to ${data.sent_to}.`)
    } finally { setTesting(false) }
  }

  return (
    <Modal
      open onClose={onClose}
      title={template ? 'Edit template' : 'New template'}
      maxWidth="max-w-4xl"
      fullScreenOnMobile
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <Button variant="ghost" onClick={sendTest} disabled={testing}>{testing ? 'Sending…' : 'Send test to myself'}</Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Template name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring promo"
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Subject line</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Hi {{first_name}}, spring is here"
              className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white" />
          </div>
        </div>

        <BlockEditor design={design} onChange={setDesign} />
      </div>
    </Modal>
  )
}
