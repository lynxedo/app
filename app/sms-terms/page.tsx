import Link from 'next/link'

export const metadata = {
  title: 'SMS Verbal Opt-In Consent Script — Heroes Lawn Care',
  description:
    'The verbal consent script Heroes Lawn Care of The Woodlands, TX reads to customers over the phone before collecting their mobile number and consent to receive text messages. Covers message purpose, frequency, rates, and STOP/HELP opt-out.',
}

export default function HeroesSmsConsentScriptPage() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      {/* Header */}
      <header className="bg-emerald-700 text-white">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <p className="text-emerald-100 text-xs font-semibold tracking-widest uppercase">
            Heroes Lawn Care of The Woodlands
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold mt-2">
            SMS Verbal Opt-In Consent Script
          </h1>
          <p className="text-emerald-100 text-sm mt-3 leading-relaxed">
            Heroes Lawn Care collects consent to send text messages{' '}
            <span className="font-semibold">verbally</span> — over the phone or in
            person. This page documents the exact script our representatives read
            aloud to a customer before collecting their mobile number and recording
            their consent to receive text messages.
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8 text-sm leading-relaxed">
        <p className="text-gray-500 text-xs">Last updated: May 31, 2026</p>

        {/* The verbal script */}
        <section>
          <h2 className="text-gray-900 font-semibold text-lg mb-3">
            Verbal Consent Script (Read Aloud to the Customer)
          </h2>
          <div className="bg-white border-l-4 border-emerald-600 border-y border-r border-gray-200 rounded-r-xl p-5 shadow-sm text-gray-800 space-y-4">
            <p>
              &ldquo;This is{' '}
              <span className="italic text-gray-500">[representative name]</span> with{' '}
              <span className="font-semibold">Heroes Lawn Care of The Woodlands</span>.
              I&rsquo;d like to send you text messages at your mobile number so we can
              keep you updated about your service. We use text messages for things
              like appointment reminders, &lsquo;on my way&rsquo; and arrival
              notifications, service updates, and billing or account notices, and to
              reply to questions you send us.
            </p>
            <p>
              Message frequency varies depending on your service schedule, and message
              and data rates may apply. You can reply <span className="font-semibold">STOP</span>{' '}
              at any time to opt out, or reply <span className="font-semibold">HELP</span>{' '}
              for help. Your consent to receive these text messages is{' '}
              <span className="font-semibold">not required</span> in order to purchase
              any goods or services from us.
            </p>
            <p>
              Do I have your permission to send recurring text messages to your mobile
              number at{' '}
              <span className="italic text-gray-500">[confirm or collect the customer&rsquo;s mobile number]</span>?&rdquo;
            </p>
            <p className="text-gray-600 text-xs pt-1 border-t border-gray-100">
              <span className="font-semibold text-gray-700">Representative:</span> Proceed
              only after the customer verbally answers &ldquo;yes.&rdquo; If the customer
              declines, do not enroll their number.
            </p>
          </div>
        </section>

        {/* What's covered */}
        <section>
          <h2 className="text-gray-900 font-semibold text-lg mb-3">
            Required Disclosures Covered in This Script
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <p className="text-gray-900 font-medium mb-1">Identity &amp; consent</p>
              <p className="text-gray-600">
                The representative identifies the business by name (Heroes Lawn Care)
                and asks for explicit permission to send text messages.
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <p className="text-gray-900 font-medium mb-1">Message purpose</p>
              <p className="text-gray-600">
                Appointment reminders, arrival notifications, service updates, billing
                and account notices, and replies to customer questions.
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <p className="text-gray-900 font-medium mb-1">Message frequency</p>
              <p className="text-gray-600">
                The customer is told that message frequency varies and that messages
                are recurring.
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <p className="text-gray-900 font-medium mb-1">Message &amp; data rates</p>
              <p className="text-gray-600">
                The customer is told that message and data rates may apply.
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <p className="text-gray-900 font-medium mb-1">Opt-out &amp; help</p>
              <p className="text-gray-600">
                The customer is told to reply STOP to opt out and HELP for help.
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <p className="text-gray-900 font-medium mb-1">Not required for purchase</p>
              <p className="text-gray-600">
                The customer is told that consent to receive texts is not a condition
                of purchasing any goods or services.
              </p>
            </div>
          </div>
        </section>

        {/* Record keeping */}
        <section>
          <h2 className="text-gray-900 font-semibold text-lg mb-3">
            How We Record Consent
          </h2>
          <p className="text-gray-700">
            When a customer verbally agrees, the Heroes Lawn Care representative
            records the customer&rsquo;s name, the mobile number provided, and the date
            and time consent was given. This record is retained as proof of opt-in. A
            customer may withdraw consent at any time by replying STOP to any message,
            or by contacting us using the information below.
          </p>
        </section>

        {/* Privacy */}
        <section>
          <h2 className="text-gray-900 font-semibold text-lg mb-3">Privacy</h2>
          <p className="text-gray-700">
            We respect your privacy. The mobile information collected during this
            opt-in is used solely to communicate with you about your services and
            account.{' '}
            <span className="font-medium text-gray-900">
              We do not sell, rent, or share your mobile phone number or text messaging
              consent with third parties for their own marketing purposes.
            </span>{' '}
            See our{' '}
            <Link
              href="/privacy"
              className="text-emerald-700 font-medium hover:text-emerald-800 underline"
            >
              Privacy Policy
            </Link>{' '}
            for more information about how your data is handled.
          </p>
        </section>

        {/* Contact */}
        <section>
          <h2 className="text-gray-900 font-semibold text-lg mb-3">Contact Us</h2>
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-1 text-gray-700">
            <p className="font-medium text-gray-900">Heroes Lawn Care of The Woodlands</p>
            <p>
              Text/Phone:{' '}
              <a
                href="tel:+18322208100"
                className="text-emerald-700 font-medium hover:text-emerald-800"
              >
                (832) 220-8100
              </a>
            </p>
            <p>
              Email:{' '}
              <a
                href="mailto:support@heroeslawntx.com"
                className="text-emerald-700 font-medium hover:text-emerald-800"
              >
                support@heroeslawntx.com
              </a>
            </p>
            <p>
              Web:{' '}
              <a
                href="https://www.heroeslawntx.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-700 font-medium hover:text-emerald-800"
              >
                heroeslawntx.com
              </a>
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-3xl mx-auto px-6 py-6 text-xs text-gray-500">
          © Heroes Lawn Care of The Woodlands, TX. All rights reserved.
        </div>
      </footer>
    </div>
  )
}
