-- Session 5 (Pricer) — seed the 14 current Heroes programs as published 2026 charts.
-- Run on the shared Supabase DB on 2026-06-19 via MCP execute_sql.
-- Values copied verbatim from Lynxedo/Pricer/pricer.html (the arrays this retires).
-- name = exact program name (so Builder "Seed from current composition" matches
-- product_rounds.program); program_key = slugifyProgramKey(name) (matches the Builder).
-- Per-visit = base_fee + price_per_k * sizeK ; annual = per-visit * visits (one-time: visits=1).
-- The 3 add-ons (Moisture Manager / BWP / PHC) are intentionally NOT seeded here — they
-- use non-size formulas and stay special-cased in the Pricer until modeled (later session).

insert into public.program_price_charts
  (company_id, program_key, name, description, category, sort_order,
   visits, base_fee, price_per_k, status, is_published, version_label, effective_from)
values
  -- ── Annual programs ──
  ('00000000-0000-0000-0000-000000000002','lawn_health_basic','Lawn Health Basic','Fertilizer, Weed Control, Soil Conditioners','annual',10, 8, 50,10,'published',true,'2026','2026-01-01'),
  ('00000000-0000-0000-0000-000000000002','lawn_health_plus','Lawn Health Plus','LHB + Insect Protection Program','annual',20, 8, 55,15,'published',true,'2026','2026-01-01'),
  ('00000000-0000-0000-0000-000000000002','lawn_health_complete','Lawn Health Complete','LHP + Fall Brown Patch Disease Control','annual',30,12, 50,15,'published',true,'2026','2026-01-01'),
  ('00000000-0000-0000-0000-000000000002','root_rot_recovery','Root Rot Recovery','LHC + Enhanced Fertilizers, Fungicides & Aeration','annual',40,12, 60,20,'published',true,'2026','2026-01-01'),
  ('00000000-0000-0000-0000-000000000002','organic_fertilizer','Organic Fertilizer','Organic fertilizers only — no weed control','annual',50, 4, 50,20,'published',true,'2026','2026-01-01'),
  ('00000000-0000-0000-0000-000000000002','mosquito_misting','Mosquito (Misting)','Bi-weekly mist blowing, March–October (16 visits)','annual',60,16, 45, 5,'published',true,'2026','2026-01-01'),
  -- ── One-time & seasonal services ──
  ('00000000-0000-0000-0000-000000000002','aeration','Aeration','Core Aeration — Spring &/or Fall','onetime',10, 1,190, 5,'published',true,'2026','2026-01-01'),
  ('00000000-0000-0000-0000-000000000002','fire_ant_control','Fire Ant Control','Top Choice application — 1-year guarantee','onetime',20, 1, 60,20,'published',true,'2026','2026-01-01'),
  ('00000000-0000-0000-0000-000000000002','lawn_stimulator','Lawn Stimulator','Enhanced Fertilizers, Soil Conditioners & Growth Stimulators','onetime',30, 1, 60,25,'published',true,'2026','2026-01-01'),
  ('00000000-0000-0000-0000-000000000002','soil_surge','Soil Surge','pH Balance, Soil Surfactant, Microbe & Amino Acid Inoculation','onetime',40, 1, 70,30,'published',true,'2026','2026-01-01'),
  ('00000000-0000-0000-0000-000000000002','ot_fungicide','OT Fungicide','One-Time Fungicide Treatment','onetime',50, 1, 70,15,'published',true,'2026','2026-01-01'),
  ('00000000-0000-0000-0000-000000000002','ot_insect','OT Insect','One-Time Basic Insecticide Treatment','onetime',60, 1, 77,12,'published',true,'2026','2026-01-01'),
  ('00000000-0000-0000-0000-000000000002','grub_curative','Grub Curative','One-Time Grub Treatment (Instar 2 & 3 stage)','onetime',70, 1, 95,15,'published',true,'2026','2026-01-01'),
  ('00000000-0000-0000-0000-000000000002','ot_lawn_treatment','OT Lawn Treatment','One-Time Fertilizer &/or Pre/Post Emergent','onetime',80, 1, 70,18,'published',true,'2026','2026-01-01');
