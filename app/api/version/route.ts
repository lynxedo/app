import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function GET() {
  try {
    const buildId = fs.readFileSync(
      path.join(process.cwd(), '.next', 'BUILD_ID'),
      'utf8'
    ).trim()
    return NextResponse.json({ buildId }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch {
    return NextResponse.json({ buildId: 'unknown' })
  }
}
