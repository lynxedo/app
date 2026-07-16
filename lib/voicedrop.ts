import { createAdminClient } from '@/lib/supabase/admin'

// VoiceDrop — ringless-voicemail (RVM) provider for Drip Marketing.
//
// Bring-your-own-API-key, exactly like lib/onestepgps.ts: a per-company key
// entered in Admin → Integrations (stored on company_integrations, service-role
// only) wins; otherwise we fall back to a shared env key (dev / single-tenant).
// This is the provider layer ONLY — the drip engine's RVM send branch and the
// builder channel-picker are wired separately, and every call here stays dark
// until a company connects a key.
//
// API base https://api.voicedrop.ai/v1; requests authenticate with a per-request
// `auth-key` header. ⚠ The exact endpoint paths + request/response shapes below
// are the best-known VoiceDrop contract and are flagged `// TODO verify` where
// uncertain — the whole channel is gated dark, so runtime correctness is
// confirmed against developers.voicedrop.ai at the first live call (the same
// approach lib/google-ads.ts takes with its GAQL field paths).

const VOICEDROP_BASE = process.env.VOICEDROP_API_BASE || 'https://api.voicedrop.ai/v1'
const REQUEST_TIMEOUT_MS = 20_000

// Resolve the VoiceDrop API key for a company. A per-company key entered in
// Admin → Integrations wins; otherwise fall back to the shared env key. Mirrors
// resolveOneStepGpsKey exactly (config.api_key, honoring the enabled flag).
export async function resolveVoiceDropKey(companyId: string): Promise<string | null> {
  if (companyId) {
    try {
      const { data } = await createAdminClient()
        .from('company_integrations')
        .select('config, enabled')
        .eq('company_id', companyId)
        .eq('provider', 'voicedrop')
        .maybeSingle()
      const cfg = (data?.config ?? null) as { api_key?: string } | null
      if (cfg?.api_key && data?.enabled !== false) return cfg.api_key
    } catch {
      // fall through to the env key
    }
  }
  return process.env.VOICEDROP_API_KEY ?? null
}

// Low-level authenticated fetch against the VoiceDrop REST API. JSON bodies get a
// Content-Type automatically; a FormData body is left alone so the runtime sets
// the multipart boundary.
async function vdFetch(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('auth-key', key) // TODO verify — VoiceDrop's documented auth header
  const isForm = typeof FormData !== 'undefined' && init.body instanceof FormData
  if (init.body && !isForm && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(`${VOICEDROP_BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

// Pull the provider-side id out of a VoiceDrop response, tolerating the common
// naming variants (top-level or nested under data/result) so a minor doc
// discrepancy doesn't lose the reference we store in drip_sends.provider_ref.
function pickId(data: Record<string, unknown>): string | undefined {
  const nested = (data.data ?? data.result) as Record<string, unknown> | undefined
  const raw =
    data.id ??
    data.message_id ??
    data.messageId ??
    data.voicemail_id ??
    data.ref ??
    nested?.id ??
    nested?.message_id
  return raw == null ? undefined : String(raw)
}

function vdError(data: Record<string, unknown>, status: number): string {
  const msg = data.error ?? data.message ?? data.detail
  return typeof msg === 'string' && msg ? msg : `VoiceDrop returned ${status}`
}

// Validate a raw key with a lightweight authenticated call, for the Admin →
// Integrations save route to run BEFORE persisting (mirrors the OneStepGPS
// key-validation probe). `reachable:false` distinguishes a network failure
// (→ 502) from a rejected key (→ 400).
export async function validateVoiceDropKey(
  key: string,
): Promise<{ ok: boolean; status?: number; reachable: boolean }> {
  try {
    // ⚠ TODO verify — a cheap authenticated GET that 200s for a valid key and
    // 401/403s for a bad one. Listing voicemails fits; swap for an account /
    // balance endpoint if VoiceDrop documents a lighter one.
    const res = await vdFetch(key, '/voicemails', { method: 'GET' })
    return { ok: res.ok, status: res.status, reachable: true }
  } catch {
    return { ok: false, reachable: false }
  }
}

// Upload a static RVM audio file (MP3/WAV) to VoiceDrop and return the stored
// voicemail's id, which is later referenced when sending drops.
export async function uploadVoiceDropAudio(
  companyId: string,
  file: { buffer: Buffer; filename: string; contentType: string },
): Promise<{ ok: boolean; voicemailId?: string; error?: string }> {
  const key = await resolveVoiceDropKey(companyId)
  if (!key) return { ok: false, error: 'VoiceDrop is not connected' }
  try {
    // ⚠ TODO verify — static-audio upload is multipart/form-data with the audio
    // under `file`; VoiceDrop returns the stored voicemail's id. Adjust the field
    // name / response key against developers.voicedrop.ai at the first live upload.
    const form = new FormData()
    // Wrap in a fresh Uint8Array view so the Node Buffer satisfies BlobPart.
    form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.contentType }), file.filename)
    const res = await vdFetch(key, '/voicemails', { method: 'POST', body: form })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) return { ok: false, error: vdError(data, res.status) }
    const voicemailId = pickId(data)
    if (!voicemailId) return { ok: false, error: 'VoiceDrop upload returned no voicemail id' }
    return { ok: true, voicemailId }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'VoiceDrop upload failed' }
  }
}

// Send a ringless voicemail drop of a previously uploaded voicemail to a number.
// Returns the provider reference for the drip_sends ledger.
export async function sendVoiceDropDrop(opts: {
  companyId: string
  phone: string
  voicemailId: string
  callerId: string
  metadata: Record<string, unknown>
}): Promise<{ ok: boolean; providerRef?: string; error?: string }> {
  const key = await resolveVoiceDropKey(opts.companyId)
  if (!key) return { ok: false, error: 'VoiceDrop is not connected' }
  try {
    // ⚠ TODO verify — best-known VoiceDrop static-drop shape:
    // POST /ringless-voicemail with the destination, the caller ID shown on the
    // missed call, and the uploaded voicemail's id. `foreign_id` carries our own
    // record id for webhook correlation; the rest of metadata rides along.
    const foreignId =
      typeof opts.metadata.foreign_id === 'string'
        ? opts.metadata.foreign_id
        : typeof opts.metadata.enrollment_id === 'string'
          ? opts.metadata.enrollment_id
          : undefined
    const body: Record<string, unknown> = {
      phone_number: opts.phone,
      caller_id: opts.callerId,
      voicemail_id: opts.voicemailId,
      metadata: opts.metadata,
    }
    if (foreignId) body.foreign_id = foreignId
    const res = await vdFetch(key, '/ringless-voicemail', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) return { ok: false, error: vdError(data, res.status) }
    return { ok: true, providerRef: pickId(data) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'VoiceDrop send failed' }
  }
}

// Check a destination number against VoiceDrop's validation / DNC suppression
// before dropping. FAIL-OPEN by design: a number is only rejected when VoiceDrop
// explicitly says it's undeliverable, so a wrong endpoint guess (or a missing
// key / network blip) can never silently drop a legitimate voicemail.
export async function validateVoiceDropNumber(
  companyId: string,
  phone: string,
): Promise<{ ok: boolean; reason?: string }> {
  const key = await resolveVoiceDropKey(companyId)
  if (!key) return { ok: true } // no key configured → don't block
  try {
    // ⚠ TODO verify — VoiceDrop advertises built-in phone validation + DNC
    // suppression. If the documented endpoint/shape differs (or doesn't exist),
    // this stays fail-open (see the function contract above).
    const res = await vdFetch(key, '/phone-validation', {
      method: 'POST',
      body: JSON.stringify({ phone_number: phone }),
    })
    if (!res.ok) return { ok: true } // treat validator errors as fail-open
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    const valid = data.valid ?? data.is_valid ?? data.deliverable
    if (valid === false) {
      return { ok: false, reason: typeof data.reason === 'string' ? data.reason : 'Number not deliverable' }
    }
    return { ok: true }
  } catch {
    return { ok: true } // fail-open on any network / parse error
  }
}
