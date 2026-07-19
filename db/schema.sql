-- Lynxedo (Supabase project nhvwdulyzolevoeayjum "Lynxedo App") — public schema structure
-- READ-ONLY EXPORT for version control + recovery. Reconstructed from the Postgres catalog
-- (information_schema.columns, pg_constraint, pg_indexes) via the Supabase MCP.
-- This is a recovery/reference blueprint, not a migration. Source of truth is the live DB;
-- change schema in Supabase, then re-run the export (see db/README.md). RLS lives in db/rls_policies.sql.


-- ============ TABLES ============

CREATE TABLE public.announcement_reactions (
  announcement_id uuid NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.api_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  key_hash text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_used timestamp with time zone,
  revoked_at timestamp with time zone
);

CREATE TABLE public.apns_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  device_token text NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.board_item_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  board_item_id uuid NOT NULL,
  company_id uuid NOT NULL,
  uploaded_by uuid NOT NULL,
  storage_path text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream'::text,
  size_bytes bigint NOT NULL DEFAULT 0,
  width_px integer,
  height_px integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.board_item_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  board_item_id uuid NOT NULL,
  company_id uuid NOT NULL,
  content text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.board_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL,
  company_id uuid NOT NULL,
  content text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  done_at timestamp with time zone,
  priority text NOT NULL DEFAULT 'none'::text,
  due_date date,
  assignee_id uuid,
  created_by uuid NOT NULL,
  forwarded_from_message_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.board_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL,
  user_id uuid NOT NULL
);

CREATE TABLE public.boards (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  is_private boolean NOT NULL DEFAULT false,
  is_personal boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.call_ai_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL,
  company_id uuid NOT NULL,
  engine text NOT NULL,
  transcript_text text,
  transcript_json jsonb,
  summary text,
  sentiment text,
  sentiment_json jsonb,
  topics jsonb,
  intents jsonb,
  action_items jsonb,
  call_type text,
  latency_ms integer,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.call_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recording_id text NOT NULL,
  filename text NOT NULL,
  call_datetime timestamp with time zone NOT NULL,
  date date NOT NULL,
  direction text NOT NULL,
  phone text NOT NULL,
  duration_seconds integer,
  rep_name text,
  customer_name text,
  call_type text,
  call_subject text,
  customer_summary text,
  action_items text[],
  overall_grade text,
  headline text,
  must_listen boolean DEFAULT false,
  must_listen_reason text,
  red_flags text[],
  never_dos text[],
  top_wins text[],
  top_improvements text[],
  avg_confidence double precision,
  coaching_json jsonb,
  transcript_text text,
  created_at timestamp with time zone DEFAULT now(),
  company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002'::uuid,
  hub_posted_at timestamp with time zone,
  sentiment text,
  sentiment_json jsonb,
  transcript_speakers jsonb
);

CREATE TABLE public.calls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  twilio_call_sid text,
  parent_call_sid text,
  direction text NOT NULL,
  from_number text NOT NULL,
  to_number text NOT NULL,
  status text NOT NULL DEFAULT 'queued'::text,
  duration_seconds integer DEFAULT 0,
  recording_url text,
  recording_storage_path text,
  recording_duration_seconds integer,
  transcript text,
  ai_summary text,
  sentiment text,
  handled_by uuid,
  initiated_by uuid,
  contact_id uuid,
  conversation_id uuid,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  answered_at timestamp with time zone,
  ended_at timestamp with time zone,
  transcript_json jsonb,
  call_type text,
  topics jsonb,
  intents jsonb,
  action_items jsonb,
  transcription_status text NOT NULL DEFAULT 'none'::text,
  recording_paused boolean NOT NULL DEFAULT false,
  conference_name text,
  conference_sid text,
  conference_agent_sid text,
  conference_customer_sid text,
  conference_transfer_sid text,
  ring_pending jsonb,
  disposition text,
  disposition_at timestamp with time zone,
  agent_notes text,
  responder_mode text,
  responder_text_status text
);

CREATE TABLE public.chat_synx_bridges (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  hub_room_id uuid NOT NULL,
  slack_channel_id text NOT NULL,
  company_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.chat_synx_user_links (
  slack_user_id text NOT NULL,
  hub_user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  display_name text,
  avatar_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.client_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'jobber'::text,
  external_id text,
  client_id uuid NOT NULL,
  body text,
  author_external_id text,
  pinned boolean NOT NULL DEFAULT false,
  deleted_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  external_created_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.client_tags (
  client_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.clients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'jobber'::text,
  external_id text,
  name text,
  first_name text,
  last_name text,
  company_name text,
  is_company boolean NOT NULL DEFAULT false,
  is_lead boolean NOT NULL DEFAULT false,
  email text,
  phone text,
  balance numeric,
  is_archived boolean NOT NULL DEFAULT false,
  lead_source text,
  jobber_web_uri text,
  custom_fields jsonb,
  deleted_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  external_created_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  customer_since text,
  sales_person text,
  cancellation_reason text,
  phone_digits text
);

CREATE TABLE public.companies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subdomain_slug text,
  google_domain text,
  is_active boolean NOT NULL DEFAULT true,
  plan_tier text NOT NULL DEFAULT 'basic'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.company_routing_settings (
  company_id uuid NOT NULL,
  display_name text,
  depot_address text,
  depot_lat numeric,
  depot_lng numeric,
  default_service_minutes integer NOT NULL DEFAULT 30,
  default_drive_mph integer NOT NULL DEFAULT 25,
  duration_method text NOT NULL DEFAULT 'default'::text,
  duration_rules jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid,
  visible_tech_ids text[],
  pin_settings jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.contact_tag_assignments (
  contact_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  assigned_at timestamp with time zone NOT NULL DEFAULT now(),
  assigned_by uuid
);

CREATE TABLE public.contact_tags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  label text NOT NULL,
  color text NOT NULL DEFAULT '#6B7280'::text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'jobber'::text,
  external_id text,
  client_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  first_name text,
  last_name text,
  name text,
  title text,
  role text,
  email text,
  phone text,
  is_billing_contact boolean NOT NULL DEFAULT false,
  receives_followups boolean,
  receives_reminders boolean,
  custom_fields jsonb,
  deleted_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  external_created_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  phone_digits text
);

CREATE TABLE public.conversation_members (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  archived_at timestamp with time zone
);

CREATE TABLE public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.daily_log_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  log_date date NOT NULL,
  tech_user_id uuid NOT NULL,
  office_notes text,
  route_sheet_url text,
  route_sheet_name text,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  secondary_tech_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  completed_at timestamp with time zone,
  completed_by uuid,
  closed_at timestamp with time zone,
  closed_by uuid
);

CREATE TABLE public.daily_log_read_receipts (
  user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  last_read_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.daily_log_settings (
  company_id uuid NOT NULL,
  completion_notify_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  completion_notify_room_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  on_my_way_template text,
  update_notify_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]
);

CREATE TABLE public.daily_log_skip_reasons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.daily_log_stop_attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  stop_id uuid NOT NULL,
  company_id uuid NOT NULL,
  uploaded_by uuid NOT NULL,
  file_name text NOT NULL,
  file_type text NOT NULL,
  file_size integer NOT NULL,
  storage_path text NOT NULL,
  file_url text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.daily_log_stop_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  stop_id uuid NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.daily_log_stop_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  stop_id uuid NOT NULL,
  company_id uuid NOT NULL,
  main_service text,
  additional_services text[] NOT NULL DEFAULT '{}'::text[],
  issues_found text[] NOT NULL DEFAULT '{}'::text[],
  notes text,
  sent_at timestamp with time zone,
  sent_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.daily_log_stops (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL,
  ord integer NOT NULL,
  jobber_visit_id text,
  client_name text NOT NULL,
  client_phone text,
  address text NOT NULL,
  lat double precision,
  lng double precision,
  job_title text,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  instructions text,
  scheduled_start_at timestamp with time zone,
  scheduled_end_at timestamp with time zone,
  duration_minutes integer,
  status text NOT NULL DEFAULT 'pending'::text,
  completed_at timestamp with time zone,
  completed_by uuid,
  notes text,
  weather jsonb,
  pesticide_record_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  arrived_at timestamp with time zone,
  on_my_way_sent_at timestamp with time zone,
  on_my_way_eta_minutes integer,
  skip_reason_id uuid,
  skip_reason_label text,
  pesticide_tech_notes text,
  office_reviewed_at timestamp with time zone,
  office_reviewed_by uuid
);

CREATE TABLE public.daily_log_subscribers (
  entry_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.daily_log_update_reactions (
  update_id uuid NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.daily_log_updates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL,
  company_id uuid NOT NULL,
  content text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  media_urls jsonb DEFAULT '[]'::jsonb
);

CREATE TABLE public.dialer_ring_group_members (
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  member_timeout_sec integer NOT NULL DEFAULT 20,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.dialer_ring_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  ring_mode text NOT NULL DEFAULT 'simultaneous'::text,
  ring_timeout_sec integer NOT NULL DEFAULT 25,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.dialer_settings (
  company_id uuid NOT NULL,
  business_hours jsonb DEFAULT '{}'::jsonb,
  after_hours_routing jsonb DEFAULT '{}'::jsonb,
  fallback_voicemail_url text,
  inbound_route_user_id uuid,
  default_caller_id_number text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  voicemail_recipient_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ring_timeout_sec integer NOT NULL DEFAULT 20,
  ivr_enabled boolean NOT NULL DEFAULT false,
  ivr_config jsonb NOT NULL DEFAULT '{"trees": {}}'::jsonb,
  holidays jsonb NOT NULL DEFAULT '[]'::jsonb,
  recording_enabled boolean NOT NULL DEFAULT false,
  recording_consent_notice text,
  recording_pause_auto_resume_sec integer NOT NULL DEFAULT 60,
  disposition_options jsonb,
  fallback_voicemail_tts text,
  recording_consent_enabled boolean NOT NULL DEFAULT true,
  recording_consent_url text
);

CREATE TABLE public.employees (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  gusto_uuid text,
  gusto_job_uuid text,
  user_id uuid,
  first_name text NOT NULL,
  last_name text NOT NULL,
  preferred_name text,
  email text,
  phone text,
  department text,
  job_title text,
  pay_type text NOT NULL,
  flsa_status text,
  hourly_rate numeric,
  is_active boolean DEFAULT true,
  gusto_synced_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002'::uuid
);

CREATE TABLE public.external_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  icon text NOT NULL DEFAULT '🔗'::text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.fcm_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  device_token text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  message_id uuid,
  uploader_id uuid,
  storage_path text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL DEFAULT ''::text,
  size_bytes bigint NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  width_px integer,
  height_px integer
);

CREATE TABLE public.fleet_alert_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  device_id text NOT NULL,
  device_name text NOT NULL,
  alert_type text NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.fleet_settings (
  company_id uuid NOT NULL,
  alert_speeding boolean NOT NULL DEFAULT true,
  alert_after_hours boolean NOT NULL DEFAULT true,
  alert_low_fuel boolean NOT NULL DEFAULT true,
  alert_offline boolean NOT NULL DEFAULT true,
  speed_threshold_mph integer NOT NULL DEFAULT 75,
  fuel_threshold_pct integer NOT NULL DEFAULT 20,
  offline_timeout_min integer NOT NULL DEFAULT 30,
  work_hours_start time without time zone NOT NULL DEFAULT '06:00:00'::time without time zone,
  work_hours_end time without time zone NOT NULL DEFAULT '19:00:00'::time without time zone,
  work_tz text NOT NULL DEFAULT 'America/Chicago'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  alert_recipient_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  alert_recipient_room_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]
);

CREATE TABLE public.form_submissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL,
  company_id uuid NOT NULL,
  context_type text,
  context_id uuid,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_by uuid,
  submitted_at timestamp with time zone NOT NULL DEFAULT now(),
  customer_name text,
  customer_email text,
  customer_phone text,
  jobber_client_id text,
  jobber_note_id text,
  notification_sent_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.forms (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  notification_sms_template text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.guardian_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid,
  question text NOT NULL,
  answer text,
  model text,
  tools_called jsonb NOT NULL DEFAULT '[]'::jsonb,
  web_searches_used integer NOT NULL DEFAULT 0,
  input_tokens integer,
  output_tokens integer,
  is_test boolean NOT NULL DEFAULT false,
  guardian_tier text,
  room_id uuid,
  conversation_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.guardian_knowledge_doc_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL,
  company_id uuid NOT NULL,
  body text NOT NULL,
  title text NOT NULL,
  saved_by uuid,
  saved_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.guardian_knowledge_docs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT ''::text,
  always_include boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid
);

CREATE TABLE public.guardian_settings (
  company_id uuid NOT NULL,
  model text NOT NULL DEFAULT 'claude-sonnet-4-6'::text,
  web_search_daily_cap integer NOT NULL DEFAULT 30,
  updated_at timestamp with time zone,
  updated_by uuid
);

CREATE TABLE public.guardian_web_search_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  count integer NOT NULL DEFAULT 0
);

CREATE TABLE public.holiday_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  holiday_id uuid NOT NULL,
  pay_period_start date NOT NULL,
  custom_hours numeric,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.hub_announcements (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  content text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  type text NOT NULL DEFAULT 'announcement'::text,
  archived_at timestamp with time zone,
  edited_at timestamp with time zone
);

CREATE TABLE public.hub_api_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone,
  bot_user_id uuid
);

CREATE TABLE public.hub_automation_geofence_state (
  rule_id uuid NOT NULL,
  device_id text NOT NULL,
  inside boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.hub_automation_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  trigger_room_id uuid,
  trigger_source text NOT NULL DEFAULT 'room_message'::text,
  keyword text,
  action_type text NOT NULL DEFAULT 'post_room'::text,
  target_room_id uuid,
  target_user_id uuid,
  message_template text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  target_board_id uuid,
  name text,
  recipient_type text NOT NULL DEFAULT 'fixed_user'::text,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  condition_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_fired_at timestamp with time zone,
  deliver_via text NOT NULL DEFAULT 'guardian'::text
);

CREATE TABLE public.hub_automation_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  rule_id uuid,
  trigger_source text,
  fired_at timestamp with time zone NOT NULL DEFAULT now(),
  recipient_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.hub_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  jobber_client_id text,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  notes text,
  do_not_text boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.hub_file_tags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6B7280'::text,
  tag_type text NOT NULL DEFAULT 'general'::text,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.hub_files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  uploader_id uuid,
  storage_path text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream'::text,
  size_bytes bigint NOT NULL DEFAULT 0,
  description text,
  uploaded_at timestamp with time zone NOT NULL DEFAULT now(),
  tags text[] NOT NULL DEFAULT '{}'::text[],
  social_used_at timestamp with time zone
);

CREATE TABLE public.hub_geofences (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  address text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  radius_m integer NOT NULL DEFAULT 137,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.hub_read_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  room_id uuid,
  conversation_id uuid,
  last_read_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.hub_settings (
  company_id uuid NOT NULL,
  allow_member_room_creation boolean NOT NULL DEFAULT true,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.hub_sms_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  direction text NOT NULL DEFAULT 'outbound'::text,
  body text NOT NULL,
  sent_by uuid,
  captivated_sent boolean NOT NULL DEFAULT false,
  twilio_sid text,
  status text NOT NULL DEFAULT 'sent'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.hub_users (
  id uuid NOT NULL,
  company_id uuid NOT NULL,
  display_name text NOT NULL DEFAULT ''::text,
  avatar_url text,
  is_bot boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'available'::text,
  status_text text,
  status_emoji text,
  status_until timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  claude_allowed boolean NOT NULL DEFAULT false,
  last_active_at timestamp with time zone
);

CREATE TABLE public.hub_vehicle_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  device_id text NOT NULL,
  device_name text,
  user_id uuid,
  effective_date date,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.inventory_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'jobber'::text,
  external_id text,
  client_id uuid,
  client_external_id text,
  job_id uuid,
  job_external_id text,
  invoice_number text,
  subject text,
  subtotal numeric,
  total numeric,
  outstanding_balance numeric,
  invoice_status text,
  issued_date date,
  due_date date,
  paid_at timestamp with time zone,
  custom_fields jsonb,
  deleted_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  external_created_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  tax_amount numeric,
  discount_amount numeric,
  payments_total numeric,
  invoice_net_days integer,
  salesperson_external_id text,
  deposit_amount numeric,
  tips_total numeric,
  jobber_web_uri text
);

CREATE TABLE public.job_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'jobber'::text,
  external_id text,
  job_id uuid NOT NULL,
  body text,
  author_external_id text,
  deleted_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  external_created_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.jobber_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002'::uuid
);

CREATE TABLE public.jobber_users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'jobber'::text,
  external_id text NOT NULL,
  name text NOT NULL,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  last_synced_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'jobber'::text,
  external_id text,
  client_id uuid,
  client_external_id text,
  property_id uuid,
  property_external_id text,
  title text,
  job_number integer,
  is_recurring boolean NOT NULL DEFAULT false,
  job_status text,
  job_type text,
  billing_type text,
  total numeric,
  invoiced_total numeric,
  uninvoiced_total numeric,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  completed_at timestamp with time zone,
  salesperson_external_id text,
  dept_prefix text,
  route_code text,
  route_type text,
  lawn_size_k numeric,
  lawn_size_sqft integer,
  cancellation_reason text,
  neighborhood text,
  gate_code text,
  onsite_time text,
  po_number text,
  custom_note text,
  custom_fields jsonb,
  jobber_web_uri text,
  deleted_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  external_created_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.lead_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  lead_id uuid,
  company_id uuid,
  note text NOT NULL,
  created_by text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.leads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  first_name text,
  last_name text,
  phone text,
  email text,
  service text[],
  lead_source text,
  status text,
  stage text,
  lead_creation_date date DEFAULT CURRENT_DATE,
  sold_date date,
  salesperson text,
  base_program_sold text,
  auxiliary_services text[],
  annual_value numeric,
  service_address text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  monday_item_id text
);

CREATE TABLE public.line_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'jobber'::text,
  external_id text,
  parent_type text NOT NULL,
  parent_id uuid,
  parent_external_id text NOT NULL,
  name text NOT NULL,
  description text,
  dept_prefix text,
  is_recurring_program boolean NOT NULL DEFAULT false,
  is_auxiliary boolean NOT NULL DEFAULT false,
  quantity numeric,
  unit_price numeric,
  total numeric,
  deleted_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  room_id uuid,
  conversation_id uuid,
  parent_id uuid,
  sender_id uuid,
  content text NOT NULL DEFAULT ''::text,
  edited_at timestamp with time zone,
  deleted_at timestamp with time zone,
  forwarded_from uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  source text,
  slack_ts text,
  slack_event_id text
);

CREATE TABLE public.notification_prefs (
  user_id uuid NOT NULL,
  room_id uuid,
  level text NOT NULL DEFAULT 'all'::text,
  dnd_enabled boolean NOT NULL DEFAULT false,
  dnd_start time without time zone,
  dnd_end time without time zone,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  notification_sound text DEFAULT 'default'::text
);

CREATE TABLE public.paid_holidays (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  date date NOT NULL,
  hours numeric NOT NULL DEFAULT 8,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.pesticide_line_item_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  match_text text NOT NULL,
  match_type text NOT NULL DEFAULT 'contains'::text,
  chemical_name text NOT NULL,
  epa_registration_number text,
  active_ingredients text,
  target_pests text,
  application_rate text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.pesticide_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  stop_id uuid,
  daily_log_entry_id uuid,
  application_timestamp timestamp with time zone NOT NULL,
  location_address text,
  location_lat double precision,
  location_lng double precision,
  customer_name text,
  jobber_visit_id text,
  jobber_client_id text,
  technician_user_id uuid,
  technician_name text,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  chemicals_applied jsonb NOT NULL DEFAULT '[]'::jsonb,
  weather jsonb,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  tech_notes text
);

CREATE TABLE public.product_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.product_location_inventory (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  product_id uuid NOT NULL,
  location_id uuid NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.product_variants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  product_id uuid NOT NULL,
  label text,
  application_rate numeric,
  rate_basis text NOT NULL DEFAULT 'per_1000sqft'::text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  category_id uuid,
  name text NOT NULL,
  description text,
  package_price numeric,
  package_size numeric,
  unit text,
  epa_reg_number text,
  active_ingredient text,
  notes text,
  batch_number text,
  batch_date date,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.properties (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'jobber'::text,
  external_id text,
  client_id uuid,
  client_external_id text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,
  custom_fields jsonb,
  deleted_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  external_created_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  name text,
  is_billing_address boolean,
  jobber_web_uri text,
  latitude numeric,
  longitude numeric,
  lawn_size_k numeric,
  lawn_size_sqft integer,
  irrigation_zones integer,
  sprinkler_system boolean,
  gate_code text,
  neighborhood text
);

CREATE TABLE public.pto_policies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  annual_hours numeric NOT NULL DEFAULT 0,
  anniversary_date date,
  accrual_notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.pto_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  request_date date NOT NULL,
  hours numeric NOT NULL,
  type text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending'::text,
  admin_note text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.push_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.qbo_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  realm_id text NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone DEFAULT now(),
  company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002'::uuid
);

CREATE TABLE public.reactions (
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.recurring_program_definitions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  line_item_name text NOT NULL,
  dept_prefix text NOT NULL,
  is_recurring boolean NOT NULL DEFAULT true,
  program_group text,
  visits_per_year integer,
  is_auxiliary boolean NOT NULL DEFAULT false,
  display_name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.recurring_services (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'monday'::text,
  monday_item_id text,
  monday_group text,
  lead_id uuid,
  name text,
  phone text,
  email text,
  lead_comments text,
  service text[],
  lead_source text,
  status text,
  lead_creation_date date,
  annual_value numeric,
  sold_date date,
  salesperson text,
  base_program_sold text,
  auxiliary_services text[],
  cancelled_status text,
  cancellation_reason text,
  cancel_date date,
  temp_updated boolean NOT NULL DEFAULT false,
  temp_prepaid boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.responder_calls (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  call_sid text NOT NULL,
  from_number text,
  to_number text,
  called_at timestamp with time zone NOT NULL DEFAULT now(),
  call_duration_seconds integer,
  has_voicemail boolean NOT NULL DEFAULT false,
  recording_url text,
  recording_duration_seconds integer,
  transcript text,
  text_sent boolean NOT NULL DEFAULT false,
  text_sent_at timestamp with time zone,
  template_used text,
  email_sent boolean NOT NULL DEFAULT false,
  email_sent_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002'::uuid
);

CREATE TABLE public.responder_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  is_active boolean NOT NULL DEFAULT false,
  twilio_phone_number text,
  business_days int4[] NOT NULL DEFAULT '{1,2,3,4,5}'::integer[],
  business_hours_start time without time zone NOT NULL DEFAULT '08:00:00'::time without time zone,
  business_hours_end time without time zone NOT NULL DEFAULT '18:00:00'::time without time zone,
  business_hours_template text NOT NULL DEFAULT 'Hi {first_name}! Sorry we missed your call at Heroes Lawn Care. We''re with another customer right now but will call you back shortly!'::text,
  afterhours_template text NOT NULL DEFAULT 'Hi {first_name}! Sorry we missed your call at Heroes Lawn Care. We''re currently closed but will reach out first thing in the morning!'::text,
  voicemail_greeting text NOT NULL DEFAULT 'Thanks for calling Heroes Lawn Care! We missed you — please leave a message after the beep and we will get right back to you.'::text,
  notification_emails text NOT NULL DEFAULT 'ben@heroeslawntx.com'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002'::uuid,
  mode text NOT NULL DEFAULT 'off'::text,
  business_hours_no_message_template text DEFAULT 'Hi {first_name}! We saw you called Heroes Lawn Care but missed you. We''re with another customer — text us back here and we''ll help you right away!'::text,
  afterhours_no_message_template text DEFAULT 'Hi {first_name}! We saw you called Heroes Lawn Care. We''re closed right now but text us back here and we''ll reach out first thing in the morning!'::text,
  ai_reply_enabled boolean NOT NULL DEFAULT false,
  ai_reply_prompt text,
  forwarded_line_ring_sec integer NOT NULL DEFAULT 0
);

CREATE TABLE public.room_members (
  room_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member'::text,
  joined_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.rooms (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  is_private boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  archived_at timestamp with time zone,
  claude_enabled boolean NOT NULL DEFAULT false,
  guardian_full_access boolean NOT NULL DEFAULT false
);

CREATE TABLE public.route_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  created_by uuid,
  label text,
  assigned_date date NOT NULL,
  assigned_tech_jobber_id text,
  assigned_tech_name text,
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_drive_minutes integer NOT NULL DEFAULT 0,
  total_onsite_minutes integer NOT NULL DEFAULT 0,
  total_miles numeric NOT NULL DEFAULT 0,
  sent_to_jobber_at timestamp with time zone,
  sent_to_daily_log_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  depot_lat numeric,
  depot_lng numeric
);

CREATE TABLE public.route_capacity (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'monday'::text,
  monday_item_id text,
  monday_group text,
  job_external_id text,
  name text,
  sync_date date,
  job_title text,
  client_name text,
  service_street text,
  service_city text,
  service_province text,
  service_zip text,
  line_items text,
  total numeric,
  lawn_size text,
  size_helper text,
  drive_time numeric,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.route_definitions (
  route_code text NOT NULL,
  route_type text NOT NULL,
  program_group text NOT NULL,
  visits_per_year integer NOT NULL,
  programs text[] NOT NULL,
  mix_gal_per_k numeric NOT NULL DEFAULT 2.0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.scheduled_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  room_id uuid,
  conversation_id uuid,
  sender_id uuid NOT NULL,
  content text NOT NULL DEFAULT ''::text,
  files jsonb,
  send_at timestamp with time zone NOT NULL,
  sent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  parent_id uuid
);

CREATE TABLE public.scoreboard_technicians (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  board_slug text NOT NULL,
  employee_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.service_definitions (
  prefix text NOT NULL,
  name text NOT NULL,
  color text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.social_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  platform text NOT NULL,
  account_name text NOT NULL,
  external_id text NOT NULL,
  access_token text NOT NULL,
  token_expires_at timestamp with time zone,
  ig_user_id text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  user_token text
);

CREATE TABLE public.social_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  account_id uuid NOT NULL,
  hub_file_id uuid,
  caption text NOT NULL DEFAULT ''::text,
  scheduled_at timestamp with time zone NOT NULL,
  published_at timestamp with time zone,
  fb_post_id text,
  status text NOT NULL DEFAULT 'draft'::text,
  error_message text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  platforms text[] NOT NULL DEFAULT ARRAY['facebook'::text]
);

CREATE TABLE public.sync_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'jobber'::text,
  sync_type text NOT NULL,
  entity text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  records_upserted integer,
  records_skipped integer,
  error_message text,
  status text NOT NULL DEFAULT 'running'::text
);

CREATE TABLE public.tags (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'jobber'::text,
  external_id text,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.time_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  date date NOT NULL,
  clock_in timestamp with time zone NOT NULL,
  clock_out timestamp with time zone,
  break_minutes integer DEFAULT 0,
  regular_hours numeric,
  overtime_hours numeric,
  total_hours numeric,
  pay_period_start date,
  pay_period_end date,
  gusto_timesheet_uuid text,
  pushed_to_gusto_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002'::uuid
);

CREATE TABLE public.time_punch_edit_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  time_entry_id uuid,
  new_clock_in timestamp with time zone,
  new_clock_out timestamp with time zone,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  admin_note text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.time_punches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  punch_type text NOT NULL,
  punched_at timestamp with time zone NOT NULL,
  lat numeric,
  lng numeric,
  note text,
  edited_by uuid,
  edit_reason text,
  original_punched_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002'::uuid
);

CREATE TABLE public.timesheet_settings (
  id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000003'::uuid,
  pay_period_frequency text DEFAULT 'weekly'::text,
  pay_period_start_day integer DEFAULT 1,
  overtime_threshold_daily numeric DEFAULT 8,
  overtime_threshold_weekly numeric DEFAULT 40,
  gps_enabled boolean DEFAULT false,
  gps_visible_to_employee boolean DEFAULT false,
  gusto_access_token text,
  gusto_refresh_token text,
  gusto_token_expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002'::uuid
);

CREATE TABLE public.tracker_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  status_options text[] DEFAULT ARRAY['Current'::text, 'Follow Up'::text, 'Follow Up — Long Term'::text, 'Follow Up — Assessment Scheduled'::text, 'Needs Bid'::text, 'Sold'::text, 'Sold — Upsell'::text, 'Active'::text, 'Unreachable'::text, 'Bad Lead'::text, 'Out of Service Area'::text, 'Did Not Bid'::text, 'Not Sold — Changed Mind'::text, 'Not Sold — Other'::text, 'Jobber'::text],
  service_options text[] DEFAULT ARRAY['IRR Install'::text, 'WF - Lawn Health'::text, 'Pet Waste'::text, 'Landscape'::text, 'IRR'::text, 'IRR SC'::text, 'Winterize'::text, 'Drain'::text, 'Aeration'::text, 'Mow'::text, 'MOS'::text, 'PHC'::text, 'Upgrade'::text, 'IR - Rachio'::text, 'IR - Gold'::text, 'Other'::text, 'Spam/Sales'::text],
  lead_source_options text[] DEFAULT ARRAY['GLSA'::text, 'Google'::text, 'Angi Lead'::text, 'Angi Ads'::text, 'Thumbtack'::text, 'Networx'::text, 'Door Hanging'::text, 'Facebook'::text, 'Organic'::text, 'Website Visit'::text, 'Referral'::text, 'Repeat Customer'::text, 'Postcard/Mailer'::text, 'Nextdoor'::text, 'Friends and Family'::text, 'Truck Wrap'::text, 'BS Marketing'::text, 'Events'::text, 'Other Paid Source'::text],
  salesperson_options text[] DEFAULT ARRAY['Ben'::text, 'Ally'::text, 'Mike'::text, 'Bonnie'::text, 'Angel'::text, 'Kathryn'::text, 'Lucas'::text, 'SERV'::text],
  base_program_sold_options text[] DEFAULT ARRAY['IR - Irrigation Service Plan Bronze'::text, 'IR - Irrigation Service Plan Silver'::text, 'IR - Irrigation Service Plan Gold'::text, 'WF - Lawn Health Basic'::text, 'WF - Lawn Health Plus'::text, 'WF - Lawn Health Complete'::text, 'WF - Root Rot Recovery'::text, 'MO - Mosquito Control'::text, 'MO - Dunks'::text, 'PW - Pet Waste Removal Weekly'::text, 'PW - Pet Waste Removal 2x Week'::text],
  auxiliary_services_options text[] DEFAULT ARRAY['WF - Bed Weed Prevention'::text, 'WF - Plant Health Care'::text],
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  status_stage_rules jsonb DEFAULT '[]'::jsonb,
  stage_colors jsonb DEFAULT '{}'::jsonb,
  status_colors jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.txt_broadcast_recipients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  conversation_id uuid,
  message_id uuid,
  status text NOT NULL DEFAULT 'queued'::text,
  error_message text,
  processed_at timestamp with time zone
);

CREATE TABLE public.txt_broadcasts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  created_by uuid NOT NULL,
  body text NOT NULL,
  apply_signature boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued'::text,
  recipient_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  throttle_mps integer NOT NULL DEFAULT 8,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  last_error text
);

CREATE TABLE public.txt_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  jobber_client_id text,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  notes text,
  do_not_text boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.txt_conversation_contacts (
  conversation_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  added_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.txt_conversation_members (
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  added_by uuid,
  added_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.txt_conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  contact_id uuid,
  assigned_to uuid,
  status text NOT NULL DEFAULT 'unassigned'::text,
  last_message_at timestamp with time zone,
  last_inbound_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  archived_by uuid,
  kind text NOT NULL DEFAULT 'direct'::text,
  twilio_conversation_sid text,
  phone_number_id uuid,
  last_message_preview text,
  last_message_direction text,
  source text DEFAULT 'manual'::text
);

CREATE TABLE public.txt_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  direction text NOT NULL,
  body text,
  media_urls text[] NOT NULL DEFAULT '{}'::text[],
  sent_by uuid,
  twilio_sid text,
  status text NOT NULL DEFAULT 'sent'::text,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.txt_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  body text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.txt_phone_numbers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  twilio_number text NOT NULL,
  label text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.txt_scheduled_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  body text,
  media_urls text[] NOT NULL DEFAULT '{}'::text[],
  send_at timestamp with time zone NOT NULL,
  sent_at timestamp with time zone,
  status text NOT NULL DEFAULT 'scheduled'::text,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.txt_settings (
  company_id uuid NOT NULL,
  on_my_way_template text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  responder_notify_user_ids uuid[] DEFAULT '{}'::uuid[]
);

CREATE TABLE public.txt_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  scope text NOT NULL,
  owner_user_id uuid,
  title text NOT NULL,
  body text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE public.user_profiles (
  id uuid NOT NULL,
  role text NOT NULL DEFAULT 'user'::text,
  can_access_routing boolean NOT NULL DEFAULT false,
  can_access_lawn boolean NOT NULL DEFAULT false,
  can_access_call_log boolean NOT NULL DEFAULT false,
  can_access_responder boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  can_access_timesheet boolean DEFAULT false,
  company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002'::uuid,
  can_access_books boolean NOT NULL DEFAULT false,
  can_access_tracker boolean DEFAULT false,
  can_access_hub boolean NOT NULL DEFAULT true,
  phone text,
  invite_sent_at timestamp with time zone,
  hub_text_size text DEFAULT 'default'::text,
  hub_pinned_ids text[] NOT NULL DEFAULT '{}'::text[],
  full_name text,
  landing_page text NOT NULL DEFAULT 'hub'::text,
  can_post_shout_outs boolean NOT NULL DEFAULT false,
  can_access_fleet boolean NOT NULL DEFAULT false,
  tracker_column_layout jsonb,
  can_admin_people boolean NOT NULL DEFAULT false,
  can_admin_hub boolean NOT NULL DEFAULT false,
  can_admin_routing boolean NOT NULL DEFAULT false,
  can_admin_timesheet boolean NOT NULL DEFAULT false,
  can_admin_fleet boolean NOT NULL DEFAULT false,
  can_admin_daily_log boolean NOT NULL DEFAULT false,
  last_activity_seen_at timestamp with time zone,
  rail_config jsonb,
  can_access_zone_sizer boolean NOT NULL DEFAULT false,
  can_admin_zone_sizer boolean NOT NULL DEFAULT false,
  can_assign_txt_threads boolean NOT NULL DEFAULT false,
  txt_signature text,
  txt_default_number_id uuid,
  can_access_dialer boolean NOT NULL DEFAULT false,
  can_admin_dialer boolean NOT NULL DEFAULT false,
  dialer_global_ring boolean NOT NULL DEFAULT true,
  dialer_extension text,
  dialer_dnd_enabled boolean NOT NULL DEFAULT false,
  dialer_dnd_schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
  voicemail_greeting_url text,
  can_admin_contacts boolean NOT NULL DEFAULT false,
  guardian_tier text NOT NULL DEFAULT 'basic'::text,
  can_access_marketing boolean NOT NULL DEFAULT false,
  can_admin_marketing boolean NOT NULL DEFAULT false,
  can_access_forms boolean NOT NULL DEFAULT true,
  can_admin_forms boolean NOT NULL DEFAULT false,
  can_admin_products boolean NOT NULL DEFAULT false,
  can_access_daily_log_v2 boolean NOT NULL DEFAULT false,
  can_access_txt boolean NOT NULL DEFAULT false,
  can_access_call_log2 boolean NOT NULL DEFAULT false,
  hub_layout jsonb,
  can_admin_guardian boolean NOT NULL DEFAULT false,
  can_admin_txt boolean NOT NULL DEFAULT false,
  can_admin_announcements boolean NOT NULL DEFAULT false,
  can_admin_file_tags boolean NOT NULL DEFAULT false,
  can_access_scoreboards boolean DEFAULT false,
  hub_seeded_apps text[] NOT NULL DEFAULT '{}'::text[],
  master_dnd_enabled boolean NOT NULL DEFAULT false,
  master_dnd_schedule jsonb,
  hub_dnd_enabled boolean NOT NULL DEFAULT false,
  hub_dnd_schedule jsonb
);

CREATE TABLE public.user_settings (
  user_id uuid NOT NULL,
  display_name text,
  depot_address text,
  depot_lat numeric,
  depot_lng numeric,
  default_service_minutes integer DEFAULT 30,
  default_drive_mph integer DEFAULT 25,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  duration_method text DEFAULT 'default'::text,
  duration_rules jsonb DEFAULT '{}'::jsonb,
  company_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000002'::uuid
);

CREATE TABLE public.visits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'jobber'::text,
  external_id text,
  job_id uuid,
  job_external_id text,
  client_id uuid,
  client_external_id text,
  title text,
  scheduled_date date,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  completed_at timestamp with time zone,
  visit_status text,
  tech_external_user_ids text[],
  subtotal numeric,
  total numeric,
  override_reason text,
  custom_fields jsonb,
  deleted_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  external_created_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  invoice_external_id text
);

CREATE TABLE public.voicemails (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  call_id uuid,
  owner_user_id uuid,
  from_number text,
  contact_id uuid,
  twilio_recording_sid text,
  recording_storage_path text NOT NULL,
  recording_duration_sec integer,
  transcript text,
  summary text,
  heard_at timestamp with time zone,
  heard_by uuid,
  deleted_at timestamp with time zone,
  deleted_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  ai_reply_body text,
  ai_reply_sent_at timestamp with time zone
);

CREATE TABLE public.zone_sizer_settings (
  company_id uuid NOT NULL,
  turf_sqft_per_zone integer NOT NULL DEFAULT 1000,
  bed_sqft_per_zone integer NOT NULL DEFAULT 1000,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);


-- ============ CONSTRAINTS (PK / FK / UNIQUE / CHECK) ============

ALTER TABLE announcement_reactions ADD CONSTRAINT announcement_reactions_pkey PRIMARY KEY (announcement_id, user_id, emoji);
ALTER TABLE announcement_reactions ADD CONSTRAINT announcement_reactions_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES hub_announcements(id) ON DELETE CASCADE;
ALTER TABLE announcement_reactions ADD CONSTRAINT announcement_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);
ALTER TABLE api_keys ADD CONSTRAINT api_keys_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE apns_tokens ADD CONSTRAINT apns_tokens_user_id_device_token_key UNIQUE (user_id, device_token);
ALTER TABLE apns_tokens ADD CONSTRAINT apns_tokens_pkey PRIMARY KEY (id);
ALTER TABLE apns_tokens ADD CONSTRAINT apns_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE board_item_attachments ADD CONSTRAINT board_item_attachments_pkey PRIMARY KEY (id);
ALTER TABLE board_item_attachments ADD CONSTRAINT board_item_attachments_board_item_id_fkey FOREIGN KEY (board_item_id) REFERENCES board_items(id) ON DELETE CASCADE;
ALTER TABLE board_item_attachments ADD CONSTRAINT board_item_attachments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE board_item_attachments ADD CONSTRAINT board_item_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES hub_users(id);
ALTER TABLE board_item_comments ADD CONSTRAINT board_item_comments_pkey PRIMARY KEY (id);
ALTER TABLE board_item_comments ADD CONSTRAINT board_item_comments_board_item_id_fkey FOREIGN KEY (board_item_id) REFERENCES board_items(id) ON DELETE CASCADE;
ALTER TABLE board_item_comments ADD CONSTRAINT board_item_comments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE board_item_comments ADD CONSTRAINT board_item_comments_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id);
ALTER TABLE board_items ADD CONSTRAINT board_items_pkey PRIMARY KEY (id);
ALTER TABLE board_items ADD CONSTRAINT board_items_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES hub_users(id);
ALTER TABLE board_items ADD CONSTRAINT board_items_board_id_fkey FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE;
ALTER TABLE board_items ADD CONSTRAINT board_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE board_items ADD CONSTRAINT board_items_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id);
ALTER TABLE board_items ADD CONSTRAINT board_items_forwarded_from_message_id_fkey FOREIGN KEY (forwarded_from_message_id) REFERENCES messages(id);
ALTER TABLE board_items ADD CONSTRAINT board_items_priority_check CHECK ((priority = ANY (ARRAY['none'::text, 'low'::text, 'medium'::text, 'high'::text])));
ALTER TABLE board_members ADD CONSTRAINT board_members_board_id_user_id_key UNIQUE (board_id, user_id);
ALTER TABLE board_members ADD CONSTRAINT board_members_pkey PRIMARY KEY (id);
ALTER TABLE board_members ADD CONSTRAINT board_members_board_id_fkey FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE;
ALTER TABLE board_members ADD CONSTRAINT board_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE boards ADD CONSTRAINT boards_pkey PRIMARY KEY (id);
ALTER TABLE boards ADD CONSTRAINT boards_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE boards ADD CONSTRAINT boards_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id);
ALTER TABLE call_ai_results ADD CONSTRAINT call_ai_results_call_id_engine_key UNIQUE (call_id, engine);
ALTER TABLE call_ai_results ADD CONSTRAINT call_ai_results_pkey PRIMARY KEY (id);
ALTER TABLE call_ai_results ADD CONSTRAINT call_ai_results_call_id_fkey FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE;
ALTER TABLE call_logs ADD CONSTRAINT call_logs_recording_id_key UNIQUE (recording_id);
ALTER TABLE call_logs ADD CONSTRAINT call_logs_pkey PRIMARY KEY (id);
ALTER TABLE call_logs ADD CONSTRAINT call_logs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE calls ADD CONSTRAINT calls_pkey PRIMARY KEY (id);
ALTER TABLE calls ADD CONSTRAINT calls_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE calls ADD CONSTRAINT calls_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES txt_contacts(id) ON DELETE SET NULL;
ALTER TABLE calls ADD CONSTRAINT calls_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES txt_conversations(id) ON DELETE SET NULL;
ALTER TABLE calls ADD CONSTRAINT calls_handled_by_fkey FOREIGN KEY (handled_by) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE calls ADD CONSTRAINT calls_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE calls ADD CONSTRAINT calls_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])));
ALTER TABLE calls ADD CONSTRAINT calls_sentiment_check CHECK ((sentiment = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text])));
ALTER TABLE chat_synx_bridges ADD CONSTRAINT chat_synx_bridges_hub_room_id_key UNIQUE (hub_room_id);
ALTER TABLE chat_synx_bridges ADD CONSTRAINT chat_synx_bridges_slack_channel_id_key UNIQUE (slack_channel_id);
ALTER TABLE chat_synx_bridges ADD CONSTRAINT chat_synx_bridges_pkey PRIMARY KEY (id);
ALTER TABLE chat_synx_bridges ADD CONSTRAINT chat_synx_bridges_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE chat_synx_bridges ADD CONSTRAINT chat_synx_bridges_hub_room_id_fkey FOREIGN KEY (hub_room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE chat_synx_user_links ADD CONSTRAINT chat_synx_user_links_pkey PRIMARY KEY (slack_user_id);
ALTER TABLE chat_synx_user_links ADD CONSTRAINT chat_synx_user_links_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE chat_synx_user_links ADD CONSTRAINT chat_synx_user_links_hub_user_id_fkey FOREIGN KEY (hub_user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE client_notes ADD CONSTRAINT client_notes_pkey PRIMARY KEY (id);
ALTER TABLE client_notes ADD CONSTRAINT client_notes_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE client_notes ADD CONSTRAINT client_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE client_tags ADD CONSTRAINT client_tags_pkey PRIMARY KEY (client_id, tag_id);
ALTER TABLE client_tags ADD CONSTRAINT client_tags_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE client_tags ADD CONSTRAINT client_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE;
ALTER TABLE clients ADD CONSTRAINT clients_pkey PRIMARY KEY (id);
ALTER TABLE clients ADD CONSTRAINT clients_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE companies ADD CONSTRAINT companies_subdomain_slug_key UNIQUE (subdomain_slug);
ALTER TABLE companies ADD CONSTRAINT companies_pkey PRIMARY KEY (id);
ALTER TABLE company_routing_settings ADD CONSTRAINT company_routing_settings_pkey PRIMARY KEY (company_id);
ALTER TABLE company_routing_settings ADD CONSTRAINT company_routing_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE contact_tag_assignments ADD CONSTRAINT contact_tag_assignments_pkey PRIMARY KEY (contact_id, tag_id);
ALTER TABLE contact_tag_assignments ADD CONSTRAINT contact_tag_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE contact_tag_assignments ADD CONSTRAINT contact_tag_assignments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES txt_contacts(id) ON DELETE CASCADE;
ALTER TABLE contact_tag_assignments ADD CONSTRAINT contact_tag_assignments_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES contact_tags(id) ON DELETE CASCADE;
ALTER TABLE contact_tags ADD CONSTRAINT contact_tags_company_id_label_key UNIQUE (company_id, label);
ALTER TABLE contact_tags ADD CONSTRAINT contact_tags_pkey PRIMARY KEY (id);
ALTER TABLE contact_tags ADD CONSTRAINT contact_tags_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE contact_tags ADD CONSTRAINT contact_tags_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 60)));
ALTER TABLE contacts ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);
ALTER TABLE contacts ADD CONSTRAINT contacts_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE contacts ADD CONSTRAINT contacts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE conversation_members ADD CONSTRAINT conversation_members_pkey PRIMARY KEY (conversation_id, user_id);
ALTER TABLE conversation_members ADD CONSTRAINT conversation_members_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE conversation_members ADD CONSTRAINT conversation_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE conversations ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);
ALTER TABLE conversations ADD CONSTRAINT conversations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE daily_log_entries ADD CONSTRAINT daily_log_entries_company_id_log_date_tech_user_id_key UNIQUE (company_id, log_date, tech_user_id);
ALTER TABLE daily_log_entries ADD CONSTRAINT daily_log_entries_pkey PRIMARY KEY (id);
ALTER TABLE daily_log_entries ADD CONSTRAINT daily_log_entries_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES hub_users(id);
ALTER TABLE daily_log_entries ADD CONSTRAINT daily_log_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE daily_log_entries ADD CONSTRAINT daily_log_entries_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES hub_users(id);
ALTER TABLE daily_log_entries ADD CONSTRAINT daily_log_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id);
ALTER TABLE daily_log_entries ADD CONSTRAINT daily_log_entries_tech_user_id_fkey FOREIGN KEY (tech_user_id) REFERENCES hub_users(id);
ALTER TABLE daily_log_read_receipts ADD CONSTRAINT daily_log_read_receipts_pkey PRIMARY KEY (user_id);
ALTER TABLE daily_log_read_receipts ADD CONSTRAINT daily_log_read_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE daily_log_settings ADD CONSTRAINT daily_log_settings_pkey PRIMARY KEY (company_id);
ALTER TABLE daily_log_settings ADD CONSTRAINT daily_log_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE daily_log_skip_reasons ADD CONSTRAINT daily_log_skip_reasons_pkey PRIMARY KEY (id);
ALTER TABLE daily_log_skip_reasons ADD CONSTRAINT daily_log_skip_reasons_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 100)));
ALTER TABLE daily_log_stop_attachments ADD CONSTRAINT daily_log_stop_attachments_pkey PRIMARY KEY (id);
ALTER TABLE daily_log_stop_attachments ADD CONSTRAINT daily_log_stop_attachments_stop_id_fkey FOREIGN KEY (stop_id) REFERENCES daily_log_stops(id) ON DELETE CASCADE;
ALTER TABLE daily_log_stop_attachments ADD CONSTRAINT daily_log_stop_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES hub_users(id);
ALTER TABLE daily_log_stop_messages ADD CONSTRAINT daily_log_stop_messages_pkey PRIMARY KEY (id);
ALTER TABLE daily_log_stop_messages ADD CONSTRAINT daily_log_stop_messages_stop_id_fkey FOREIGN KEY (stop_id) REFERENCES daily_log_stops(id) ON DELETE CASCADE;
ALTER TABLE daily_log_stop_messages ADD CONSTRAINT daily_log_stop_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id);
ALTER TABLE daily_log_stop_messages ADD CONSTRAINT daily_log_stop_messages_content_check CHECK (((char_length(content) >= 1) AND (char_length(content) <= 5000)));
ALTER TABLE daily_log_stop_reports ADD CONSTRAINT daily_log_stop_reports_stop_id_key UNIQUE (stop_id);
ALTER TABLE daily_log_stop_reports ADD CONSTRAINT daily_log_stop_reports_pkey PRIMARY KEY (id);
ALTER TABLE daily_log_stop_reports ADD CONSTRAINT daily_log_stop_reports_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES hub_users(id);
ALTER TABLE daily_log_stop_reports ADD CONSTRAINT daily_log_stop_reports_stop_id_fkey FOREIGN KEY (stop_id) REFERENCES daily_log_stops(id) ON DELETE CASCADE;
ALTER TABLE daily_log_stops ADD CONSTRAINT daily_log_stops_pkey PRIMARY KEY (id);
ALTER TABLE daily_log_stops ADD CONSTRAINT daily_log_stops_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES hub_users(id);
ALTER TABLE daily_log_stops ADD CONSTRAINT daily_log_stops_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES daily_log_entries(id) ON DELETE CASCADE;
ALTER TABLE daily_log_stops ADD CONSTRAINT daily_log_stops_office_reviewed_by_fkey FOREIGN KEY (office_reviewed_by) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE daily_log_stops ADD CONSTRAINT daily_log_stops_pesticide_record_id_fkey FOREIGN KEY (pesticide_record_id) REFERENCES pesticide_records(id) ON DELETE SET NULL;
ALTER TABLE daily_log_stops ADD CONSTRAINT daily_log_stops_skip_reason_id_fkey FOREIGN KEY (skip_reason_id) REFERENCES daily_log_skip_reasons(id) ON DELETE SET NULL;
ALTER TABLE daily_log_subscribers ADD CONSTRAINT daily_log_subscribers_pkey PRIMARY KEY (entry_id, user_id);
ALTER TABLE daily_log_subscribers ADD CONSTRAINT daily_log_subscribers_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES daily_log_entries(id) ON DELETE CASCADE;
ALTER TABLE daily_log_subscribers ADD CONSTRAINT daily_log_subscribers_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE daily_log_update_reactions ADD CONSTRAINT daily_log_update_reactions_pkey PRIMARY KEY (update_id, user_id, emoji);
ALTER TABLE daily_log_update_reactions ADD CONSTRAINT daily_log_update_reactions_update_id_fkey FOREIGN KEY (update_id) REFERENCES daily_log_updates(id) ON DELETE CASCADE;
ALTER TABLE daily_log_update_reactions ADD CONSTRAINT daily_log_update_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE daily_log_updates ADD CONSTRAINT daily_log_updates_pkey PRIMARY KEY (id);
ALTER TABLE daily_log_updates ADD CONSTRAINT daily_log_updates_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE daily_log_updates ADD CONSTRAINT daily_log_updates_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id);
ALTER TABLE daily_log_updates ADD CONSTRAINT daily_log_updates_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES daily_log_entries(id) ON DELETE CASCADE;
ALTER TABLE dialer_ring_group_members ADD CONSTRAINT dialer_ring_group_members_pkey PRIMARY KEY (group_id, user_id);
ALTER TABLE dialer_ring_group_members ADD CONSTRAINT dialer_ring_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES dialer_ring_groups(id) ON DELETE CASCADE;
ALTER TABLE dialer_ring_group_members ADD CONSTRAINT dialer_ring_group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE dialer_ring_group_members ADD CONSTRAINT dialer_ring_group_members_member_timeout_sec_check CHECK (((member_timeout_sec >= 5) AND (member_timeout_sec <= 60)));
ALTER TABLE dialer_ring_groups ADD CONSTRAINT dialer_ring_groups_company_id_name_key UNIQUE (company_id, name);
ALTER TABLE dialer_ring_groups ADD CONSTRAINT dialer_ring_groups_pkey PRIMARY KEY (id);
ALTER TABLE dialer_ring_groups ADD CONSTRAINT dialer_ring_groups_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE dialer_ring_groups ADD CONSTRAINT dialer_ring_groups_ring_mode_check CHECK ((ring_mode = ANY (ARRAY['simultaneous'::text, 'sequential'::text])));
ALTER TABLE dialer_ring_groups ADD CONSTRAINT dialer_ring_groups_ring_timeout_sec_check CHECK (((ring_timeout_sec >= 5) AND (ring_timeout_sec <= 120)));
ALTER TABLE dialer_settings ADD CONSTRAINT dialer_settings_pkey PRIMARY KEY (company_id);
ALTER TABLE dialer_settings ADD CONSTRAINT dialer_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE dialer_settings ADD CONSTRAINT dialer_settings_inbound_route_user_id_fkey FOREIGN KEY (inbound_route_user_id) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE dialer_settings ADD CONSTRAINT dialer_settings_ring_timeout_check CHECK (((ring_timeout_sec >= 5) AND (ring_timeout_sec <= 120)));
ALTER TABLE employees ADD CONSTRAINT employees_gusto_uuid_key UNIQUE (gusto_uuid);
ALTER TABLE employees ADD CONSTRAINT employees_pkey PRIMARY KEY (id);
ALTER TABLE employees ADD CONSTRAINT employees_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE employees ADD CONSTRAINT employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT employees_flsa_status_check CHECK ((flsa_status = ANY (ARRAY['Exempt'::text, 'Nonexempt'::text])));
ALTER TABLE employees ADD CONSTRAINT employees_pay_type_check CHECK ((pay_type = ANY (ARRAY['hourly'::text, 'salary'::text])));
ALTER TABLE external_links ADD CONSTRAINT external_links_pkey PRIMARY KEY (id);
ALTER TABLE external_links ADD CONSTRAINT external_links_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE fcm_tokens ADD CONSTRAINT fcm_tokens_user_id_device_token_key UNIQUE (user_id, device_token);
ALTER TABLE fcm_tokens ADD CONSTRAINT fcm_tokens_pkey PRIMARY KEY (id);
ALTER TABLE fcm_tokens ADD CONSTRAINT fcm_tokens_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE fcm_tokens ADD CONSTRAINT fcm_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE files ADD CONSTRAINT files_pkey PRIMARY KEY (id);
ALTER TABLE files ADD CONSTRAINT files_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE files ADD CONSTRAINT files_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE files ADD CONSTRAINT files_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE fleet_alert_events ADD CONSTRAINT fleet_alert_events_pkey PRIMARY KEY (id);
ALTER TABLE fleet_alert_events ADD CONSTRAINT fleet_alert_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE fleet_alert_events ADD CONSTRAINT fleet_alert_events_alert_type_check CHECK ((alert_type = ANY (ARRAY['speeding'::text, 'after_hours'::text, 'low_fuel'::text, 'offline'::text])));
ALTER TABLE fleet_settings ADD CONSTRAINT fleet_settings_pkey PRIMARY KEY (company_id);
ALTER TABLE fleet_settings ADD CONSTRAINT fleet_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE form_submissions ADD CONSTRAINT form_submissions_pkey PRIMARY KEY (id);
ALTER TABLE form_submissions ADD CONSTRAINT form_submissions_form_id_fkey FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE;
ALTER TABLE form_submissions ADD CONSTRAINT form_submissions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE form_submissions ADD CONSTRAINT form_submissions_context_type_check CHECK ((context_type = ANY (ARRAY['manual'::text, 'daily_log_stop'::text, 'daily_log_entry'::text])));
ALTER TABLE forms ADD CONSTRAINT forms_pkey PRIMARY KEY (id);
ALTER TABLE forms ADD CONSTRAINT forms_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE forms ADD CONSTRAINT forms_description_check CHECK (((description IS NULL) OR (length(description) <= 1000)));
ALTER TABLE forms ADD CONSTRAINT forms_name_check CHECK (((length(name) >= 1) AND (length(name) <= 200)));
ALTER TABLE forms ADD CONSTRAINT forms_notification_sms_template_check CHECK (((notification_sms_template IS NULL) OR (length(notification_sms_template) <= 2000)));
ALTER TABLE guardian_audit ADD CONSTRAINT guardian_audit_pkey PRIMARY KEY (id);
ALTER TABLE guardian_audit ADD CONSTRAINT guardian_audit_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id);
ALTER TABLE guardian_knowledge_doc_versions ADD CONSTRAINT guardian_knowledge_doc_versions_pkey PRIMARY KEY (id);
ALTER TABLE guardian_knowledge_doc_versions ADD CONSTRAINT guardian_knowledge_doc_versions_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES guardian_knowledge_docs(id) ON DELETE CASCADE;
ALTER TABLE guardian_knowledge_doc_versions ADD CONSTRAINT guardian_knowledge_doc_versions_saved_by_fkey FOREIGN KEY (saved_by) REFERENCES hub_users(id);
ALTER TABLE guardian_knowledge_docs ADD CONSTRAINT guardian_knowledge_docs_company_id_slug_key UNIQUE (company_id, slug);
ALTER TABLE guardian_knowledge_docs ADD CONSTRAINT guardian_knowledge_docs_pkey PRIMARY KEY (id);
ALTER TABLE guardian_knowledge_docs ADD CONSTRAINT guardian_knowledge_docs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE guardian_knowledge_docs ADD CONSTRAINT guardian_knowledge_docs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES hub_users(id);
ALTER TABLE guardian_knowledge_docs ADD CONSTRAINT slug_format CHECK ((slug ~ '^[a-z0-9_-]+$'::text));
ALTER TABLE guardian_knowledge_docs ADD CONSTRAINT slug_length CHECK ((char_length(slug) <= 60));
ALTER TABLE guardian_knowledge_docs ADD CONSTRAINT slug_not_empty CHECK ((char_length(TRIM(BOTH FROM slug)) > 0));
ALTER TABLE guardian_knowledge_docs ADD CONSTRAINT title_length CHECK ((char_length(title) <= 120));
ALTER TABLE guardian_knowledge_docs ADD CONSTRAINT title_not_empty CHECK ((char_length(TRIM(BOTH FROM title)) > 0));
ALTER TABLE guardian_settings ADD CONSTRAINT guardian_settings_pkey PRIMARY KEY (company_id);
ALTER TABLE guardian_settings ADD CONSTRAINT guardian_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE guardian_settings ADD CONSTRAINT guardian_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES hub_users(id);
ALTER TABLE guardian_web_search_usage ADD CONSTRAINT guardian_web_search_usage_company_id_date_key UNIQUE (company_id, date);
ALTER TABLE guardian_web_search_usage ADD CONSTRAINT guardian_web_search_usage_pkey PRIMARY KEY (id);
ALTER TABLE holiday_overrides ADD CONSTRAINT holiday_overrides_company_id_employee_id_holiday_id_pay_per_key UNIQUE (company_id, employee_id, holiday_id, pay_period_start);
ALTER TABLE holiday_overrides ADD CONSTRAINT holiday_overrides_pkey PRIMARY KEY (id);
ALTER TABLE holiday_overrides ADD CONSTRAINT holiday_overrides_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE holiday_overrides ADD CONSTRAINT holiday_overrides_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE holiday_overrides ADD CONSTRAINT holiday_overrides_holiday_id_fkey FOREIGN KEY (holiday_id) REFERENCES paid_holidays(id) ON DELETE CASCADE;
ALTER TABLE hub_announcements ADD CONSTRAINT hub_announcements_pkey PRIMARY KEY (id);
ALTER TABLE hub_announcements ADD CONSTRAINT hub_announcements_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE hub_announcements ADD CONSTRAINT hub_announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE hub_announcements ADD CONSTRAINT hub_announcements_type_check CHECK ((type = ANY (ARRAY['announcement'::text, 'shout_out'::text])));
ALTER TABLE hub_api_keys ADD CONSTRAINT hub_api_keys_pkey PRIMARY KEY (id);
ALTER TABLE hub_api_keys ADD CONSTRAINT hub_api_keys_bot_user_id_fkey FOREIGN KEY (bot_user_id) REFERENCES hub_users(id);
ALTER TABLE hub_api_keys ADD CONSTRAINT hub_api_keys_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE hub_api_keys ADD CONSTRAINT hub_api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id);
ALTER TABLE hub_automation_geofence_state ADD CONSTRAINT hub_automation_geofence_state_pkey PRIMARY KEY (rule_id, device_id);
ALTER TABLE hub_automation_geofence_state ADD CONSTRAINT hub_automation_geofence_state_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES hub_automation_rules(id) ON DELETE CASCADE;
ALTER TABLE hub_automation_rules ADD CONSTRAINT hub_automation_rules_pkey PRIMARY KEY (id);
ALTER TABLE hub_automation_rules ADD CONSTRAINT hub_automation_rules_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE hub_automation_rules ADD CONSTRAINT hub_automation_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE hub_automation_rules ADD CONSTRAINT hub_automation_rules_target_board_id_fkey FOREIGN KEY (target_board_id) REFERENCES boards(id) ON DELETE CASCADE;
ALTER TABLE hub_automation_rules ADD CONSTRAINT hub_automation_rules_target_room_id_fkey FOREIGN KEY (target_room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE hub_automation_rules ADD CONSTRAINT hub_automation_rules_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE hub_automation_rules ADD CONSTRAINT hub_automation_rules_trigger_room_id_fkey FOREIGN KEY (trigger_room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE hub_automation_rules ADD CONSTRAINT hub_automation_rules_action_type_check CHECK ((action_type = ANY (ARRAY['post_room'::text, 'dm_user'::text, 'create_board_task'::text])));
ALTER TABLE hub_automation_runs ADD CONSTRAINT hub_automation_runs_pkey PRIMARY KEY (id);
ALTER TABLE hub_automation_runs ADD CONSTRAINT hub_automation_runs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE hub_automation_runs ADD CONSTRAINT hub_automation_runs_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES hub_automation_rules(id) ON DELETE CASCADE;
ALTER TABLE hub_contacts ADD CONSTRAINT hub_contacts_company_id_phone_key UNIQUE (company_id, phone);
ALTER TABLE hub_contacts ADD CONSTRAINT hub_contacts_pkey PRIMARY KEY (id);
ALTER TABLE hub_contacts ADD CONSTRAINT hub_contacts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE hub_file_tags ADD CONSTRAINT hub_file_tags_company_id_name_key UNIQUE (company_id, name);
ALTER TABLE hub_file_tags ADD CONSTRAINT hub_file_tags_pkey PRIMARY KEY (id);
ALTER TABLE hub_file_tags ADD CONSTRAINT hub_file_tags_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE hub_file_tags ADD CONSTRAINT hub_file_tags_tag_type_check CHECK ((tag_type = ANY (ARRAY['general'::text, 'social-page'::text, 'social-queue'::text])));
ALTER TABLE hub_files ADD CONSTRAINT hub_files_pkey PRIMARY KEY (id);
ALTER TABLE hub_files ADD CONSTRAINT hub_files_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE hub_files ADD CONSTRAINT hub_files_uploader_id_fkey FOREIGN KEY (uploader_id) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE hub_geofences ADD CONSTRAINT hub_geofences_pkey PRIMARY KEY (id);
ALTER TABLE hub_geofences ADD CONSTRAINT hub_geofences_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE hub_geofences ADD CONSTRAINT hub_geofences_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE hub_read_receipts ADD CONSTRAINT hub_read_receipts_conv_unique UNIQUE (user_id, conversation_id);
ALTER TABLE hub_read_receipts ADD CONSTRAINT hub_read_receipts_room_unique UNIQUE (user_id, room_id);
ALTER TABLE hub_read_receipts ADD CONSTRAINT hub_read_receipts_pkey PRIMARY KEY (id);
ALTER TABLE hub_read_receipts ADD CONSTRAINT hub_read_receipts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE hub_read_receipts ADD CONSTRAINT hub_read_receipts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE hub_read_receipts ADD CONSTRAINT hub_read_receipts_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE hub_read_receipts ADD CONSTRAINT hub_read_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE hub_read_receipts ADD CONSTRAINT hub_read_receipts_target_check CHECK ((((room_id IS NOT NULL) AND (conversation_id IS NULL)) OR ((room_id IS NULL) AND (conversation_id IS NOT NULL))));
ALTER TABLE hub_settings ADD CONSTRAINT hub_settings_pkey PRIMARY KEY (company_id);
ALTER TABLE hub_settings ADD CONSTRAINT hub_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE hub_sms_messages ADD CONSTRAINT hub_sms_messages_pkey PRIMARY KEY (id);
ALTER TABLE hub_sms_messages ADD CONSTRAINT hub_sms_messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE hub_sms_messages ADD CONSTRAINT hub_sms_messages_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES hub_contacts(id) ON DELETE CASCADE;
ALTER TABLE hub_sms_messages ADD CONSTRAINT hub_sms_messages_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE hub_users ADD CONSTRAINT hub_users_pkey PRIMARY KEY (id);
ALTER TABLE hub_users ADD CONSTRAINT hub_users_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE hub_users ADD CONSTRAINT hub_users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE hub_users ADD CONSTRAINT hub_users_status_check CHECK ((status = ANY (ARRAY['available'::text, 'busy'::text, 'away'::text, 'dnd'::text, 'custom'::text])));
ALTER TABLE hub_vehicle_assignments ADD CONSTRAINT hub_vehicle_assignments_pkey PRIMARY KEY (id);
ALTER TABLE hub_vehicle_assignments ADD CONSTRAINT hub_vehicle_assignments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE hub_vehicle_assignments ADD CONSTRAINT hub_vehicle_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE inventory_locations ADD CONSTRAINT inventory_locations_company_id_name_key UNIQUE (company_id, name);
ALTER TABLE inventory_locations ADD CONSTRAINT inventory_locations_pkey PRIMARY KEY (id);
ALTER TABLE invoices ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
ALTER TABLE invoices ADD CONSTRAINT invoices_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);
ALTER TABLE invoices ADD CONSTRAINT invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE invoices ADD CONSTRAINT invoices_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id);
ALTER TABLE job_notes ADD CONSTRAINT job_notes_pkey PRIMARY KEY (id);
ALTER TABLE job_notes ADD CONSTRAINT job_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE job_notes ADD CONSTRAINT job_notes_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE jobber_tokens ADD CONSTRAINT jobber_tokens_user_id_key UNIQUE (user_id);
ALTER TABLE jobber_tokens ADD CONSTRAINT jobber_tokens_pkey PRIMARY KEY (id);
ALTER TABLE jobber_tokens ADD CONSTRAINT jobber_tokens_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE jobber_tokens ADD CONSTRAINT jobber_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE jobber_users ADD CONSTRAINT jobber_users_external_id_company_id_key UNIQUE (external_id, company_id);
ALTER TABLE jobber_users ADD CONSTRAINT jobber_users_pkey PRIMARY KEY (id);
ALTER TABLE jobs ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);
ALTER TABLE jobs ADD CONSTRAINT jobs_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);
ALTER TABLE jobs ADD CONSTRAINT jobs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE jobs ADD CONSTRAINT jobs_property_id_fkey FOREIGN KEY (property_id) REFERENCES properties(id);
ALTER TABLE lead_notes ADD CONSTRAINT lead_notes_pkey PRIMARY KEY (id);
ALTER TABLE lead_notes ADD CONSTRAINT lead_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE lead_notes ADD CONSTRAINT lead_notes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE leads ADD CONSTRAINT leads_pkey PRIMARY KEY (id);
ALTER TABLE leads ADD CONSTRAINT leads_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE line_items ADD CONSTRAINT line_items_pkey PRIMARY KEY (id);
ALTER TABLE line_items ADD CONSTRAINT line_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
ALTER TABLE messages ADD CONSTRAINT messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT messages_forwarded_from_fkey FOREIGN KEY (forwarded_from) REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE messages ADD CONSTRAINT messages_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE messages ADD CONSTRAINT messages_check CHECK (((room_id IS NOT NULL) OR (conversation_id IS NOT NULL)));
ALTER TABLE notification_prefs ADD CONSTRAINT notification_prefs_pkey PRIMARY KEY (id);
ALTER TABLE notification_prefs ADD CONSTRAINT notification_prefs_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE notification_prefs ADD CONSTRAINT notification_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE notification_prefs ADD CONSTRAINT notification_prefs_level_check CHECK ((level = ANY (ARRAY['all'::text, 'mentions'::text, 'muted'::text])));
ALTER TABLE paid_holidays ADD CONSTRAINT paid_holidays_pkey PRIMARY KEY (id);
ALTER TABLE paid_holidays ADD CONSTRAINT paid_holidays_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE pesticide_line_item_mappings ADD CONSTRAINT pesticide_line_item_mappings_pkey PRIMARY KEY (id);
ALTER TABLE pesticide_line_item_mappings ADD CONSTRAINT pesticide_line_item_mappings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE pesticide_line_item_mappings ADD CONSTRAINT pesticide_mapping_chemical_name_len CHECK (((length(chemical_name) >= 1) AND (length(chemical_name) <= 200)));
ALTER TABLE pesticide_line_item_mappings ADD CONSTRAINT pesticide_mapping_match_text_len CHECK (((length(match_text) >= 2) AND (length(match_text) <= 200)));
ALTER TABLE pesticide_line_item_mappings ADD CONSTRAINT pesticide_mapping_match_type_check CHECK ((match_type = ANY (ARRAY['exact'::text, 'contains'::text])));
ALTER TABLE pesticide_records ADD CONSTRAINT pesticide_records_pkey PRIMARY KEY (id);
ALTER TABLE pesticide_records ADD CONSTRAINT pesticide_records_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE pesticide_records ADD CONSTRAINT pesticide_records_daily_log_entry_id_fkey FOREIGN KEY (daily_log_entry_id) REFERENCES daily_log_entries(id) ON DELETE SET NULL;
ALTER TABLE pesticide_records ADD CONSTRAINT pesticide_records_stop_id_fkey FOREIGN KEY (stop_id) REFERENCES daily_log_stops(id) ON DELETE SET NULL;
ALTER TABLE pesticide_records ADD CONSTRAINT pesticide_records_technician_user_id_fkey FOREIGN KEY (technician_user_id) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE product_categories ADD CONSTRAINT product_categories_company_id_name_key UNIQUE (company_id, name);
ALTER TABLE product_categories ADD CONSTRAINT product_categories_pkey PRIMARY KEY (id);
ALTER TABLE product_location_inventory ADD CONSTRAINT product_location_inventory_product_id_location_id_key UNIQUE (product_id, location_id);
ALTER TABLE product_location_inventory ADD CONSTRAINT product_location_inventory_pkey PRIMARY KEY (id);
ALTER TABLE product_location_inventory ADD CONSTRAINT product_location_inventory_location_id_fkey FOREIGN KEY (location_id) REFERENCES inventory_locations(id) ON DELETE CASCADE;
ALTER TABLE product_location_inventory ADD CONSTRAINT product_location_inventory_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE product_variants ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);
ALTER TABLE product_variants ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE product_variants ADD CONSTRAINT product_variants_rate_basis_check CHECK ((rate_basis = ANY (ARRAY['per_1000sqft'::text, 'per_gallon'::text, 'per_tree'::text, 'other'::text])));
ALTER TABLE products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
ALTER TABLE products ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE SET NULL;
ALTER TABLE properties ADD CONSTRAINT properties_pkey PRIMARY KEY (id);
ALTER TABLE properties ADD CONSTRAINT properties_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);
ALTER TABLE properties ADD CONSTRAINT properties_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE pto_policies ADD CONSTRAINT pto_policies_company_id_employee_id_key UNIQUE (company_id, employee_id);
ALTER TABLE pto_policies ADD CONSTRAINT pto_policies_pkey PRIMARY KEY (id);
ALTER TABLE pto_policies ADD CONSTRAINT pto_policies_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE pto_policies ADD CONSTRAINT pto_policies_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE pto_requests ADD CONSTRAINT pto_requests_pkey PRIMARY KEY (id);
ALTER TABLE pto_requests ADD CONSTRAINT pto_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE pto_requests ADD CONSTRAINT pto_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE pto_requests ADD CONSTRAINT pto_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id);
ALTER TABLE pto_requests ADD CONSTRAINT pto_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE pto_requests ADD CONSTRAINT pto_requests_type_check CHECK ((type = ANY (ARRAY['paid'::text, 'unpaid'::text])));
ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint);
ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE qbo_tokens ADD CONSTRAINT qbo_tokens_realm_id_key UNIQUE (realm_id);
ALTER TABLE qbo_tokens ADD CONSTRAINT qbo_tokens_company_id_key UNIQUE (company_id);
ALTER TABLE qbo_tokens ADD CONSTRAINT qbo_tokens_pkey PRIMARY KEY (id);
ALTER TABLE qbo_tokens ADD CONSTRAINT qbo_tokens_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE reactions ADD CONSTRAINT reactions_pkey PRIMARY KEY (message_id, user_id, emoji);
ALTER TABLE reactions ADD CONSTRAINT reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE reactions ADD CONSTRAINT reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE recurring_program_definitions ADD CONSTRAINT recurring_program_definitions_line_item_name_key UNIQUE (line_item_name);
ALTER TABLE recurring_program_definitions ADD CONSTRAINT recurring_program_definitions_pkey PRIMARY KEY (id);
ALTER TABLE recurring_services ADD CONSTRAINT recurring_services_pkey PRIMARY KEY (id);
ALTER TABLE recurring_services ADD CONSTRAINT recurring_services_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE responder_calls ADD CONSTRAINT responder_calls_call_sid_key UNIQUE (call_sid);
ALTER TABLE responder_calls ADD CONSTRAINT responder_calls_pkey PRIMARY KEY (id);
ALTER TABLE responder_calls ADD CONSTRAINT responder_calls_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE responder_settings ADD CONSTRAINT responder_settings_company_id_key UNIQUE (company_id);
ALTER TABLE responder_settings ADD CONSTRAINT responder_settings_pkey PRIMARY KEY (id);
ALTER TABLE responder_settings ADD CONSTRAINT responder_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE room_members ADD CONSTRAINT room_members_pkey PRIMARY KEY (room_id, user_id);
ALTER TABLE room_members ADD CONSTRAINT room_members_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE room_members ADD CONSTRAINT room_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE room_members ADD CONSTRAINT room_members_role_check CHECK ((role = ANY (ARRAY['member'::text, 'admin'::text])));
ALTER TABLE rooms ADD CONSTRAINT rooms_company_id_name_key UNIQUE (company_id, name);
ALTER TABLE rooms ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);
ALTER TABLE rooms ADD CONSTRAINT rooms_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE rooms ADD CONSTRAINT rooms_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE route_batches ADD CONSTRAINT route_batches_pkey PRIMARY KEY (id);
ALTER TABLE route_capacity ADD CONSTRAINT route_capacity_pkey PRIMARY KEY (id);
ALTER TABLE route_definitions ADD CONSTRAINT route_definitions_pkey PRIMARY KEY (route_code);
ALTER TABLE scheduled_messages ADD CONSTRAINT scheduled_messages_pkey PRIMARY KEY (id);
ALTER TABLE scheduled_messages ADD CONSTRAINT scheduled_messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE scheduled_messages ADD CONSTRAINT scheduled_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE scheduled_messages ADD CONSTRAINT scheduled_messages_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE scheduled_messages ADD CONSTRAINT scheduled_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE scheduled_messages ADD CONSTRAINT scheduled_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE scoreboard_technicians ADD CONSTRAINT scoreboard_technicians_company_id_board_slug_employee_id_key UNIQUE (company_id, board_slug, employee_id);
ALTER TABLE scoreboard_technicians ADD CONSTRAINT scoreboard_technicians_pkey PRIMARY KEY (id);
ALTER TABLE scoreboard_technicians ADD CONSTRAINT scoreboard_technicians_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE service_definitions ADD CONSTRAINT service_definitions_pkey PRIMARY KEY (prefix);
ALTER TABLE social_accounts ADD CONSTRAINT social_accounts_company_platform_external_id_key UNIQUE (company_id, platform, external_id);
ALTER TABLE social_accounts ADD CONSTRAINT social_accounts_pkey PRIMARY KEY (id);
ALTER TABLE social_accounts ADD CONSTRAINT social_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE social_accounts ADD CONSTRAINT social_accounts_platform_check CHECK ((platform = ANY (ARRAY['facebook'::text, 'instagram'::text, 'google_business'::text])));
ALTER TABLE social_posts ADD CONSTRAINT social_posts_pkey PRIMARY KEY (id);
ALTER TABLE social_posts ADD CONSTRAINT social_posts_account_id_fkey FOREIGN KEY (account_id) REFERENCES social_accounts(id) ON DELETE CASCADE;
ALTER TABLE social_posts ADD CONSTRAINT social_posts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE social_posts ADD CONSTRAINT social_posts_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE social_posts ADD CONSTRAINT social_posts_hub_file_id_fkey FOREIGN KEY (hub_file_id) REFERENCES hub_files(id) ON DELETE SET NULL;
ALTER TABLE social_posts ADD CONSTRAINT social_posts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'delivering'::text, 'published'::text, 'failed'::text])));
ALTER TABLE sync_log ADD CONSTRAINT sync_log_pkey PRIMARY KEY (id);
ALTER TABLE sync_log ADD CONSTRAINT sync_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE tags ADD CONSTRAINT tags_pkey PRIMARY KEY (id);
ALTER TABLE tags ADD CONSTRAINT tags_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE time_entries ADD CONSTRAINT time_entries_employee_date_unique UNIQUE (employee_id, date);
ALTER TABLE time_entries ADD CONSTRAINT time_entries_pkey PRIMARY KEY (id);
ALTER TABLE time_entries ADD CONSTRAINT time_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE time_entries ADD CONSTRAINT time_entries_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE time_punch_edit_requests ADD CONSTRAINT time_punch_edit_requests_pkey PRIMARY KEY (id);
ALTER TABLE time_punch_edit_requests ADD CONSTRAINT time_punch_edit_requests_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE time_punch_edit_requests ADD CONSTRAINT time_punch_edit_requests_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE time_punch_edit_requests ADD CONSTRAINT time_punch_edit_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE time_punch_edit_requests ADD CONSTRAINT time_punch_edit_requests_time_entry_id_fkey FOREIGN KEY (time_entry_id) REFERENCES time_entries(id) ON DELETE SET NULL;
ALTER TABLE time_punch_edit_requests ADD CONSTRAINT time_punch_edit_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE time_punches ADD CONSTRAINT time_punches_pkey PRIMARY KEY (id);
ALTER TABLE time_punches ADD CONSTRAINT time_punches_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE time_punches ADD CONSTRAINT time_punches_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES auth.users(id);
ALTER TABLE time_punches ADD CONSTRAINT time_punches_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE time_punches ADD CONSTRAINT time_punches_punch_type_check CHECK ((punch_type = ANY (ARRAY['in'::text, 'out'::text])));
ALTER TABLE timesheet_settings ADD CONSTRAINT timesheet_settings_company_id_key UNIQUE (company_id);
ALTER TABLE timesheet_settings ADD CONSTRAINT timesheet_settings_pkey PRIMARY KEY (id);
ALTER TABLE timesheet_settings ADD CONSTRAINT timesheet_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE tracker_settings ADD CONSTRAINT tracker_settings_company_id_key UNIQUE (company_id);
ALTER TABLE tracker_settings ADD CONSTRAINT tracker_settings_pkey PRIMARY KEY (id);
ALTER TABLE tracker_settings ADD CONSTRAINT tracker_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE txt_broadcast_recipients ADD CONSTRAINT txt_broadcast_recipients_broadcast_id_contact_id_key UNIQUE (broadcast_id, contact_id);
ALTER TABLE txt_broadcast_recipients ADD CONSTRAINT txt_broadcast_recipients_pkey PRIMARY KEY (id);
ALTER TABLE txt_broadcast_recipients ADD CONSTRAINT txt_broadcast_recipients_broadcast_id_fkey FOREIGN KEY (broadcast_id) REFERENCES txt_broadcasts(id) ON DELETE CASCADE;
ALTER TABLE txt_broadcast_recipients ADD CONSTRAINT txt_broadcast_recipients_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES txt_contacts(id) ON DELETE CASCADE;
ALTER TABLE txt_broadcast_recipients ADD CONSTRAINT txt_broadcast_recipients_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES txt_conversations(id) ON DELETE SET NULL;
ALTER TABLE txt_broadcast_recipients ADD CONSTRAINT txt_broadcast_recipients_message_id_fkey FOREIGN KEY (message_id) REFERENCES txt_messages(id) ON DELETE SET NULL;
ALTER TABLE txt_broadcast_recipients ADD CONSTRAINT txt_broadcast_recipients_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text, 'skipped'::text])));
ALTER TABLE txt_broadcasts ADD CONSTRAINT txt_broadcasts_pkey PRIMARY KEY (id);
ALTER TABLE txt_broadcasts ADD CONSTRAINT txt_broadcasts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE txt_broadcasts ADD CONSTRAINT txt_broadcasts_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id);
ALTER TABLE txt_broadcasts ADD CONSTRAINT txt_broadcasts_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'processing'::text, 'complete'::text, 'failed'::text])));
ALTER TABLE txt_contacts ADD CONSTRAINT txt_contacts_company_id_phone_key UNIQUE (company_id, phone);
ALTER TABLE txt_contacts ADD CONSTRAINT txt_contacts_pkey PRIMARY KEY (id);
ALTER TABLE txt_contacts ADD CONSTRAINT txt_contacts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE txt_conversation_contacts ADD CONSTRAINT txt_conversation_contacts_pkey PRIMARY KEY (conversation_id, contact_id);
ALTER TABLE txt_conversation_contacts ADD CONSTRAINT txt_conversation_contacts_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES txt_contacts(id) ON DELETE CASCADE;
ALTER TABLE txt_conversation_contacts ADD CONSTRAINT txt_conversation_contacts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES txt_conversations(id) ON DELETE CASCADE;
ALTER TABLE txt_conversation_members ADD CONSTRAINT txt_conversation_members_pkey PRIMARY KEY (conversation_id, user_id);
ALTER TABLE txt_conversation_members ADD CONSTRAINT txt_conversation_members_added_by_fkey FOREIGN KEY (added_by) REFERENCES hub_users(id);
ALTER TABLE txt_conversation_members ADD CONSTRAINT txt_conversation_members_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES txt_conversations(id) ON DELETE CASCADE;
ALTER TABLE txt_conversation_members ADD CONSTRAINT txt_conversation_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE txt_conversation_members ADD CONSTRAINT txt_conversation_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text])));
ALTER TABLE txt_conversations ADD CONSTRAINT txt_conversations_pkey PRIMARY KEY (id);
ALTER TABLE txt_conversations ADD CONSTRAINT txt_conversations_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES hub_users(id);
ALTER TABLE txt_conversations ADD CONSTRAINT txt_conversations_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE txt_conversations ADD CONSTRAINT txt_conversations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE txt_conversations ADD CONSTRAINT txt_conversations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES txt_contacts(id) ON DELETE CASCADE;
ALTER TABLE txt_conversations ADD CONSTRAINT txt_conversations_phone_number_id_fkey FOREIGN KEY (phone_number_id) REFERENCES txt_phone_numbers(id) ON DELETE SET NULL;
ALTER TABLE txt_conversations ADD CONSTRAINT txt_conversations_kind_check CHECK ((kind = ANY (ARRAY['direct'::text, 'group'::text])));
ALTER TABLE txt_conversations ADD CONSTRAINT txt_conversations_status_check CHECK ((status = ANY (ARRAY['unassigned'::text, 'assigned'::text, 'archived'::text])));
ALTER TABLE txt_messages ADD CONSTRAINT txt_messages_pkey PRIMARY KEY (id);
ALTER TABLE txt_messages ADD CONSTRAINT txt_messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE txt_messages ADD CONSTRAINT txt_messages_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES txt_contacts(id) ON DELETE CASCADE;
ALTER TABLE txt_messages ADD CONSTRAINT txt_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES txt_conversations(id) ON DELETE CASCADE;
ALTER TABLE txt_messages ADD CONSTRAINT txt_messages_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE txt_messages ADD CONSTRAINT txt_messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])));
ALTER TABLE txt_messages ADD CONSTRAINT txt_messages_status_check CHECK ((status = ANY (ARRAY['sending'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'received'::text, 'undelivered'::text])));
ALTER TABLE txt_notes ADD CONSTRAINT txt_notes_pkey PRIMARY KEY (id);
ALTER TABLE txt_notes ADD CONSTRAINT txt_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE txt_notes ADD CONSTRAINT txt_notes_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES txt_conversations(id) ON DELETE CASCADE;
ALTER TABLE txt_notes ADD CONSTRAINT txt_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE txt_phone_numbers ADD CONSTRAINT txt_phone_numbers_twilio_number_key UNIQUE (twilio_number);
ALTER TABLE txt_phone_numbers ADD CONSTRAINT txt_phone_numbers_pkey PRIMARY KEY (id);
ALTER TABLE txt_phone_numbers ADD CONSTRAINT txt_phone_numbers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE txt_scheduled_messages ADD CONSTRAINT txt_scheduled_messages_pkey PRIMARY KEY (id);
ALTER TABLE txt_scheduled_messages ADD CONSTRAINT txt_scheduled_messages_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE txt_scheduled_messages ADD CONSTRAINT txt_scheduled_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES txt_conversations(id) ON DELETE CASCADE;
ALTER TABLE txt_scheduled_messages ADD CONSTRAINT txt_scheduled_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES hub_users(id);
ALTER TABLE txt_settings ADD CONSTRAINT txt_settings_pkey PRIMARY KEY (company_id);
ALTER TABLE txt_settings ADD CONSTRAINT txt_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE txt_templates ADD CONSTRAINT txt_templates_pkey PRIMARY KEY (id);
ALTER TABLE txt_templates ADD CONSTRAINT txt_templates_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES hub_users(id) ON DELETE CASCADE;
ALTER TABLE txt_templates ADD CONSTRAINT txt_templates_owner_matches_scope CHECK ((((scope = 'org'::text) AND (owner_user_id IS NULL)) OR ((scope = 'personal'::text) AND (owner_user_id IS NOT NULL))));
ALTER TABLE txt_templates ADD CONSTRAINT txt_templates_scope_check CHECK ((scope = ANY (ARRAY['org'::text, 'personal'::text])));
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_txt_default_number_id_fkey FOREIGN KEY (txt_default_number_id) REFERENCES txt_phone_numbers(id) ON DELETE SET NULL;
ALTER TABLE user_profiles ADD CONSTRAINT guardian_tier_check CHECK ((guardian_tier = ANY (ARRAY['basic'::text, 'manager'::text, 'full'::text])));
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_dialer_extension_format CHECK (((dialer_extension IS NULL) OR (dialer_extension ~ '^[1-9][0-9]{2}$'::text)));
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_hub_text_size_check CHECK ((hub_text_size = ANY (ARRAY['small'::text, 'default'::text, 'large'::text])));
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_landing_page_check CHECK ((landing_page = ANY (ARRAY['hub'::text, 'dashboard'::text])));
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'manager'::text, 'user'::text])));
ALTER TABLE user_settings ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id);
ALTER TABLE user_settings ADD CONSTRAINT user_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE user_settings ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE visits ADD CONSTRAINT visits_pkey PRIMARY KEY (id);
ALTER TABLE visits ADD CONSTRAINT visits_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id);
ALTER TABLE visits ADD CONSTRAINT visits_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE visits ADD CONSTRAINT visits_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id);
ALTER TABLE voicemails ADD CONSTRAINT voicemails_pkey PRIMARY KEY (id);
ALTER TABLE voicemails ADD CONSTRAINT voicemails_call_id_fkey FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE SET NULL;
ALTER TABLE voicemails ADD CONSTRAINT voicemails_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE voicemails ADD CONSTRAINT voicemails_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES txt_contacts(id) ON DELETE SET NULL;
ALTER TABLE voicemails ADD CONSTRAINT voicemails_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE voicemails ADD CONSTRAINT voicemails_heard_by_fkey FOREIGN KEY (heard_by) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE voicemails ADD CONSTRAINT voicemails_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES hub_users(id) ON DELETE SET NULL;
ALTER TABLE zone_sizer_settings ADD CONSTRAINT zone_sizer_settings_pkey PRIMARY KEY (company_id);
ALTER TABLE zone_sizer_settings ADD CONSTRAINT zone_sizer_settings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE zone_sizer_settings ADD CONSTRAINT zone_sizer_settings_bed_sqft_per_zone_check CHECK ((bed_sqft_per_zone > 0));
ALTER TABLE zone_sizer_settings ADD CONSTRAINT zone_sizer_settings_turf_sqft_per_zone_check CHECK ((turf_sqft_per_zone > 0));


-- ============ INDEXES ============

CREATE UNIQUE INDEX announcement_reactions_pkey ON public.announcement_reactions USING btree (announcement_id, user_id, emoji);
CREATE INDEX idx_announcement_reactions_user_id ON public.announcement_reactions USING btree (user_id);
CREATE UNIQUE INDEX api_keys_pkey ON public.api_keys USING btree (id);
CREATE INDEX idx_api_keys_company_id ON public.api_keys USING btree (company_id);
CREATE INDEX idx_api_keys_created_by ON public.api_keys USING btree (created_by);
CREATE UNIQUE INDEX apns_tokens_device_token_uniq ON public.apns_tokens USING btree (device_token);
CREATE UNIQUE INDEX apns_tokens_pkey ON public.apns_tokens USING btree (id);
CREATE UNIQUE INDEX apns_tokens_user_id_device_token_key ON public.apns_tokens USING btree (user_id, device_token);
CREATE INDEX apns_tokens_user_id_idx ON public.apns_tokens USING btree (user_id);
CREATE INDEX board_item_attachments_item_id_idx ON public.board_item_attachments USING btree (board_item_id);
CREATE UNIQUE INDEX board_item_attachments_pkey ON public.board_item_attachments USING btree (id);
CREATE INDEX bic_item_idx ON public.board_item_comments USING btree (board_item_id, created_at);
CREATE UNIQUE INDEX board_item_comments_pkey ON public.board_item_comments USING btree (id);
CREATE INDEX idx_board_item_comments_company_id ON public.board_item_comments USING btree (company_id);
CREATE INDEX idx_board_item_comments_created_by ON public.board_item_comments USING btree (created_by);
CREATE INDEX board_items_board_id_idx ON public.board_items USING btree (board_id, created_at);
CREATE UNIQUE INDEX board_items_pkey ON public.board_items USING btree (id);
CREATE INDEX idx_board_items_assignee_id ON public.board_items USING btree (assignee_id);
CREATE INDEX idx_board_items_company_id ON public.board_items USING btree (company_id);
CREATE INDEX idx_board_items_created_by ON public.board_items USING btree (created_by);
CREATE INDEX idx_board_items_forwarded_from_message_id ON public.board_items USING btree (forwarded_from_message_id);
CREATE UNIQUE INDEX board_members_board_id_user_id_key ON public.board_members USING btree (board_id, user_id);
CREATE UNIQUE INDEX board_members_pkey ON public.board_members USING btree (id);
CREATE INDEX board_members_user_id_idx ON public.board_members USING btree (user_id);
CREATE INDEX boards_company_id_idx ON public.boards USING btree (company_id);
CREATE UNIQUE INDEX boards_pkey ON public.boards USING btree (id);
CREATE INDEX idx_boards_created_by ON public.boards USING btree (created_by);
CREATE UNIQUE INDEX call_ai_results_call_id_engine_key ON public.call_ai_results USING btree (call_id, engine);
CREATE INDEX call_ai_results_call_id_idx ON public.call_ai_results USING btree (call_id);
CREATE UNIQUE INDEX call_ai_results_pkey ON public.call_ai_results USING btree (id);
CREATE INDEX call_logs_company_id_idx ON public.call_logs USING btree (company_id);
CREATE INDEX call_logs_hub_posted_at_idx ON public.call_logs USING btree (company_id, hub_posted_at) WHERE (hub_posted_at IS NULL);
CREATE UNIQUE INDEX call_logs_pkey ON public.call_logs USING btree (id);
CREATE UNIQUE INDEX call_logs_recording_id_key ON public.call_logs USING btree (recording_id);
CREATE INDEX calls_company_created_idx ON public.calls USING btree (company_id, created_at DESC);
CREATE INDEX calls_contact_id_idx ON public.calls USING btree (contact_id) WHERE (contact_id IS NOT NULL);
CREATE INDEX calls_conversation_id_idx ON public.calls USING btree (conversation_id) WHERE (conversation_id IS NOT NULL);
CREATE INDEX calls_handled_by_idx ON public.calls USING btree (handled_by) WHERE (handled_by IS NOT NULL);
CREATE UNIQUE INDEX calls_pkey ON public.calls USING btree (id);
CREATE UNIQUE INDEX calls_twilio_call_sid_idx ON public.calls USING btree (twilio_call_sid) WHERE (twilio_call_sid IS NOT NULL);
CREATE INDEX idx_calls_initiated_by ON public.calls USING btree (initiated_by);
CREATE INDEX chat_synx_bridges_company_id_idx ON public.chat_synx_bridges USING btree (company_id);
CREATE UNIQUE INDEX chat_synx_bridges_hub_room_id_key ON public.chat_synx_bridges USING btree (hub_room_id);
CREATE UNIQUE INDEX chat_synx_bridges_pkey ON public.chat_synx_bridges USING btree (id);
CREATE UNIQUE INDEX chat_synx_bridges_slack_channel_id_key ON public.chat_synx_bridges USING btree (slack_channel_id);
CREATE INDEX chat_synx_user_links_company_id_idx ON public.chat_synx_user_links USING btree (company_id);
CREATE INDEX chat_synx_user_links_hub_user_id_idx ON public.chat_synx_user_links USING btree (hub_user_id);
CREATE UNIQUE INDEX chat_synx_user_links_pkey ON public.chat_synx_user_links USING btree (slack_user_id);
CREATE INDEX client_notes_client_idx ON public.client_notes USING btree (client_id);
CREATE UNIQUE INDEX client_notes_external_id_source_idx ON public.client_notes USING btree (external_id, source);
CREATE UNIQUE INDEX client_notes_pkey ON public.client_notes USING btree (id);
CREATE UNIQUE INDEX client_tags_pkey ON public.client_tags USING btree (client_id, tag_id);
CREATE INDEX clients_active_idx ON public.clients USING btree (company_id) WHERE ((deleted_at IS NULL) AND (is_archived = false));
CREATE INDEX clients_company_idx ON public.clients USING btree (company_id);
CREATE INDEX clients_company_phone_digits_idx ON public.clients USING btree (company_id, phone_digits);
CREATE INDEX clients_email_idx ON public.clients USING btree (email);
CREATE UNIQUE INDEX clients_external_id_source_idx ON public.clients USING btree (external_id, source);
CREATE INDEX clients_phone_idx ON public.clients USING btree (phone);
CREATE UNIQUE INDEX clients_pkey ON public.clients USING btree (id);
CREATE UNIQUE INDEX companies_pkey ON public.companies USING btree (id);
CREATE UNIQUE INDEX companies_subdomain_slug_key ON public.companies USING btree (subdomain_slug);
CREATE UNIQUE INDEX company_routing_settings_pkey ON public.company_routing_settings USING btree (company_id);
CREATE UNIQUE INDEX contact_tag_assignments_pkey ON public.contact_tag_assignments USING btree (contact_id, tag_id);
CREATE INDEX contact_tag_assignments_tag_idx ON public.contact_tag_assignments USING btree (tag_id);
CREATE INDEX idx_contact_tag_assignments_assigned_by ON public.contact_tag_assignments USING btree (assigned_by);
CREATE UNIQUE INDEX contact_tags_company_id_label_key ON public.contact_tags USING btree (company_id, label);
CREATE INDEX contact_tags_company_idx ON public.contact_tags USING btree (company_id, sort_order, label);
CREATE UNIQUE INDEX contact_tags_pkey ON public.contact_tags USING btree (id);
CREATE INDEX idx_contact_tags_created_by ON public.contact_tags USING btree (created_by);
CREATE INDEX contacts_client_idx ON public.contacts USING btree (client_id);
CREATE INDEX contacts_company_phone_digits_idx ON public.contacts USING btree (company_id, phone_digits);
CREATE UNIQUE INDEX contacts_external_id_source_idx ON public.contacts USING btree (external_id, source);
CREATE UNIQUE INDEX contacts_pkey ON public.contacts USING btree (id);
CREATE UNIQUE INDEX conversation_members_pkey ON public.conversation_members USING btree (conversation_id, user_id);
CREATE INDEX conversation_members_user_id_idx ON public.conversation_members USING btree (user_id);
CREATE UNIQUE INDEX conversations_pkey ON public.conversations USING btree (id);
CREATE INDEX idx_conversations_company_id ON public.conversations USING btree (company_id);
CREATE INDEX daily_log_entries_company_date ON public.daily_log_entries USING btree (company_id, log_date);
CREATE UNIQUE INDEX daily_log_entries_company_id_log_date_tech_user_id_key ON public.daily_log_entries USING btree (company_id, log_date, tech_user_id);
CREATE UNIQUE INDEX daily_log_entries_pkey ON public.daily_log_entries USING btree (id);
CREATE INDEX daily_log_entries_secondary_techs_gin ON public.daily_log_entries USING gin (secondary_tech_user_ids);
CREATE INDEX idx_daily_log_entries_closed_by ON public.daily_log_entries USING btree (closed_by);
CREATE INDEX idx_daily_log_entries_completed_by ON public.daily_log_entries USING btree (completed_by);
CREATE INDEX idx_daily_log_entries_created_by ON public.daily_log_entries USING btree (created_by);
CREATE INDEX idx_daily_log_entries_tech_user_id ON public.daily_log_entries USING btree (tech_user_id);
CREATE UNIQUE INDEX daily_log_read_receipts_pkey ON public.daily_log_read_receipts USING btree (user_id);
CREATE UNIQUE INDEX daily_log_settings_pkey ON public.daily_log_settings USING btree (company_id);
CREATE INDEX daily_log_skip_reasons_company_idx ON public.daily_log_skip_reasons USING btree (company_id, sort_order, active);
CREATE UNIQUE INDEX daily_log_skip_reasons_pkey ON public.daily_log_skip_reasons USING btree (id);
CREATE UNIQUE INDEX daily_log_stop_attachments_pkey ON public.daily_log_stop_attachments USING btree (id);
CREATE INDEX daily_log_stop_attachments_stop_idx ON public.daily_log_stop_attachments USING btree (stop_id, created_at);
CREATE INDEX idx_daily_log_stop_attachments_uploaded_by ON public.daily_log_stop_attachments USING btree (uploaded_by);
CREATE UNIQUE INDEX daily_log_stop_messages_pkey ON public.daily_log_stop_messages USING btree (id);
CREATE INDEX daily_log_stop_messages_stop_idx ON public.daily_log_stop_messages USING btree (stop_id, created_at);
CREATE INDEX idx_daily_log_stop_messages_user_id ON public.daily_log_stop_messages USING btree (user_id);
CREATE UNIQUE INDEX daily_log_stop_reports_pkey ON public.daily_log_stop_reports USING btree (id);
CREATE UNIQUE INDEX daily_log_stop_reports_stop_id_key ON public.daily_log_stop_reports USING btree (stop_id);
CREATE INDEX idx_daily_log_stop_reports_sent_by ON public.daily_log_stop_reports USING btree (sent_by);
CREATE INDEX daily_log_stops_entry_id_idx ON public.daily_log_stops USING btree (entry_id);
CREATE UNIQUE INDEX daily_log_stops_entry_ord_uniq ON public.daily_log_stops USING btree (entry_id, ord);
CREATE INDEX daily_log_stops_jobber_visit_id_idx ON public.daily_log_stops USING btree (jobber_visit_id) WHERE (jobber_visit_id IS NOT NULL);
CREATE UNIQUE INDEX daily_log_stops_pkey ON public.daily_log_stops USING btree (id);
CREATE INDEX idx_daily_log_stops_completed_by ON public.daily_log_stops USING btree (completed_by);
CREATE INDEX idx_daily_log_stops_office_reviewed_by ON public.daily_log_stops USING btree (office_reviewed_by);
CREATE INDEX idx_daily_log_stops_pesticide_record_id ON public.daily_log_stops USING btree (pesticide_record_id);
CREATE INDEX idx_daily_log_stops_skip_reason_id ON public.daily_log_stops USING btree (skip_reason_id);
CREATE UNIQUE INDEX daily_log_subscribers_pkey ON public.daily_log_subscribers USING btree (entry_id, user_id);
CREATE INDEX idx_daily_log_subscribers_user_id ON public.daily_log_subscribers USING btree (user_id);
CREATE UNIQUE INDEX daily_log_update_reactions_pkey ON public.daily_log_update_reactions USING btree (update_id, user_id, emoji);
CREATE INDEX daily_log_updates_entry_id ON public.daily_log_updates USING btree (entry_id);
CREATE UNIQUE INDEX daily_log_updates_pkey ON public.daily_log_updates USING btree (id);
CREATE INDEX idx_daily_log_updates_company_id ON public.daily_log_updates USING btree (company_id);
CREATE INDEX idx_daily_log_updates_created_by ON public.daily_log_updates USING btree (created_by);
CREATE INDEX dialer_ring_group_members_group_idx ON public.dialer_ring_group_members USING btree (group_id, "position");
CREATE UNIQUE INDEX dialer_ring_group_members_pkey ON public.dialer_ring_group_members USING btree (group_id, user_id);
CREATE INDEX idx_dialer_ring_group_members_user_id ON public.dialer_ring_group_members USING btree (user_id);
CREATE UNIQUE INDEX dialer_ring_groups_company_id_name_key ON public.dialer_ring_groups USING btree (company_id, name);
CREATE INDEX dialer_ring_groups_company_idx ON public.dialer_ring_groups USING btree (company_id);
CREATE UNIQUE INDEX dialer_ring_groups_pkey ON public.dialer_ring_groups USING btree (id);
CREATE UNIQUE INDEX dialer_settings_pkey ON public.dialer_settings USING btree (company_id);
CREATE INDEX idx_dialer_settings_inbound_route_user_id ON public.dialer_settings USING btree (inbound_route_user_id);
CREATE INDEX employees_company_id_idx ON public.employees USING btree (company_id);
CREATE UNIQUE INDEX employees_gusto_uuid_key ON public.employees USING btree (gusto_uuid);
CREATE UNIQUE INDEX employees_pkey ON public.employees USING btree (id);
CREATE INDEX idx_employees_user_id ON public.employees USING btree (user_id);
CREATE INDEX external_links_company_sort_idx ON public.external_links USING btree (company_id, sort_order, name);
CREATE UNIQUE INDEX external_links_pkey ON public.external_links USING btree (id);
CREATE UNIQUE INDEX fcm_tokens_device_token_uniq ON public.fcm_tokens USING btree (device_token);
CREATE UNIQUE INDEX fcm_tokens_pkey ON public.fcm_tokens USING btree (id);
CREATE UNIQUE INDEX fcm_tokens_user_id_device_token_key ON public.fcm_tokens USING btree (user_id, device_token);
CREATE INDEX idx_fcm_tokens_company_id ON public.fcm_tokens USING btree (company_id);
CREATE INDEX files_message_id_idx ON public.files USING btree (message_id) WHERE (message_id IS NOT NULL);
CREATE UNIQUE INDEX files_pkey ON public.files USING btree (id);
CREATE INDEX idx_files_company_id ON public.files USING btree (company_id);
CREATE INDEX idx_files_uploader_id ON public.files USING btree (uploader_id);
CREATE INDEX fleet_alert_events_company_started ON public.fleet_alert_events USING btree (company_id, started_at DESC);
CREATE UNIQUE INDEX fleet_alert_events_one_open ON public.fleet_alert_events USING btree (device_id, alert_type) WHERE (resolved_at IS NULL);
CREATE UNIQUE INDEX fleet_alert_events_pkey ON public.fleet_alert_events USING btree (id);
CREATE UNIQUE INDEX fleet_settings_pkey ON public.fleet_settings USING btree (company_id);
CREATE UNIQUE INDEX form_submissions_pkey ON public.form_submissions USING btree (id);
CREATE INDEX idx_form_submissions_form_id ON public.form_submissions USING btree (form_id);
CREATE INDEX idx_form_submissions_submitted_by ON public.form_submissions USING btree (submitted_by);
CREATE UNIQUE INDEX forms_pkey ON public.forms USING btree (id);
CREATE INDEX idx_forms_created_by ON public.forms USING btree (created_by);
CREATE INDEX guardian_audit_company_created ON public.guardian_audit USING btree (company_id, created_at DESC);
CREATE UNIQUE INDEX guardian_audit_pkey ON public.guardian_audit USING btree (id);
CREATE INDEX idx_guardian_audit_user_id ON public.guardian_audit USING btree (user_id);
CREATE INDEX guardian_knowledge_doc_versions_doc_saved ON public.guardian_knowledge_doc_versions USING btree (doc_id, saved_at DESC);
CREATE UNIQUE INDEX guardian_knowledge_doc_versions_pkey ON public.guardian_knowledge_doc_versions USING btree (id);
CREATE INDEX idx_guardian_knowledge_doc_versions_saved_by ON public.guardian_knowledge_doc_versions USING btree (saved_by);
CREATE UNIQUE INDEX guardian_knowledge_docs_company_id_slug_key ON public.guardian_knowledge_docs USING btree (company_id, slug);
CREATE INDEX guardian_knowledge_docs_company_slug ON public.guardian_knowledge_docs USING btree (company_id, slug);
CREATE UNIQUE INDEX guardian_knowledge_docs_pkey ON public.guardian_knowledge_docs USING btree (id);
CREATE INDEX idx_guardian_knowledge_docs_updated_by ON public.guardian_knowledge_docs USING btree (updated_by);
CREATE UNIQUE INDEX guardian_settings_pkey ON public.guardian_settings USING btree (company_id);
CREATE INDEX idx_guardian_settings_updated_by ON public.guardian_settings USING btree (updated_by);
CREATE UNIQUE INDEX guardian_web_search_usage_company_id_date_key ON public.guardian_web_search_usage USING btree (company_id, date);
CREATE UNIQUE INDEX guardian_web_search_usage_pkey ON public.guardian_web_search_usage USING btree (id);
CREATE UNIQUE INDEX holiday_overrides_company_id_employee_id_holiday_id_pay_per_key ON public.holiday_overrides USING btree (company_id, employee_id, holiday_id, pay_period_start);
CREATE UNIQUE INDEX holiday_overrides_pkey ON public.holiday_overrides USING btree (id);
CREATE INDEX idx_holiday_overrides_employee_id ON public.holiday_overrides USING btree (employee_id);
CREATE INDEX idx_holiday_overrides_holiday_id ON public.holiday_overrides USING btree (holiday_id);
CREATE INDEX hub_announcements_lookup_idx ON public.hub_announcements USING btree (company_id, type, archived_at, expires_at, created_at DESC);
CREATE UNIQUE INDEX hub_announcements_pkey ON public.hub_announcements USING btree (id);
CREATE INDEX idx_hub_announcements_created_by ON public.hub_announcements USING btree (created_by);
CREATE INDEX hub_api_keys_company_idx ON public.hub_api_keys USING btree (company_id);
CREATE UNIQUE INDEX hub_api_keys_pkey ON public.hub_api_keys USING btree (id);
CREATE INDEX hub_api_keys_prefix_idx ON public.hub_api_keys USING btree (key_prefix);
CREATE INDEX idx_hub_api_keys_bot_user_id ON public.hub_api_keys USING btree (bot_user_id);
CREATE INDEX idx_hub_api_keys_created_by ON public.hub_api_keys USING btree (created_by);
CREATE UNIQUE INDEX hub_automation_geofence_state_pkey ON public.hub_automation_geofence_state USING btree (rule_id, device_id);
CREATE UNIQUE INDEX hub_automation_rules_pkey ON public.hub_automation_rules USING btree (id);
CREATE INDEX idx_hub_automation_rules_company_id ON public.hub_automation_rules USING btree (company_id);
CREATE INDEX idx_hub_automation_rules_created_by ON public.hub_automation_rules USING btree (created_by);
CREATE INDEX idx_hub_automation_rules_target_board_id ON public.hub_automation_rules USING btree (target_board_id);
CREATE INDEX idx_hub_automation_rules_target_room_id ON public.hub_automation_rules USING btree (target_room_id);
CREATE INDEX idx_hub_automation_rules_target_user_id ON public.hub_automation_rules USING btree (target_user_id);
CREATE INDEX idx_hub_automation_rules_trigger_room_id ON public.hub_automation_rules USING btree (trigger_room_id);
CREATE INDEX hub_automation_runs_company_idx ON public.hub_automation_runs USING btree (company_id, fired_at DESC);
CREATE UNIQUE INDEX hub_automation_runs_pkey ON public.hub_automation_runs USING btree (id);
CREATE INDEX hub_automation_runs_rule_idx ON public.hub_automation_runs USING btree (rule_id, fired_at DESC);
CREATE INDEX hub_contacts_company_id_idx ON public.hub_contacts USING btree (company_id);
CREATE UNIQUE INDEX hub_contacts_company_id_phone_key ON public.hub_contacts USING btree (company_id, phone);
CREATE INDEX hub_contacts_name_idx ON public.hub_contacts USING btree (company_id, name);
CREATE UNIQUE INDEX hub_contacts_pkey ON public.hub_contacts USING btree (id);
CREATE UNIQUE INDEX hub_file_tags_company_id_name_key ON public.hub_file_tags USING btree (company_id, name);
CREATE INDEX hub_file_tags_company_idx ON public.hub_file_tags USING btree (company_id);
CREATE UNIQUE INDEX hub_file_tags_pkey ON public.hub_file_tags USING btree (id);
CREATE INDEX hub_files_company_uploaded ON public.hub_files USING btree (company_id, uploaded_at DESC);
CREATE UNIQUE INDEX hub_files_pkey ON public.hub_files USING btree (id);
CREATE INDEX hub_files_social_queue_idx ON public.hub_files USING btree (company_id, uploaded_at) WHERE (social_used_at IS NULL);
CREATE INDEX hub_files_tags_gin_idx ON public.hub_files USING gin (tags);
CREATE INDEX idx_hub_files_uploader_id ON public.hub_files USING btree (uploader_id);
CREATE INDEX hub_geofences_company_idx ON public.hub_geofences USING btree (company_id);
CREATE UNIQUE INDEX hub_geofences_pkey ON public.hub_geofences USING btree (id);
CREATE UNIQUE INDEX hub_read_receipts_conv_unique ON public.hub_read_receipts USING btree (user_id, conversation_id);
CREATE UNIQUE INDEX hub_read_receipts_pkey ON public.hub_read_receipts USING btree (id);
CREATE UNIQUE INDEX hub_read_receipts_room_unique ON public.hub_read_receipts USING btree (user_id, room_id);
CREATE INDEX hub_read_receipts_user_idx ON public.hub_read_receipts USING btree (user_id);
CREATE INDEX idx_hub_read_receipts_company_id ON public.hub_read_receipts USING btree (company_id);
CREATE INDEX idx_hub_read_receipts_conversation_id ON public.hub_read_receipts USING btree (conversation_id);
CREATE INDEX idx_hub_read_receipts_room_id ON public.hub_read_receipts USING btree (room_id);
CREATE UNIQUE INDEX hub_settings_pkey ON public.hub_settings USING btree (company_id);
CREATE INDEX hub_sms_messages_company_id_idx ON public.hub_sms_messages USING btree (company_id);
CREATE INDEX hub_sms_messages_contact_id_idx ON public.hub_sms_messages USING btree (contact_id);
CREATE INDEX hub_sms_messages_created_at_idx ON public.hub_sms_messages USING btree (contact_id, created_at DESC);
CREATE UNIQUE INDEX hub_sms_messages_pkey ON public.hub_sms_messages USING btree (id);
CREATE INDEX idx_hub_sms_messages_sent_by ON public.hub_sms_messages USING btree (sent_by);
CREATE INDEX hub_users_company_idx ON public.hub_users USING btree (company_id);
CREATE UNIQUE INDEX hub_users_pkey ON public.hub_users USING btree (id);
CREATE UNIQUE INDEX hub_vehicle_assign_dated_uniq ON public.hub_vehicle_assignments USING btree (company_id, device_id, effective_date) WHERE (effective_date IS NOT NULL);
CREATE UNIQUE INDEX hub_vehicle_assign_default_uniq ON public.hub_vehicle_assignments USING btree (company_id, device_id) WHERE (effective_date IS NULL);
CREATE UNIQUE INDEX hub_vehicle_assignments_pkey ON public.hub_vehicle_assignments USING btree (id);
CREATE INDEX idx_inventory_locations_company ON public.inventory_locations USING btree (company_id);
CREATE UNIQUE INDEX inventory_locations_company_id_name_key ON public.inventory_locations USING btree (company_id, name);
CREATE UNIQUE INDEX inventory_locations_pkey ON public.inventory_locations USING btree (id);
CREATE INDEX invoices_client_idx ON public.invoices USING btree (client_id);
CREATE UNIQUE INDEX invoices_external_id_source_idx ON public.invoices USING btree (external_id, source);
CREATE INDEX invoices_issued_idx ON public.invoices USING btree (issued_date);
CREATE INDEX invoices_job_idx ON public.invoices USING btree (job_id);
CREATE UNIQUE INDEX invoices_pkey ON public.invoices USING btree (id);
CREATE INDEX invoices_status_idx ON public.invoices USING btree (invoice_status);
CREATE UNIQUE INDEX job_notes_external_id_source_idx ON public.job_notes USING btree (external_id, source);
CREATE INDEX job_notes_job_idx ON public.job_notes USING btree (job_id);
CREATE UNIQUE INDEX job_notes_pkey ON public.job_notes USING btree (id);
CREATE INDEX jobber_tokens_company_id_idx ON public.jobber_tokens USING btree (company_id);
CREATE UNIQUE INDEX jobber_tokens_pkey ON public.jobber_tokens USING btree (id);
CREATE UNIQUE INDEX jobber_tokens_user_id_key ON public.jobber_tokens USING btree (user_id);
CREATE UNIQUE INDEX jobber_users_external_id_company_id_key ON public.jobber_users USING btree (external_id, company_id);
CREATE UNIQUE INDEX jobber_users_pkey ON public.jobber_users USING btree (id);
CREATE INDEX jobs_client_idx ON public.jobs USING btree (client_id);
CREATE INDEX jobs_dept_idx ON public.jobs USING btree (dept_prefix);
CREATE UNIQUE INDEX jobs_external_id_source_idx ON public.jobs USING btree (external_id, source);
CREATE INDEX jobs_neighborhood_idx ON public.jobs USING btree (neighborhood) WHERE (neighborhood IS NOT NULL);
CREATE UNIQUE INDEX jobs_pkey ON public.jobs USING btree (id);
CREATE INDEX jobs_property_idx ON public.jobs USING btree (property_id);
CREATE INDEX jobs_recurring_idx ON public.jobs USING btree (is_recurring) WHERE (is_recurring = true);
CREATE INDEX jobs_route_idx ON public.jobs USING btree (route_code) WHERE (route_code IS NOT NULL);
CREATE INDEX jobs_status_idx ON public.jobs USING btree (job_status);
CREATE INDEX lead_notes_company_id_idx ON public.lead_notes USING btree (company_id);
CREATE INDEX lead_notes_lead_id_idx ON public.lead_notes USING btree (lead_id);
CREATE UNIQUE INDEX lead_notes_pkey ON public.lead_notes USING btree (id);
CREATE INDEX leads_company_id_idx ON public.leads USING btree (company_id);
CREATE UNIQUE INDEX leads_monday_item_uidx ON public.leads USING btree (monday_item_id);
CREATE UNIQUE INDEX leads_pkey ON public.leads USING btree (id);
CREATE INDEX leads_salesperson_idx ON public.leads USING btree (company_id, salesperson);
CREATE INDEX leads_sold_date_idx ON public.leads USING btree (company_id, sold_date);
CREATE INDEX leads_stage_idx ON public.leads USING btree (company_id, stage);
CREATE INDEX line_items_dept_idx ON public.line_items USING btree (dept_prefix);
CREATE UNIQUE INDEX line_items_external_id_parent_source_idx ON public.line_items USING btree (external_id, parent_type, parent_external_id, source);
CREATE INDEX line_items_parent_idx ON public.line_items USING btree (parent_type, parent_external_id);
CREATE UNIQUE INDEX line_items_pkey ON public.line_items USING btree (id);
CREATE INDEX line_items_recurring_idx ON public.line_items USING btree (is_recurring_program) WHERE (is_recurring_program = true);
CREATE INDEX idx_messages_company_id ON public.messages USING btree (company_id);
CREATE INDEX idx_messages_forwarded_from ON public.messages USING btree (forwarded_from);
CREATE INDEX idx_messages_fts ON public.messages USING gin (to_tsvector('english'::regconfig, content));
CREATE INDEX idx_messages_sender_id ON public.messages USING btree (sender_id);
CREATE INDEX messages_conversation_created_idx ON public.messages USING btree (conversation_id, created_at) WHERE (conversation_id IS NOT NULL);
CREATE INDEX messages_parent_idx ON public.messages USING btree (parent_id) WHERE (parent_id IS NOT NULL);
CREATE UNIQUE INDEX messages_pkey ON public.messages USING btree (id);
CREATE INDEX messages_room_created_idx ON public.messages USING btree (room_id, created_at) WHERE (room_id IS NOT NULL);
CREATE UNIQUE INDEX messages_slack_event_id_unique ON public.messages USING btree (slack_event_id) WHERE (slack_event_id IS NOT NULL);
CREATE UNIQUE INDEX messages_slack_ts_idx ON public.messages USING btree (slack_ts) WHERE (source = 'slack-import-v2'::text);
CREATE INDEX idx_notification_prefs_room_id ON public.notification_prefs USING btree (room_id);
CREATE UNIQUE INDEX notification_prefs_global_idx ON public.notification_prefs USING btree (user_id) WHERE (room_id IS NULL);
CREATE UNIQUE INDEX notification_prefs_pkey ON public.notification_prefs USING btree (id);
CREATE UNIQUE INDEX notification_prefs_room_idx ON public.notification_prefs USING btree (user_id, room_id) WHERE (room_id IS NOT NULL);
CREATE INDEX idx_paid_holidays_company_id ON public.paid_holidays USING btree (company_id);
CREATE UNIQUE INDEX paid_holidays_pkey ON public.paid_holidays USING btree (id);
CREATE INDEX pesticide_line_item_mappings_company_idx ON public.pesticide_line_item_mappings USING btree (company_id, active);
CREATE UNIQUE INDEX pesticide_line_item_mappings_pkey ON public.pesticide_line_item_mappings USING btree (id);
CREATE INDEX idx_pesticide_records_daily_log_entry_id ON public.pesticide_records USING btree (daily_log_entry_id);
CREATE INDEX idx_pesticide_records_technician_user_id ON public.pesticide_records USING btree (technician_user_id);
CREATE INDEX pesticide_records_company_date_idx ON public.pesticide_records USING btree (company_id, application_timestamp DESC);
CREATE UNIQUE INDEX pesticide_records_pkey ON public.pesticide_records USING btree (id);
CREATE INDEX pesticide_records_stop_idx ON public.pesticide_records USING btree (stop_id) WHERE (stop_id IS NOT NULL);
CREATE INDEX idx_product_categories_company ON public.product_categories USING btree (company_id);
CREATE UNIQUE INDEX product_categories_company_id_name_key ON public.product_categories USING btree (company_id, name);
CREATE UNIQUE INDEX product_categories_pkey ON public.product_categories USING btree (id);
CREATE INDEX idx_pli_company ON public.product_location_inventory USING btree (company_id);
CREATE INDEX idx_pli_location ON public.product_location_inventory USING btree (location_id);
CREATE INDEX idx_pli_product ON public.product_location_inventory USING btree (product_id);
CREATE UNIQUE INDEX product_location_inventory_pkey ON public.product_location_inventory USING btree (id);
CREATE UNIQUE INDEX product_location_inventory_product_id_location_id_key ON public.product_location_inventory USING btree (product_id, location_id);
CREATE INDEX idx_product_variants_company ON public.product_variants USING btree (company_id);
CREATE INDEX idx_product_variants_product ON public.product_variants USING btree (product_id);
CREATE UNIQUE INDEX product_variants_pkey ON public.product_variants USING btree (id);
CREATE INDEX idx_products_category ON public.products USING btree (category_id);
CREATE INDEX idx_products_company ON public.products USING btree (company_id);
CREATE UNIQUE INDEX products_pkey ON public.products USING btree (id);
CREATE INDEX properties_client_idx ON public.properties USING btree (client_id);
CREATE UNIQUE INDEX properties_external_id_source_idx ON public.properties USING btree (external_id, source);
CREATE UNIQUE INDEX properties_pkey ON public.properties USING btree (id);
CREATE INDEX idx_pto_policies_employee_id ON public.pto_policies USING btree (employee_id);
CREATE UNIQUE INDEX pto_policies_company_id_employee_id_key ON public.pto_policies USING btree (company_id, employee_id);
CREATE UNIQUE INDEX pto_policies_pkey ON public.pto_policies USING btree (id);
CREATE INDEX idx_pto_requests_company_id ON public.pto_requests USING btree (company_id);
CREATE INDEX idx_pto_requests_employee_id ON public.pto_requests USING btree (employee_id);
CREATE INDEX idx_pto_requests_reviewed_by ON public.pto_requests USING btree (reviewed_by);
CREATE UNIQUE INDEX pto_requests_pkey ON public.pto_requests USING btree (id);
CREATE INDEX idx_push_subscriptions_company_id ON public.push_subscriptions USING btree (company_id);
CREATE UNIQUE INDEX push_subscriptions_endpoint_uniq ON public.push_subscriptions USING btree (endpoint);
CREATE UNIQUE INDEX push_subscriptions_pkey ON public.push_subscriptions USING btree (id);
CREATE UNIQUE INDEX push_subscriptions_user_id_endpoint_key ON public.push_subscriptions USING btree (user_id, endpoint);
CREATE UNIQUE INDEX qbo_tokens_pkey ON public.qbo_tokens USING btree (id);
CREATE UNIQUE INDEX qbo_tokens_realm_id_key ON public.qbo_tokens USING btree (realm_id);
CREATE UNIQUE INDEX qbo_tokens_company_id_key ON public.qbo_tokens USING btree (company_id);
CREATE INDEX qbo_tokens_company_id_idx ON public.qbo_tokens USING btree (company_id);
CREATE INDEX idx_reactions_user_id ON public.reactions USING btree (user_id);
CREATE UNIQUE INDEX reactions_pkey ON public.reactions USING btree (message_id, user_id, emoji);
CREATE UNIQUE INDEX recurring_program_definitions_line_item_name_key ON public.recurring_program_definitions USING btree (line_item_name);
CREATE UNIQUE INDEX recurring_program_definitions_pkey ON public.recurring_program_definitions USING btree (id);
CREATE INDEX recurring_services_cancelled_idx ON public.recurring_services USING btree (cancelled_status);
CREATE INDEX recurring_services_company_idx ON public.recurring_services USING btree (company_id);
CREATE INDEX recurring_services_lead_idx ON public.recurring_services USING btree (lead_id);
CREATE UNIQUE INDEX recurring_services_monday_item_uidx ON public.recurring_services USING btree (monday_item_id);
CREATE UNIQUE INDEX recurring_services_pkey ON public.recurring_services USING btree (id);
CREATE INDEX idx_responder_calls_called_at ON public.responder_calls USING btree (called_at DESC);
CREATE INDEX idx_responder_calls_from_number ON public.responder_calls USING btree (from_number);
CREATE UNIQUE INDEX responder_calls_call_sid_key ON public.responder_calls USING btree (call_sid);
CREATE INDEX responder_calls_company_id_idx ON public.responder_calls USING btree (company_id);
CREATE UNIQUE INDEX responder_calls_pkey ON public.responder_calls USING btree (id);
CREATE INDEX responder_settings_company_id_idx ON public.responder_settings USING btree (company_id);
CREATE UNIQUE INDEX responder_settings_company_id_key ON public.responder_settings USING btree (company_id);
CREATE UNIQUE INDEX responder_settings_pkey ON public.responder_settings USING btree (id);
CREATE UNIQUE INDEX room_members_pkey ON public.room_members USING btree (room_id, user_id);
CREATE INDEX room_members_user_idx ON public.room_members USING btree (user_id);
CREATE INDEX idx_rooms_created_by ON public.rooms USING btree (created_by);
CREATE UNIQUE INDEX rooms_company_id_name_key ON public.rooms USING btree (company_id, name);
CREATE UNIQUE INDEX rooms_pkey ON public.rooms USING btree (id);
CREATE INDEX route_batches_company_created_idx ON public.route_batches USING btree (company_id, created_at DESC);
CREATE UNIQUE INDEX route_batches_pkey ON public.route_batches USING btree (id);
CREATE INDEX route_capacity_company_idx ON public.route_capacity USING btree (company_id);
CREATE INDEX route_capacity_job_ext_idx ON public.route_capacity USING btree (job_external_id);
CREATE UNIQUE INDEX route_capacity_monday_item_uidx ON public.route_capacity USING btree (monday_item_id);
CREATE UNIQUE INDEX route_capacity_pkey ON public.route_capacity USING btree (id);
CREATE UNIQUE INDEX route_definitions_pkey ON public.route_definitions USING btree (route_code);
CREATE INDEX idx_scheduled_messages_company_id ON public.scheduled_messages USING btree (company_id);
CREATE INDEX idx_scheduled_messages_conversation_id ON public.scheduled_messages USING btree (conversation_id);
CREATE INDEX idx_scheduled_messages_room_id ON public.scheduled_messages USING btree (room_id);
CREATE INDEX idx_scheduled_messages_sender_id ON public.scheduled_messages USING btree (sender_id);
CREATE INDEX scheduled_messages_parent_id_idx ON public.scheduled_messages USING btree (parent_id) WHERE (parent_id IS NOT NULL);
CREATE UNIQUE INDEX scheduled_messages_pkey ON public.scheduled_messages USING btree (id);
CREATE INDEX idx_scoreboard_technicians_board ON public.scoreboard_technicians USING btree (company_id, board_slug);
CREATE UNIQUE INDEX scoreboard_technicians_company_id_board_slug_employee_id_key ON public.scoreboard_technicians USING btree (company_id, board_slug, employee_id);
CREATE UNIQUE INDEX scoreboard_technicians_pkey ON public.scoreboard_technicians USING btree (id);
CREATE UNIQUE INDEX service_definitions_pkey ON public.service_definitions USING btree (prefix);
CREATE UNIQUE INDEX social_accounts_company_platform_external_id_key ON public.social_accounts USING btree (company_id, platform, external_id);
CREATE UNIQUE INDEX social_accounts_pkey ON public.social_accounts USING btree (id);
CREATE INDEX idx_social_posts_account_id ON public.social_posts USING btree (account_id);
CREATE INDEX idx_social_posts_created_by ON public.social_posts USING btree (created_by);
CREATE INDEX idx_social_posts_hub_file_id ON public.social_posts USING btree (hub_file_id);
CREATE INDEX social_posts_company_status_idx ON public.social_posts USING btree (company_id, status, scheduled_at);
CREATE INDEX social_posts_deliver_idx ON public.social_posts USING btree (status, scheduled_at) WHERE (status = 'scheduled'::text);
CREATE UNIQUE INDEX social_posts_pkey ON public.social_posts USING btree (id);
CREATE UNIQUE INDEX sync_log_pkey ON public.sync_log USING btree (id);
CREATE INDEX sync_log_started_idx ON public.sync_log USING btree (started_at DESC);
CREATE UNIQUE INDEX tags_company_name_idx ON public.tags USING btree (company_id, name);
CREATE UNIQUE INDEX tags_external_id_source_idx ON public.tags USING btree (external_id, source) WHERE (external_id IS NOT NULL);
CREATE UNIQUE INDEX tags_pkey ON public.tags USING btree (id);
CREATE INDEX idx_time_entries_date ON public.time_entries USING btree (date DESC);
CREATE INDEX idx_time_entries_employee_id ON public.time_entries USING btree (employee_id);
CREATE INDEX idx_time_entries_pay_period ON public.time_entries USING btree (pay_period_start, pay_period_end);
CREATE INDEX time_entries_company_id_idx ON public.time_entries USING btree (company_id);
CREATE UNIQUE INDEX time_entries_employee_date_unique ON public.time_entries USING btree (employee_id, date);
CREATE UNIQUE INDEX time_entries_pkey ON public.time_entries USING btree (id);
CREATE INDEX idx_time_punch_edit_requests_reviewed_by ON public.time_punch_edit_requests USING btree (reviewed_by);
CREATE INDEX idx_time_punch_edit_requests_time_entry_id ON public.time_punch_edit_requests USING btree (time_entry_id);
CREATE INDEX time_punch_edit_requests_company_id_status_idx ON public.time_punch_edit_requests USING btree (company_id, status);
CREATE INDEX time_punch_edit_requests_employee_id_idx ON public.time_punch_edit_requests USING btree (employee_id);
CREATE UNIQUE INDEX time_punch_edit_requests_pkey ON public.time_punch_edit_requests USING btree (id);
CREATE INDEX idx_time_punches_edited_by ON public.time_punches USING btree (edited_by);
CREATE INDEX idx_time_punches_employee_id ON public.time_punches USING btree (employee_id);
CREATE INDEX idx_time_punches_punched_at ON public.time_punches USING btree (punched_at DESC);
CREATE INDEX time_punches_company_id_idx ON public.time_punches USING btree (company_id);
CREATE INDEX time_punches_employee_punched_at_idx ON public.time_punches USING btree (employee_id, punched_at DESC);
CREATE UNIQUE INDEX time_punches_pkey ON public.time_punches USING btree (id);
CREATE INDEX timesheet_settings_company_id_idx ON public.timesheet_settings USING btree (company_id);
CREATE UNIQUE INDEX timesheet_settings_company_id_key ON public.timesheet_settings USING btree (company_id);
CREATE UNIQUE INDEX timesheet_settings_pkey ON public.timesheet_settings USING btree (id);
CREATE UNIQUE INDEX tracker_settings_company_id_key ON public.tracker_settings USING btree (company_id);
CREATE UNIQUE INDEX tracker_settings_pkey ON public.tracker_settings USING btree (id);
CREATE INDEX idx_txt_broadcast_recipients_contact_id ON public.txt_broadcast_recipients USING btree (contact_id);
CREATE INDEX idx_txt_broadcast_recipients_conversation_id ON public.txt_broadcast_recipients USING btree (conversation_id);
CREATE INDEX idx_txt_broadcast_recipients_message_id ON public.txt_broadcast_recipients USING btree (message_id);
CREATE UNIQUE INDEX txt_broadcast_recipients_broadcast_id_contact_id_key ON public.txt_broadcast_recipients USING btree (broadcast_id, contact_id);
CREATE INDEX txt_broadcast_recipients_drain_idx ON public.txt_broadcast_recipients USING btree (status, broadcast_id) WHERE (status = 'queued'::text);
CREATE INDEX txt_broadcast_recipients_pending_idx ON public.txt_broadcast_recipients USING btree (broadcast_id) WHERE (status = 'queued'::text);
CREATE UNIQUE INDEX txt_broadcast_recipients_pkey ON public.txt_broadcast_recipients USING btree (id);
CREATE INDEX idx_txt_broadcasts_created_by ON public.txt_broadcasts USING btree (created_by);
CREATE INDEX txt_broadcasts_company_created_idx ON public.txt_broadcasts USING btree (company_id, created_at DESC);
CREATE UNIQUE INDEX txt_broadcasts_pkey ON public.txt_broadcasts USING btree (id);
CREATE INDEX txt_broadcasts_status_idx ON public.txt_broadcasts USING btree (status) WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));
CREATE UNIQUE INDEX txt_contacts_company_id_phone_key ON public.txt_contacts USING btree (company_id, phone);
CREATE INDEX txt_contacts_company_idx ON public.txt_contacts USING btree (company_id);
CREATE INDEX txt_contacts_phone_idx ON public.txt_contacts USING btree (phone);
CREATE UNIQUE INDEX txt_contacts_pkey ON public.txt_contacts USING btree (id);
CREATE INDEX txt_conversation_contacts_contact_idx ON public.txt_conversation_contacts USING btree (contact_id);
CREATE UNIQUE INDEX txt_conversation_contacts_pkey ON public.txt_conversation_contacts USING btree (conversation_id, contact_id);
CREATE INDEX idx_txt_conversation_members_added_by ON public.txt_conversation_members USING btree (added_by);
CREATE UNIQUE INDEX txt_conversation_members_one_owner ON public.txt_conversation_members USING btree (conversation_id) WHERE (role = 'owner'::text);
CREATE UNIQUE INDEX txt_conversation_members_pkey ON public.txt_conversation_members USING btree (conversation_id, user_id);
CREATE INDEX txt_conversation_members_user_idx ON public.txt_conversation_members USING btree (user_id);
CREATE INDEX idx_txt_conversations_contact_id ON public.txt_conversations USING btree (contact_id);
CREATE INDEX txt_conversations_archived_by_idx ON public.txt_conversations USING btree (archived_by) WHERE (archived_by IS NOT NULL);
CREATE INDEX txt_conversations_assigned_to_idx ON public.txt_conversations USING btree (assigned_to);
CREATE INDEX txt_conversations_company_idx ON public.txt_conversations USING btree (company_id);
CREATE UNIQUE INDEX txt_conversations_direct_one_per_contact ON public.txt_conversations USING btree (company_id, contact_id) WHERE ((kind = 'direct'::text) AND (contact_id IS NOT NULL));
CREATE INDEX txt_conversations_last_message_at_idx ON public.txt_conversations USING btree (last_message_at DESC);
CREATE INDEX txt_conversations_phone_number_id_idx ON public.txt_conversations USING btree (phone_number_id) WHERE (phone_number_id IS NOT NULL);
CREATE UNIQUE INDEX txt_conversations_pkey ON public.txt_conversations USING btree (id);
CREATE INDEX txt_conversations_status_idx ON public.txt_conversations USING btree (status);
CREATE INDEX idx_txt_messages_contact_id ON public.txt_messages USING btree (contact_id);
CREATE INDEX idx_txt_messages_sent_by ON public.txt_messages USING btree (sent_by);
CREATE INDEX txt_messages_company_idx ON public.txt_messages USING btree (company_id);
CREATE INDEX txt_messages_conversation_idx ON public.txt_messages USING btree (conversation_id, created_at);
CREATE UNIQUE INDEX txt_messages_pkey ON public.txt_messages USING btree (id);
CREATE INDEX txt_messages_twilio_sid_idx ON public.txt_messages USING btree (twilio_sid) WHERE (twilio_sid IS NOT NULL);
CREATE INDEX idx_txt_notes_company_id ON public.txt_notes USING btree (company_id);
CREATE INDEX idx_txt_notes_created_by ON public.txt_notes USING btree (created_by);
CREATE INDEX txt_notes_conversation_idx ON public.txt_notes USING btree (conversation_id, created_at);
CREATE UNIQUE INDEX txt_notes_pkey ON public.txt_notes USING btree (id);
CREATE INDEX txt_phone_numbers_company_id_idx ON public.txt_phone_numbers USING btree (company_id);
CREATE UNIQUE INDEX txt_phone_numbers_one_default_per_company_idx ON public.txt_phone_numbers USING btree (company_id) WHERE (is_default = true);
CREATE UNIQUE INDEX txt_phone_numbers_pkey ON public.txt_phone_numbers USING btree (id);
CREATE UNIQUE INDEX txt_phone_numbers_twilio_number_key ON public.txt_phone_numbers USING btree (twilio_number);
CREATE INDEX txt_scheduled_due_idx ON public.txt_scheduled_messages USING btree (send_at) WHERE ((sent_at IS NULL) AND (status = 'scheduled'::text));
CREATE UNIQUE INDEX txt_scheduled_messages_pkey ON public.txt_scheduled_messages USING btree (id);
CREATE UNIQUE INDEX txt_settings_pkey ON public.txt_settings USING btree (company_id);
CREATE INDEX txt_templates_company_scope_idx ON public.txt_templates USING btree (company_id, scope, sort_order);
CREATE INDEX txt_templates_owner_idx ON public.txt_templates USING btree (owner_user_id) WHERE (owner_user_id IS NOT NULL);
CREATE UNIQUE INDEX txt_templates_pkey ON public.txt_templates USING btree (id);
CREATE INDEX idx_user_profiles_txt_default_number_id ON public.user_profiles USING btree (txt_default_number_id);
CREATE UNIQUE INDEX user_profiles_company_extension_idx ON public.user_profiles USING btree (company_id, dialer_extension) WHERE (dialer_extension IS NOT NULL);
CREATE INDEX user_profiles_company_id_idx ON public.user_profiles USING btree (company_id);
CREATE UNIQUE INDEX user_profiles_pkey ON public.user_profiles USING btree (id);
CREATE INDEX user_settings_company_id_idx ON public.user_settings USING btree (company_id);
CREATE UNIQUE INDEX user_settings_pkey ON public.user_settings USING btree (user_id);
CREATE INDEX visits_client_idx ON public.visits USING btree (client_id);
CREATE INDEX visits_completed_idx ON public.visits USING btree (completed_at) WHERE (completed_at IS NOT NULL);
CREATE UNIQUE INDEX visits_external_id_source_idx ON public.visits USING btree (external_id, source);
CREATE INDEX visits_invoice_external_id_idx ON public.visits USING btree (invoice_external_id) WHERE (invoice_external_id IS NOT NULL);
CREATE INDEX visits_job_idx ON public.visits USING btree (job_id);
CREATE UNIQUE INDEX visits_pkey ON public.visits USING btree (id);
CREATE INDEX visits_scheduled_date_idx ON public.visits USING btree (scheduled_date);
CREATE INDEX visits_status_idx ON public.visits USING btree (visit_status);
CREATE INDEX idx_voicemails_call_id ON public.voicemails USING btree (call_id);
CREATE INDEX idx_voicemails_contact_id ON public.voicemails USING btree (contact_id);
CREATE INDEX idx_voicemails_deleted_by ON public.voicemails USING btree (deleted_by);
CREATE INDEX idx_voicemails_heard_by ON public.voicemails USING btree (heard_by);
CREATE INDEX voicemails_company_created_idx ON public.voicemails USING btree (company_id, created_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX voicemails_company_unheard_idx ON public.voicemails USING btree (company_id, created_at DESC) WHERE ((deleted_at IS NULL) AND (heard_at IS NULL));
CREATE INDEX voicemails_owner_idx ON public.voicemails USING btree (owner_user_id) WHERE (owner_user_id IS NOT NULL);
CREATE UNIQUE INDEX voicemails_pkey ON public.voicemails USING btree (id);
CREATE UNIQUE INDEX zone_sizer_settings_pkey ON public.zone_sizer_settings USING btree (company_id);
