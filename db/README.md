# Database schema & RLS export (recovery blueprint)

Read-only, version-controlled snapshot of the Lynxedo Supabase database
(`nhvwdulyzolevoeayjum` — "Lynxedo App"), `public` schema.

These files exist so the database's structure **and its access rules are reviewable in
git** instead of living only in the Supabase cloud. They are a **recovery/reference
blueprint**, not a migration system — the live database is the source of truth.

| File | What it is |
|------|-----------|
| `schema.sql` | `CREATE TABLE` (columns + types + defaults), then all PK/FK/UNIQUE/CHECK constraints, then all indexes. Reconstructed from the Postgres catalog. |
| `rls_policies.sql` | `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for every policied table, then every `CREATE POLICY` (the app's authoritative access rules). |

## ⚠️ Do not treat these as the way to change prod
To change the schema or RLS, change it **in Supabase** (or a real migration), then
**re-run the export below** so the files stay in sync. Replaying these files into an
empty database reconstructs the structure, but they are not ordered for a clean
single-shot apply (FKs may reference tables defined later) and they don't include data.

## How to regenerate
Run these read-only queries against the project (via the Supabase MCP `execute_sql`,
or the SQL editor) and drop the results back into the matching file.

**Tables (`schema.sql`, TABLES section):**
```sql
SELECT 'CREATE TABLE public.' || quote_ident(c.table_name) || E' (\n' || string_agg(
  '  ' || quote_ident(c.column_name) || ' ' ||
  CASE WHEN c.data_type='USER-DEFINED' THEN c.udt_name
       WHEN c.data_type='ARRAY' THEN regexp_replace(c.udt_name,'^_','')||'[]'
       ELSE c.data_type END ||
  CASE WHEN c.character_maximum_length IS NOT NULL THEN '('||c.character_maximum_length||')' ELSE '' END ||
  CASE WHEN c.is_nullable='NO' THEN ' NOT NULL' ELSE '' END ||
  CASE WHEN c.column_default IS NOT NULL THEN ' DEFAULT '||c.column_default ELSE '' END,
  E',\n' ORDER BY c.ordinal_position) || E'\n);'
FROM information_schema.columns c
JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
WHERE c.table_schema='public' GROUP BY c.table_name ORDER BY c.table_name;
```

**Constraints (`schema.sql`, CONSTRAINTS section):**
```sql
SELECT 'ALTER TABLE '||conrelid::regclass::text||' ADD CONSTRAINT '||quote_ident(conname)||' '||pg_get_constraintdef(oid)||';'
FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype IN ('p','f','u','c')
ORDER BY conrelid::regclass::text, contype DESC, conname;
```

**Indexes (`schema.sql`, INDEXES section):**
```sql
SELECT indexdef||';' FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname;
```

**RLS enable (`rls_policies.sql`, top):**
```sql
SELECT 'ALTER TABLE public.'||quote_ident(c.relname)||' ENABLE ROW LEVEL SECURITY;'
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity ORDER BY c.relname;
```

**RLS policies (`rls_policies.sql`):**
```sql
SELECT 'CREATE POLICY '||quote_ident(policyname)||E'\n  ON '||quote_ident(schemaname)||'.'||quote_ident(tablename)||
  '  AS '||CASE WHEN permissive='PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END||'  FOR '||cmd||
  '  TO '||array_to_string(roles, ', ')||
  COALESCE(E'\n  USING ('||qual||')','')||COALESCE(E'\n  WITH CHECK ('||with_check||')','')||';'
FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname;
```

## Snapshot stats (last export — 2026-06-13)
127 tables · 473 constraints · 453 indexes · 220 RLS policies. The RLS-enable list covers
the 123 tables that carry policies; a handful of tables have RLS on with no policy
(effectively locked) — re-run the "RLS enable" query above for the exhaustive list.
