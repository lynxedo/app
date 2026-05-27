'use client'

import { useEffect, useState } from 'react'

// Route sheet print page.
//
// The Quick Route's "Route Sheet" button writes the full HTML document to
// localStorage with a random key, then opens this page with ?k=<key>. We read
// the HTML out and replace the document with it.
//
// Why not just open the HTML via URL.createObjectURL(blob)? Because the public
// Mapbox token is URL-restricted to lynxedo.com origins. A blob: URL has a
// different origin, so Mapbox rejects the tile requests and the basemap stays
// blank (the route line and pins still render because they're DOM elements).
// Loading the print sheet through this real Next.js route puts us back on the
// lynxedo.com origin and Mapbox tiles load normally.

const NO_DATA_HTML = `
  <div style="padding:24px;font-family:sans-serif;color:#374151;">
    <h1 style="font-size:18px;margin-bottom:8px;">Route sheet not available</h1>
    <p style="font-size:14px;color:#6b7280;">
      Go back to Quick Route and click <strong>Route Sheet</strong> again. Route
      sheet data only lives in this browser for a few minutes after you generate it.
    </p>
  </div>
`

export default function PrintRouteSheetPage() {
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const run = () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const key = params.get('k')
        if (!key) {
          document.open()
          document.write(NO_DATA_HTML)
          document.close()
          return
        }
        const raw = localStorage.getItem(key)
        if (!raw) {
          document.open()
          document.write(NO_DATA_HTML)
          document.close()
          return
        }

        let payload: { html?: string }
        try {
          payload = JSON.parse(raw)
        } catch {
          document.open()
          document.write(NO_DATA_HTML)
          document.close()
          return
        }
        if (!payload.html || typeof payload.html !== 'string') {
          document.open()
          document.write(NO_DATA_HTML)
          document.close()
          return
        }

        // Clean up so the URL can't be reused / shared. The HTML is now
        // already rendering, so we don't need it in storage anymore.
        try { localStorage.removeItem(key) } catch {}

        // Replace the entire React-managed document with the route-sheet HTML.
        // The origin stays lynxedo.com so Mapbox GL JS tile fetches succeed.
        document.open()
        document.write(payload.html)
        document.close()
      } catch (err) {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : 'Could not load route sheet')
        }
      }
    }

    // Wait one tick so React has finished its initial commit before we
    // replace the document — keeps the reconciler from yelling.
    const t = setTimeout(run, 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [])

  if (renderError) {
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#b91c1c' }}>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>Could not load route sheet</h1>
        <p style={{ fontSize: 14 }}>{renderError}</p>
      </div>
    )
  }

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif', color: '#374151' }}>
      Loading route sheet…
    </div>
  )
}

