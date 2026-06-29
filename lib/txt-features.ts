// Temporary kill-switch for Txt group + broadcast messaging (June 29, 2026).
//
// GROUPS: the "+ Group" feature provisions a real Twilio Conversations
// group-MMS thread — every member's phone is bound to our number, so ANY
// member texting our number gets relayed to all OTHER members. In testing a
// member's ordinary text to the company fanned out to the whole group, which
// is not how we want group messaging to behave, so groups are off until the
// behavior is redesigned.
//
// BROADCASTS: turned off alongside groups at Ben's request for now. The
// broadcast feature itself works (one message to many customers as separate
// 1:1 texts — no group thread); it's only disabled, not broken.
//
// To re-enable either feature, flip its flag back to `true`. Both the Txt
// sidebar buttons and the API route guards read these constants, so a single
// flip restores the feature end-to-end (no other code changes needed).
export const TXT_GROUPS_ENABLED = false
export const TXT_BROADCASTS_ENABLED = false
