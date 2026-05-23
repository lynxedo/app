// Bidirectional mention translation for Chat Synx.
//
// Hub stores mentions as plain "@Firstname" text; Slack uses <@U12345>. Hub's
// broadcast is "@room"; Slack uses <!channel> / <!here> / <!everyone>.
// Without translation, mentions show as ugly literal tags AND don't fire
// notifications on the other side. These helpers convert in both directions.
//
// Outbound (Hub → Slack): scan content for @firstname, look up the Hub user
// by first-name match (display_name's first space-separated token, case-
// insensitive), find their slack_user_id via chat_synx_user_links, replace
// with <@U…>. Replace @room with <!channel>.
//
// Inbound (Slack → Hub): scan event.text for <@U…>, look up the linked Hub
// user, replace with @Firstname. Replace <!channel>/<!here>/<!everyone>
// with @room so the existing inbound push fan-out picks it up.
//
// First-name collisions: Heroes' convention is to append a last initial
// ("Ben S") when two people share a first name. This means the first
// space-separated token is unique within a company, so a simple
// first-name-token equality match works.

import { createAdminClient } from '@/lib/supabase/admin'

const MENTION_RE = /@(\w+)/g
const SLACK_USER_RE = /<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g
const SLACK_BROADCAST_RE = /<!(channel|here|everyone)>/g

// Translate a Hub message body into Slack syntax for outbound posting.
// companyId scopes the user lookup so we never cross-match a user from
// another company.
export async function translateHubToSlack(content: string, companyId: string): Promise<string> {
  if (!content) return content

  // First pass: @room → <!channel>. Use word-boundary so @roomate isn't matched.
  let out = content.replace(/(^|\W)@room(?=\W|$)/gi, (_m, pre) => `${pre}<!channel>`)

  // Collect candidate first names from remaining @mentions.
  const candidates = new Set<string>()
  for (const m of out.matchAll(MENTION_RE)) {
    const name = m[1].toLowerCase()
    if (name === 'room') continue // already handled above
    candidates.add(name)
  }
  if (candidates.size === 0) return out

  const admin = createAdminClient()
  // Batch-fetch all hub_users in this company that have a Chat Synx link.
  // We filter in-app for first-name match (Postgres doesn't natively split
  // display_name); the row count is small per company.
  const { data: users } = await admin
    .from('hub_users')
    .select('id, display_name, chat_synx_user_links(slack_user_id)')
    .eq('company_id', companyId)
    .eq('is_bot', false)
  if (!users) return out

  type UserRow = {
    display_name: string
    chat_synx_user_links:
      | { slack_user_id: string }
      | { slack_user_id: string }[]
      | null
  }
  const firstNameToSlackId = new Map<string, string>()
  for (const u of users as unknown as UserRow[]) {
    const link = Array.isArray(u.chat_synx_user_links)
      ? u.chat_synx_user_links[0]
      : u.chat_synx_user_links
    const slackId = link?.slack_user_id
    if (!slackId) continue
    const first = u.display_name.trim().split(/\s+/)[0]?.toLowerCase()
    if (!first) continue
    if (!firstNameToSlackId.has(first)) firstNameToSlackId.set(first, slackId)
  }

  out = out.replace(MENTION_RE, (match, name: string) => {
    const slackId = firstNameToSlackId.get(name.toLowerCase())
    return slackId ? `<@${slackId}>` : match
  })

  return out
}

// Translate an inbound Slack message body into Hub syntax. companyId scopes
// the user lookup. Returns the rewritten text; mentioned users whose link
// isn't found are left as <@U…> (rare — admin can add the link to fix).
export async function translateSlackToHub(text: string, companyId: string): Promise<string> {
  if (!text) return text

  // Broadcasts first — these have no DB dependency.
  let out = text.replace(SLACK_BROADCAST_RE, '@room')

  // Collect slack_user_ids referenced by <@U…> tags.
  const slackIds = new Set<string>()
  for (const m of out.matchAll(SLACK_USER_RE)) slackIds.add(m[1])
  if (slackIds.size === 0) return out

  const admin = createAdminClient()
  // chat_synx_user_links has its own company_id column, so we can scope
  // directly without joining through hub_users.
  const { data: links } = await admin
    .from('chat_synx_user_links')
    .select('slack_user_id, hub_users:hub_user_id(display_name)')
    .in('slack_user_id', Array.from(slackIds))
    .eq('company_id', companyId)

  // supabase-js types FK embeds as arrays even for to-one relationships;
  // PostgREST returns a single object at runtime, so accept either shape.
  type LinkRow = {
    slack_user_id: string
    hub_users: { display_name: string } | { display_name: string }[] | null
  }
  const slackIdToFirstName = new Map<string, string>()
  for (const link of (links ?? []) as unknown as LinkRow[]) {
    const hu = Array.isArray(link.hub_users) ? link.hub_users[0] : link.hub_users
    const name = hu?.display_name
    if (!name) continue
    const first = name.trim().split(/\s+/)[0]
    if (!first) continue
    slackIdToFirstName.set(link.slack_user_id, first)
  }

  out = out.replace(SLACK_USER_RE, (match, slackId: string) => {
    const first = slackIdToFirstName.get(slackId)
    return first ? `@${first}` : match
  })

  return out
}
