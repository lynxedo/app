// Lazily-instantiated Stripe client for the platform billing backend (Track 5, M2).
//
// The secret key is per-env: staging carries a Stripe TEST key (sk_test_…), prod a
// LIVE key (sk_live_…). We deliberately do NOT pin an apiVersion — the installed
// `stripe` package default is used so the SDK types and runtime stay in lockstep.
//
// Every billing route/webhook must call stripeConfigured() (or gate on a 503) before
// touching getStripe(), so an env-unset staging box degrades gracefully instead of
// throwing an opaque 500.
import Stripe from 'stripe'

let _stripe: Stripe | null = null

// True when the Stripe secret key is present in the environment.
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

// The shared Stripe client. Throws a clear error if STRIPE_SECRET_KEY is unset so
// callers that forgot the stripeConfigured() gate fail loudly rather than silently.
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set — Stripe billing is not configured.')
  }
  if (!_stripe) {
    _stripe = new Stripe(key)
  }
  return _stripe
}
