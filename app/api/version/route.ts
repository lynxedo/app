import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Read once at process startup so the value survives the rm -rf .next that
// runs at the start of each deploy (before npm run build rewrites the file).
// Module-level code runs once when the worker first imports this route.
let BUILD_ID: string
try {
  BUILD_ID = fs.readFileSync(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim()
} catch {
  BUILD_ID = 'unknown'
}

export function GET() {
  return NextResponse.json(
    { buildId: BUILD_ID },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  )
}
