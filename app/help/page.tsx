import Link from 'next/link'

export const metadata = {
  title: 'Help — Lynxedo',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 className="text-white font-semibold text-lg mb-4">{title}</h2>
      <div className="space-y-3 text-sm text-gray-300 leading-relaxed">{children}</div>
    </section>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-orange-500/20 text-orange-400 text-xs font-bold flex items-center justify-center mt-0.5">{n}</span>
      <p>{children}</p>
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-gray-400 text-xs">
      {children}
    </div>
  )
}

function ToolHeading({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-3 pt-4">
      <span className="text-2xl">{icon}</span>
      <h2 className="text-white text-xl font-bold tracking-tight">{label}</h2>
    </div>
  )
}

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">
          ← Dashboard
        </Link>
        <h1 className="text-xl font-bold tracking-tight">Help</h1>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-6">

        {/* Quick nav */}
        <nav className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <p className="text-xs text-gray-400 mb-3 font-medium uppercase tracking-wide">On this page</p>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide">⚡ Route Optimizer</p>
              <div className="grid grid-cols-2 gap-1.5 text-sm">
                {[
                  ['#first-time', 'First-time setup'],
                  ['#settings-profile', 'Profile'],
                  ['#settings-duration', 'On-Site Duration'],
                  ['#settings-routing', 'Routing Defaults'],
                  ['#settings-depot', 'Depot'],
                  ['#settings-jobber', 'Jobber Connection'],
                  ['#building-route', 'Building a route'],
                  ['#sending', 'Sending to Jobber'],
                  ['#printing', 'Printing the route sheet'],
                  ['#tips', 'Tips & troubleshooting'],
                ].map(([href, label]) => (
                  <a key={href} href={href} className="text-orange-400 hover:text-orange-300 transition-colors">{label}</a>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide">🌿 Lawn Sizer</p>
              <div className="grid grid-cols-2 gap-1.5 text-sm">
                {[
                  ['#lawn-how', 'How to use it'],
                  ['#lawn-results', 'Reading the results'],
                ].map(([href, label]) => (
                  <a key={href} href={href} className="text-orange-400 hover:text-orange-300 transition-colors">{label}</a>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide">📋 Call Log</p>
              <div className="grid grid-cols-2 gap-1.5 text-sm">
                {[
                  ['#calllog-browse', 'Browsing calls'],
                  ['#calllog-detail', 'Call detail & audio'],
                ].map(([href, label]) => (
                  <a key={href} href={href} className="text-orange-400 hover:text-orange-300 transition-colors">{label}</a>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide">📱 Responder</p>
              <div className="grid grid-cols-2 gap-1.5 text-sm">
                {[
                  ['#responder-how', 'How it works'],
                  ['#responder-setup', 'Configuration'],
                ].map(([href, label]) => (
                  <a key={href} href={href} className="text-orange-400 hover:text-orange-300 transition-colors">{label}</a>
                ))}
              </div>
            </div>
          </div>
        </nav>

        {/* ── ROUTE OPTIMIZER ── */}
        <ToolHeading icon="⚡" label="Route Optimizer" />

        {/* First-time setup */}
        <div id="first-time">
          <Section title="First-Time Setup">
            <Step n={1}>Sign in with your email. You&apos;ll get a magic link — no password needed.</Step>
            <Step n={2}>Go to <Link href="/settings" className="text-orange-400 hover:text-orange-300">Settings</Link> and set your <strong className="text-white">Depot address</strong> — this is where the route starts and ends (your shop, warehouse, or home base).</Step>
            <Step n={3}>Connect your Jobber account under <strong className="text-white">Jobber Connection</strong>. Click &quot;Connect Jobber →&quot; and authorize in the popup.</Step>
            <Step n={4}>Configure your <strong className="text-white">On-Site Duration</strong> method (see below). This tells the optimizer how long each stop takes.</Step>
            <Step n={5}>Head to the <Link href="/routing" className="text-orange-400 hover:text-orange-300">Route Optimizer</Link> and build your first route.</Step>
          </Section>
        </div>

        {/* Profile */}
        <div id="settings-profile">
          <Section title="Settings — Profile">
            <p><strong className="text-white">Display name</strong> — shown on the printed route sheet header. Set this to your company name or the tech&apos;s name.</p>
            <p><strong className="text-white">Email</strong> — read-only. This is the address you signed in with.</p>
            <p>Use the <strong className="text-white">Sign out</strong> link here when you&apos;re done.</p>
          </Section>
        </div>

        {/* On-Site Duration */}
        <div id="settings-duration">
          <Section title="Settings — On-Site Duration">
            <p>Controls how many minutes the optimizer budgets for each stop. Choose one of two methods:</p>

            <div className="border border-gray-700 rounded-xl p-4 mt-2">
              <p className="text-white font-medium mb-2">Default Time</p>
              <p>Every stop gets the same fixed number of minutes. Good for crews that run similar services all day. Set the minutes under <em>Minimum per stop</em>.</p>
              <p className="mt-2">Assessments/requests get their own fixed duration (📋 badge stops don&apos;t have line items to calculate from).</p>
            </div>

            <div className="border border-gray-700 rounded-xl p-4">
              <p className="text-white font-medium mb-2">Formula (Line Items)</p>
              <p>Calculates a different duration for each stop based on what services are on that visit. More accurate — especially when one crew does both quick and long jobs on the same day.</p>

              <p className="mt-3 text-white font-medium text-xs uppercase tracking-wide">How to set it up:</p>
              <div className="space-y-2 mt-2">
                <Step n={1}>Click <strong className="text-white">↻ Refresh from Jobber</strong> to pull your full list of line items. This requires Jobber to be connected.</Step>
                <Step n={2}>For each line item that affects how long the job takes, use the dropdown to select it and enter the minutes it adds.</Step>
                <Step n={3}>All matching line items on a visit are summed together.</Step>
                <Step n={4}>Optionally check <strong className="text-white">Add lawn size (K = minutes)</strong> — if a visit&apos;s job title contains &quot;6K&quot;, that adds 6 minutes.</Step>
                <Step n={5}>Set <strong className="text-white">Padding</strong> — extra minutes added to every stop (door-to-door walkup, loading, etc.).</Step>
                <Step n={6}>Set <strong className="text-white">Minimum</strong> — no stop will be calculated below this floor.</Step>
                <Step n={7}>Set <strong className="text-white">Assessments</strong> — fixed duration for 📋 stops (they have no line items).</Step>
              </div>
            </div>

            <Note>
              💡 If a stop can&apos;t be calculated (no matching line items), it falls back to the <em>Default service time</em> from Routing Defaults. A yellow banner appears on that stop in the route list.
            </Note>
          </Section>
        </div>

        {/* Routing Defaults */}
        <div id="settings-routing">
          <Section title="Settings — Routing Defaults">
            <p><strong className="text-white">Default service time per stop</strong> — the fallback duration used when the Formula method can&apos;t calculate a stop. Also used when method is set to Default Time.</p>
            <p><strong className="text-white">Avg drive speed (mph)</strong> — used as a rough estimate for drive times when Mapbox road data isn&apos;t available. Real road times from Mapbox replace this whenever possible.</p>
          </Section>
        </div>

        {/* Depot */}
        <div id="settings-depot">
          <Section title="Settings — Depot">
            <p>The <strong className="text-white">depot</strong> is the starting and ending point for every route — typically your office, shop, or home base.</p>
            <p>Enter the full street address and click Save. Lynxedo will geocode it and confirm the coordinates with a green ✓. The optimizer routes from depot → all stops → back to depot.</p>
            <Note>If the green ✓ doesn&apos;t appear after saving, the address couldn&apos;t be geocoded. Try adding the full city and state.</Note>
          </Section>
        </div>

        {/* Jobber Connection */}
        <div id="settings-jobber">
          <Section title="Settings — Jobber Connection">
            <p>Click <strong className="text-white">Connect Jobber →</strong> to authorize Lynxedo to read your visits and write appointment times. You&apos;ll be redirected to Jobber to approve the connection.</p>
            <p>Once connected, the status shows <span className="text-green-400 font-medium">● Connected</span>. You can disconnect at any time — this revokes Lynxedo&apos;s access to your Jobber account.</p>
            <Note>⚠️ If visits aren&apos;t loading, try disconnecting and reconnecting Jobber. The OAuth token occasionally needs a refresh.</Note>
          </Section>
        </div>

        {/* Building a route */}
        <div id="building-route">
          <Section title="Building a Route">
            <Step n={1}><strong className="text-white">Select a tech</strong> — choose the team member whose visits you&apos;re routing. The list pulls from your Jobber users.</Step>
            <Step n={2}><strong className="text-white">Pick a date</strong> — defaults to today. Change it to route a future or past day.</Step>
            <Step n={3}><strong className="text-white">Set a start time</strong> — when the tech leaves the depot. Used to calculate ETAs for every stop.</Step>
            <Step n={4}><strong className="text-white">Load Stops</strong> — fetches all visits and assessments scheduled for that tech on that date from Jobber.</Step>
            <Step n={5}><strong className="text-white">Optimize</strong> — reorders the stops to minimize total drive time using real road distances. The depot is always locked as the first and last point.</Step>
            <p className="mt-2">After optimizing, you&apos;ll see each stop with:</p>
            <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
              <li>ETA and on-site duration</li>
              <li>Drive time from the previous stop</li>
              <li>Client name, address, and job details</li>
              <li>📋 badge = assessment/request stop</li>
              <li>🗺 badge = road times calculated (vs straight-line estimate)</li>
              <li>Yellow banner = duration fell back to default (no matching line items)</li>
            </ul>
          </Section>
        </div>

        {/* Drag to reorder */}
        <div>
          <Section title="Reordering Stops Manually">
            <p>After loading or optimizing, you can drag stops up or down in the list to adjust the order manually.</p>
            <p>After reordering, click <strong className="text-white">Recalculate</strong> to update all ETAs and drive times based on the new sequence. The depot is always locked first and last.</p>
          </Section>
        </div>

        {/* Sending */}
        <div id="sending">
          <Section title="Sending Appointment Times to Jobber">
            <p>Once you&apos;re happy with the route, click <strong className="text-white">Send to Jobber</strong>. This writes the calculated ETA as the scheduled appointment time for each visit in Jobber.</p>
            <p>Each stop shows a ✓ or an error after sending. Assessment stops are included — their times are set the same way.</p>
            <Note>⚠️ Sending overwrites any existing appointment times on those visits. If a visit already has a scheduled time in Jobber, it will be replaced.</Note>
          </Section>
        </div>

        {/* Printing */}
        <div id="printing">
          <Section title="Printing the Route Sheet">
            <p>Click <strong className="text-white">Print Route Sheet</strong> to open a printable version in a new tab. The sheet has two sections:</p>
            <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
              <li><strong className="text-white">Page 1 (landscape)</strong> — a map showing the full route with numbered stops and road geometry overlaid</li>
              <li><strong className="text-white">Following pages (portrait)</strong> — one card per stop with client name, address, phone, job title, services, and special instructions</li>
            </ul>
            <p>Use your browser&apos;s Print dialog (Cmd+P / Ctrl+P) from the new tab. Set margins to None or Minimum for best results.</p>
          </Section>
        </div>

        {/* Tips */}
        <div id="tips">
          <Section title="Tips &amp; Troubleshooting">
            <div className="space-y-4">
              <div>
                <p className="text-white font-medium mb-1">Stops aren&apos;t loading</p>
                <p>Check that Jobber is connected (Settings → Jobber Connection shows ● Connected). If it is, try disconnecting and reconnecting — the token may have expired.</p>
              </div>
              <div>
                <p className="text-white font-medium mb-1">Drive times look like estimates, not real road times</p>
                <p>The 🗺 badge means real Mapbox road times were used. If it&apos;s missing, the route has more than 25 stops — Mapbox&apos;s Matrix API caps at 25 locations (depot + 24 stops). Above that limit, straight-line distances are used as a fallback.</p>
              </div>
              <div>
                <p className="text-white font-medium mb-1">Duration formula isn&apos;t calculating a stop</p>
                <p>A yellow warning banner appears on stops that fell back to the default time. This usually means none of the stop&apos;s line items match any entries in your Formula rules. Open Settings → On-Site Duration and check your line item names for exact matches (spelling and capitalization matter).</p>
              </div>
              <div>
                <p className="text-white font-medium mb-1">Line item dropdown in Settings is empty</p>
                <p>Click <strong className="text-white">↻ Refresh from Jobber</strong> to pull your current line items. Jobber must be connected. After refreshing, click Save — the list is cached so it loads instantly next time.</p>
              </div>
              <div>
                <p className="text-white font-medium mb-1">Assessment shows wrong address or is missing</p>
                <p>Assessments use a different address field than regular visits. If an address is missing, it may not be set on that request in Jobber. Check the request record directly in Jobber and add the property address.</p>
              </div>
            </div>
          </Section>
        </div>

        {/* ── LAWN SIZER ── */}
        <ToolHeading icon="🌿" label="Lawn Sizer" />

        <div id="lawn-how">
          <Section title="How to Use It">
            <p>Lawn Sizer estimates the mowable square footage of a property using satellite imagery and county parcel data. Use it to size new leads before quoting.</p>
            <Step n={1}><strong className="text-white">Enter the property address</strong> and click <strong className="text-white">Calculate</strong>. Lynxedo geocodes the address and pulls parcel data from the county.</Step>
            <Step n={2}><strong className="text-white">Quick result</strong> appears first — a single AI analysis of the satellite image. If confidence is HIGH ✅, you&apos;re done.</Step>
            <Step n={3}>If confidence is MEDIUM ⚠️ or FLAG 🚩, the tool automatically runs <strong className="text-white">Advanced mode</strong> — three separate AI analyses averaged together for a more reliable estimate.</Step>
            <Note>The tool covers Montgomery County (MCAD) and Harris County (HCAD) properties. Addresses outside those counties may still work but parcel data may be limited.</Note>
          </Section>
        </div>

        <div id="lawn-results">
          <Section title="Reading the Results">
            <p>The result card shows several measurements broken out from the total lot:</p>
            <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
              <li><strong className="text-white">Lot sqft</strong> — total parcel size from county records</li>
              <li><strong className="text-white">Building sqft</strong> — structure footprint (excluded from lawn)</li>
              <li><strong className="text-white">Driveway / hardscape sqft</strong> — estimated paved area (excluded)</li>
              <li><strong className="text-white">Tree canopy sqft</strong> — areas with significant tree cover (excluded)</li>
              <li><strong className="text-white">Visible lawn sqft</strong> — the mowable estimate used for quoting</li>
            </ul>

            <p className="mt-2">Confidence tiers:</p>
            <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
              <li><strong className="text-white">HIGH ✅</strong> — all three AI runs closely agreed. Use the number.</li>
              <li><strong className="text-white">MEDIUM ⚠️</strong> — moderate variance across runs. Use with a sanity check.</li>
              <li><strong className="text-white">FLAG 🚩</strong> — high variance or unusual property. Treat as a rough estimate only.</li>
            </ul>

            <Note>Pool presence is also detected. If a pool is found, it&apos;s noted in the result — pools affect hardscape area and can shift the lawn estimate.</Note>
          </Section>
        </div>

        {/* ── CALL LOG ── */}
        <ToolHeading icon="📋" label="Call Log" />

        <div id="calllog-browse">
          <Section title="Browsing Calls">
            <p>The Call Log shows every recorded call processed by the Unitel system, with AI summaries and transcripts. New calls appear automatically within a few minutes of the call ending.</p>
            <p><strong className="text-white">Filters</strong> — narrow the list by date range, phone number, or customer/rep name. All filters work together.</p>
            <p><strong className="text-white">Must-Listen flag</strong> — calls the AI flagged as especially noteworthy (unusual situation, missed opportunity, coaching moment) are marked in the list.</p>
            <p><strong className="text-white">Call type</strong> — each call is categorized: New Lead, Existing Customer, Vendor, Wrong Number, Voicemail, or Other.</p>
          </Section>
        </div>

        <div id="calllog-detail">
          <Section title="Call Detail &amp; Audio">
            <p>Click any call in the list to open the detail panel on the right.</p>
            <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
              <li><strong className="text-white">Audio player</strong> — play the recording directly in the browser. Click anywhere on the progress bar to seek.</li>
              <li><strong className="text-white">AI summary</strong> — a short paragraph describing what happened on the call.</li>
              <li><strong className="text-white">Action items</strong> — specific follow-ups the AI identified from the conversation.</li>
              <li><strong className="text-white">Coaching feedback</strong> — wins and areas for improvement noted by the AI.</li>
              <li><strong className="text-white">Transcript</strong> — full speaker-labeled transcript, collapsible. Speaker labels are AI-generated (Rep / Customer).</li>
            </ul>
            <Note>Historical calls (before May 2026) have transcripts and basic info but no AI coaching grades — those only run on new calls going forward.</Note>
          </Section>
        </div>

        {/* ── RESPONDER ── */}
        <ToolHeading icon="📱" label="Responder" />

        <div id="responder-how">
          <Section title="How It Works">
            <p>Responder automatically texts customers who called but didn&apos;t reach anyone. When a call goes unanswered, Unitel forwards it to a Twilio number — Responder picks it up, records a voicemail, and sends a text via Captivated so the conversation continues there.</p>
            <ul className="list-disc list-inside text-gray-400 space-y-1 ml-2">
              <li>Only fires during configured business hours (or always, if set to 24/7)</li>
              <li>Uses different templates for business hours vs. after hours</li>
              <li>Voicemail recording is transcribed and emailed to your notification address</li>
              <li>All activity is logged in the Recent Activity section</li>
            </ul>
          </Section>
        </div>

        <div id="responder-setup">
          <Section title="Configuration">
            <p><strong className="text-white">Active toggle</strong> — turn Responder on or off. When off, no texts are sent and no voicemails are recorded.</p>
            <p><strong className="text-white">Business days &amp; hours</strong> — set which days and the start/end time for your business hours window. Calls outside this window use the after-hours template.</p>
            <p><strong className="text-white">Text templates</strong> — the message sent to the customer. Use <code className="bg-gray-800 px-1 rounded text-orange-300">{'{first_name}'}</code> to personalize with the customer&apos;s name if known.</p>
            <p><strong className="text-white">Voicemail greeting</strong> — what the caller hears before the beep. Keep it short and friendly.</p>
            <p><strong className="text-white">Notification email</strong> — where voicemail transcripts are sent after each missed call.</p>
            <Note>Twilio must be set up and Unitel call forwarding must be configured for Responder to receive calls. Contact support if you need help with that setup.</Note>
          </Section>
        </div>

        <div className="flex flex-col items-center gap-3 py-4">
          <p className="text-gray-500 text-sm">Can&apos;t find what you&apos;re looking for?</p>
          <a
            href="mailto:support@lynxedo.com?subject=Lynxedo%20Support%20Request"
            className="inline-block bg-orange-600 hover:bg-orange-500 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
          >
            Contact Support
          </a>
        </div>
      </main>
    </div>
  )
}
