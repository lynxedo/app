import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getCurrentUser, getCurrentProfile } from "@/lib/supabase/current-user";

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
// real values in iOS Safari. Without it per-page safe-area handling
// collapses to 0.
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
  const user = await getCurrentUser()

  // NAV-GlobalNavFate — the legacy GlobalNav (and the /dashboard + /timesheet
  // pages it served) are retired; everything lives in /hub now. We still read
  // the profile here for the global text-size class.
  let textSize: 'small' | 'default' | 'large' = 'default'
  let theme = 'midnight'

  if (user) {
    // Shared, request-cached profile fetch — the Hub layout reuses the same row.
    const data = await getCurrentProfile()
    const hub_text_size = data?.hub_text_size
    if (hub_text_size === 'small' || hub_text_size === 'large' || hub_text_size === 'default') {
      textSize = hub_text_size
    }
    const validThemes = ['midnight','carbon','evergreen','slate','ember','mocha','daylight','linen','sage','arctic','blossom','graphite','heroes']
    if (data?.hub_theme && validThemes.includes(data.hub_theme)) {
      theme = data.hub_theme
    }
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased text-size-${textSize} theme-${theme}`}
    >
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
