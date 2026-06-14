'use client'

import { useState, useEffect, useCallback } from 'react'
import PostComposer from './PostComposer'
import { useConfirm, useToast, Spinner, EmptyState } from '@/components/ui'

type SocialAccount = {
  id: string
  platform: 'facebook' | 'instagram'
  account_name: string
  external_id: string
  ig_user_id: string | null
}

type SocialPost = {
  id: string
  account_id: string
  hub_file_id: string | null
  caption: string
  scheduled_at: string
  published_at: string | null
  fb_post_id: string | null
  status: 'draft' | 'scheduled' | 'published' | 'failed'
  error_message: string | null
  platforms: string[]
  created_at: string
  account: { account_name: string; platform: string; ig_user_id: string | null } | null
  file: { filename: string; storage_path: string; mime_type: string } | null
}

type StatusFilter = 'all' | 'scheduled' | 'published' | 'draft' | 'failed'

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-gray-700 text-gray-300' },
  scheduled: { label: 'Scheduled', cls: 'bg-blue-500/20 text-blue-300 border border-blue-500/30' },
  published: { label: 'Published', cls: 'bg-green-500/20 text-green-300 border border-green-500/30' },
  failed: { label: 'Failed', cls: 'bg-red-500/20 text-red-300 border border-red-500/30' },
}

function formatScheduled(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'America/Chicago',
  })
}

function PlatformIcons({ platforms, igUserId }: { platforms: string[]; igUserId: string | null }) {
  return (
    <span className="flex items-center gap-1">
      {platforms.includes('facebook') && (
        <span className="text-blue-400 text-xs font-semibold">FB</span>
      )}
      {platforms.includes('instagram') && igUserId && (
        <span className="text-pink-400 text-xs font-semibold">IG</span>
      )}
    </span>
  )
}

export default function SocialView({
  initialAccounts,
  canAdmin,
}: {
  initialAccounts: SocialAccount[]
  canAdmin: boolean
}) {
  const confirmDialog = useConfirm()
  const toast = useToast()
  const [accounts] = useState<SocialAccount[]>(initialAccounts)
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showComposer, setShowComposer] = useState(false)
  const [editingPost, setEditingPost] = useState<SocialPost | null>(null)

  const fetchPosts = useCallback(async (filter: StatusFilter) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('status', filter)
      const res = await fetch(`/api/hub/social/posts?${params}`)
      const data = await res.json() as { posts?: SocialPost[] }
      setPosts(data.posts ?? [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchPosts(statusFilter) }, [statusFilter, fetchPosts])

  async function deletePost(id: string) {
    if (!(await confirmDialog({ message: 'Delete this post?', danger: true }))) return
    const res = await fetch(`/api/hub/social/posts/${id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error("Couldn't delete the post"); return }
    setPosts(prev => prev.filter(p => p.id !== id))
    toast.success('Post deleted')
  }

  function handleSaved() {
    setShowComposer(false)
    setEditingPost(null)
    fetchPosts(statusFilter)
  }

  const noAccounts = accounts.length === 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-5 pt-5 pb-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">Social</h1>
            <p className="text-xs text-white/50 mt-0.5">Schedule Facebook and Instagram posts</p>
          </div>
          <div className="flex items-center gap-2">
            {canAdmin && (
              <a
                href="/hub/admin/marketing"
                className="text-xs text-white/40 hover:text-white transition-colors border border-gray-700 px-2.5 py-1.5 rounded-lg"
              >
                Admin
              </a>
            )}
            <button
              onClick={() => { setEditingPost(null); setShowComposer(true) }}
              disabled={noAccounts}
              title={noAccounts ? 'Connect a social account in Admin first' : undefined}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Post
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 mt-4 flex-wrap">
          {(['all', 'scheduled', 'published', 'draft', 'failed'] as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-full capitalize transition-colors ${
                statusFilter === f
                  ? 'bg-white/10 text-white font-medium'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              {f === 'all' ? 'All Posts' : f}
            </button>
          ))}
        </div>
      </div>

      {/* No-accounts banner */}
      {noAccounts && (
        <div className="mx-5 mt-5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-5 py-4">
          <p className="text-sm text-amber-300 font-medium">No social accounts connected</p>
          <p className="text-xs text-amber-300/70 mt-1">
            Connect your Facebook pages in{' '}
            <a href="/hub/admin/marketing" className="underline hover:no-underline">Admin → Marketing</a>{' '}
            to start scheduling posts.
          </p>
        </div>
      )}

      {/* Posts list */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="py-12 text-center"><Spinner size={6} /></div>
        ) : posts.length === 0 ? (
          <EmptyState
            size="lg"
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.952 9.168-5v10c-1.543-3.048-5.068-5-9.168-5H7a3.988 3.988 0 00-1.564.317z" />
              </svg>
            }
            title={statusFilter === 'all' ? 'No posts yet. Create your first post.' : `No ${statusFilter} posts.`}
          />
        ) : (
          <div className="space-y-2">
            {posts.map(post => {
              const chip = STATUS_CHIP[post.status] ?? STATUS_CHIP.draft
              const acct = Array.isArray(post.account) ? post.account[0] : post.account
              const canEdit = post.status === 'draft' || post.status === 'scheduled'
              return (
                <div key={post.id} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-start gap-3">
                  {/* Thumbnail placeholder */}
                  <div className="w-12 h-12 rounded-lg bg-gray-800 flex-shrink-0 overflow-hidden">
                    {post.hub_file_id ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                        </svg>
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${chip.cls}`}>
                        {chip.label}
                      </span>
                      {acct && (
                        <PlatformIcons platforms={post.platforms} igUserId={acct.ig_user_id} />
                      )}
                      {acct && (
                        <span className="text-xs text-white/40">{acct.account_name}</span>
                      )}
                    </div>
                    <p className="text-sm text-white mt-1.5 line-clamp-2 leading-snug">{post.caption}</p>
                    <p className="text-xs text-white/40 mt-1">
                      {post.status === 'published' && post.published_at
                        ? `Published ${formatScheduled(post.published_at)}`
                        : `Scheduled ${formatScheduled(post.scheduled_at)}`}
                    </p>
                    {post.status === 'failed' && post.error_message && (
                      <p className="text-xs text-red-400 mt-1 truncate">{post.error_message}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {canEdit && (
                      <button
                        onClick={() => { setEditingPost(post); setShowComposer(true) }}
                        className="text-xs text-white/40 hover:text-white border border-gray-700 hover:border-gray-500 px-2.5 py-1 rounded-md transition-colors"
                      >
                        Edit
                      </button>
                    )}
                    {canEdit && (
                      <button
                        onClick={() => deletePost(post.id)}
                        className="text-xs text-white/40 hover:text-red-400 border border-gray-700 hover:border-red-600/40 px-2.5 py-1 rounded-md transition-colors"
                      >
                        Delete
                      </button>
                    )}
                    {post.status === 'published' && post.fb_post_id && (
                      <span className="text-xs text-green-400/60">✓ Live</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Composer modal */}
      {showComposer && (
        <PostComposer
          accounts={accounts}
          editPost={editingPost ? {
            id: editingPost.id,
            caption: editingPost.caption,
            scheduled_at: editingPost.scheduled_at,
            hub_file_id: editingPost.hub_file_id,
            platforms: editingPost.platforms,
            account_id: editingPost.account_id,
          } : null}
          onClose={() => { setShowComposer(false); setEditingPost(null) }}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
