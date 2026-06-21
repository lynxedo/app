import { chromium } from 'playwright'

// Render a self-contained route-sheet HTML document (lib/advanced-route-sheet.ts)
// to a real PDF, server-side, using the SAME print CSS the browser's "Save as
// PDF" uses. This is what lets the optimizer attach an actual downloadable PDF
// to a Daily Log v2 entry instead of an HTML preview the tech has to print
// themselves (test-findings #7, revised).
//
// Best-effort: returns null on any failure so the caller can fall back to
// storing the HTML and never lose the route sheet entirely. Chromium is the
// same Playwright browser already installed on the VPS; `playwright` is in
// next.config.ts `serverExternalPackages` so it is not bundled.
export async function renderRouteSheetPdf(html: string): Promise<Buffer | null> {
  let browser = null
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()

    // The route sheet embeds a Mapbox Static Images <img>. The public token is
    // referrer-restricted to lynxedo.com, so without a Referer the map 403s and
    // renders blank (same fix as the server-side geocode/matrix calls — June
    // 2026 lesson). Set it to our app origin so the map loads in the PDF.
    const referer = process.env.NEXT_PUBLIC_APP_URL
    if (referer) await page.setExtraHTTPHeaders({ Referer: referer })

    await page.setContent(html, { waitUntil: 'networkidle', timeout: 20000 })

    // page.pdf() uses print media by default — that hides `.print-btn` and
    // applies the sheet's @page rules (landscape summary page + portrait stop
    // cards). preferCSSPageSize honors those so the PDF matches the in-browser
    // "Save as PDF" output exactly. printBackground keeps the dark headers.
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true })
    return Buffer.from(pdf)
  } catch (err) {
    console.error('[route-sheet-pdf] render failed:', (err as Error).message)
    return null
  } finally {
    if (browser) {
      try { await browser.close() } catch { /* ignore */ }
    }
  }
}
