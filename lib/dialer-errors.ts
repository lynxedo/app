// #40 — turn raw dialer/Twilio error codes into plain English for the office
// staff. The Twilio Voice SDK and our token endpoint surface machine codes like
// `token_fetch_failed_401` or `AccessTokenInvalid`; staff shouldn't see those.
// The raw string is still logged at the call site — this is display-only.

// Friendly copy keyed by a substring of the raw error (codes vary by source).
const PATTERNS: Array<{ match: RegExp; message: string }> = [
  { match: /token_fetch_failed_401|token_fetch_failed_403|AccessTokenInvalid|AccessTokenExpired|31204|20101/i,
    message: 'Phone sign-in expired. Try again, or reload the page.' },
  { match: /token_fetch_failed/i,
    message: 'Couldn’t start the phone. Check your connection and try again.' },
  { match: /device_init_failed|registrationFailed|31000|31005|31009/i,
    message: 'Couldn’t connect to the phone service. Try again in a moment.' },
  { match: /micro|getUserMedia|NotAllowed|permission/i,
    message: 'Microphone access is blocked. Allow the mic in your browser, then retry.' },
  { match: /network|offline|31003|53000|53405/i,
    message: 'Network problem reaching the phone service. Check your connection.' },
  { match: /busy|31486/i, message: 'The line is busy.' },
  { match: /no-?answer|timeout|31487/i, message: 'No answer.' },
  { match: /rejected|31603|declin/i, message: 'The call was declined.' },
]

export function friendlyCallError(raw: string | null | undefined): string {
  if (!raw) return 'Something went wrong with the phone. Try again.'
  for (const { match, message } of PATTERNS) {
    if (match.test(raw)) return message
  }
  // Unmapped: a clean, generic line rather than a raw code.
  return 'Something went wrong with the phone. Try again.'
}
