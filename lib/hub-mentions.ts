// NT4 — shared @mention resolver. The old matcher extracted `@(\w+)` tokens and
// compared them to each user's FIRST name only. That (a) pinged everyone who
// shares a first name ("@Mike" → both Mikes), and (b) silently missed names with
// letters `\w` doesn't cover — accented (José) or punctuated (O'Brien).
//
// This resolver instead tests the literal display name against the text, so any
// character works, and prefers a FULL-name match before falling back to a
// first-name match. The Hub message route and the Slack bridge both call this so
// they can't drift.

export type MentionUser = { id: string; display_name: string }

function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
}

// True if `@name` appears in `lowerText` and isn't immediately followed by
// another letter/number (so `@Mike` doesn't match inside `@Mikey`). A trailing
// space, punctuation, or end-of-string all count as a boundary — which lets
// `@mike` match inside `@mike smith` as well, which is what we want.
function containsMention(lowerText: string, lowerName: string): boolean {
  if (!lowerName) return false
  let from = 0
  for (;;) {
    const i = lowerText.indexOf('@' + lowerName, from)
    if (i === -1) return false
    const after = lowerText[i + 1 + lowerName.length]
    if (after === undefined || !/[\p{L}\p{N}]/u.test(after)) return true
    from = i + 1
  }
}

/**
 * Returns the ids of users mentioned in `text`. A full-name mention
 * ("@Mike Smith") resolves to exactly that person; a bare first-name mention
 * ("@Mike") resolves to everyone sharing that first name UNLESS one of them was
 * already pinned by a full-name match (so "@Mike Smith" doesn't also ping Mike
 * Jones). Caller is responsible for excluding the sender + scoping to members.
 */
export function matchMentionedUsers(text: string, users: MentionUser[]): string[] {
  if (!text || !text.includes('@') || users.length === 0) return []
  const lower = text.toLowerCase()
  const matched = new Set<string>()

  // Pass 1 — exact full-name matches (the disambiguating signal).
  for (const u of users) {
    const full = u.display_name.trim().toLowerCase()
    if (containsMention(lower, full)) matched.add(u.id)
  }

  // Pass 2 — first-name matches, skipped when a same-first-name colleague was
  // already matched by full name above.
  for (const u of users) {
    if (matched.has(u.id)) continue
    const first = firstNameOf(u.display_name)
    if (!containsMention(lower, first)) continue
    const fullNameMatchExists = users.some(
      o => firstNameOf(o.display_name) === first && matched.has(o.id)
    )
    if (!fullNameMatchExists) matched.add(u.id)
  }

  return [...matched]
}

/** True if `firstName` is shared by 2+ users (so the composer should insert the
 * full name to disambiguate). */
export function isAmbiguousFirstName(firstName: string, users: MentionUser[]): boolean {
  const f = firstName.trim().toLowerCase()
  let count = 0
  for (const u of users) {
    if (firstNameOf(u.display_name) === f) count++
    if (count > 1) return true
  }
  return false
}
