-- =============================================================================
-- Lynxedo — Demo Tenant Content Seed
-- File: 2026-07-18_demo_tenant_seed.sql
-- =============================================================================
--
-- PURPOSE
--   Populate a NEW demo company with small, curated, believable lawn-care sample
--   data so the app "looks alive" in a sales demo. Content tables ONLY.
--
-- EXPECTS TWO psql VARIABLES (supplied by the orchestrator at run time):
--     -v demo_company_id="<uuid of the demo company>"
--     -v demo_admin_id="<uuid of the demo admin hub user / auth user>"
--   Referenced below as  :'demo_company_id'  and  :'demo_admin_id'.
--
--   Example:
--     psql "$DATABASE_URL" \
--       -v demo_company_id="11111111-1111-1111-1111-111111111111" \
--       -v demo_admin_id="22222222-2222-2222-2222-222222222222" \
--       -f 2026-07-18_demo_tenant_seed.sql
--
-- ASSUMED TO ALREADY EXIST (created separately by the orchestrator — NOT here):
--   * companies row for the demo company
--   * auth.users row for the demo admin
--   * user_profiles row for the demo admin
--   * hub_users row for the demo admin
--
-- WHAT THIS SCRIPT SEEDS:
--   hub_users (+auth.users)  ~4 fake employees
--   rooms                    4 Hub rooms
--   messages                 ~20 Hub chat messages
--   clients                  12 residential customers
--   txt_contacts             12 directory contacts (mirror the clients)
--   tracker_stages           8 Lead Tracker stages
--   tracker_column_definitions  0 rows — see NOTE below
--   leads                    15 leads across the stages
--   boards                   2 task boards
--   board_items              8 tasks
--
-- NOTES / JUDGEMENT CALLS:
--   * hub_users.id has a FK to auth.users(id). A bare gen_random_uuid() would
--     therefore VIOLATE the FK, so this script inserts a minimal auth.users row
--     for each fake employee (id + email only; no password/identity). These
--     accounts CANNOT log in — they exist purely so the employees can appear as
--     message authors / task assignees in the demo. That is fine for display.
--   * The auth trigger handle_new_user() only auto-provisions user_profiles +
--     hub_users when the new user's email DOMAIN matches a company's
--     google_domain. The fake employees use @example.com, so the trigger is a
--     no-op for them and the explicit hub_users inserts below are required. The
--     inserts still use ON CONFLICT (id) DO UPDATE defensively.
--   * The fake employees intentionally get NO user_profiles row — they are
--     display-only identities (like Heroes' bot users) and should not surface in
--     people-pickers or hold permissions.
--   * tracker_column_definitions is EMPTY across every existing tenant in this
--     database (including Heroes). The Lead Tracker renders fully from its
--     built-in columns, so the "minimum needed to render" is zero rows. Because
--     there is no production example of a valid column `type` string, seeding a
--     guessed custom column could break the board render — so this script
--     deliberately seeds NO custom column definitions.
--   * All PII is obviously fake: names are invented, phones use the fictional
--     555-0100..555-0199 range, emails are @example.com.
--   * Idempotency: rooms / tracker_stages / txt_contacts use ON CONFLICT on
--     their natural unique keys and are safe to re-run. clients / leads /
--     messages / boards / board_items have no natural unique key and WILL
--     duplicate if the script is run twice against the same company — run once
--     against a fresh demo company.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Fake employees  ->  auth.users (minimal) + hub_users
-- -----------------------------------------------------------------------------
WITH emp(display_name, first_name, last_name, email, status_text, status_emoji) AS (
  VALUES
    ('Maria Gomez',  'Maria',  'Gomez',  'maria.gomez@example.com',  'On a route',        '🚚'),
    ('Tyler Brooks', 'Tyler',  'Brooks', 'tyler.brooks@example.com', 'Available',         NULL),
    ('Dwayne Ellis', 'Dwayne', 'Ellis',  'dwayne.ellis@example.com', 'Out in the field',  '🌱'),
    ('Priya Nair',   'Priya',  'Nair',   'priya.nair@example.com',   'In the office',     '☎️')
),
created_auth AS (
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at, is_sso_user, is_anonymous)
  SELECT gen_random_uuid(),
         '00000000-0000-0000-0000-000000000000',
         'authenticated',
         'authenticated',
         e.email,
         now() - interval '45 days',
         now() - interval '45 days',
         false,
         false
  FROM emp e
  RETURNING id, email
)
INSERT INTO hub_users (id, company_id, display_name, status, status_text, status_emoji, created_at, last_active_at)
SELECT ca.id,
       :'demo_company_id',
       e.display_name,
       'available',
       e.status_text,
       e.status_emoji,
       now() - interval '45 days',
       now() - ((random() * 180) || ' minutes')::interval
FROM created_auth ca
JOIN emp e ON e.email = ca.email
ON CONFLICT (id) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      company_id   = EXCLUDED.company_id;

-- -----------------------------------------------------------------------------
-- 2. Hub rooms
-- -----------------------------------------------------------------------------
INSERT INTO rooms (company_id, name, description, is_private, created_by, created_at)
VALUES
  (:'demo_company_id', 'general',       'Company-wide chatter and day-to-day updates', false, :'demo_admin_id', now() - interval '44 days'),
  (:'demo_company_id', 'office',        'Scheduling, customer callbacks, and admin',   false, :'demo_admin_id', now() - interval '44 days'),
  (:'demo_company_id', 'field-crew',    'Routes, equipment, and job-site coordination',false, :'demo_admin_id', now() - interval '44 days'),
  (:'demo_company_id', 'announcements', 'Official company announcements',              false, :'demo_admin_id', now() - interval '44 days')
ON CONFLICT (company_id, name) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. Hub messages (~20)
--    v.emp = NULL  -> authored by the demo admin
--    v.emp = name  -> authored by that fake employee (resolved by display_name)
--    v.mins        -> minutes-ago offset for created_at
-- -----------------------------------------------------------------------------
INSERT INTO messages (company_id, room_id, sender_id, content, created_at)
SELECT
  :'demo_company_id',
  (SELECT id FROM rooms r WHERE r.company_id = :'demo_company_id' AND r.name = v.room_name),
  COALESCE(
    (SELECT id FROM hub_users h WHERE h.company_id = :'demo_company_id' AND h.display_name = v.emp),
    :'demo_admin_id'
  ),
  v.content,
  now() - ((v.mins) || ' minutes')::interval
FROM (VALUES
  -- room_name,       emp (author),   content,                                                                                   mins ago
  ('general',       NULL::text,      'Morning team! Looks like a clear week ahead — let''s get after it. 🌤️',                      9600),
  ('general',       'Tyler Brooks',  'Trucks are fueled and loaded. Rolling out in 10.',                                          9540),
  ('general',       'Maria Gomez',   'Finished the Oakwood Dr cul-de-sac early, picking up an extra stop.',                        7200),
  ('general',       NULL,            'Nice work everyone — we hit 100% on-time completions yesterday.',                           5760),
  ('general',       'Priya Nair',    'Reminder: submit your timesheets before end of day Friday. 🙏',                             2880),
  ('office',        'Priya Nair',    'Mrs. Alvarez called about rescheduling her Thursday mosquito treatment to Friday.',         8600),
  ('office',        NULL,            'Go ahead and move it — Friday afternoon has room on the route.',                            8500),
  ('office',        'Priya Nair',    'Done. Also two new Angi leads came in overnight, adding them to the tracker.',              8400),
  ('office',        'Priya Nair',    'Quote sent to the Whitfield property for the full lawn health program.',                    4300),
  ('office',        NULL,            'Perfect. Let''s follow up with a call tomorrow if we don''t hear back.',                     4200),
  ('office',        'Priya Nair',    'Heads up: the Coleman account balance is past due, flagging for a reminder text.',          1500),
  ('field-crew',    'Dwayne Ellis',  'Irrigation controller at 214 Birch is acting up — zone 3 won''t fire.',                     8000),
  ('field-crew',    'Tyler Brooks',  'Bring the spare solenoid from the shop, I think it''s the valve.',                          7900),
  ('field-crew',    'Dwayne Ellis',  'Good call, swapped it and zone 3 is back. Logged it on the job.',                           7700),
  ('field-crew',    'Maria Gomez',   'Low on granular fert on truck 2, can someone restock before tomorrow?',                     3600),
  ('field-crew',    NULL,            'Restock is in the shop by the roll-up door — grab a couple bags.',                          3500),
  ('field-crew',    'Tyler Brooks',  'Aeration plugs came out great on the Harmon lawn, before/after looks 🔥',                    900),
  ('announcements', NULL,            'Welcome to the Hub! This is our new home base for everything day-to-day.',                  10080),
  ('announcements', NULL,            'New spring mosquito program launches Monday — talking points are in the office room.',      6000),
  ('announcements', NULL,            'Great job hitting our review goal this month — 12 new 5-star reviews! ⭐',                   1200)
) AS v(room_name, emp, content, mins);

-- -----------------------------------------------------------------------------
-- 4. Clients (12 residential customers)
--    NOTE: the clients table has no address columns; addresses live on
--    txt_contacts (seeded next). source set to 'manual' (no Jobber connected).
-- -----------------------------------------------------------------------------
INSERT INTO clients (company_id, source, name, first_name, last_name, email, phone, is_company, is_lead, is_archived, customer_since, created_at, updated_at)
VALUES
  (:'demo_company_id', 'manual', 'Robert Alvarez',  'Robert',  'Alvarez',  'robert.alvarez@example.com',  '(281) 555-0100', false, false, false, '2023', now() - interval '400 days', now()),
  (:'demo_company_id', 'manual', 'Linda Whitfield', 'Linda',   'Whitfield','linda.whitfield@example.com', '(281) 555-0101', false, false, false, '2024', now() - interval '300 days', now()),
  (:'demo_company_id', 'manual', 'James Coleman',   'James',   'Coleman',  'james.coleman@example.com',   '(281) 555-0102', false, false, false, '2022', now() - interval '500 days', now()),
  (:'demo_company_id', 'manual', 'Sandra Harmon',   'Sandra',  'Harmon',   'sandra.harmon@example.com',   '(281) 555-0103', false, false, false, '2024', now() - interval '210 days', now()),
  (:'demo_company_id', 'manual', 'Kevin Doyle',     'Kevin',   'Doyle',    'kevin.doyle@example.com',     '(281) 555-0104', false, false, false, '2023', now() - interval '365 days', now()),
  (:'demo_company_id', 'manual', 'Patricia Nguyen', 'Patricia','Nguyen',   'patricia.nguyen@example.com', '(281) 555-0105', false, false, false, '2025', now() - interval '90 days',  now()),
  (:'demo_company_id', 'manual', 'Marcus Bell',     'Marcus',  'Bell',     'marcus.bell@example.com',     '(281) 555-0106', false, false, false, '2024', now() - interval '180 days', now()),
  (:'demo_company_id', 'manual', 'Emily Foster',    'Emily',   'Foster',   'emily.foster@example.com',    '(281) 555-0107', false, false, false, '2023', now() - interval '330 days', now()),
  (:'demo_company_id', 'manual', 'Daniel Reyes',    'Daniel',  'Reyes',    'daniel.reyes@example.com',    '(281) 555-0108', false, false, false, '2025', now() - interval '60 days',  now()),
  (:'demo_company_id', 'manual', 'Grace Kim',       'Grace',   'Kim',      'grace.kim@example.com',       '(281) 555-0109', false, false, false, '2022', now() - interval '520 days', now()),
  (:'demo_company_id', 'manual', 'Walter Pierce',   'Walter',  'Pierce',   'walter.pierce@example.com',   '(281) 555-0110', false, false, false, '2024', now() - interval '150 days', now()),
  (:'demo_company_id', 'manual', 'Nina Castillo',   'Nina',    'Castillo', 'nina.castillo@example.com',   '(281) 555-0111', false, false, false, '2025', now() - interval '30 days',  now());

-- -----------------------------------------------------------------------------
-- 5. txt_contacts (directory spine) — mirrors the 12 clients, adds addresses
-- -----------------------------------------------------------------------------
INSERT INTO txt_contacts (company_id, name, first_name, last_name, phone, phone_digits, email, address_line1, city, state, postal_code, country, in_directory, sources, created_at, updated_at)
VALUES
  (:'demo_company_id', 'Robert Alvarez',  'Robert',  'Alvarez',  '+12815550100', '2815550100', 'robert.alvarez@example.com',  '104 Oakwood Dr',   'The Woodlands', 'TX', '77380', 'US', true, '{manual}', now() - interval '400 days', now()),
  (:'demo_company_id', 'Linda Whitfield', 'Linda',   'Whitfield','+12815550101', '2815550101', 'linda.whitfield@example.com', '2211 Cedar Bend Ln','The Woodlands', 'TX', '77381', 'US', true, '{manual}', now() - interval '300 days', now()),
  (:'demo_company_id', 'James Coleman',   'James',   'Coleman',  '+12815550102', '2815550102', 'james.coleman@example.com',   '58 Maple Ridge Ct','Spring',        'TX', '77386', 'US', true, '{manual}', now() - interval '500 days', now()),
  (:'demo_company_id', 'Sandra Harmon',   'Sandra',  'Harmon',   '+12815550103', '2815550103', 'sandra.harmon@example.com',   '3417 Willow Creek Dr','Conroe',      'TX', '77384', 'US', true, '{manual}', now() - interval '210 days', now()),
  (:'demo_company_id', 'Kevin Doyle',     'Kevin',   'Doyle',    '+12815550104', '2815550104', 'kevin.doyle@example.com',     '77 Birchwood Way', 'The Woodlands', 'TX', '77382', 'US', true, '{manual}', now() - interval '365 days', now()),
  (:'demo_company_id', 'Patricia Nguyen', 'Patricia','Nguyen',   '+12815550105', '2815550105', 'patricia.nguyen@example.com', '915 Timberloch Pl','The Woodlands', 'TX', '77380', 'US', true, '{manual}', now() - interval '90 days',  now()),
  (:'demo_company_id', 'Marcus Bell',     'Marcus',  'Bell',     '+12815550106', '2815550106', 'marcus.bell@example.com',     '412 Pinecroft Dr', 'Spring',        'TX', '77389', 'US', true, '{manual}', now() - interval '180 days', now()),
  (:'demo_company_id', 'Emily Foster',    'Emily',   'Foster',   '+12815550107', '2815550107', 'emily.foster@example.com',    '1620 Grogan''s Mill Rd','The Woodlands','TX','77380','US', true, '{manual}', now() - interval '330 days', now()),
  (:'demo_company_id', 'Daniel Reyes',    'Daniel',  'Reyes',    '+12815550108', '2815550108', 'daniel.reyes@example.com',    '306 Sawmill St',   'Conroe',        'TX', '77385', 'US', true, '{manual}', now() - interval '60 days',  now()),
  (:'demo_company_id', 'Grace Kim',       'Grace',   'Kim',      '+12815550109', '2815550109', 'grace.kim@example.com',       '88 Lakefront Cir', 'The Woodlands', 'TX', '77381', 'US', true, '{manual}', now() - interval '520 days', now()),
  (:'demo_company_id', 'Walter Pierce',   'Walter',  'Pierce',   '+12815550110', '2815550110', 'walter.pierce@example.com',   '2745 Fox Run Blvd','Spring',        'TX', '77388', 'US', true, '{manual}', now() - interval '150 days', now()),
  (:'demo_company_id', 'Nina Castillo',   'Nina',    'Castillo', '+12815550111', '2815550111', 'nina.castillo@example.com',   '133 Sterling Ridge Dr','The Woodlands','TX','77382','US', true, '{manual}', now() - interval '30 days',  now())
ON CONFLICT (company_id, phone) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. Lead Tracker stages (mirrors the Heroes default set)
-- -----------------------------------------------------------------------------
INSERT INTO tracker_stages (company_id, key, label, color, sort_order)
VALUES
  (:'demo_company_id', 'current',             'Leads — Current',       '#3b82f6', 0),
  (:'demo_company_id', 'appointment_set',     'Appointment Set',       '#8b5cf6', 1),
  (:'demo_company_id', 'follow_up_long_term', 'Follow Up — Long Term', '#d97706', 2),
  (:'demo_company_id', 'closed_won',          'Closed Won',            '#16a34a', 3),
  (:'demo_company_id', 'upsells',             'Upsells',               '#0d9488', 4),
  (:'demo_company_id', 'closed_lost',         'Closed Lost',           '#dc2626', 5),
  (:'demo_company_id', 'closed_other',        'Closed Other',          '#4b5563', 6),
  (:'demo_company_id', 'saves',               'Saves',                 '#ea580c', 7)
ON CONFLICT (company_id, key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 7. tracker_column_definitions — intentionally none (see NOTE in header).
--    The Lead Tracker renders from built-in columns; the table is empty for
--    every existing tenant, so zero rows is the correct "minimum to render".
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 8. Leads (15) spread across the stages
--    stage values match the tracker_stages keys above.
-- -----------------------------------------------------------------------------
INSERT INTO leads
  (company_id, first_name, last_name, phone, email, service, lead_source, status, stage,
   lead_creation_date, sold_date, salesperson, base_program_sold, annual_value, service_address, stage_changed_at)
VALUES
  -- current
  (:'demo_company_id', 'Angela',  'Turner',   '(281) 555-0120', 'angela.turner@example.com',   '{Lawn Health}',              'Angi',                'New — Needs Contact', 'current',             CURRENT_DATE - 2,  NULL, NULL,           NULL,                       NULL,    '540 Rayford Rd, Spring, TX 77386',            now() - interval '2 days'),
  (:'demo_company_id', 'Brian',   'Wallace',  '(281) 555-0121', 'brian.wallace@example.com',   '{Mosquito Control}',         'Google (GBP / LSA)',  'New — Needs Contact', 'current',             CURRENT_DATE - 1,  NULL, NULL,           NULL,                       NULL,    '812 Woodlands Pkwy, The Woodlands, TX 77380', now() - interval '1 day'),
  (:'demo_company_id', 'Chloe',   'Martin',   '(281) 555-0122', 'chloe.martin@example.com',    '{Lawn Health,Aeration}',     'Website',             'Attempted Contact',   'current',             CURRENT_DATE - 3,  NULL, NULL,           NULL,                       NULL,    '19 Timber Trail, Conroe, TX 77384',           now() - interval '3 days'),
  (:'demo_company_id', 'David',   'Okafor',   '(281) 555-0123', 'david.okafor@example.com',    '{Irrigation}',               'Referral',            'New — Needs Contact', 'current',             CURRENT_DATE - 4,  NULL, NULL,           NULL,                       NULL,    '661 Lake Robbins Dr, The Woodlands, TX 77380', now() - interval '4 days'),
  -- appointment_set
  (:'demo_company_id', 'Elena',   'Rossi',    '(281) 555-0124', 'elena.rossi@example.com',     '{Lawn Health}',              'Angi',                'Appointment Set',     'appointment_set',     CURRENT_DATE - 6,  NULL, 'Priya',        NULL,                       NULL,    '204 Sterling Ridge Dr, The Woodlands, TX 77382', now() - interval '2 days'),
  (:'demo_company_id', 'Frank',   'Delgado',  '(281) 555-0125', 'frank.delgado@example.com',   '{Mosquito Control}',         'Facebook',            'Appointment Set',     'appointment_set',     CURRENT_DATE - 5,  NULL, 'Priya',        NULL,                       NULL,    '77 Pinecroft Dr, Spring, TX 77389',           now() - interval '1 day'),
  -- follow_up_long_term
  (:'demo_company_id', 'Grace',   'Holloway', '(281) 555-0126', 'grace.holloway@example.com',  '{Aeration}',                 'Referral',            'Follow Up — Long Term','follow_up_long_term', CURRENT_DATE - 30, NULL, 'Maria',        NULL,                       NULL,    '350 Fox Run Blvd, Spring, TX 77388',          now() - interval '12 days'),
  (:'demo_company_id', 'Henry',   'Osei',     '(281) 555-0127', 'henry.osei@example.com',      '{Lawn Health}',              'Google (GBP / LSA)',  'Follow Up — Long Term','follow_up_long_term', CURRENT_DATE - 45, NULL, 'Priya',        NULL,                       NULL,    '1204 Grogan''s Mill Rd, The Woodlands, TX 77380', now() - interval '20 days'),
  -- closed_won
  (:'demo_company_id', 'Isabel',  'Mendez',   '(281) 555-0128', 'isabel.mendez@example.com',   '{Lawn Health}',              'Angi',                'Sold',                'closed_won',          CURRENT_DATE - 14, CURRENT_DATE - 10, 'Priya',   'Full Lawn Health Program', 648.00,  '90 Cedar Bend Ln, The Woodlands, TX 77381',   now() - interval '10 days'),
  (:'demo_company_id', 'Jamal',   'Franklin', '(281) 555-0129', 'jamal.franklin@example.com',  '{Mosquito Control}',         'Referral',            'Sold',                'closed_won',          CURRENT_DATE - 20, CURRENT_DATE - 16, 'Maria',   'Seasonal Mosquito Program',420.00,  '512 Sawmill St, Conroe, TX 77385',            now() - interval '16 days'),
  (:'demo_company_id', 'Karen',   'Whitaker', '(281) 555-0130', 'karen.whitaker@example.com',  '{Irrigation}',               'Website',             'Sold',                'closed_won',          CURRENT_DATE - 9,  CURRENT_DATE - 7,  'Priya',   'Irrigation Service Call',  125.00,  '48 Lakefront Cir, The Woodlands, TX 77381',   now() - interval '7 days'),
  -- upsells
  (:'demo_company_id', 'Louis',   'Pham',     '(281) 555-0131', 'louis.pham@example.com',      '{Aeration,Lawn Health}',     'Repeat / Existing Customer', 'Upsell Opportunity','upsells',      CURRENT_DATE - 8,  NULL, 'Maria',        NULL,                       260.00,  '221 Fox Run Blvd, Spring, TX 77388',          now() - interval '3 days'),
  (:'demo_company_id', 'Monica',  'Sterling', '(281) 555-0132', 'monica.sterling@example.com', '{Mosquito Control}',         'Repeat / Existing Customer', 'Upsell Opportunity','upsells',      CURRENT_DATE - 11, NULL, 'Priya',        NULL,                       390.00,  '17 Timberloch Pl, The Woodlands, TX 77380',   now() - interval '5 days'),
  -- closed_lost
  (:'demo_company_id', 'Nathan',  'Boone',    '(281) 555-0133', 'nathan.boone@example.com',    '{Lawn Health}',              'Angi',                'Not Sold — Price',    'closed_lost',         CURRENT_DATE - 25, NULL, 'Maria',        NULL,                       NULL,    '905 Rayford Rd, Spring, TX 77386',            now() - interval '18 days'),
  (:'demo_company_id', 'Olivia',  'Chen',     '(281) 555-0134', 'olivia.chen@example.com',     '{Irrigation}',               'Google (GBP / LSA)',  'Unreachable',         'closed_lost',         CURRENT_DATE - 28, NULL, 'Priya',        NULL,                       NULL,    '333 Lake Robbins Dr, The Woodlands, TX 77380', now() - interval '21 days');

-- -----------------------------------------------------------------------------
-- 9. Task boards (2)
-- -----------------------------------------------------------------------------
INSERT INTO boards (company_id, name, is_private, is_personal, created_by, created_at)
VALUES
  (:'demo_company_id', 'Onboarding', false, false, :'demo_admin_id', now() - interval '40 days'),
  (:'demo_company_id', 'This Week',  false, false, :'demo_admin_id', now() - interval '7 days');

-- -----------------------------------------------------------------------------
-- 10. Board items (8) — reference boards by name; assignees by display_name
--     v.assignee = NULL -> unassigned
-- -----------------------------------------------------------------------------
INSERT INTO board_items (board_id, company_id, content, done, done_at, priority, due_date, assignee_id, created_by, created_at)
SELECT
  (SELECT id FROM boards b WHERE b.company_id = :'demo_company_id' AND b.name = v.board_name),
  :'demo_company_id',
  v.content,
  v.done,
  CASE WHEN v.done THEN now() - interval '2 days' ELSE NULL END,
  v.priority,
  (CURRENT_DATE + v.due_offset_days::int),   -- NULL offset -> NULL due_date
  (SELECT id FROM hub_users h WHERE h.company_id = :'demo_company_id' AND h.display_name = v.assignee),
  :'demo_admin_id',
  now() - ((v.created_days_ago) || ' days')::interval
FROM (VALUES
  -- board_name,   content,                                              done,  priority, due_offset_days, assignee,        created_days_ago
  ('Onboarding', 'Set up company profile and service area',             true,  'medium', NULL,            NULL,            38),
  ('Onboarding', 'Import customer list into the directory',             true,  'high',   NULL,            'Priya Nair',    37),
  ('Onboarding', 'Configure Lead Tracker stages',                       true,  'low',    NULL,            NULL,            36),
  ('Onboarding', 'Invite the field crew to the Hub',                    false, 'medium', 3,               'Priya Nair',    5),
  ('This Week',  'Follow up on the Whitfield lawn health quote',        false, 'high',   1,               'Priya Nair',    3),
  ('This Week',  'Restock granular fertilizer on truck 2',              false, 'medium', 0,               'Tyler Brooks',  1),
  ('This Week',  'Send past-due reminder to the Coleman account',       false, 'high',   1,               'Priya Nair',    1),
  ('This Week',  'Post before/after photos from the Harmon aeration',   false, 'low',    2,               'Maria Gomez',   0)
) AS v(board_name, content, done, priority, due_offset_days, assignee, created_days_ago);

COMMIT;

-- =============================================================================
-- End of demo tenant seed.
-- =============================================================================
