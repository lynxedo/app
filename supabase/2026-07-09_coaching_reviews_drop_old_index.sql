-- STEP 2 of the private-per-reviewer coaching migration. Run ONLY after the
-- merged Call Log code (which upserts with onConflict
-- (call_source, call_id, reviewed_by)) is live on PROD as well as staging.
--
-- Dropping the old single-row-per-call unique index is what truly allows more
-- than one reviewer to review the same call. It is safe once no deployed code
-- still relies on onConflict (call_source, call_id).
drop index if exists public.call_coaching_reviews_source_call_key;
