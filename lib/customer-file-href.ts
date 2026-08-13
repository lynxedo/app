/* Where a customer file lives. Two builders, no imports, nothing Node-only.
 *
 * ⚠ SEPARATE FROM lib/customer-file.ts ON PURPOSE. The widget metric files import
 * these, and the widget registry is imported by ScoreboardsTab — a CLIENT component
 * (the Workspace Tabs twin). Anything reachable from there is bundled for the
 * browser, and lib/customer-file.ts encodes Jobber ids with `Buffer`, which does not
 * exist there. Splitting the pure builders out makes that boundary a fact of the
 * file layout rather than something tree-shaking has to get right — the same reason
 * the widget registry keeps its slug list out of layouts.ts.
 */

/** The customer file itself, for a directory contact id we already hold. */
export function customerFilePath(contactId: string): string {
  return `/hub/contacts/${contactId}`
}

/**
 * The link a report row points at, resolved on CLICK rather than at render.
 *
 * `clientId` is a `clients.id` from the Jobber mirror — the id report payloads
 * already carry. Deliberate: the payload never has to carry a directory uuid, the
 * link survives a contact merge because it is re-resolved every time, and one
 * audited resolver owns the id mapping (see lib/customer-file.ts).
 */
export function customerFileHref(clientId: string): string {
  return `/customer/${clientId}`
}
