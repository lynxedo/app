import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy — Lynxedo',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-gray-400 hover:text-white text-sm transition-colors">
          ← Home
        </Link>
        <h1 className="text-xl font-bold tracking-tight">Privacy Policy</h1>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-8 text-sm text-gray-300 leading-relaxed">
        <p className="text-gray-500 text-xs">Last updated: May 9, 2026</p>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Overview</h2>
          <p>
            Lynxedo (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) provides route optimization
            software for field service teams. This policy explains what data we collect, how we
            use it, and what we share — in plain language.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">What We Collect</h2>
          <div className="space-y-3">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Account information</p>
              <p className="text-gray-400">Your email address, used only for sign-in via magic link. We do not store passwords.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Settings you configure</p>
              <p className="text-gray-400">Display name, depot address, routing preferences, and on-site duration rules. Stored in your account so settings persist between sessions.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Jobber OAuth token</p>
              <p className="text-gray-400">When you connect Jobber, we store an access token so we can read your visits and write appointment times on your behalf. We never store your Jobber password.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Jobber visit data</p>
              <p className="text-gray-400">
                Client names, addresses, phone numbers, line items, and job details are fetched
                in real time when you build a route. This data passes through our servers to
                generate your route — it is <span className="text-white font-medium">not stored</span> in our database.
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">How We Use Your Data</h2>
          <p>We use your data solely to operate Lynxedo:</p>
          <ul className="mt-3 space-y-2 list-disc list-inside text-gray-400">
            <li>Authenticating your sign-in</li>
            <li>Storing your settings so they persist between sessions</li>
            <li>Fetching your Jobber visits and generating an optimized route</li>
            <li>Writing appointment times back to Jobber when you choose to send them</li>
            <li>Calculating drive times and mapping your route via Mapbox</li>
          </ul>
          <p className="mt-3">We do not sell your data, use it for advertising, or share it with any third party except the services listed below that are necessary to run the app.</p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Third-Party Services</h2>
          <div className="space-y-3">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Supabase</p>
              <p className="text-gray-400">Hosts our database and authentication. Your email, settings, and Jobber token are stored here. <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Supabase Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Jobber</p>
              <p className="text-gray-400">Your field service management software. You authorize Lynxedo to connect via Jobber&apos;s OAuth flow. You can disconnect at any time from Settings. <a href="https://getjobber.com/privacy-policy/" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Jobber Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Mapbox</p>
              <p className="text-gray-400">Provides map rendering, geocoding, and road-time calculations. Stop addresses are sent to Mapbox to compute travel times and draw route geometry. <a href="https://www.mapbox.com/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Mapbox Privacy Policy →</a></p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Data Retention</h2>
          <p>Your account settings and Jobber token are retained as long as your account is active. Jobber visit data (client names, addresses, etc.) is never written to our database — it exists only in memory during an active route-building session.</p>
          <p className="mt-3">You can delete your account at any time by contacting us. We will remove all stored data within 30 days.</p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Security</h2>
          <p>All data in transit is encrypted via HTTPS. Supabase encrypts data at rest. Jobber OAuth tokens are stored at the database level and are never exposed client-side. We follow industry-standard practices and review our security posture regularly.</p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Contact</h2>
          <p>Questions about this policy or your data? Email us at <a href="mailto:support@lynxedo.com" className="text-orange-400 hover:text-orange-300">support@lynxedo.com</a>.</p>
        </section>
      </main>
    </div>
  )
}
