-- Cloning a per-person scoreboard: the recorded half of "who is this board for".
--
-- WHY THIS TABLE EXISTS. Duplicating a board built for one person has to re-point
-- every card's person filter at the next person. A person is named FIVE different
-- ways across the widget library, and only three can be mapped to the roster with
-- certainty, because their rows carry `employee_id`:
--
--   goal_people             the filter value IS the employee id          certain
--   staff_people            scoreboard_crew_labor rows carry employee_id certain
--   commission_plan_people  scoreboard_people rows carry employee_id     certain
--   jobber_people           jobber_users — no roster link                RECORDED HERE
--   lead_salespeople        free text typed on a Lead Tracker row        RECORDED HERE
--
-- The last two have no bridge. Measured on Heroes: only 2 of 25 Jobber users share
-- an email with an employee row, because Jobber holds work addresses while the
-- roster holds personal ones (lucas@heroeslawntx.com vs lucashrdz31@gmail.com), and
-- the Tracker's salesperson column holds typed text — "Kathryn", "Mike", "SERV".
--
-- ⚠⚠ So the bridge is RECORDED, NEVER INFERRED. Matching people by first name is
-- precisely how two colleagues who share one get merged into a single number, which
-- is why lib/scoreboards/widgets/people-filter.ts keeps the five catalogs separate
-- rather than fuzzy-joining them. A row in this table exists only because a human
-- answered the question in the duplicate dialog. Nothing writes here by guessing.
CREATE TABLE IF NOT EXISTS public.employee_source_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  -- The catalog this name belongs to. Values match `CatalogName` in
  -- lib/scoreboards/widgets/types.ts so the two never drift apart.
  kind text NOT NULL CHECK (kind IN ('jobber_people', 'lead_salespeople')),
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

-- One answer per person per system: answering again REPLACES rather than piles up,
-- so there is never a question of which of two recorded names is the current one.
CREATE UNIQUE INDEX IF NOT EXISTS employee_source_aliases_person_kind_uniq
  ON public.employee_source_aliases (company_id, employee_id, kind);

-- ⚠ And one owner per name, case- and padding-insensitively. Two people cannot both
-- claim "Mike" in the Tracker — that collision IS the silent merge this table exists
-- to prevent, so the database refuses it rather than the UI hoping nobody tries.
CREATE UNIQUE INDEX IF NOT EXISTS employee_source_aliases_value_kind_uniq
  ON public.employee_source_aliases (company_id, kind, lower(btrim(value)));

CREATE INDEX IF NOT EXISTS employee_source_aliases_company_idx
  ON public.employee_source_aliases (company_id);

-- ⚠⚠ RLS is not optional: `public` grants anon ALL by default in this project, so a
-- new table without this is readable by anonymous callers. Matches scoreboard_layouts
-- and scoreboard_layout_widgets — RLS on, NO policies, NO grants to anon or
-- authenticated. Every read and write goes through the service-role client on the
-- server, which is where the company scoping and the report gate already live.
ALTER TABLE public.employee_source_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_source_aliases FROM anon, authenticated;
