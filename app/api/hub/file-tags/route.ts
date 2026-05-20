import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Read-only list of file tags for the current company, available to all authenticated hub users.
// Admin write operations live at /api/admin/file-tags.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('hub_file_tags')
    .select('id, name, color, tag_type, description')
    .order('tag_type', { ascending: true })
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tags: data ?? [] })
}
