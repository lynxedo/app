/* Who a scoreboard is about — across the five different names one person has.
 *
 * ⚠⚠ THE PROBLEM THIS SOLVES. A board built for one person carries their name on
 * every card, and the widget library deliberately spells that name five different
 * ways, because each picker offers the names its own chart actually draws (see
 * ./widgets/people-filter.ts, which explains why merging them would be worse). On
 * Lucas's real board: `22a0aa46-…` on the Goals cards, "Lucas Hernandez" on the
 * crew cards, "Lucas" on commission and sales, "Lucas Hernandez" again for Jobber.
 * Duplicating that board for somebody else means re-pointing all of them, and a
 * filter left on the old person renders a plausible, wrong, un-erroring number.
 *
 * ⚠⚠ THREE BRIDGES ARE CERTAIN, TWO ARE RECORDED, NONE ARE GUESSED. Three catalogs
 * can be tied to the roster with certainty because their rows carry `employee_id`.
 * The other two — Jobber user names, and the free text typed into the Lead Tracker's
 * salesperson column — have no link to the roster at all; on Heroes only 2 of 25
 * Jobber users even share an email with an employee row. So those two are answered
 * by a human once and stored (`employee_source_aliases`), never inferred from a
 * name. Matching people by first name is how two colleagues who share one get
 * silently merged into a single number, which is the whole reason the catalogs are
 * separate in the first place — this file must not undo that by the back door.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { getWidgetDef } from './widgets/registry'
import { personKey } from './widgets/people-filter'
import { CATALOG_BRIDGE, isPersonCatalog, type PersonCatalog } from './person-catalogs'
import type { WidgetConfig } from './widgets/types'
import type { CrewLaborRow, PeopleRow } from './widgets/sources'

/** Every value, however old — the same unbounded window the pickers use. */
const ALL_TIME_START = '1900-01-01'
const ALL_TIME_END = '2999-12-31'

export {
  PERSON_CATALOGS, CATALOG_BRIDGE, CATALOG_LABEL, RECORDED_PROMPT, isPersonCatalog,
} from './person-catalogs'
export type { PersonCatalog, Bridge } from './person-catalogs'

export type PersonDirectory = {
  /** employeeId → the exact value each catalog uses for them. Absent = not known. */
  byEmployee: Map<string, Partial<Record<PersonCatalog, string>>>
  /** `${catalog}|${personKey(value)}` → employeeId. The reverse lookup. */
  owner: Map<string, string>
  /** employeeId → how to refer to them in a sentence. */
  label: Map<string, string>
  /** Roster people who could own a board, most recently useful first. */
  roster: { employeeId: string; label: string; isActive: boolean }[]
}

const ownerKey = (catalog: PersonCatalog, value: string) => `${catalog}|${personKey(value)}`

/**
 * Build the whole map in one go — four reads, shared by the clone preview, the
 * clone itself and the mixed-people banner, so all three always agree about who a
 * board is about.
 */
export async function loadPersonDirectory(companyId: string): Promise<PersonDirectory> {
  const admin = createAdminClient()

  const [empRes, crewRes, peopleRes, aliasRes] = await Promise.all([
    admin.from('employees')
      .select('id, first_name, last_name, preferred_name, is_active')
      .eq('company_id', companyId),
    admin.rpc('scoreboard_crew_labor', { p_company_id: companyId, p_start: ALL_TIME_START, p_end: ALL_TIME_END }),
    admin.rpc('scoreboard_people', { p_company_id: companyId, p_start: ALL_TIME_START, p_end: ALL_TIME_END }),
    admin.from('employee_source_aliases').select('employee_id, kind, value').eq('company_id', companyId),
  ])

  const byEmployee: PersonDirectory['byEmployee'] = new Map()
  const owner: PersonDirectory['owner'] = new Map()
  const label: PersonDirectory['label'] = new Map()
  const roster: PersonDirectory['roster'] = []

  const put = (employeeId: string, catalog: PersonCatalog, value: string | null | undefined) => {
    const v = String(value ?? '').trim()
    if (!employeeId || !v) return
    const slot = byEmployee.get(employeeId) ?? {}
    slot[catalog] = v
    byEmployee.set(employeeId, slot)
    // ⚠ First writer wins. Two employees claiming one name would otherwise make the
    // reverse lookup depend on row order; the alias table's unique index stops that
    // for the recorded catalogs, and for the derived ones the source rows are already
    // keyed on employee_id, so a collision here would be a source bug worth not
    // papering over silently — it simply leaves the second person unmapped, which
    // shows up as "couldn't place this name" rather than as the wrong person.
    if (!owner.has(ownerKey(catalog, v))) owner.set(ownerKey(catalog, v), employeeId)
  }

  for (const e of (empRes.data ?? []) as { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null; is_active: boolean | null }[]) {
    // Composed the way the roster reads, for talking ABOUT the person. The value a
    // card actually stores never comes from here — see the note at the top of file.
    const name = [String(e.preferred_name || e.first_name || '').trim(), String(e.last_name || '').trim()]
      .filter(Boolean).join(' ').trim() || 'Unnamed'
    label.set(e.id, name)
    roster.push({ employeeId: e.id, label: name, isActive: e.is_active !== false })
    // The Goals cards store the roster id itself, so this bridge needs no lookup.
    put(e.id, 'goal_people', e.id)
  }

  const crew = crewRes.data as CrewLaborRow | null
  for (const p of crew?.people ?? []) {
    if (p.employee_id) put(p.employee_id, 'staff_people', p.name)
  }

  const people = peopleRes.data as PeopleRow | null
  for (const p of people?.people ?? []) {
    if (p.employee_id) put(p.employee_id, 'commission_plan_people', p.name)
  }

  for (const a of (aliasRes.data ?? []) as { employee_id: string; kind: string; value: string }[]) {
    if (isPersonCatalog(a.kind)) put(a.employee_id, a.kind, a.value)
  }

  roster.sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.label.localeCompare(b.label))

  return { byEmployee, owner, label, roster }
}

/** Which config keys on this widget type hold people, and from which catalog. */
export function personFieldsFor(type: string): { key: string; catalog: PersonCatalog }[] {
  const def = getWidgetDef(type)
  if (!def) return []
  const out: { key: string; catalog: PersonCatalog }[] = []
  for (const [key, field] of Object.entries(def.config ?? {})) {
    // Driven by the registry rather than a hand-kept list, so a person filter added
    // to a new widget is re-pointed by this file without anybody remembering to.
    if (field.kind === 'catalog' && isPersonCatalog(field.catalog)) {
      out.push({ key, catalog: field.catalog })
    }
  }
  return out
}

export type BoardCard = { type: string; span: number; config: WidgetConfig }

export type BoardPersonUse = {
  /** People this board's filters name, busiest first. */
  people: { employeeId: string; label: string; cards: number }[]
  /** Filter values that match nobody on the roster — usually an un-recorded alias. */
  unrecognised: { catalog: PersonCatalog; value: string; cards: number }[]
  /** Cards whose person filter is EMPTY. ⚠ Empty means everyone, not nobody. */
  everyoneCards: number
  /** Cards carrying a person filter at all — the denominator for the rest. */
  filteredCards: number
}

/**
 * Who is this board about? Drives the duplicate dialog, and the banner that warns a
 * board is filtered to more than one person.
 *
 * ⚠ Counts CARDS, not filter values: a card naming a crew of three counts once for
 * each of them, but the number a person reads is "how many cards are about me".
 */
export function analyseBoardPeople(cards: BoardCard[], dir: PersonDirectory): BoardPersonUse {
  const perPerson = new Map<string, number>()
  const perUnknown = new Map<string, { catalog: PersonCatalog; value: string; cards: number }>()
  let everyoneCards = 0
  let filteredCards = 0

  for (const card of cards) {
    const fields = personFieldsFor(card.type)
    if (fields.length === 0) continue
    let hasAny = false
    const seenHere = new Set<string>()
    for (const { key, catalog } of fields) {
      const raw = card.config?.[key]
      const values = Array.isArray(raw) ? raw.map(String).map(s => s.trim()).filter(Boolean) : []
      if (values.length === 0) continue
      hasAny = true
      for (const v of values) {
        const who = dir.owner.get(ownerKey(catalog, v))
        if (who) {
          if (!seenHere.has(who)) { perPerson.set(who, (perPerson.get(who) ?? 0) + 1); seenHere.add(who) }
        } else {
          const k = ownerKey(catalog, v)
          const cur = perUnknown.get(k)
          if (cur) cur.cards += 1
          else perUnknown.set(k, { catalog, value: v, cards: 1 })
        }
      }
    }
    if (hasAny) filteredCards += 1
    else everyoneCards += 1
  }

  return {
    people: [...perPerson.entries()]
      .map(([employeeId, cards]) => ({ employeeId, label: dir.label.get(employeeId) ?? 'Unnamed', cards }))
      .sort((a, b) => b.cards - a.cards || a.label.localeCompare(b.label)),
    unrecognised: [...perUnknown.values()].sort((a, b) => b.cards - a.cards || a.value.localeCompare(b.value)),
    everyoneCards,
    filteredCards,
  }
}

export type RepointChange = {
  catalog: PersonCatalog
  from: string
  to: string
  cards: number
}

export type RepointBlock = {
  catalog: PersonCatalog
  /** The value left in place, still naming the person the board was copied from. */
  value: string
  cards: number
  /** Why it could not be re-pointed, in words the dialog can print. */
  reason: string
}

export type RepointResult = {
  cards: BoardCard[]
  changed: RepointChange[]
  blocked: RepointBlock[]
}

/**
 * Re-point every filter naming `fromEmployeeId` at `toEmployeeId`.
 *
 * ⚠⚠ THREE RULES, each one a way to get this wrong:
 *
 * 1. An EMPTY filter is never filled in, and a filled one is never emptied. Empty
 *    means everyone — clearing a filter would quietly turn a board about one person
 *    into one showing the whole company's figures, which on a commission card is the
 *    company's payroll. Emptiness is left exactly as found.
 * 2. Only values belonging to the source person are touched. A card naming a crew of
 *    three keeps the other two; a card about somebody else entirely is left alone.
 * 3. When the target has no known value for a catalog, the filter KEEPS the old
 *    person and is reported as blocked. Wrong-and-loud beats wrong-and-silent, and
 *    it cannot show anything the copied board did not already show.
 */
export function repointCards(
  cards: BoardCard[],
  dir: PersonDirectory,
  fromEmployeeId: string,
  toEmployeeId: string,
): RepointResult {
  const fromNames = dir.byEmployee.get(fromEmployeeId) ?? {}
  const toNames = dir.byEmployee.get(toEmployeeId) ?? {}
  const changed = new Map<string, RepointChange>()
  const blocked = new Map<string, RepointBlock>()

  const out = cards.map(card => {
    const fields = personFieldsFor(card.type)
    if (fields.length === 0) return card
    let config = card.config
    let touched = false

    for (const { key, catalog } of fields) {
      const raw = config?.[key]
      const values = Array.isArray(raw) ? raw.map(String) : []
      if (values.length === 0) continue // rule 1

      const fromValue = fromNames[catalog]
      if (!fromValue) continue
      const fromK = personKey(fromValue)
      if (!values.some(v => personKey(v) === fromK)) continue // rule 2

      const toValue = toNames[catalog]
      if (!toValue) {
        const k = `${catalog}|${fromK}`
        const cur = blocked.get(k)
        if (cur) cur.cards += 1
        else blocked.set(k, {
          catalog,
          value: fromValue,
          cards: 1,
          reason: CATALOG_BRIDGE[catalog] === 'recorded'
            ? 'nobody has said which name this person goes by here yet'
            : 'this person has no figures in the numbers these cards read',
        })
        continue // rule 3
      }

      const next = values.map(v => (personKey(v) === fromK ? toValue : v))
      // De-duplicate: filtering a crew card to both people and re-pointing one onto
      // the other would otherwise leave the same name twice.
      const seen = new Set<string>()
      const deduped = next.filter(v => {
        const k = personKey(v)
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      if (!touched) { config = { ...config }; touched = true }
      config[key] = deduped

      const k = `${catalog}|${fromK}`
      const cur = changed.get(k)
      if (cur) cur.cards += 1
      else changed.set(k, { catalog, from: fromValue, to: toValue, cards: 1 })
    }

    return touched ? { ...card, config } : card
  })

  return {
    cards: out,
    changed: [...changed.values()].sort((a, b) => b.cards - a.cards),
    blocked: [...blocked.values()].sort((a, b) => b.cards - a.cards),
  }
}
