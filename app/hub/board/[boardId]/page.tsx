import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import BoardView from '@/components/hub/BoardView'

export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [boardResult, hubUsersResult] = await Promise.all([
    supabase
      .from('boards')
      .select('id, name, is_private, is_personal, created_by')
      .eq('id', boardId)
      .single(),
    supabase
      .from('hub_users')
      .select('id, display_name, avatar_url')
      .order('display_name'),
  ])

  if (!boardResult.data) redirect('/hub')

  return (
    <BoardView
      board={boardResult.data}
      hubUsers={hubUsersResult.data ?? []}
      currentUserId={user.id}
    />
  )
}
