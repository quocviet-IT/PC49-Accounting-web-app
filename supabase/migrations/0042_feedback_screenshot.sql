-- 0042_feedback_screenshot.sql
-- The picture of the screen the reporter was looking at.
--
-- The page address already travels with a report, which lets somebody reopen
-- the same view. It does not show what was on it: which row was selected, what
-- the figure actually read, whether a control was greyed out. Reports that say
-- "the total is wrong" become answerable with a picture and guesswork without
-- one.
--
-- Stored in a private bucket, never a public one. A screenshot of an accounting
-- page carries customer names and amounts, so it is read by the person who
-- filed it and by an administrator, and by nobody else — the same rule the
-- report itself follows.
--
-- Two things went wrong the first time this was built elsewhere, and both are
-- designed out here rather than discovered again:
--
--   * The report table has no UPDATE policy, on purpose. A client writing the
--     path back therefore affected zero rows and reported no error, so pictures
--     were stored and never referenced. The link is made server-side with the
--     service role, and the caller counts the rows it changed.
--
--   * The evidence trigger rejected every change to the row, the link included.
--     It now allows exactly one: null to a path. Replacing or clearing a
--     screenshot stays impossible, which is what the evidence rule is for.

ALTER TABLE pc49.feedback_report
  ADD COLUMN IF NOT EXISTS screenshot_path text;

COMMENT ON COLUMN pc49.feedback_report.screenshot_path IS
  'Object path in the feedback-screenshots bucket, or null when the reporter '
  'chose not to send one.';

-- A filed report still says what it said. The screenshot may be attached once,
-- by the upload linking itself, and never touched again.
CREATE OR REPLACE FUNCTION pc49.feedback_report_is_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.page_url IS DISTINCT FROM OLD.page_url
     OR NEW.reporter_id IS DISTINCT FROM OLD.reporter_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'a filed report is evidence; only its status may change';
  END IF;

  IF NEW.screenshot_path IS DISTINCT FROM OLD.screenshot_path
     AND OLD.screenshot_path IS NOT NULL THEN
    RAISE EXCEPTION
      'a report screenshot cannot be replaced or removed once attached';
  END IF;

  RETURN NEW;
END $$;

-- ----------------------------------------------------------------------------
-- Where a screenshot may be written.
--
-- `<report id>/<uuid>.png`, and the report has to be one this caller filed. The
-- path is checked rather than trusted because a storage policy is the only
-- thing between an authenticated browser and the bucket.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pc49.feedback_screenshot_path_allowed(p_name text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pc49, public AS $$
DECLARE
  v_parts text[];
BEGIN
  v_parts := string_to_array(p_name, '/');
  IF array_length(v_parts, 1) <> 2 THEN RETURN false; END IF;
  IF v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  IF v_parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM pc49.feedback_report
     WHERE id = v_parts[1]::uuid AND reporter_id = auth.uid()
  );
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('feedback-screenshots', 'feedback-screenshots', false, 5242880,
        array['image/png']::text[])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Every policy on storage.objects sees every bucket in the project, so each one
-- has to name the bucket it means. A policy written without that clause governs
-- files it was never intended to.
DROP POLICY IF EXISTS pc49_feedback_screenshot_insert ON storage.objects;
CREATE POLICY pc49_feedback_screenshot_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'feedback-screenshots'
    AND pc49.feedback_screenshot_path_allowed(name)
  );

-- Read by the reporter and by an administrator: the same people the report
-- itself is visible to, because the picture shows the same figures.
DROP POLICY IF EXISTS pc49_feedback_screenshot_read ON storage.objects;
CREATE POLICY pc49_feedback_screenshot_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'feedback-screenshots'
    AND (
      pc49.effective_role() = 'ADMIN'
      OR EXISTS (
        SELECT 1 FROM pc49.feedback_report r
         WHERE r.screenshot_path = storage.objects.name
           AND r.reporter_id = auth.uid()
      )
    )
  );

-- No update or delete policy. What a report shows does not change after filing,
-- and that has to hold for the file as well as the row.

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0042_feedback_screenshot')
ON CONFLICT (version) DO NOTHING;
