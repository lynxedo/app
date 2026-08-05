import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // IN5 — zero-downtime deploy. The build output dir is overridable via
  // NEXT_DIST_DIR so the deploy can build into a SIDE dir (.next-build) while
  // the live .next keeps serving, then atomically swap. Unset (the default,
  // and what `next start` runs with) it resolves to '.next' — identical to the
  // previous behavior. See .github/workflows/deploy*.yml.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Playwright drives a real Chromium binary to render the Daily Log v2 route
  // sheet to a PDF server-side (lib/route-sheet-pdf.ts). It must NOT be bundled
  // by webpack — let Node resolve it from node_modules at runtime.
  serverExternalPackages: ['playwright'],

  // Legacy URL redirects — Admin, Settings, Books, and other tools moved
  // under /hub/* in the Hub UI refactor. Old paths and external/push-notif
  // links keep working via these permanent redirects.
  redirects: async () => [
    { source: '/admin', destination: '/hub/admin', permanent: true },
    { source: '/admin/:path*', destination: '/hub/admin/:path*', permanent: true },
    { source: '/settings', destination: '/hub/settings', permanent: true },
    { source: '/settings/:path*', destination: '/hub/settings/:path*', permanent: true },
    { source: '/books', destination: '/hub/books', permanent: true },
    { source: '/books/:path*', destination: '/hub/books/:path*', permanent: true },
  ],
  // OAuth / MCP discovery documents must live at the well-known paths, but the
  // Next app router ignores dot-prefixed directories — so `app/.well-known/…`
  // would never route. The handlers live under app/api/well-known/* and are
  // surfaced at their canonical paths here.
  rewrites: async () => [
    {
      source: '/.well-known/oauth-protected-resource',
      destination: '/api/well-known/oauth-protected-resource',
    },
    {
      source: '/.well-known/oauth-authorization-server',
      destination: '/api/well-known/oauth-authorization-server',
    },
    // Some clients probe the resource-metadata path with the resource appended.
    {
      source: '/.well-known/oauth-protected-resource/:path*',
      destination: '/api/well-known/oauth-protected-resource',
    },
  ],
  headers: async () => [
    {
      source: '/(books|api/qbo)(.*)',
      headers: [{ key: 'Cache-Control', value: 'no-store, no-cache' }],
    },
    // Tokens and MCP responses must never be cached by a proxy or the browser.
    {
      source: '/api/(mcp|oauth)(.*)',
      headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' }],
    },
    {
      source: '/(.*)',
      headers: [
        // IN1 — `frame-ancestors 'self'` replaces `X-Frame-Options: DENY`. DENY
        // blocked the app's own in-app route-sheet viewer (a same-origin frame)
        // in desktop browsers. This still blocks external sites from framing us
        // (clickjacking) but permits same-origin framing.
        { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // IN2 — HSTS: instruct browsers to only ever reach this domain over HTTPS.
        // Safe because all traffic is HTTPS-only via Cloudflare Tunnel. 1-year
        // max-age is the recommended minimum; preload not added yet.
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        // IN2 — Permissions-Policy: restrict powerful browser features to same-origin
        // only. Camera + microphone allowed for Den (video) and Dialer; geolocation
        // for Fleet and GPS clock-in; payment / usb / serial blocked entirely.
        { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), serial=()' },
        // IN2 — CSP report-only: running in observe mode for at least one week before
        // switching to an enforced `Content-Security-Policy` header. Any violations
        // appear in browser DevTools (Console / Security tab) and can be reviewed
        // before enforcement blocks anything. Covers: Supabase realtime (wss),
        // Mapbox (tiles + events), Twilio (dialer WebRTC), Next.js hydration
        // (unsafe-inline/eval), Tailwind inline styles, R2/CDN images (https:).
        {
          key: 'Content-Security-Policy-Report-Only',
          value: [
            "default-src 'self'",
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.mapbox.com https://events.mapbox.com wss://*.twilio.com https://*.twilio.com",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            "img-src 'self' data: blob: https:",
            "media-src 'self' blob: https:",
            "worker-src 'self' blob:",
            "frame-src 'self'",
            "form-action 'self'",
            "base-uri 'self'",
          ].join('; '),
        },
      ],
    },
  ],
};

export default nextConfig;
