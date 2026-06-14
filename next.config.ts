import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright drives a real Chromium binary for the Route Builder's
  // "Send Order Only" flow (lib/jobber-playwright.ts). It must NOT be bundled
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
  headers: async () => [
    {
      source: '/(books|api/qbo)(.*)',
      headers: [{ key: 'Cache-Control', value: 'no-store, no-cache' }],
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
