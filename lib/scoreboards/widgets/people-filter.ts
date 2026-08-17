/* "Only count these people" — the shared person filter for every widget that has
 * a person dimension.
 *
 * Ben, after seeing it on the tracked-item cards: "I found the same thing in other
 * widgets. Like Visit revenue by technician. So I want you to take a pass at all
 * widgets and make sure we can filter the results down to just one person or a
 * group of people."
 *
 * ⚠⚠ THE SAFETY PROPERTY, and the reason this can be applied uniformly: the filter
 * is a NARROWING of rows the viewer has already been sent. It is applied in the pure
 * metric layer, never pushed into a query, so it can only ever remove rows — it can
 * never reach for a person the source withheld. That matters most on People
 * Performance, where `sources.ts` strips colleagues' rows **in the source** unless
 * the viewer holds team view: a filtered card composes with that narrowing instead of
 * bypassing it, because the colleague's row never arrives in the first place.
 *
 * ⚠ Being metric-level also means a card for Angel and a card for Josh still share
 * ONE round trip, since the source request is unchanged by the filter.
 *
 * ⚠⚠ THREE CATALOGS, NOT ONE, and this is deliberate. The same human appears under
 * different names in different systems — "Angel" on a Lead Tracker card, "Angel
 * Morin" as a Jobber user, "Angel Morin" on the employee roster. A single merged
 * picker would either list one person three times or need fuzzy name matching, and
 * fuzzy-matching PEOPLE is how two colleagues who share a first name get silently
 * merged into one number. So each widget offers the catalog of names its own chart
 * actually displays, and matching is exact (bar case and padding).
 */

import type { ConfigField, WidgetConfig } from './types'
import type { CatalogName } from './types'

/**
 * The bucket a record with nobody credited lands in.
 *
 * ⚠ Doubles as the value you tick to count exactly those, so the picker, the filter
 * and the chart all name it with one string. A real person called this would merge
 * with the bucket — a trade taken knowingly over inventing a sentinel that could
 * surface in the UI.
 */
export const NO_SELLER = 'No salesperson recorded'

/** Same idea on the field/crew side, where the gap is an unassigned visit. */
export const NO_TECH = 'Nobody assigned'

/** Case- and padding-insensitive: the Tracker holds "Kathryn" and "kathryn" as one. */
export const personKey = (s: string): string => s.trim().toLowerCase()

/**
 * The config field to spread into a widget's schema.
 *
 * `catalog` decides which names are offered — see the note above on why that is
 * per-family rather than one shared list.
 */
export function peopleField(catalog: CatalogName, noun = 'people'): ConfigField {
  return {
    kind: 'catalog',
    label: `Only include these ${noun}`,
    def: [],
    catalog,
    hint: `Leave empty for everyone. Tick one name for their own card, or several for a crew.`,
  }
}

export type PersonFilter = {
  active: boolean
  /** Normalised keys to keep. Empty when inactive. */
  keys: Set<string>
  /** The names as ticked, for labels. */
  names: string[]
}

export function personFilter(cfg: WidgetConfig, key = 'people'): PersonFilter {
  const raw = cfg[key]
  const names = Array.isArray(raw) ? raw.map(String).map(s => s.trim()).filter(Boolean) : []
  return { active: names.length > 0, keys: new Set(names.map(personKey)), names }
}

/**
 * Does this person survive the filter?
 *
 * ⚠ An INACTIVE filter keeps everyone. This is the single most important line in the
 * file: read the other way round, an empty selection would mean "nobody" and every
 * unfiltered card in the product would render zero — a total, silent failure. It is
 * asserted in the test suite for exactly that reason.
 *
 * ⚠ A name that matches nobody yields an empty result rather than falling back to
 * everyone. Both directions of that mistake are silent, and this is the safer one:
 * an obviously-empty card gets reported in a minute, whereas a card quietly showing
 * the whole company under one person's name would be believed.
 */
export function keepPerson(f: PersonFilter, name: string | null | undefined, fallback: string): boolean {
  if (!f.active) return true
  return f.keys.has(personKey(name?.trim() || fallback))
}

/**
 * The phrase appended to a filtered card's subtitle, or null when unfiltered.
 *
 * ⚠ Always shown on a filtered card. A tile reading "3" is unremarkable for a
 * company and excellent for one person, and nothing else on the card distinguishes
 * the two — an undisclosed filter is how someone concludes sales collapsed.
 */
export function peoplePhrase(f: PersonFilter): string | null {
  if (!f.active) return null
  if (f.names.length === 1) return `${f.names[0]} only`
  if (f.names.length <= 3) return `${f.names.join(' + ')} only`
  return `${f.names.length} people only`
}

/** Just the names, for a title: "Angel" or "Angel + Josh" or "4 people". */
export function peopleTitleSuffix(f: PersonFilter): string | null {
  if (!f.active) return null
  if (f.names.length === 1) return f.names[0]
  if (f.names.length <= 3) return f.names.join(' + ')
  return `${f.names.length} people`
}

/** Append `only …` to an existing subtitle, keeping the separator consistent. */
export function withPeople(sub: string, f: PersonFilter): string {
  const p = peoplePhrase(f)
  return p ? `${sub} · ${p}` : sub
}

/**
 * Put the filter in the card's TITLE too.
 *
 * ⚠ The subtitle alone isn't enough on a tile: a card headed "Hours Clocked" showing
 * 421 reads as the company's figure at a glance, and a glance is all a scoreboard
 * gets. Unfiltered titles are returned untouched, so every existing card is
 * byte-identical.
 */
export function withPeopleTitle(title: string, f: PersonFilter): string {
  const s = peopleTitleSuffix(f)
  return s ? `${title} — ${s}` : title
}
