/**
 * A made-up route for the App Store / Google Play reviewers' account ONLY.
 *
 * Why (Ben, Oct 22 2026): the car screens (CarPlay / Android Auto) show the
 * signed-in tech's Work Orders day, and the reviewers' account
 * (reviewer@lynxedo.com) sits in Heroes with no Work Orders and no route — so a
 * reviewer would see an empty car screen and reject. Giving it a real Heroes
 * day would be worse: On my way would text a real customer.
 *
 * ⚠ So this account alone gets SAMPLE stops (made-up names, public places), and
 * On my way on a sample stop answers "sent" WITHOUT texting anyone. The account
 * still has no Work Orders grant, so every real stop stays a 403 for it.
 * Nobody else can ever see or trigger any of this: it keys on one user id.
 */
export const APP_REVIEW_USER_ID = 'aaaaaaaa-0000-0000-0000-000000000099'

export const isAppReviewer = (userId: string | null | undefined) => userId === APP_REVIEW_USER_ID

/** Sample stop ids all start with this, so they can never collide with a real stop's uuid. */
const SAMPLE_PREFIX = 'sample-'

export const isSampleStopId = (id: string) => id.startsWith(SAMPLE_PREFIX)

type SampleStop = {
  id: string
  client_name: string
  address: string
  lat: number
  lng: number
  hour: number
}

// Public places in The Woodlands, TX — never a customer's house.
const SAMPLES: SampleStop[] = [
  { id: `${SAMPLE_PREFIX}1`, client_name: 'Sample Stop · Demo Customer A', address: '2099 Lake Robbins Dr, The Woodlands, TX 77380', lat: 30.1636, lng: -95.4651, hour: 9 },
  { id: `${SAMPLE_PREFIX}2`, client_name: 'Sample Stop · Demo Customer B', address: '1201 Lake Woodlands Dr, The Woodlands, TX 77380', lat: 30.1617, lng: -95.4589, hour: 11 },
  { id: `${SAMPLE_PREFIX}3`, client_name: 'Sample Stop · Demo Customer C', address: '4 Waterway Square Pl, The Woodlands, TX 77380', lat: 30.1611, lng: -95.4627, hour: 14 },
]

/** The /api/hub/car/stops body for the reviewer: today's date, fixed times. */
export function sampleCarStops(now = new Date()) {
  const day = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) // YYYY-MM-DD
  return {
    stops: SAMPLES.map((s) => ({
      id: s.id,
      client_name: s.client_name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      // Central is UTC-5 or -6; a fixed -05:00 offset only nudges the shown time by an hour in winter.
      scheduled_start_at: `${day}T${String(s.hour).padStart(2, '0')}:00:00-05:00`,
      in_progress: false,
      can_text: true,
      on_my_way_sent_at: null,
      on_my_way_eta_minutes: null,
    })),
    remaining: SAMPLES.length,
    total: SAMPLES.length,
    omw_etas: [10, 20, 30],
  }
}

/** What On my way answers for a sample stop — same shape as a real send, nothing sent. */
export function sampleOnMyWay(id: string, eta: number) {
  const s = SAMPLES.find((x) => x.id === id)
  if (!s) return null
  return {
    stop: { id: s.id, on_my_way_sent_at: new Date().toISOString(), on_my_way_eta_minutes: eta },
    message_sent: true,
    sample: true,
    rendered_message: `(Sample stop — no text was sent.) Hi, this is your technician. I'm on my way — should be there in about ${eta} minutes.`,
  }
}
