import { NextResponse } from 'next/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { requireCompany } from '@/lib/company-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getR2Client } from '@/lib/r2'
import { canManageChecks } from '@/lib/check-deposit'

// GET /api/hub/checks/:id/photo/front|back → short-lived R2 link to the photo.
//     ?download=1 → the bytes themselves, from OUR origin, as a named attachment
//     ("Mike-Brown-check-1043-front.jpg"). Same-origin so the page can fetch it
//     into a blob — the one shape the iPhone app's download shim and the
//     Android app's download bridge both save — without needing CORS on R2.
//
// Same rule as the list: the checks room + admins see any check; the person who
// sent it sees their own. A check photo carries the customer's account number,
// so it is never served on "signed in" alone.

type Ctx = { params: Promise<{ id: string; side: string }> }

export async function GET(request: Request, ctx: Ctx) {
  const { id, side } = await ctx.params
  if (side !== 'front' && side !== 'back') return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const auth = await requireCompany({ grant: 'can_access_hub' })
  if ('error' in auth) return auth.error
  const admin = createAdminClient()

  const { data: row } = await admin
    .from('check_deposits')
    .select('front_path, back_path, submitted_by, customer_name, check_number')
    .eq('id', id)
    .eq('company_id', auth.companyId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.submitted_by !== auth.userId && !(await canManageChecks(admin, auth.companyId, auth.userId, auth.role))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!process.env.CF_R2_BUCKET_NAME) return NextResponse.json({ error: 'File storage not configured' }, { status: 501 })

  const key = side === 'front' ? row.front_path : row.back_path

  if (new URL(request.url).searchParams.get('download') === '1') {
    const obj = await getR2Client().send(new GetObjectCommand({ Bucket: process.env.CF_R2_BUCKET_NAME, Key: key }))
    const bytes = await obj.Body?.transformToByteArray()
    if (!bytes) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const slug = (row.customer_name || 'customer').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'customer'
    const name = `${slug}-check${row.check_number ? `-${row.check_number.replace(/[^0-9a-z]/gi, '')}` : ''}-${side}.jpg`
    return new Response(new Uint8Array(bytes), {
      headers: {
        // Always an image we stored as JPEG — never serve a stored type from our origin.
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  const url = await getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: process.env.CF_R2_BUCKET_NAME, Key: key }),
    { expiresIn: 600 },
  )
  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'private, max-age=300' } })
}
