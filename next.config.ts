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
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ],
};

export default nextConfig;
