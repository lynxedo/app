import Link from 'next/link'

export const metadata = {
  title: 'SMS Text Messaging Terms & Opt-In — Heroes Lawn Care',
  description:
    'How customers opt in to receive text messages from Heroes Lawn Care of The Woodlands, TX, including consent terms, message frequency, and opt-out instructions.',
}

export default function HeroesSmsPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-800">
      {/* Header */}
      <header className="bg-emerald-700 text-white">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <p className="text-emerald-100 text-xs font-semibold tracking-widest uppercase">
            Heroes Lawn Care of The Woodlands
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold mt-2">
            SMS Text Messaging Terms &amp; Opt-In Policy
          </h1>
          <p className="text-emerald-100 text-sm mt-3 leading-relaxed">
            This page explains how you can sign up to receive text messages from
            Heroes Lawn Care, what kinds of messages we send, and how to stop them
            at any time.
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8 text-sm leading-relaxed">
        <p className="text-gray-500 text-xs">Last updated: May 31, 2026</p>

        {/* About the program */}
        <section>
          <h2 className="text-gray-900 font-semibold text-lg mb-3">
            About Our Text Messaging Program
          </h2>
          <p className="text-gray-700">
            Heroes Lawn Care of The Woodlands, TX (&quot;Heroes Lawn Care,&quot;
            &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) offers a text
            messaging program so we can stay in touch with our customers about
            their lawn and landscape services. When you opt in, you may receive
            text messages such as:
          </p>
          <ul className="list-disc pl-6 mt-3 space-y-1 text-gray-700">
            <li>Appointment reminders and scheduling confirmations</li>
            <li>&quot;On my way&quot; and arrival notifications from your technician</li>
            <li>Service updates and follow-ups about completed visits</li>
            <li>Account, billing, and invoice notifications</li>
            <li>Replies to questions and requests you send us</li>
          </ul>
        </section>

        {/* How to opt in */}
        <section>
          <h2 className="text-gray-900 font-semibold text-lg mb-3">
            How to Opt In (Sign Up)
          </h2>
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3 text-gray-700">
            <p>
              You can opt in to receive text messages from Heroes Lawn Care in any
              of the following ways:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <span className="font-medium text-gray-900">Text us first.</span>{' '}
                Send a text message to{' '}
                <span className="font-semibold text-emerald-700">
                  (832) 220-8100
                </span>
                . By texting us, you agree to receive text messages back from
                Heroes Lawn Care at the mobile number you texted from.
              </li>
              <li>
                <span className="font-medium text-gray-900">Reply to a message.</span>{' '}
                If we reach out to confirm your service, you can reply to opt in to
                ongoing text updates.
              </li>
              <li>
                <span className="font-medium text-gray-900">Give us your number.</span>{' '}
                Provide your mobile number to a Heroes Lawn Care team member (by
                phone, in person, or on a service request) and let us know you would
                like to receive text updates.
              </li>
            </ul>
            <p className="text-gray-600 text-xs pt-1">
              Your consent to receive text messages is{' '}
              <span className="font-semibold">not a condition</span> of purchasing
              any property, goods, or services from Heroes Lawn Care.
            </p>
          </div>
        </section>

        {/* Key terms */}
        <section>
          <h2 className="text-gray-900 font-semibold text-lg mb-3">
            Message Frequency &amp; Rates
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <p className="text-gray-900 font-medium mb-1">Message frequency</p>
              <p className="text-gray-600">
                Message frequency varies based on your service schedule and your
                communication with us. You may receive recurring messages.
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
              <p className="text-gray-900 font-medium mb-1">Message &amp; data rates</p>
              <p className="text-gray-600">
                Message and data rates may apply. Check with your mobile carrier for
                details about your plan.
              </p>
            </div>
          </div>
        </section>

        {/* Opt out / help */}
        <section>
          <h2 className="text-gray-900 font-semibold text-lg mb-3">
            How to Opt Out or Get Help
          </h2>
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3 text-gray-700">
            <p>
              <span className="font-medium text-gray-900">To opt out:</span> Reply{' '}
              <span className="font-semibold text-emerald-700">STOP</span> to any text
              message from us at any time. You will receive one final confirmation
              message and will not receive any further texts unless you opt in again.
            </p>
            <p>
              <span className="font-medium text-gray-900">For help:</span> Reply{' '}
              <span className="font-semibold text-emerald-700">HELP</span> to any text
              message, or contact us directly at the phone number or email below.
            </p>
          </div>
        </section>

        {/* Carrier disclaimer */}
        <section>
          <h2 className="text-gray-900 font-semibold text-lg mb-3">
            Carriers &amp; Delivery
          </h2>
          <p className="text-gray-700">
            Carriers are not liable for delayed or undelivered messages. Heroes Lawn
            Care is not responsible for any charges incurred from your wireless
            carrier as a result of receiving our text messages.
          </p>
        </section>

        {/* Privacy */}
        <section>
          <h2 className="text-gray-900 font-semibold text-lg mb-3">Privacy</h2>
          <p className="text-gray-700">
            We respect your privacy. The mobile information you share with us is used
            solely to communicate with you about your services and account.{' '}
            <span className="font-medium text-gray-900">
              We do not sell, rent, or share your mobile phone number or text
              messaging consent with third parties for their own marketing purposes.
            </span>{' '}
            Phone numbers and consent are not shared with third parties for
            marketing. See our{' '}
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
