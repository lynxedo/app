import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy — Lynxedo',
  description: 'Privacy policy for the Lynxedo platform and mobile app.',
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
        <p className="text-gray-500 text-xs">Last updated: June 10, 2026</p>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Overview</h2>
          <p>
            Lynxedo (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) is a business operations
            platform for field service teams — including team messaging, VoIP calling, SMS, route
            optimization, employee timekeeping, fleet tracking, daily job logs, financial reporting,
            and automated communication tools. This policy explains what data we collect, how we
            use it, and what we share — in plain language.
          </p>
          <p className="mt-3">
            Lynxedo is a business-to-business (B2B) platform. Individual users are employees or
            contractors of a business that has subscribed to Lynxedo. Data is collected on behalf
            of and under the control of the subscribing business.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">What We Collect</h2>
          <div className="space-y-3">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Account &amp; profile information</p>
              <p className="text-gray-400">Your email address, display name, and optional phone number — used for sign-in and to identify you within your organization&apos;s workspace. We do not store passwords.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Team messages and files</p>
              <p className="text-gray-400">Messages, replies, and file attachments sent in team rooms and direct messages are stored so your team can view conversation history. Files are stored in encrypted cloud storage.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Phone calls and voicemail</p>
              <p className="text-gray-400">When you make or receive calls through the Lynxedo Dialer, call metadata (caller ID, duration, timestamps) is stored. If call recording is enabled by your administrator, call audio is recorded and stored. AI-generated transcripts, summaries, and analysis are stored alongside the recording. Voicemail audio and transcripts are stored in your account.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">SMS messages</p>
              <p className="text-gray-400">When you use the Txt feature, inbound and outbound SMS message content, timestamps, and associated phone numbers are stored to maintain conversation history for your team.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Microphone access</p>
              <p className="text-gray-400">The mobile and desktop app requests access to your device&apos;s microphone solely to transmit voice audio during phone calls placed or received through the Dialer. Microphone audio is not recorded or stored beyond what is described in the &quot;Phone calls and voicemail&quot; section above, and only when call recording is enabled by your administrator.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Push notification tokens</p>
              <p className="text-gray-400">When you enable notifications, your device&apos;s push token (APNs on iOS, FCM on Android) is stored so we can deliver incoming call alerts, new message notifications, and voicemail notifications to your device.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">GPS location (timesheet clock punches)</p>
              <p className="text-gray-400">When you clock in or out using the Lynxedo time clock, your device&apos;s GPS coordinates at the moment of the punch are optionally captured and stored — subject to your administrator&apos;s configuration. Location is captured only at the exact moment of a clock punch, not continuously tracked in the background.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Employee timesheet records</p>
              <p className="text-gray-400">Employee names, clock-in and clock-out times, computed hours, and PTO or holiday records are stored to support payroll and scheduling. Accessible only to authorized administrators.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Fleet vehicle location</p>
              <p className="text-gray-400">If your organization uses the Fleet Tracker feature, real-time GPS position, speed, and status of company vehicles is retrieved from a third-party GPS provider (OneStepGPS) and displayed on a live map. This is vehicle location data, not personal device location.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Jobber visit and customer data</p>
              <p className="text-gray-400">Client names, addresses, phone numbers, line items, and job details are fetched from Jobber and used to build routes, populate daily logs, and support field operations. Customer records are stored in a mirror database to power reports and sync features — they are not sold or used for any purpose outside operating your account.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">QuickBooks financial data</p>
              <p className="text-gray-400">When you connect QuickBooks Online, we store an access token to retrieve financial reports on your behalf. Financial data is fetched in real time and cached temporarily (up to 4 hours) — it is not stored permanently in our database.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Settings you configure</p>
              <p className="text-gray-400">Display preferences, routing settings, IVR configuration, notification preferences, and other tool-specific settings are stored in your account so they persist between sessions.</p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">How We Use Your Data</h2>
          <p>We use your data solely to operate Lynxedo:</p>
          <ul className="mt-3 space-y-2 list-disc list-inside text-gray-400">
            <li>Authenticating your sign-in and maintaining your session</li>
            <li>Delivering team messages, push notifications, and voicemail alerts to your device</li>
            <li>Connecting, routing, and recording phone calls through the Dialer</li>
            <li>Sending and receiving SMS messages on your team&apos;s behalf</li>
            <li>Fetching your Jobber visits and generating an optimized route</li>
            <li>Writing appointment times back to Jobber when you choose to send them</li>
            <li>Tracking employee clock-in and clock-out times for payroll purposes</li>
            <li>Displaying fleet vehicle locations on a live map</li>
            <li>Generating AI transcripts and summaries from call recordings</li>
            <li>Fetching and displaying QuickBooks financial reports in your private dashboard</li>
            <li>Sending automated SMS responses to missed callers when configured</li>
          </ul>
          <p className="mt-3">We do not sell your data, use it for advertising, or share it with any third party except the services listed below that are necessary to operate the platform.</p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Third-Party Services</h2>
          <div className="space-y-3">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Supabase</p>
              <p className="text-gray-400">Hosts our database and authentication. Your account, messages, settings, tokens, call logs, and timesheet data are stored here. Data is encrypted at rest and in transit. <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Supabase Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Twilio</p>
              <p className="text-gray-400">Provides VoIP calling, SMS messaging, and voicemail. Call audio, caller phone numbers, SMS message content, and voicemail recordings are processed via Twilio. Twilio also delivers push notifications for incoming calls to native apps via APNs and FCM. <a href="https://www.twilio.com/en-us/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Twilio Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Deepgram</p>
              <p className="text-gray-400">Provides AI-powered audio transcription. Call recording audio is sent to Deepgram to generate transcripts, speaker identification, sentiment analysis, and topic detection. <a href="https://deepgram.com/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Deepgram Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Anthropic (Claude AI)</p>
              <p className="text-gray-400">Provides AI analysis for call recordings (summaries, call type, action items, coaching scores) and lawn area estimation from satellite imagery. Call transcript text and satellite images are sent to Anthropic&apos;s API for processing. <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Anthropic Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Jobber</p>
              <p className="text-gray-400">Your field service management software. You authorize Lynxedo to connect via Jobber&apos;s OAuth flow. You can disconnect at any time from Settings. <a href="https://getjobber.com/privacy-policy/" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Jobber Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Mapbox</p>
              <p className="text-gray-400">Provides map rendering, geocoding, road-time calculations, and satellite imagery. Stop addresses are sent to Mapbox to compute travel times and draw route geometry. <a href="https://www.mapbox.com/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Mapbox Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">OneStepGPS</p>
              <p className="text-gray-400">Provides real-time GPS tracking data for company fleet vehicles. Vehicle location, speed, and status are retrieved from OneStepGPS and displayed in the Fleet Tracker. <a href="https://onestepgps.com/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">OneStepGPS Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">QuickBooks Online (Intuit)</p>
              <p className="text-gray-400">Your accounting software. You authorize Lynxedo to read financial reports via QuickBooks OAuth. We request read-only access and never modify your QuickBooks data. You can disconnect at any time. <a href="https://www.intuit.com/privacy/statement/" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Intuit Privacy Statement →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Google (sign-in &amp; Android push notifications)</p>
              <p className="text-gray-400">We use Google OAuth for sign-in and Firebase Cloud Messaging (FCM) to deliver push notifications to Android devices. Google receives your name and email at sign-in, and Android device tokens are registered with FCM. <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Google Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Apple (iOS push notifications)</p>
              <p className="text-gray-400">We use Apple Push Notification service (APNs) to deliver incoming call alerts, voicemail notifications, and message notifications to iOS devices. Device push tokens are registered with APNs for this purpose. <a href="https://www.apple.com/legal/privacy/" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Apple Privacy Policy →</a></p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Resend</p>
              <p className="text-gray-400">Delivers transactional emails such as sign-in magic links. Recipient email addresses are passed to Resend for delivery only. <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Resend Privacy Policy →</a></p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Mobile App Permissions</h2>
          <div className="space-y-3">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Microphone</p>
              <p className="text-gray-400">Required to transmit your voice during phone calls. The microphone is accessed only while a call is active. Audio is not recorded unless call recording is enabled by your administrator.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Push notifications</p>
              <p className="text-gray-400">Used to alert you of incoming calls, new messages, and voicemails. You can disable notifications at any time in your device Settings.</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-white font-medium mb-1">Location (optional)</p>
              <p className="text-gray-400">Location access is requested only when you clock in or out using the time clock feature, and only if your administrator has enabled GPS capture for clock punches. Location is captured once at the moment of the punch — not continuously tracked in the background.</p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Data Retention</h2>
          <p>Your account settings and OAuth tokens are retained as long as your account is active. Team messages, call recordings, transcripts, and voicemails are retained indefinitely unless you or your administrator requests deletion. Employee timesheet records are retained for payroll and compliance purposes. QuickBooks financial data is not stored permanently — only temporarily cached (up to 4 hours) and discarded.</p>
          <p className="mt-3">You can request deletion of your account and all associated data by emailing us at <a href="mailto:support@lynxedo.com" className="text-orange-400 hover:text-orange-300">support@lynxedo.com</a>. We will remove all stored data within 30 days.</p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Security</h2>
          <p>All data in transit is encrypted via HTTPS/TLS. Supabase encrypts data at rest. OAuth tokens are stored with row-level security and are never exposed client-side. Financial data is protected by two independent authentication gates. Call recordings are stored in encrypted cloud storage and served via authenticated, time-limited URLs. We review our security posture regularly.</p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Children&apos;s Privacy</h2>
          <p>Lynxedo is a business operations platform intended for use by adults in a professional context. We do not knowingly collect personal information from anyone under 13 years of age.</p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Changes to This Policy</h2>
          <p>We may update this policy from time to time. We will update the &quot;Last updated&quot; date at the top of this page when we do. Continued use of the platform after changes constitutes acceptance of the revised policy.</p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Contact</h2>
          <p>Questions about this policy or your data? Email us at <a href="mailto:support@lynxedo.com" className="text-orange-400 hover:text-orange-300">support@lynxedo.com</a>.</p>
          <p className="mt-2 text-gray-500 text-xs">Lynxedo LLC · Dallas, TX</p>
        </section>
      </main>
    </div>
  )
}
