// Jobber Playwright session manager.
//
// The Route Builder's "Send Order Only" mode reorders anytime visits in Jobber.
// Jobber's public OAuth GraphQL API does NOT expose the `editAppointment` mutation
// that controls anytime stop order — it only lives in Jobber's internal web
// session schema. The workaround: a headless browser logs into Jobber with a
// dedicated bot account and fires the mutation from inside the authenticated
// session, where session cookies satisfy the gate.
//
// Confirmed working May 27, 2026: chained editAppointment mutations correctly
// updated `overrideOrder` on a real 6-stop route with no Jobber page refresh.
//
// Env vars (set on VPS, NOT committed):
//   JOBBER_BOT_EMAIL
//   JOBBER_BOT_PASSWORD
//   JOBBER_GRAPHQL_VERSION   (optional, defaults to "2026-04-22")
//
// Bot account must have:
//   - 2FA disabled
//   - access to the visits being reordered

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'

const JOBBER_BASE = 'https://secure.getjobber.com'
const JOBBER_LOGIN_URL = `${JOBBER_BASE}/login`
const JOBBER_AFTER_LOGIN_URL = `${JOBBER_BASE}/work_orders`
const JOBBER_GRAPHQL_VERSION = process.env.JOBBER_GRAPHQL_VERSION ?? '2026-04-22'

const REORDER_MUTATION = `
  mutation AppointmentEditOrder($appointmentId: EncodedId!, $sortRule: AppointmentSortRuleInput) {
    editAppointment(appointmentId: $appointmentId, sortInput: $sortRule) {
      userErrors { message path }
      appointment { id overrideOrder }
    }
  }
`

let browser: Browser | null = null
let context: BrowserContext | null = null
// Serialize all access — Playwright launch + login is not safe to run twice
// concurrently against the same singletons.
let inflight: Promise<unknown> | null = null

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  while (inflight) {
    try { await inflight } catch { /* ignore prior failures */ }
  }
  const p = fn()
  inflight = p
  try {
    return await p
  } finally {
    if (inflight === p) inflight = null
  }
}

async function ensureBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  browser.on('disconnected', () => {
    browser = null
    context = null
  })
  return browser
}

async function login(): Promise<BrowserContext> {
  const email = process.env.JOBBER_BOT_EMAIL
  const password = process.env.JOBBER_BOT_PASSWORD
  if (!email || !password) {
    throw new Error('JOBBER_BOT_EMAIL or JOBBER_BOT_PASSWORD not configured on the server')
  }

  const b = await ensureBrowser()
  if (context) {
    await context.close().catch(() => {})
    context = null
  }
  context = await b.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })

  const page = await context.newPage()
  try {
    await page.goto(JOBBER_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    // Login form selectors — Jobber is a Rails app; common selector patterns
    const emailSel = 'input[type="email"], input[name="user[email]"], #user_email'
    const passSel = 'input[type="password"], input[name="user[password]"], #user_password'
    const submitSel =
      'button[type="submit"], input[type="submit"][name="commit"], button[data-test="login"]'

    await page.locator(emailSel).first().fill(email)
    await page.locator(passSel).first().fill(password)
    await page.locator(submitSel).first().click()

    // Wait for navigation away from /login
    await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 30_000 })
  } finally {
    await page.close().catch(() => {})
  }

  return context
}

async function ensureSession(): Promise<BrowserContext> {
  if (context) {
    // Probe a known authenticated page; if we land on /login the session is dead.
    const probe = await context.newPage()
    try {
      await probe.goto(JOBBER_AFTER_LOGIN_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      })
      if (!probe.url().includes('/login')) {
        return context
      }
    } catch {
      // fall through to re-login
    } finally {
      await probe.close().catch(() => {})
    }
  }
  return login()
}

export interface ReorderResult {
  visitId: string
  success: boolean
  overrideOrder?: number
  error?: string
}

interface EvalResult {
  ok: boolean
  status: number
  body: string
}

async function fireReorder(
  page: Page,
  appointmentId: string,
  anchoredAppointmentId: string,
): Promise<EvalResult> {
  return page.evaluate(
    async ({ query, variables, version }) => {
      const r = await fetch('/api/graphql', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-JOBBER-GRAPHQL-VERSION': version,
        },
        body: JSON.stringify({ query, variables }),
      })
      return { ok: r.ok, status: r.status, body: await r.text() }
    },
    {
      query: REORDER_MUTATION,
      variables: {
        appointmentId,
        sortRule: { anchoredAppointmentId, relativePosition: 'AFTER' },
      },
      version: JOBBER_GRAPHQL_VERSION,
    },
  )
}

/**
 * Set the route order in Jobber for the given list of visit EncodedIds.
 * Fires N-1 mutations: visitIds[i] AFTER visitIds[i-1].
 * Returns one result row per input visit (first stop reported as success
 * since it implicitly anchors the chain).
 */
export async function setRouteOrder(visitIds: string[]): Promise<ReorderResult[]> {
  if (visitIds.length === 0) return []
  if (visitIds.length === 1) return [{ visitId: visitIds[0], success: true }]

  return withLock(async () => {
    let ctx: BrowserContext
    try {
      ctx = await ensureSession()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'login_failed'
      return visitIds.map(id => ({ visitId: id, success: false, error: msg }))
    }

    let page: Page = await ctx.newPage()
    const results: ReorderResult[] = [{ visitId: visitIds[0], success: true }]
    let triedRelogin = false

    try {
      // Navigate to any authenticated Jobber page so /api/graphql calls inherit
      // the session cookies via credentials: 'include'.
      await page.goto(JOBBER_AFTER_LOGIN_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      })

      for (let i = 1; i < visitIds.length; i++) {
        const appointmentId = visitIds[i]
        const anchored = visitIds[i - 1]
        let res: EvalResult
        try {
          res = await fireReorder(page, appointmentId, anchored)
        } catch (err) {
          results.push({
            visitId: appointmentId,
            success: false,
            error: err instanceof Error ? err.message : 'eval_failed',
          })
          continue
        }

        // 401 = session died mid-stream. Re-login once and retry this mutation.
        if (res.status === 401 && !triedRelogin) {
          triedRelogin = true
          try {
            await page.close().catch(() => {})
            await login()
            page = await context!.newPage()
            await page.goto(JOBBER_AFTER_LOGIN_URL, {
              waitUntil: 'domcontentloaded',
              timeout: 20_000,
            })
            res = await fireReorder(page, appointmentId, anchored)
          } catch (err) {
            results.push({
              visitId: appointmentId,
              success: false,
              error: err instanceof Error ? err.message : 'relogin_failed',
            })
            for (let j = i + 1; j < visitIds.length; j++) {
              results.push({
                visitId: visitIds[j],
                success: false,
                error: 'skipped_due_to_auth',
              })
            }
            return results
          }
        }

        if (!res.ok) {
          results.push({
            visitId: appointmentId,
            success: false,
            error: `http_${res.status}`,
          })
          continue
        }

        let parsed: {
          data?: {
            editAppointment?: {
              userErrors?: Array<{ message: string }>
              appointment?: { id: string; overrideOrder?: number }
            }
          }
          errors?: Array<{ message: string }>
        }
        try {
          parsed = JSON.parse(res.body)
        } catch {
          results.push({
            visitId: appointmentId,
            success: false,
            error: 'invalid_json_response',
          })
          continue
        }

        if (parsed.errors?.length) {
          results.push({
            visitId: appointmentId,
            success: false,
            error: parsed.errors[0].message,
          })
          continue
        }

        const userErrors = parsed.data?.editAppointment?.userErrors
        if (userErrors && userErrors.length > 0) {
          results.push({
            visitId: appointmentId,
            success: false,
            error: userErrors[0].message,
          })
          continue
        }

        results.push({
          visitId: appointmentId,
          success: true,
          overrideOrder: parsed.data?.editAppointment?.appointment?.overrideOrder,
        })
      }
    } finally {
      await page.close().catch(() => {})
    }

    return results
  })
}
