import { redirect } from 'next/navigation'

// Contacts is a shared, top-level tool at /hub/contacts (reachable from Texting,
// the Dialer, and on its own). This path used to render a Txt-scoped duplicate;
// it now redirects to the canonical Contacts page.
export default function TxtContactsRedirect() {
  redirect('/hub/contacts')
}
