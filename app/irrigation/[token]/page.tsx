import { createAdminClient } from '@/lib/supabase/admin'
import { getBusinessProfile } from '@/lib/business-profile'
import { toCustomerSummary } from '@/lib/irrigation'
import { r2SignedUrl } from '@/lib/r2'
import { contactDisplayName } from '@/lib/contact-name'

// Public, no-login customer summary of an irrigation inspection. Reached only
// via an unguessable share token (see /api/hub/contacts/[id]/irrigation/[inspId]/text).
// Renders ONLY the customer-safe projection (lib/irrigation.toCustomerSummary) —
// the gate code, dollar figures, and internal notes can never appear here.

export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false } }

const wrap: React.CSSProperties = {
  minHeight: '100vh', margin: 0, background: '#eef2f0',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
  color: '#16211e', padding: '24px 16px', boxSizing: 'border-box',
}
const card: React.CSSProperties = {
  maxWidth: 640, margin: '0 auto', background: '#fff', borderRadius: 14,
  boxShadow: '0 6px 24px rgba(16,40,36,.08)', overflow: 'hidden',
}
const label: React.CSSProperties = {
  fontSize: 11, letterSpacing: '.07em', textTransform: 'uppercase', color: '#0a5e66', fontWeight: 700,
}

function InfoRow({ k, v }: { k: string; v: string }) {
  if (!v) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', fontSize: 15, borderTop: '1px solid #eef2f0' }}>
      <span style={{ color: '#5a6b64', flexShrink: 0 }}>{k}</span>
      <span style={{ textAlign: 'right', fontWeight: 500 }}>{v}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '16px 20px', borderTop: '8px solid #f1f5f3' }}>
      <div style={{ ...label, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

function NotValid() {
  return (
    <div style={wrap}>
      <div style={{ ...card, padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 34 }}>💧</div>
        <h1 style={{ fontSize: 20, margin: '12px 0 6px' }}>This link isn&rsquo;t valid</h1>
        <p style={{ color: '#5a6b64', fontSize: 15, margin: 0 }}>
          It may have expired or been replaced. Please contact us for an up-to-date copy of your irrigation system summary.
        </p>
      </div>
    </div>
  )
}

export default async function IrrigationSummaryPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || token.length < 16) return <NotValid />

  const admin = createAdminClient()
  const { data: insp } = await admin
    .from('irrigation_inspections')
    .select('company_id, contact_id, data, sketch_key, finalized_at, inspected_on, share_expires_at, status')
    .eq('share_token', token)
    .maybeSingle()

  if (!insp || insp.status !== 'final') return <NotValid />
  if (insp.share_expires_at && new Date(insp.share_expires_at) <= new Date()) return <NotValid />

  const [profile, contactRes, sketchUrl] = await Promise.all([
    getBusinessProfile(admin, insp.company_id as string),
    admin.from('txt_contacts').select('name, phone').eq('id', insp.contact_id as string).maybeSingle(),
    insp.sketch_key ? r2SignedUrl(insp.sketch_key as string, 3600).catch(() => null) : Promise.resolve(null),
  ])

  const s = toCustomerSummary(insp.data)
  const customerName = contactDisplayName((contactRes.data?.name as string) || '', (contactRes.data?.phone as string) || null)
  const when = insp.inspected_on
    ? new Date(String(insp.inspected_on) + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : (insp.finalized_at ? new Date(insp.finalized_at as string).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '')

  const controllerParts = [s.controller.brand, s.controller.model].filter(Boolean).join(' ')
  const hasSystem =
    s.source.length || s.psi || controllerParts || s.controller.type || s.controller.stations ||
    s.backflow.type || s.mainShutoff || s.zones.length || s.overallCond || s.recommendations.length

  return (
    <div style={wrap}>
      <div style={card}>
        {/* Brand header */}
        <div style={{ background: 'linear-gradient(150deg,#0e7c86,#0a5e66)', color: '#fff', padding: '22px 20px' }}>
          <div style={{ fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.85 }}>{profile.businessName}</div>
          <h1 style={{ fontSize: 22, margin: '4px 0 0', fontWeight: 600 }}>Your Irrigation System</h1>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6 }}>
            {customerName}{when ? ` · ${when}` : ''}
          </div>
        </div>

        {!hasSystem ? (
          <div style={{ padding: 24, color: '#5a6b64', fontSize: 15 }}>
            Your system details are being finalized. Please check back soon or contact us.
          </div>
        ) : (
          <>
            {(s.source.length > 0 || s.psi) && (
              <Section title="Water supply">
                <InfoRow k="Source" v={s.source.join(', ')} />
                <InfoRow k="Water pressure" v={s.psi ? `${s.psi} PSI` : ''} />
              </Section>
            )}

            {(controllerParts || s.controller.type || s.controller.stations || s.controller.location) && (
              <Section title="Controller">
                <InfoRow k="Model" v={controllerParts} />
                <InfoRow k="Type" v={s.controller.type} />
                <InfoRow k="Zones (stations)" v={s.controller.stations} />
                <InfoRow k="Location" v={s.controller.location} />
              </Section>
            )}

            {(s.backflow.type || s.backflow.location) && (
              <Section title="Backflow preventer">
                <InfoRow k="Type" v={s.backflow.type} />
                <InfoRow k="Location" v={s.backflow.location} />
              </Section>
            )}

            {s.mainShutoff && (
              <Section title="Main shutoff">
                <div style={{ fontSize: 15 }}>{s.mainShutoff}</div>
              </Section>
            )}

            {s.zones.length > 0 && (
              <Section title={`Zones (${s.zones.length})`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {s.zones.map((z, i) => (
                    <div key={i} style={{ background: '#f6f8f7', borderRadius: 9, padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {z.zone ? `Zone ${z.zone}` : `Zone ${i + 1}`}{z.area ? ` — ${z.area}` : ''}
                      </div>
                      <div style={{ fontSize: 13, color: '#5a6b64', marginTop: 2 }}>
                        {[z.waters, z.head, z.count ? `${z.count} heads` : ''].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {s.overallCond && (
              <Section title="Overall condition">
                <div style={{ fontSize: 15, textTransform: 'capitalize' }}>{s.overallCond}</div>
              </Section>
            )}

            {s.recommendations.length > 0 && (
              <Section title="Recommendations">
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
                  {s.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </Section>
            )}

            {sketchUrl && (
              <Section title="System map">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sketchUrl} alt="Irrigation system sketch" style={{ width: '100%', borderRadius: 9, border: '1px solid #e2e8e5' }} />
              </Section>
            )}
          </>
        )}

        {/* Footer */}
        <div style={{ padding: '18px 20px', background: '#f1f5f3', color: '#5a6b64', fontSize: 14, textAlign: 'center' }}>
          Questions about your system? Call <strong style={{ color: '#0a5e66' }}>{profile.phone}</strong>
          <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>{profile.businessName}{profile.website ? ` · ${profile.website}` : ''}</div>
        </div>
      </div>
    </div>
  )
}
