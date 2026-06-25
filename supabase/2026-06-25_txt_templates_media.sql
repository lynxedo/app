-- Feature #3: Txt2 templates that carry an attachment.
-- Additive only (safe on shared prod/staging DB). `media` holds R2 storage_path(s)
-- in the same format /api/txt/upload returns; on template pick they're loaded into
-- the composer's pending attachments so they send (as MMS) with the body.
ALTER TABLE public.txt_templates
  ADD COLUMN IF NOT EXISTS media text[] NOT NULL DEFAULT '{}'::text[];
