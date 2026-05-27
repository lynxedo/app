import { NextResponse } from 'next/server'
import { requireAdminArea } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type AnthropicModel = {
  id: string
  display_name?: string
  created_at?: string
  type?: string
}

async function requireGuardianAdmin() {
  const check = await requireAdminArea('guardian')
  if (!check.ok || !check.company_id) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { companyId: check.company_id }
}

/**
 * Annotate a model id with cost/capability labels so the admin UI can render
 * a meaningful dropdown without hardcoding specific model ids.
 */
function labelForModel(id: string): { label: string; flag?: string; family: 'opus' | 'sonnet' | 'haiku' | 'other' } {
  const lower = id.toLowerCase()
  if (lower.includes('opus')) {
    return { label: 'Most capable · highest cost', family: 'opus' }
  }
  if (lower.includes('sonnet')) {
    return { label: 'Recommended · balanced', family: 'sonnet' }
  }
  if (lower.includes('haiku')) {
    return {
      label: 'Fastest · lowest cost',
      flag: 'Not recommended for multi-step tool use',
      family: 'haiku',
    }
  }
  return { label: id, family: 'other' }
}

export async function GET() {
  const ctx = await requireGuardianAdmin()
  if ('error' in ctx) return ctx.error

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `Anthropic models API: ${res.status} ${text.slice(0, 200)}` }, { status: 502 })
    }
    const data = await res.json() as { data?: AnthropicModel[] }
    const models = (data.data ?? []).map(m => {
      const meta = labelForModel(m.id)
      return {
        id: m.id,
        display_name: m.display_name ?? m.id,
        created_at: m.created_at ?? null,
        family: meta.family,
        label: meta.label,
        flag: meta.flag ?? null,
      }
    })
    return NextResponse.json({ models })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to fetch models' },
      { status: 502 }
    )
  }
}
