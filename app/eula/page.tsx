import Link from 'next/link'

export const metadata = {
  title: 'End User License Agreement — Lynxedo',
}

export default function EulaPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-gray-400 hover:text-white text-sm transition-colors">
          ← Home
        </Link>
        <h1 className="text-xl font-bold tracking-tight">End User License Agreement</h1>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-8 text-sm text-gray-300 leading-relaxed">
        <p className="text-gray-500 text-xs">Last updated: May 15, 2026</p>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Agreement</h2>
          <p>
            This End User License Agreement (&quot;Agreement&quot;) is between Lynxedo (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;)
            and the individual or organization accessing or using the Lynxedo platform (&quot;you&quot; or &quot;User&quot;).
            By accessing or using Lynxedo, you agree to be bound by the terms of this Agreement.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">License Grant</h2>
          <p>
            We grant you a limited, non-exclusive, non-transferable license to access and use the Lynxedo
            platform solely for your internal business operations. This license is granted only to authorized
            users of your organization and may not be sublicensed or transferred to any third party.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Authorized Use</h2>
          <p>Lynxedo is intended for use by authorized employees and administrators of your organization. You agree to:</p>
          <ul className="mt-3 space-y-2 list-disc list-inside text-gray-400">
            <li>Use the platform only for lawful business purposes</li>
            <li>Keep your login credentials confidential and not share access with unauthorized individuals</li>
            <li>Ensure that any connected third-party accounts (Jobber, QuickBooks, etc.) are accounts you are authorized to access</li>
            <li>Not attempt to reverse engineer, copy, or resell any part of the platform</li>
            <li>Not use the platform in any way that could damage, disable, or impair our servers or services</li>
          </ul>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">QuickBooks Integration</h2>
          <p>
            Lynxedo connects to QuickBooks Online via Intuit&apos;s OAuth 2.0 authorization framework.
            By connecting your QuickBooks account, you authorize Lynxedo to read financial data
            (profit &amp; loss reports, revenue, expense data) from your QuickBooks company file on your behalf.
          </p>
          <p className="mt-3">Lynxedo requests read-only access and does not create, modify, or delete any data in your QuickBooks account. You may revoke this authorization at any time by disconnecting QuickBooks from the platform settings. Lynxedo&apos;s use of QuickBooks data is governed by <a href="https://www.intuit.com/privacy/statement/" target="_blank" rel="noopener noreferrer" className="text-orange-400 hover:text-orange-300">Intuit&apos;s Privacy Statement</a> in addition to this Agreement.</p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Intellectual Property</h2>
          <p>
            All software, design, and content comprising the Lynxedo platform is our proprietary property.
            Nothing in this Agreement transfers any ownership rights to you. Your data remains yours —
            we claim no ownership over the business information you access or display through the platform.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">No Warranty</h2>
          <p>
            The Lynxedo platform is provided &quot;as is&quot; without warranty of any kind. We do not warrant
            that the platform will be error-free, uninterrupted, or that financial data retrieved from
            connected services will be accurate or complete. You are responsible for verifying the accuracy
            of any data displayed and for all decisions made based on that data.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Limitation of Liability</h2>
          <p>
            To the maximum extent permitted by applicable law, Lynxedo shall not be liable for any
            indirect, incidental, special, or consequential damages arising from your use of the platform,
            including but not limited to loss of revenue, loss of data, or business interruption — even
            if we have been advised of the possibility of such damages.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Termination</h2>
          <p>
            We reserve the right to suspend or terminate your access to Lynxedo at any time if you
            violate the terms of this Agreement. You may discontinue use at any time. Upon termination,
            your license to use the platform ceases immediately.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Governing Law</h2>
          <p>
            This Agreement is governed by the laws of the State of Texas, without regard to its conflict
            of law provisions.
          </p>
        </section>

        <section>
          <h2 className="text-white font-semibold text-base mb-3">Contact</h2>
          <p>Questions about this Agreement? Email us at <a href="mailto:support@lynxedo.com" className="text-orange-400 hover:text-orange-300">support@lynxedo.com</a>.</p>
        </section>
      </main>
    </div>
  )
}
