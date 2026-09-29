// Neighborhood lookup — which of the company's own map neighborhoods an address
// falls in. Read-only; the map is the company's (Admin → AI → Knowledge).

import type { HubAction } from './types'
import { str } from './types'
import { lookupNeighborhood } from '@/lib/neighborhood-map'

function miles(metres: number): string {
  const mi = metres / 1609.34
  return mi < 0.1 ? `${Math.round(metres * 3.281)} ft` : `${mi.toFixed(1)} mi`
}

export const lookupNeighborhoodAction: HubAction = {
  name: 'lookup_neighborhood',
  description:
    "Say which of this company's neighborhoods an address is in, using the company's own neighborhood " +
    'map (the polygons the office drew). Pass a full street address — house number, street, city, and ' +
    'zip if you have it. If the user names a customer instead of an address, get their address with ' +
    'find_contact first. ' +
    'NEVER guess a neighborhood from a zip code, city, or street name — these are hand-drawn areas that ' +
    'share zip codes. If this tool says the address is outside the map or could not be placed, say so ' +
    'plainly rather than offering a best guess.',
  input_schema: {
    type: 'object',
    properties: {
      address: { type: 'string', description: 'The full street address to look up.' },
    },
    required: ['address'],
  },
  kind: 'read',
  gate: null,
  consentLabel: 'look up which neighborhood an address is in',
  run: async (ctx, args) => {
    const address = str(args, 'address')
    if (!address) return 'Provide a full street address to look up.'

    const r = await lookupNeighborhood(ctx.admin, ctx.actor.companyId, address)
    if (r.status === 'no_map') {
      return 'This company has not uploaded a neighborhood map yet (Admin → AI → Knowledge), so there is nothing to look it up against. Do not guess.'
    }
    if (r.status === 'not_geocoded') {
      return `"${address}" could not be placed on the map to a specific house — check the house number, street, and zip. Do not guess a neighborhood from the city or zip.`
    }

    const border = r.nearBorder.length
      ? ` It sits within about 300 ft of the ${r.nearBorder.join(' / ')} border, so mention that it is close to the line.`
      : ''
    if (r.status === 'found') return `${address} is in **${r.matches[0]}**.${border}`
    if (r.status === 'overlap') {
      return `${address} falls where two drawn areas overlap: ${r.matches.join(' and ')}. Tell the user both — the map itself is ambiguous here.`
    }
    return (
      `${address} is outside every neighborhood on the map.` +
      (r.nearest ? ` The closest is ${r.nearest.name}, about ${miles(r.nearest.metres)} away — say it is outside the map, not that it is in ${r.nearest.name}.` : '')
    )
  },
}
