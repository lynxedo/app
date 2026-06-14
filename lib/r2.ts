// Shared Cloudflare R2 (S3-compatible) client (audit MSC-r2lib). The exact same
// `new S3Client({ region: 'auto', endpoint: …r2.cloudflarestorage.com, … })`
// block was copy-pasted into 34+ files. This is the single source of truth.
//
// Migration is a drop-in: replace an inline `new S3Client({…})` with
// `getR2Client()` and keep your existing PutObject/GetObject/getSignedUrl calls.
// New code can use the r2Put/r2GetBuffer/r2SignedUrl/r2Delete helpers below.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

/** The R2 bucket every Lynxedo upload lives in. */
export const R2_BUCKET = process.env.CF_R2_BUCKET_NAME

let cached: S3Client | null = null

/** Returns the shared R2 client (cached after first call). */
export function getR2Client(): S3Client {
  if (!cached) {
    cached = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.CF_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.CF_R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.CF_R2_SECRET_ACCESS_KEY!,
      },
    })
  }
  return cached
}

// ── Convenience helpers (optional; the client above covers everything) ────────

/** Upload an object. Body can be a Buffer/Uint8Array/string/stream. */
export async function r2Put(
  key: string,
  body: Parameters<typeof PutObjectCommand>[0]['Body'],
  contentType?: string,
  bucket: string | undefined = R2_BUCKET,
): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  )
}

/** Download an object as a Buffer. */
export async function r2GetBuffer(
  key: string,
  bucket: string | undefined = R2_BUCKET,
): Promise<Buffer> {
  const res = await getR2Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const bytes = await res.Body!.transformToByteArray()
  return Buffer.from(bytes)
}

/** Presigned GET URL (default 1h), e.g. to serve private media via a redirect. */
export async function r2SignedUrl(
  key: string,
  expiresIn = 3600,
  bucket: string | undefined = R2_BUCKET,
): Promise<string> {
  return getSignedUrl(
    getR2Client(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn },
  )
}

/** Delete an object. */
export async function r2Delete(
  key: string,
  bucket: string | undefined = R2_BUCKET,
): Promise<void> {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

// Re-export the raw commands so files doing custom work import from one place.
export { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, getSignedUrl, S3Client }
