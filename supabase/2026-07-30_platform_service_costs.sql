-- Platform Service Costs (Admin → Platform → Service Costs).
--
-- A reference of every external service Lynxedo depends on, with its monthly fee and/or
-- usage rates, so the operator can see total cost of running the platform. Editable in the
-- console. Service-role only (RLS on, no policies), like the other platform tables.
--
-- ⚠ Amounts marked "(confirm)" are estimates or published list rates that depend on the
-- actual plan/usage — Ben should verify + edit them in the tab. Free tiers are labeled.
CREATE TABLE IF NOT EXISTS public.platform_service_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL DEFAULT 'Other',
  service text NOT NULL,
  plan text,          -- tier / plan label
  monthly text,       -- monthly / annual / one-time fee, or "Free tier"
  usage text,         -- usage-based rate(s)
  notes text,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_service_costs ENABLE ROW LEVEL SECURITY;

INSERT INTO public.platform_service_costs (category, service, plan, monthly, usage, notes, sort_order) VALUES
-- Hosting & Infrastructure
('Hosting & Infrastructure','Hetzner VPS','Cloud VPS (~2 vCPU)','≈ $8–15/mo (confirm plan)',NULL,'The main server — runs the website, staging, MCP, the lynxedo-voice service, and all crons.',110),
('Hosting & Infrastructure','Cloudflare','Free plan','Free tier',NULL,'DNS + Tunnel (no open ports) + CDN. WAF / some rules are paid add-ons we declined.',120),
('Hosting & Infrastructure','Cloudflare R2','Pay-as-you-go','Free tier (10 GB + 1M/10M ops)','$0.015/GB-mo stored · $0 egress · Class A $4.50/M · Class B $0.36/M','Object storage: call recordings, Txt/MMS media, IVR greetings.',130),
('Hosting & Infrastructure','Domain — lynxedo.com','Registration','≈ $10–15/yr (confirm registrar)',NULL,NULL,140),
('Hosting & Infrastructure','GitHub','Free plan (confirm)','Free tier',NULL,'Private repos + GitHub Actions deploy pipeline.',150),
-- Database
('Database','Supabase','Pro','$25/mo + compute add-on (confirm size)',NULL,'Postgres + Auth + Storage. Moved to Pro after the free-tier IO outage.',210),
-- Telephony — Twilio (per feature)
('Telephony — Twilio','Phone number — local (832)','Rental','≈ $1.15/mo',NULL,'Primary line +1 832 220 8100.',310),
('Telephony — Twilio','Phone number — toll-free (888)','Rental','≈ $2.15/mo',NULL,'Backup line +1 888 550 4376.',315),
('Telephony — Twilio','SMS — outbound','A2P 10DLC long code',NULL,'≈ $0.0079/segment + carrier ≈ $0.003/seg','Txt outbound.',320),
('Telephony — Twilio','SMS — inbound',NULL,NULL,'≈ $0.0079/segment','Txt inbound.',322),
('Telephony — Twilio','MMS — pictures',NULL,NULL,'≈ $0.02 out / $0.01 in per message + carrier','Photos over Txt.',324),
('Telephony — Twilio','Voice — inbound minutes',NULL,NULL,'≈ $0.0085/min','Dialer + AI receptionist inbound.',330),
('Telephony — Twilio','Voice — outbound minutes (US)',NULL,NULL,'≈ $0.014/min','Dialer outbound calls.',332),
('Telephony — Twilio','Call recording',NULL,NULL,'≈ $0.0025/min (storage offloaded to R2)','Dialer call recording.',334),
('Telephony — Twilio','ConversationRelay (AI receptionist voice)',NULL,NULL,'per min — confirm current rate','Real-time voice streaming for Amber.',336),
('Telephony — Twilio','Lookup (caller ID / CNAM)',NULL,NULL,'≈ $0.01/lookup','Dialer caller-ID name lookups (cached 180d).',338),
('Telephony — Twilio','A2P 10DLC registration','Brand + Campaign','Brand ≈ $4 one-time · Campaign ≈ $15 + $1.50–10/mo',NULL,'Required for SMS deliverability; plus carrier per-message fees.',340),
('Telephony — Twilio','Toll-free verification','One-time','Typically no fee',NULL,'Verified for the 888 line.',342),
('Telephony — Twilio','Voice Insights — Advanced Features',NULL,NULL,'≈ $0.008/min add-on (confirm)','Enabled during call-audio quality work.',344),
('Telephony — Twilio','Conversations API (group MMS)',NULL,NULL,'per MMS (same MMS rates)','Txt group messaging.',346),
('Telephony — Twilio','Messaging Service',NULL,'No direct fee',NULL,'Routing layer for the 832.',348),
-- AI & Voice
('AI & Voice','Anthropic (Claude)','Usage (API)',NULL,'per token, varies by model — Opus ≈ $15/$75, Sonnet ≈ $3/$15, Haiku ≈ $0.80/$4 per M tok (in/out)','AI across the platform: Guardian, receptionist brain, call coaching, contact name suggestions, lawn vision. Dedicated "Voice – Receptionist (Amber)" workspace.',410),
('AI & Voice','ElevenLabs','Plan/usage (confirm)','confirm plan','per character (or monthly plan)','AI receptionist (Amber) text-to-speech, via the lynxedo-voice service.',420),
('AI & Voice','Deepgram','Usage (API)',NULL,'≈ $0.0043/min (Nova) — confirm','Call transcription (call system / Dialer).',430),
-- Email
('Email','Resend','Free tier or paid (confirm)','Free tier (3k/mo, 100/day) → $20/mo (50k)','per email over tier','Transactional + Email Marketing. Domains: heroeslawncare.com + send.lynxedo.com.',510),
('Email','Nylas','Full Platform','$15/mo (month-to-month)',NULL,'Shared Inbox — hlc105 Microsoft 365 mailbox sync + send.',520),
-- Maps & GPS
('Maps & GPS','Mapbox','Pay-as-you-go','Free tier (50k web loads/mo)','≈ $5 per 1k loads over tier','Maps for Fleet, Route Optimizer, Lawn Size.',610),
('Maps & GPS','OneStepGPS','Per device','≈ $X/device/mo (confirm devices + rate)',NULL,'Fleet GPS tracking — your own OneStepGPS account (bring-your-own key).',620),
-- Payments
('Payments','Stripe','Standard','No monthly fee','2.9% + $0.30 per card charge (ACH / invoicing rates differ)','Billing + manual invoicing. Just activated live.',710),
-- Push Notifications
('Push Notifications','Apple Push (APNs)','Included','See Apple Developer Program',NULL,'iOS push — part of the Apple Developer Program.',810),
('Push Notifications','Firebase Cloud Messaging (FCM)','Free','Free tier',NULL,'Android / web push.',820),
('Push Notifications','Web Push (VAPID)','Free','Free (no service cost)',NULL,'Browser push notifications.',830),
-- Integrations (OAuth — no direct Lynxedo fee)
('Integrations (OAuth — no direct fee)','Jobber API','OAuth','Free',NULL,'Uses Heroes'' own Jobber subscription.',910),
('Integrations (OAuth — no direct fee)','QuickBooks Online API','OAuth','Free',NULL,'Uses Heroes'' own QBO subscription.',920),
('Integrations (OAuth — no direct fee)','Gusto API','OAuth','Free',NULL,'Payroll integration — built, not yet connected (no creds set).',925),
('Integrations (OAuth — no direct fee)','Google Ads / LSA API','OAuth + dev token','Free',NULL,'Lead polling (Local Services). Free API; uses a Google Cloud project.',930),
('Integrations (OAuth — no direct fee)','Meta (Facebook / Instagram) API','OAuth','Free',NULL,'Social posting.',940),
('Integrations (OAuth — no direct fee)','Angi — lead webhook','Webhook','Free',NULL,'Angi Leads is a separate Heroes marketing spend, not a Lynxedo platform cost.',950),
('Integrations (OAuth — no direct fee)','Slack','Free plan (confirm)','Free tier',NULL,'Chat Synx (Hub↔Slack bridge) + call-system alerts.',960),
-- App Distribution & Dev Accounts
('App Distribution & Dev Accounts','Apple Developer Program','Annual','$99/year',NULL,'iOS App Store + APNs push.',1010),
('App Distribution & Dev Accounts','Google Play Developer','One-time','$25 one-time',NULL,'Android app.',1020),
('App Distribution & Dev Accounts','Chrome Web Store Developer','One-time','$5 one-time',NULL,'Browser extension.',1030),
-- Other
('Other','Mercury','Business banking','Free',NULL,NULL,1110),
('Other','Monday.com','Retired','—',NULL,'Lead sync removed; token lingers in env but is unused.',1120);
