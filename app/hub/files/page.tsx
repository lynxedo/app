import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import FilesClient from './FilesClient'

export default async function FilesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [profileResult, filesResult] = await Promise.all([
    supabase.from('user_profiles').select('role').eq('id', user.id).single(),
    supabase
      .from('hub_files')
      .select(`
        id, filename, mime_type, size_bytes, description, uploaded_at,
        uploader:hub_users!uploader_id (display_name)
      `)
      .order('uploaded_at', { ascending: false }),
  ])

  const isAdmin = profileResult.data?.role === 'admin'

  const files = (filesResult.data ?? []).map((f: {
    id: string
    filename: string
    mime_type: string
    size_bytes: number
    description: string | null
    uploaded_at: string
    uploader: { display_name: string } | { display_name: string }[] | null
  }) => ({
    ...f,
    uploader: Array.isArray(f.uploader) ? f.uploader[0] : f.uploader,
  }))

  return <FilesClient initialFiles={files} isAdmin={isAdmin} />
}
