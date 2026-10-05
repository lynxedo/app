import { createAdminClient } from '@/lib/supabase/admin'
import { getBusinessProfile } from '@/lib/business-profile'
import { toCustomerReport, type AfterServiceData } from '@/lib/after-service'
import { r2SignedUrl } from '@/lib/r2'
import { contactDisplayName } from '@/lib/contact-name'

// Public, no-login customer copy of an after-service report (Work Orders
// Phase 3). Reached only through the unguessable link the tech sends (…/send).
// Renders ONLY lib/after-service.toCustomerReport — product names, amounts,
// EPA numbers and internal notes can never appear here (Ben, Oct 5 2026:
// customers see what the treatment does, never the products).

export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false }, title: 'Your lawn treatment report' }

const green = '#2f6b3a'
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
  fontSize: 11, letterSpacing: '.07em', textTransform: 'uppercase', color: green, fontWeight: 700,
}
const para: React.CSSProperties = { fontSize: 15, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }

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
        <div style={{ fontSize: 34 }}>🌱</div>
        <h1 style={{ fontSize: 20, margin: '12px 0 6px' }}>This link isn&rsquo;t valid</h1>
        <p style={{ color: '#5a6b64', fontSize: 15, margin: 0 }}>
          It may have expired or been replaced. Please contact us for a copy of your treatment report.
        </p>
      </div>
    </div>
  )
}

export default async function ServiceReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || token.length < 16) return <NotValid />

  const admin = createAdminClient()
  const { data: rep } = await admin
    .from('after_service_reports')
    .select('company_id, contact_id, data, photo_keys, service_date, finalized_at, share_expires_at, status, created_by')
    .eq('share_token', token)
    .maybeSingle()
  if (!rep || rep.status !== 'final') return <NotValid />
  if (rep.share_expires_at && new Date(rep.share_expires_at as string) <= new Date()) return <NotValid />

  const [profile, contactRes, techRes, photoUrls] = await Promise.all([
    getBusinessProfile(admin, rep.company_id as string),
    admin.from('txt_contacts').select('name, phone').eq('id', rep.contact_id as string).maybeSingle(),
    rep.created_by
      ? admin.from('hub_users').select('display_name').eq('id', rep.created_by as string).maybeSingle()
      : Promise.resolve({ data: null }),
    Promise.all(((rep.photo_keys as string[] | null) ?? []).slice(0, 20).map(k => r2SignedUrl(k, 3600).catch(() => null))),
  ])

  const r = toCustomerReport((rep.data as AfterServiceData) ?? {})
  const customerName = contactDisplayName((contactRes.data?.name as string) || '', (contactRes.data?.phone as string) || null)
  const techFirst = ((techRes.data?.display_name as string | null) ?? '').trim().split(/\s+/)[0] || ''
  const dateSrc = rep.service_date ? `${rep.service_date}T12:00:00` : (rep.finalized_at as string | null)
  const when = dateSrc ? new Date(dateSrc).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : ''
  const photos = photoUrls.filter((u): u is string => !!u)
  const careBlocks = r.treatments.filter(t => t.care)

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ background: `linear-gradient(150deg,#3d8a4b,${green})`, color: '#fff', padding: '22px 20px' }}>
          <div style={{ fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', opacity: 0.85 }}>{profile.businessName}</div>
          <h1 style={{ fontSize: 22, margin: '4px 0 0', fontWeight: 600 }}>Your Lawn Treatment Report</h1>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6 }}>
            {customerName}{when ? ` · ${when}` : ''}{techFirst ? ` · Technician: ${techFirst}` : ''}
          </div>
        </div>

        {(r.treatments.length > 0 || r.otherServices.length > 0) && (
          <Section title="What we did">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {r.treatments.map((t, i) => (
                <div key={i}>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{t.name}{t.round ? <span style={{ fontWeight: 400, color: '#5a6b64' }}> · {t.round}</span> : null}</div>
                  {t.description && <p style={{ ...para, marginTop: 4, color: '#2b3a35' }}>{t.description}</p>}
                </div>
              ))}
              {r.otherServices.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
                  {r.otherServices.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
            </div>
            {r.weather && <div style={{ fontSize: 13, color: '#5a6b64', marginTop: 10 }}>Conditions at your property: {r.weather}</div>}
          </Section>
        )}

        {(r.observations.length > 0 || r.mowingHeight || r.observationNotes) && (
          <Section title="What we saw">
            {r.observations.length > 0 && (
              <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
                {r.observations.map((o, i) => <li key={i}>{o}</li>)}
              </ul>
            )}
            {r.mowingHeight && <div style={{ fontSize: 15, marginBottom: 8 }}><strong>Mowing height:</strong> {r.mowingHeight}</div>}
            {r.observationNotes && <p style={para}>{r.observationNotes}</p>}
          </Section>
        )}

        {(r.recommendations.length > 0 || r.recommendationNotes) && (
          <Section title="Our recommendations">
            {r.recommendations.length > 0 && (
              <ul style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
                {r.recommendations.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            )}
            {r.recommendationNotes && <p style={para}>{r.recommendationNotes}</p>}
          </Section>
        )}

        {careBlocks.length > 0 && (
          <Section title="Caring for your lawn">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {careBlocks.map((t, i) => (
                <div key={i}>
                  {careBlocks.length > 1 && <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{t.name}</div>}
                  <p style={para}>{t.care}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {photos.length > 0 && (
          <Section title="Photos">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8 }}>
              {photos.map((u, i) => (
                <a key={i} href={u} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 9, border: '1px solid #e2e8e5' }} />
                </a>
              ))}
            </div>
          </Section>
        )}

        <div style={{ padding: '18px 20px', background: '#f1f5f3', color: '#5a6b64', fontSize: 14, textAlign: 'center' }}>
          Questions about your treatment? Reply to our text or call <strong style={{ color: green }}>{profile.phone}</strong>
          <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>{profile.businessName}{profile.website ? ` · ${profile.website}` : ''}</div>
        </div>
      </div>
    </div>
  )
}
