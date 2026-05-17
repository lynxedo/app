import type { Metadata, Viewport } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HubShell from '@/components/hub/HubShell'
import PushInit from '@/components/hub/PushInit'

export const metadata: Metadata = {
  title: 'Hub',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Hub',
    statusBarStyle: 'black-translucent',
  },
  icons: { apple: '/icons/apple-touch-icon.png' },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
}

// iOS splash screens — React 19 hoists these <link> tags to <head>
function IosSplashScreens() {
  return (
    <>
      <link rel="apple-touch-startup-image" media="screen and (device-width:320px) and (device-height:568px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-640-1136.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:375px) and (device-height:667px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-750-1334.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:414px) and (device-height:736px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1242-2208.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:375px) and (device-height:812px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1125-2436.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:414px) and (device-height:896px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1242-2688.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:414px) and (device-height:896px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-828-1792.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:390px) and (device-height:844px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1170-2532.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:428px) and (device-height:926px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1284-2778.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:393px) and (device-height:852px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1179-2556.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:430px) and (device-height:932px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1290-2796.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:402px) and (device-height:874px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1206-2622.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:440px) and (device-height:956px) and (-webkit-device-pixel-ratio:3) and (orientation:portrait)" href="/icons/splash/apple-splash-1320-2868.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:744px) and (device-height:1133px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-1488-2266.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:820px) and (device-height:1180px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-1640-2360.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:834px) and (device-height:1194px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-1668-2388.png" />
      <link rel="apple-touch-startup-image" media="screen and (device-width:1024px) and (device-height:1366px) and (-webkit-device-pixel-ratio:2) and (orientation:portrait)" href="/icons/splash/apple-splash-2048-2732.png" />
    </>
  )
}

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const now = new Date().toISOString()
  const [roomsResult, hubUsersResult, meResult, profileResult, announcementResult] = await Promise.all([
    supabase.from('rooms').select('id, name, is_private').is('archived_at', null).order('name'),
    supabase.from('hub_users').select('id, display_name, avatar_url, is_bot, status').order('display_name'),
    supabase.from('hub_users').select('display_name, status').eq('id', user.id).single(),
    supabase.from('user_profiles').select('role').eq('id', user.id).single(),
    supabase
      .from('hub_announcements')
      .select('id, content, expires_at, reactions:announcement_reactions(announcement_id, user_id, emoji)')
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const isAdmin = profileResult.data?.role === 'admin'

  const ann = announcementResult.data
  const initialAnnouncement = ann
    ? {
        id: ann.id as string,
        content: ann.content as string,
        expires_at: ann.expires_at as string,
        reactions: (Array.isArray(ann.reactions) ? ann.reactions : []) as Array<{ announcement_id: string; user_id: string; emoji: string }>,
      }
    : null

  return (
    <>
      <IosSplashScreens />
      <HubShell
        rooms={roomsResult.data ?? []}
        userEmail={user.email ?? ''}
        currentUserId={user.id}
        hubUsers={(hubUsersResult.data ?? []) as never}
        currentUserStatus={meResult.data?.status ?? null}
        currentUserDisplayName={meResult.data?.display_name ?? undefined}
        isAdmin={isAdmin}
        initialAnnouncement={initialAnnouncement}
      >
        {children}
      </HubShell>
      <PushInit />
    </>
  )
}
