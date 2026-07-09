-- Coaching reviews go private per reviewer: grain becomes (call_source, call_id, reviewed_by).
--
-- STEP 1 (apply WITH the merged code when it deploys to staging). Zero-downtime
-- on the shared staging+prod DB: we ADD the per-reviewer unique index and make
-- reviewed_by required, but deliberately KEEP the old (call_source, call_id)
-- unique index for now. The still-deployed prod code upserts with
-- onConflict (call_source, call_id), which needs that old index — so leaving it
-- in place means prod review-saves keep working until the merge reaches prod.
-- With a single reviewer today, existing data satisfies BOTH indexes.
-- Step 2 (dropping the old index) runs only after prod is on the merged code —
-- see 2026-07-09_coaching_reviews_drop_old_index.sql.
alter table public.call_coaching_reviews alter column reviewed_by set not null;
create unique index if not exists call_coaching_reviews_source_call_reviewer_key
  on public.call_coaching_reviews (call_source, call_id, reviewed_by);
