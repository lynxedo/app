import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FilesClient from './FilesClient'

export default async function FilesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileResult, filesResult, tagsResult] = await Promise.all([
    supabase.from('user_profiles').select('role, can_access_files').eq('id', user.id).single(),
    supabase
      .from('hub_files')
      .select(`
        id, filename, mime_type, size_bytes, description, uploaded_at, tags,
        uploader:hub_users!uploader_id (display_name)
      `)
      .order('uploaded_at', { ascending: false }),
    supabase
      .from('hub_file_tags')
      .select('id, name, color, tag_type, description')
      .order('tag_type', { ascending: true })
      .order('name', { ascending: true }),
  ])

  const isAdmin = profileResult.data?.role === 'admin'
  if (!isAdmin && !profileResult.data?.can_access_files) redirect('/hub')

  const files = (filesResult.data ?? []).map((f: {
    id: string
    filename: string
    mime_type: string
    size_bytes: number
    description: string | null
    uploaded_at: string
    tags: string[] | null
    uploader: { display_name: string } | { display_name: string }[] | null
  }) => ({
    ...f,
    tags: f.tags ?? [],
    uploader: Array.isArray(f.uploader) ? f.uploader[0] : f.uploader,
  }))

  return <FilesClient initialFiles={files} initialTags={tagsResult.data ?? []} isAdmin={isAdmin} />
}
