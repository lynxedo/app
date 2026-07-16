import type { createAdminClient } from '@/lib/supabase/admin'

// Drip RVM audio assets — the join between an uploaded MP3/WAV (stored in R2) and
// its VoiceDrop voicemail id. The engine's RVM send branch (wired separately)
// resolves an asset here to get the provider voicemail id + caller ID to drop.
//
// TODO regen types — drip_audio_assets is created in
// supabase/2026-07-16_drip_rvm.sql but not yet in lib/database.types.ts, so the
// table is accessed untyped (cast) and results are shaped to the interfaces here.

type AdminClient = ReturnType<typeof createAdminClient>

export type DripAudioAsset = {
  providerVoicemailId: string
  callerId: string | null
  r2Key: string
}

type DripAudioAssetRow = {
  provider_voicemail_id: string | null
  caller_id_number: string | null
  r2_key: string | null
}

// Resolve a drip_audio_assets row to what the RVM send path needs. Returns null
// when the asset doesn't exist or isn't yet registered with the provider (no
// provider_voicemail_id) — the caller treats that as "not sendable".
export async function getDripAudioAsset(
  admin: AdminClient,
  id: string,
): Promise<DripAudioAsset | null> {
  const { data, error } = await (admin as any)
    .from('drip_audio_assets')
    .select('provider_voicemail_id, caller_id_number, r2_key')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  const row = data as DripAudioAssetRow
  if (!row.provider_voicemail_id || !row.r2_key) return null
  return {
    providerVoicemailId: row.provider_voicemail_id,
    callerId: row.caller_id_number,
    r2Key: row.r2_key,
  }
}
