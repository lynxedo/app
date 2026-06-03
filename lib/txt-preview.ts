// Shared helper for the denormalized last-message preview shown in the Txt2
// sidebar conversation list. Kept tiny + dependency-free so every message-
// creating route (send, inbound webhook, scheduled, broadcast, dev-inject)
// writes the preview the same way. The matching column is
// txt_conversations.last_message_preview (+ last_message_direction).
//
// We denormalize rather than join the latest message at read time so the
// conversation list stays a single query — same pattern as the existing
// last_message_at / last_inbound_at columns.

const MAX_PREVIEW = 120

// Collapse whitespace + clamp so the stored preview stays short. The sidebar
// also truncates visually to one line; this just keeps the column tidy.
export function buildMessagePreview(
  body: string | null | undefined,
  mediaCount: number
): string {
  const text = (body || '').replace(/\s+/g, ' ').trim()
  if (text) {
    return text.length > MAX_PREVIEW ? text.slice(0, MAX_PREVIEW - 1) + '…' : text
  }
  if (mediaCount > 0) {
    return mediaCount === 1 ? '📷 Photo' : `📷 ${mediaCount} photos`
  }
  return ''
}
