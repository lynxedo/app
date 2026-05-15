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
        <p className="text-gray-500 text-xs">Last updated: May 15, 2026</p>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Overview</h2>
          <p>
            Lynxedo (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) provides business operations
            software for field service teams — including route optimization, lawn estimation, call
            log review, employee timekeeping, financial reporting, and automated communication tools.
            This policy explains what data we collect, how we use it, and what we share — in plain language.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">What We Collect</h2>
          <div className="space-y-3">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Account information</p>
              <p className="text-gray-400">Your email address, used for sign-in via Google OAuth or magic link. We do not store passwords.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Settings you configure</p>
              <p className="text-gray-400">Display name, depot address, routing preferences, on-site duration rules, and tool-specific settings. Stored in your account so settings persist between sessions.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Jobber OAuth token</p>
              <p className="text-gray-400">When you connect Jobber, we store an access token so we can read your visits and write appointment times on your behalf. We never store your Jobber password.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Jobber visit data</p>
              <p className="text-gray-400">Client names, addresses, phone numbers, line items, and job details are fetched in real time when you build a route. This data passes through our servers to generate your route — it is <span className="text-white font-medium">not stored</span> in our database.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Call recordings and transcripts</p>
              <p className="text-gray-400">Phone call recordings, AI-generated transcripts, call summaries, and analysis scores are stored in our database and associated with your account. Recordings are stored as audio files on our servers.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Employee timesheet data</p>
              <p className="text-gray-400">Employee names, clock-in and clock-out times, GPS coordinates at punch time (when enabled), and computed hours are stored to support payroll and scheduling. This data is accessible only to authorized administrators.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">QuickBooks financial data</p>
              <p className="text-gray-400">When you connect QuickBooks Online, we store an access token to retrieve financial reports on your behalf. Profit &amp; loss data, revenue figures, and expense summaries are fetched from QuickBooks and displayed in your private financial dashboard. Financial data is never stored in our database — it is fetched in real time and cached temporarily (up to 4 hours) on our servers to reduce API calls.</p>
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
            <li>Displaying call recordings, transcripts, and AI analysis to authorized staff</li>
            <li>Tracking employee clock-in and clock-out times for payroll purposes</li>
            <li>Fetching and displaying QuickBooks financial reports in your private dashboard</li>
            <li>Sending automated text messages and voicemail responses to missed callers (Responder feature)</li>
          </ul>
          <p className="mt-3">We do not sell your data, use it for advertising, or share it with any third party except the services listed below that are necessary to run the app.</p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Third-Party Services</h2>
          <div className="space-y-3">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Supabase</p>
              <p className="text-gray-400">Hosts our database and authentication. Your account, settings, tokens, call logs, and timesheet data are stored here. <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Supabase Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Jobber</p>
              <p className="text-gray-400">Your field service management software. You authorize Lynxedo to connect via Jobber&apos;s OAuth flow. You can disconnect at any time from Settings. <a href="https://getjobber.com/privacy-policy/" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Jobber Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">QuickBooks Online (Intuit)</p>
              <p className="text-gray-400">Your accounting software. You authorize Lynxedo to read financial reports via QuickBooks OAuth. We request read-only access and never modify your QuickBooks data. You can disconnect at any time. <a href="https://www.intuit.com/privacy/statement/" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Intuit Privacy Statement →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Mapbox</p>
              <p className="text-gray-400">Provides map rendering, geocoding, and road-time calculations. Stop addresses are sent to Mapbox to compute travel times and draw route geometry. <a href="https://www.mapbox.com/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Mapbox Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Anthropic (Claude AI)</p>
              <p className="text-gray-400">Provides AI analysis for call recordings (summaries, call type, action items, coaching scores) and lawn area estimation from satellite imagery. Call transcript text and satellite images are sent to Anthropic&apos;s API for processing. <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Anthropic Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Google (OAuth login)</p>
              <p className="text-gray-400">We use Google OAuth for sign-in, restricted to your organization&apos;s Google Workspace domain. We receive your name and email address from Google at sign-in. <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Google Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Twilio</p>
              <p className="text-gray-400">Handles inbound missed call forwarding, voicemail recording, and transcription for the Responder feature. Caller phone numbers and voicemail audio are processed by Twilio. <a href="https://www.twilio.com/en-us/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Twilio Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Resend</p>
              <p className="text-gray-400">Delivers transactional emails such as sign-in magic links and voicemail notification emails. Recipient email addresses are passed to Resend for delivery only. <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Resend Privacy Policy →</a></p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Data Retention</h2>
          <p>Your account settings and OAuth tokens are retained as long as your account is active. Call recordings and transcripts are retained indefinitely unless you request deletion. Employee timesheet records are retained for payroll and compliance purposes. QuickBooks financial data is not stored — only temporarily cached (up to 4 hours) and discarded.</p>
          <p className="mt-3">Jobber visit data (client names, addresses, etc.) is never written to our database — it exists only in memory during an active route-building session.</p>
          <p className="mt-3">You can request deletion of your account and all associated data by contacting us. We will remove all stored data within 30 days.</p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Security</h2>
          <p>All data in transit is encrypted via HTTPS. Supabase encrypts data at rest. OAuth tokens are stored at the database level with row-level security and are never exposed client-side. Financial data in the QuickBooks dashboard is protected by two independent authentication gates. We follow industry-standard practices and review our security posture regularly.</p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Contact</h2>
          <p>Questions about this policy or your data? Email us at <a href="mailto:support@lynxedo.com" className="text-orange-400 hover:text-orange-300">support@lynxedo.com</a>.</p>
        </section>
      </main>
    </div>
  )
}
