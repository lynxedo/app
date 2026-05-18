import type { Metadata } from "next";
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

  if (user) {
    const { data } = await supabase
      .from('user_profiles')
      .select('role, can_access_hub, can_access_routing, can_access_timesheet, can_access_tracker, can_access_call_log')
      .eq('id', user.id)
      .single()
    if (data) navProfile = data
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {navProfile && <ConditionalGlobalNav profile={navProfile} />}
        {children}
      </body>
    </html>
  );
}
