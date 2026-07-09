// Kill-switch for Txt group messaging (June 29, 2026).
//
// GROUPS: the "+ Group" feature provisions a real Twilio Conversations
// group-MMS thread — every member's phone is bound to our number, so ANY
// member texting our number gets relayed to all OTHER members. In testing a
// member's ordinary text to the company fanned out to the whole group, which
// is not how we want group messaging to behave, so groups are off until the
// behavior is redesigned.
//
// BROADCASTS moved to the Beta ring (July 9, 2026): they're now gated by the
// `txt_broadcasts` beta feature flag (per-user opt-in via Settings → Beta
// Features, admin kill-switch via Admin → Beta), NOT this static constant. See
// lib/beta-flags.ts + the broadcast routes/pages/sidebar, which resolve the
// flag per user. This file only carries the groups switch now.
//
// To re-enable groups, flip the flag back to `true`. Both the Txt sidebar
// button and the start-group API guard read this constant.
export const TXT_GROUPS_ENABLED = false
