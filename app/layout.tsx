import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import ConditionalGlobalNav from "@/components/ConditionalGlobalNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: '%s | Lynxedo',
    default: 'Lynxedo',
  },
  description: "Field service operations for Heroes Lawn Care",
};

// viewport-fit=cover is required for env(safe-area-inset-*) to return
// real values in iOS Safari. Without it the GlobalNav top spacer (and
// any per-page safe-area handling) collapses to 0 outside the Hub.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let navProfile: {
    role: string
    can_access_hub: boolean
    can_access_routing: boolean
    can_access_timesheet: boolean
    can_access_tracker: boolean
    can_access_call_log: boolean
  } | null = null
  let textSize: 'small' | 'default' | 'large' = 'default'

  if (user) {
    const { data } = await supabase
      .from('user_profiles')
      .select('role, can_access_hub, can_access_routing, can_access_timesheet, can_access_tracker, can_access_call_log, hub_text_size')
      .eq('id', user.id)
      .single()
    if (data) {
      const { hub_text_size, ...rest } = data
      navProfile = rest
      if (hub_text_size === 'small' || hub_text_size === 'large' || hub_text_size === 'default') {
        textSize = hub_text_size
      }
    }
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased text-size-${textSize}`}
    >
      <body className="min-h-full flex flex-col">
        {navProfile && <ConditionalGlobalNav profile={navProfile} />}
        {children}
      </body>
    </html>
  );
}
