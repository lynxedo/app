import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Image from 'next/image'

export const metadata = {
  title: 'Lynxedo — Operations Platform for Home Services',
  description: 'Scheduling, communication, and routing tools that supplement your CRM — built for field service businesses.',
}

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/hub')

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #0a0f1a;
          --surface: #111827;
          --border: rgba(255,255,255,0.08);
          --amber: #f59e0b;
          --amber-dim: rgba(245,158,11,0.12);
          --amber-glow: rgba(245,158,11,0.25);
          --text: #f9fafb;
          --muted: #9ca3af;
        }
        .home-body {
          background: var(--bg);
          color: var(--text);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          line-height: 1.6;
          -webkit-font-smoothing: antialiased;
        }
        /* NAV */
        .hn-nav {
          position: sticky; top: 0; z-index: 100;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 2rem; height: 60px;
          background: rgba(10,15,26,0.88);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid var(--border);
        }
        .hn-nav-logo { display: flex; align-items: center; text-decoration: none; }
        .hn-nav-logo img { height: 26px; width: auto; display: block; }
        .hn-nav-cta {
          background: var(--amber); color: #0a0f1a;
          font-weight: 700; font-size: 0.875rem;
          padding: 0.45rem 1.1rem; border-radius: 7px;
          text-decoration: none; transition: opacity 0.15s;
        }
        .hn-nav-cta:hover { opacity: 0.88; }
        /* HERO */
        .hn-hero {
          max-width: 760px; margin: 0 auto;
          padding: 7rem 2rem 5rem; text-align: center;
        }
        .hn-badge {
          display: inline-flex; align-items: center; gap: 0.4rem;
          background: var(--amber-dim); border: 1px solid var(--amber-glow);
          color: var(--amber); font-size: 0.78rem; font-weight: 600;
          letter-spacing: 0.04em; text-transform: uppercase;
          padding: 0.3rem 0.85rem; border-radius: 999px; margin-bottom: 1.75rem;
        }
        .hn-h1 {
          font-size: clamp(2.25rem, 5vw, 3.5rem); font-weight: 800;
          letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 1.4rem;
        }
        .hn-h1 span { color: var(--amber); }
        .hn-hero-sub {
          font-size: 1.15rem; color: var(--muted);
          max-width: 560px; margin: 0 auto 2.5rem;
        }
        .hn-actions { display: flex; gap: 0.85rem; justify-content: center; flex-wrap: wrap; }
        .hn-btn-primary {
          background: var(--amber); color: #0a0f1a; font-weight: 700;
          font-size: 0.95rem; padding: 0.7rem 1.6rem; border-radius: 9px;
          text-decoration: none; display: inline-block; transition: opacity 0.15s;
        }
        .hn-btn-primary:hover { opacity: 0.88; }
        .hn-btn-ghost {
          background: transparent; color: var(--text); font-weight: 600;
          font-size: 0.95rem; padding: 0.7rem 1.6rem; border-radius: 9px;
          text-decoration: none; border: 1px solid var(--border); display: inline-block;
          transition: border-color 0.15s, background 0.15s;
        }
        .hn-btn-ghost:hover { border-color: rgba(255,255,255,0.18); background: rgba(255,255,255,0.04); }
        /* FEATURES */
        .hn-features { max-width: 1000px; margin: 0 auto; padding: 5rem 2rem; }
        .hn-section-label {
          text-align: center; font-size: 0.78rem; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase;
          color: var(--amber); margin-bottom: 0.75rem;
        }
        .hn-section-title {
          text-align: center; font-size: clamp(1.6rem, 3vw, 2.2rem);
          font-weight: 700; letter-spacing: -0.025em; margin-bottom: 0.6rem;
        }
        .hn-section-sub {
          text-align: center; color: var(--muted); font-size: 1rem;
          max-width: 520px; margin: 0 auto 3.5rem;
        }
        .hn-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
          gap: 1.25rem;
        }
        .hn-card {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 14px; padding: 1.75rem;
          transition: border-color 0.2s;
        }
        .hn-card:hover { border-color: rgba(245,158,11,0.3); }
        .hn-card-icon {
          width: 42px; height: 42px; background: var(--amber-dim);
          border-radius: 10px; display: flex; align-items: center;
          justify-content: center; margin-bottom: 1rem; color: var(--amber);
        }
        .hn-card h3 { font-size: 1rem; font-weight: 700; margin-bottom: 0.4rem; }
        .hn-card p { font-size: 0.875rem; color: var(--muted); line-height: 1.55; }
        /* HOW */
        .hn-how { background: var(--surface); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
        .hn-how-inner { max-width: 860px; margin: 0 auto; padding: 5rem 2rem; }
        .hn-steps { display: flex; flex-direction: column; gap: 2rem; margin-top: 3.5rem; }
        .hn-step { display: flex; gap: 1.5rem; align-items: flex-start; }
        .hn-step-num {
          width: 36px; height: 36px; border-radius: 50%;
          background: var(--amber-dim); border: 1px solid var(--amber-glow);
          color: var(--amber); font-weight: 700; font-size: 0.9rem;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; margin-top: 2px;
        }
        .hn-step h4 { font-size: 1rem; font-weight: 700; margin-bottom: 0.25rem; }
        .hn-step p { font-size: 0.9rem; color: var(--muted); }
        /* INDUSTRIES */
        .hn-industries { max-width: 860px; margin: 0 auto; padding: 5rem 2rem; text-align: center; }
        .hn-pills { display: flex; flex-wrap: wrap; gap: 0.6rem; justify-content: center; margin-top: 2rem; }
        .hn-pill {
          background: var(--surface); border: 1px solid var(--border);
          color: var(--muted); font-size: 0.875rem;
          padding: 0.4rem 1rem; border-radius: 999px;
        }
        /* CTA */
        .hn-cta { max-width: 680px; margin: 0 auto; padding: 0 2rem 7rem; text-align: center; }
        .hn-cta-box {
          background: var(--surface); border: 1px solid var(--border);
          border-radius: 18px; padding: 3.5rem 2.5rem;
        }
        .hn-cta-box h2 {
          font-size: clamp(1.5rem, 3vw, 2rem); font-weight: 700;
          letter-spacing: -0.025em; margin-bottom: 0.75rem;
        }
        .hn-cta-box p { color: var(--muted); margin-bottom: 2rem; font-size: 0.975rem; }
        /* FOOTER */
        .hn-footer {
          border-top: 1px solid var(--border); padding: 2rem;
          display: flex; align-items: center; justify-content: space-between;
          flex-wrap: wrap; gap: 1rem;
        }
        .hn-footer-logo { display: flex; align-items: center; text-decoration: none; }
        .hn-footer-logo img { height: 20px; width: auto; display: block; }
        .hn-footer-links { display: flex; gap: 1.5rem; }
        .hn-footer-links a {
          color: var(--muted); text-decoration: none;
          font-size: 0.85rem; transition: color 0.15s;
        }
        .hn-footer-links a:hover { color: var(--text); }
        .hn-footer-copy { color: var(--muted); font-size: 0.8rem; }
        @media (max-width: 540px) {
          .hn-footer { flex-direction: column; text-align: center; }
          .hn-footer-links { justify-content: center; }
        }
      `}</style>

      <div className="home-body">
        {/* NAV */}
        <nav className="hn-nav">
          <a href="/" className="hn-nav-logo">
            <Image src="/lynxedo-logo.svg" alt="Lynxedo" width={160} height={26} priority />
          </a>
          <a href="/login" className="hn-nav-cta">Sign In</a>
        </nav>

        {/* HERO */}
        <section className="hn-hero">
          <div className="hn-badge">
            <svg width="8" height="8" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4"/></svg>
            Built for Field Service Teams
          </div>
          <h1 className="hn-h1">Operations tools that<br/><span>fit your workflow</span></h1>
          <p className="hn-hero-sub">
            Lynxedo gives home service businesses the scheduling, communication,
            and routing tools that CRMs don&rsquo;t quite cover &mdash; without replacing the software you already use.
          </p>
          <div className="hn-actions">
            <a href="/login" className="hn-btn-primary">Get Started</a>
            <a href="#features" className="hn-btn-ghost">See What&rsquo;s Included</a>
          </div>
        </section>

        {/* FEATURES */}
        <section className="hn-features" id="features">
          <p className="hn-section-label">Platform</p>
          <h2 className="hn-section-title">Everything in one place</h2>
          <p className="hn-section-sub">A connected layer on top of your CRM &mdash; no data migration, no rip-and-replace.</p>

          <div className="hn-grid">
            <div className="hn-card">
              <div className="hn-card-icon">
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
                </svg>
              </div>
              <h3>Route Optimization</h3>
              <p>Build efficient daily routes from your existing job list. Drag-and-drop reorder, pin first/last stops, and send directly back to your CRM.</p>
            </div>

            <div className="hn-card">
              <div className="hn-card-icon">
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
                </svg>
              </div>
              <h3>Team Messaging Hub</h3>
              <p>Rooms, direct messages, and threaded replies &mdash; all in one place. Connects to Slack so office and field stay in sync without switching apps.</p>
            </div>

            <div className="hn-card">
              <div className="hn-card-icon">
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                </svg>
              </div>
              <h3>Daily Log</h3>
              <p>Techs check in, post updates, and mark routes complete from the field. Office sees real-time progress without calling or texting for status.</p>
            </div>

            <div className="hn-card">
              <div className="hn-card-icon">
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
                </svg>
              </div>
              <h3>Business Phone &amp; SMS</h3>
              <p>Outbound and inbound calling, voicemail, IVR menus, and two-way SMS &mdash; all routed through one business number your whole team shares.</p>
            </div>

            <div className="hn-card">
              <div className="hn-card-icon">
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                  <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
              </div>
              <h3>Fleet Tracking</h3>
              <p>Live GPS map of every vehicle. Speed and after-hours alerts notify you automatically &mdash; no dashboard-watching required.</p>
            </div>

            <div className="hn-card">
              <div className="hn-card-icon">
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                </svg>
              </div>
              <h3>AI Assistant</h3>
              <p>@Guardian answers questions about your jobs, customers, and schedule &mdash; and can take actions in your CRM directly from the chat window.</p>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="hn-how">
          <div className="hn-how-inner">
            <p className="hn-section-label">How It Works</p>
            <h2 className="hn-section-title">Connects to the tools you already use</h2>
            <p className="hn-section-sub" style={{margin: '0 auto'}}>No data migration. Works alongside your CRM.</p>
            <div className="hn-steps">
              <div className="hn-step">
                <div className="hn-step-num">1</div>
                <div>
                  <h4>Connect your CRM</h4>
                  <p>Authenticate with your existing CRM via OAuth. Lynxedo reads your customers, jobs, and schedule &mdash; nothing gets replaced.</p>
                </div>
              </div>
              <div className="hn-step">
                <div className="hn-step-num">2</div>
                <div>
                  <h4>Invite your team</h4>
                  <p>Office staff, field techs, and managers each get role-based access. Permissions control who sees what.</p>
                </div>
              </div>
              <div className="hn-step">
                <div className="hn-step-num">3</div>
                <div>
                  <h4>Run your day from one screen</h4>
                  <p>Routes, comms, daily logs, and phone calls &mdash; all inside Lynxedo. Changes sync back to your CRM automatically.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* INDUSTRIES */}
        <section className="hn-industries">
          <p className="hn-section-label">Industries</p>
          <h2 className="hn-section-title">Built for home service businesses</h2>
          <p className="hn-section-sub">If you have a field team and a route, Lynxedo was made for you.</p>
          <div className="hn-pills">
            {['Lawn Care','Landscaping','HVAC','Plumbing','Pest Control','Pool Service','Cleaning','Irrigation','Tree Service','Snow Removal','Painting','Electrical'].map(i => (
              <span key={i} className="hn-pill">{i}</span>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="hn-cta">
          <div className="hn-cta-box">
            <h2>Ready to simplify your operations?</h2>
            <p>Set up takes minutes. No credit card required for a trial.</p>
            <a href="/login" className="hn-btn-primary">Get Started Free</a>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="hn-footer">
          <a href="/" className="hn-footer-logo">
            <Image src="/lynxedo-logo.svg" alt="Lynxedo" width={120} height={20} />
          </a>
          <div className="hn-footer-links">
            <a href="/privacy">Privacy</a>
            <a href="/eula">Terms</a>
            <a href="/login">Sign In</a>
          </div>
          <span className="hn-footer-copy">&copy; 2026 Lynxedo</span>
        </footer>
      </div>
    </>
  )
}
