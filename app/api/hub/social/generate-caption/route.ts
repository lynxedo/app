import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const SERVICE_TYPES = ['fertilization', 'irrigation', 'doody-duty', 'team', 'general', 'aeration', 'overseeding', 'pest-control'] as const
type ServiceType = typeof SERVICE_TYPES[number]

const CONTENT_PILLARS = ['educate', 'show-work', 'engage', 'sell'] as const
type ContentPillar = typeof CONTENT_PILLARS[number]

function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
    },
  })
}

const PILLAR_INSTRUCTIONS: Record<ContentPillar, string> = {
  educate: 'Write an educational tip about lawn care, landscaping, or the featured service. Share a fact, seasonal advice, or a how-to insight. Make the audience smarter.',
  'show-work': 'Showcase the work done — describe the transformation, the before/after, the craftsmanship. Let the results speak.',
  engage: 'Spark a conversation. Ask a question, run a poll, or invite the audience to share their lawn care story.',
  sell: 'Soft-sell the service with urgency or value. Mention seasonal timing, limited availability, or a clear benefit. End with a CTA: call or visit the website.',
}

const SERVICE_CONTEXT: Record<ServiceType, string> = {
  fertilization: 'Fertilization Force — Heroes\' signature fertilization program using premium nutrients tailored to Texas lawns',
  irrigation: 'Irrigation Army — sprinkler system install, repair, and seasonal adjustment services',
  'doody-duty': 'Heroes Doody Duty — professional pet waste removal service',
  aeration: 'Core aeration — break up compacted soil, improve drainage, and let nutrients reach the roots',
  overseeding: 'Overseeding — thicken thin or bare spots for a lush, full lawn',
  'pest-control': 'Pest control and grub treatment for a healthy, protected lawn',
  team: 'The Heroes Lawn Care team — the people behind the work',
  general: 'Heroes Lawn Care — full-service residential lawn care in The Woodlands area',
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('company_id, can_access_marketing')
    .eq('id', user.id)
    .single()
  if (!profile?.can_access_marketing || !profile.company_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 501 })

  const body = await request.json().catch(() => ({})) as {
    hub_file_id?: string
    platform?: string
    service_type?: string
    content_pillar?: string
    month?: string
  }

  const platform = body.platform === 'instagram' ? 'instagram' : 'facebook'
  const serviceType: ServiceType = (SERVICE_TYPES as readonly string[]).includes(body.service_type ?? '')
    ? (body.service_type as ServiceType) : 'general'
  const contentPillar: ContentPillar = (CONTENT_PILLARS as readonly string[]).includes(body.content_pillar ?? '')
    ? (body.content_pillar as ContentPillar) : 'show-work'
  const month = body.month ?? new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' })

  // Build message content — include photo if provided
  const contentBlocks: Anthropic.ContentBlockParam[] = []

  if (body.hub_file_id && process.env.CF_R2_BUCKET_NAME) {
    const { data: file } = await supabase
      .from('hub_files')
      .select('storage_path, mime_type')
      .eq('id', body.hub_file_id)
      .single()

    if (file && file.mime_type.startsWith('image/')) {
      const r2 = getR2Client()
      try {
        const signedUrl = await getSignedUrl(
          r2,
          new GetObjectCommand({ Bucket: process.env.CF_R2_BUCKET_NAME, Key: file.storage_path }),
          { expiresIn: 300 }
        )
        contentBlocks.push({
          type: 'image',
          source: { type: 'url', url: signedUrl },
        })
      } catch { /* skip photo on error */ }
    }
  }

  const platformInstructions = platform === 'instagram'
    ? 'Instagram: conversational tone, 2,200 char max, hashtags work well at end (8–15 relevant hashtags), emojis welcome.'
    : 'Facebook: slightly longer form is fine, 1–3 short paragraphs max, 1–3 hashtags at end only if natural.'

  contentBlocks.push({
    type: 'text',
    text: `Write a social media caption for the ${month} post.

Platform: ${platform === 'instagram' ? 'Instagram' : 'Facebook'}
Service: ${SERVICE_CONTEXT[serviceType]}
Content pillar: ${contentPillar.replace('-', ' ')} — ${PILLAR_INSTRUCTIONS[contentPillar]}
${contentBlocks.length > 1 ? 'The photo above is included in this post — reference what you see.' : ''}

${platformInstructions}

Return ONLY the caption text. No labels, no quotes, no commentary.`,
  })

  const systemPrompt = `You are a social media writer for Heroes Lawn Care, a full-service residential lawn care company serving The Woodlands, Spring, Magnolia, Conroe, and Tomball, TX.

Brand voice: friendly, professional, confident. Homeowners trust Heroes to make their lawn the best on the block.
Phone: (832) 220-8100
Website: heroeslawntx.com
Services: Fertilization Force, Irrigation Army, Doody Duty (pet waste), core aeration, overseeding, pest control.`

  const anthropic = new Anthropic({ apiKey })
  let caption = ''
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: contentBlocks }],
    })
    caption = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
  } catch (e) {
    console.error('[generate-caption] Anthropic error:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Caption generation failed' })
  }

  return NextResponse.json({ caption })
}
