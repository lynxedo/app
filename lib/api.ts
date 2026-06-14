import { NextResponse } from 'next/server'

// Shared API route error + input-validation helpers (Phase 5, #34).
//
// Before this, ~70% of routes had no try/catch (a thrown error → a raw 500 with a
// stack, surfaced to the user as a blank "something broke") and ~180 didn't guard
// their input. These helpers give every route a consistent, friendly failure shape
// without rewriting auth or business logic. Adopt gradually, busiest routes first.

/**
 * An error a route can throw to return a specific HTTP status with a safe message.
 * Anything else thrown inside a wrapped handler becomes a generic 500.
 */
export class ApiError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type RouteContext = { params: Promise<Record<string, string>> }
type RouteHandler = (request: Request, context: RouteContext) => Promise<Response> | Response

/**
 * Wrap a route handler so any thrown error becomes a clean JSON response instead of
 * an unhandled 500. `ApiError` carries an explicit status + user-safe message;
 * everything else logs server-side and returns a generic 500.
 *
 *   export const POST = withApiHandler(async (request) => { ... })
 */
export function withApiHandler(handler: RouteHandler): RouteHandler {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      console.error('[api] unhandled error', request.method, request.url, err)
      return NextResponse.json(
        { error: 'Something went wrong. Please try again.' },
        { status: 500 },
      )
    }
  }
}

/**
 * Parse a JSON request body, throwing a clean 400 on malformed JSON instead of
 * letting `request.json()`'s SyntaxError bubble up as a 500.
 */
export async function readJson<T = unknown>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new ApiError('Invalid request body.', 400)
  }
}

/**
 * Require a value to be present (non-null, non-empty-string). Throws a clean 400
 * naming the field, so a missing input never produces a confusing downstream crash.
 */
export function required<T>(value: T, field: string): NonNullable<T> {
  if (value === null || value === undefined || value === '') {
    throw new ApiError(`Missing required field: ${field}`, 400)
  }
  return value as NonNullable<T>
}

/**
 * `fetch` with a hard timeout via AbortController. A hung upstream (e.g. the lawn-size
 * service restarting) becomes a clean 504 instead of a request that hangs until the
 * platform kills it. Re-throws non-timeout network errors for the caller / wrapper.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('The service took too long to respond. Please try again.', 504)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
