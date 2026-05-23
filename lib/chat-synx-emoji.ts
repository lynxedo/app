// Bidirectional emoji translation for Chat Synx reactions.
//
// Hub stores reactions as native unicode emoji ("👍"). Slack's reactions API
// uses shortcode names ("+1", "thumbsup"). emoji-mart provides both an
// `emojis` map (id → { skins: [{ native }] }) and an `aliases` map
// (alternateName → canonicalId). Most Slack standard aliases are present in
// `aliases`, so a two-step lookup handles the long tail.
//
// Built once at module load. The data package is several hundred KB but is
// already a dependency for the emoji picker.

import data from '@emoji-mart/data'

type EmojiData = {
  emojis: Record<string, { skins?: { native?: string }[] }>
  aliases?: Record<string, string>
}

const typed = data as unknown as EmojiData

const nativeToIdMap = new Map<string, string>()
for (const [id, entry] of Object.entries(typed.emojis)) {
  const native = entry.skins?.[0]?.native
  if (native && !nativeToIdMap.has(native)) nativeToIdMap.set(native, id)
}

const aliases = typed.aliases ?? {}

// Resolve a Slack reaction name (e.g. "thumbsup", "+1", "tada") to a Hub
// unicode emoji ("👍"). Returns null for custom or unknown emojis.
export function slackToNative(shortcode: string): string | null {
  // Strip skin-tone suffix Slack appends (e.g. "+1::skin-tone-3"). Hub stores
  // the default skin tone only, so we drop the variant — better UX than
  // dropping the reaction entirely.
  const bare = shortcode.split('::')[0]
  const canonical = aliases[bare] ?? bare
  const native = typed.emojis[canonical]?.skins?.[0]?.native
  return native ?? null
}

// Resolve a Hub unicode emoji ("👍") to a Slack reaction name ("+1"). Returns
// null when the emoji isn't in the emoji-mart catalog (rare — usually only
// custom Hub-only renderings).
export function nativeToSlack(native: string): string | null {
  return nativeToIdMap.get(native) ?? null
}
