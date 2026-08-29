-- 0043_attach_feedback_screenshot.sql
-- Lets a reporter point their own report at the picture they just uploaded.
--
-- The report table has no UPDATE policy, deliberately: that is what stops
-- somebody editing their own statement after filing it. So the path cannot be
-- written by the reporter, and the first attempt at this did it with the
-- service role instead — which failed on a database where `service_role` has no
-- rights on this schema at all, and would have needed broad ones granted to fix.
--
-- A narrow function is the better answer. It runs as its owner, so it can write
-- the one column nobody else may; it checks for itself that the report belongs
-- to the caller and has no picture yet; and it raises rather than returning
-- quietly, so a link that does not happen cannot be mistaken for one that did.
-- No service key is needed anywhere, which is one less secret a deployment has
-- to carry.

CREATE OR REPLACE FUNCTION pc49.attach_feedback_screenshot(p_report_id uuid, p_path text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pc49, public AS $$
DECLARE
  v_reporter uuid;
  v_existing text;
BEGIN
  SELECT reporter_id, screenshot_path INTO v_reporter, v_existing
    FROM pc49.feedback_report WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report % does not exist', p_report_id;
  END IF;

  -- Your own report only. Attaching to somebody else's is not triage, it is
  -- putting words in their mouth.
  IF v_reporter IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'a screenshot goes on your own report';
  END IF;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'this report already has a screenshot';
  END IF;

  -- The same shape the storage policy accepts, checked again here: the two
  -- must not be able to disagree about what a valid path is.
  IF NOT pc49.feedback_screenshot_path_allowed(p_path) THEN
    RAISE EXCEPTION 'that is not a path this report may hold';
  END IF;

  UPDATE pc49.feedback_report SET screenshot_path = p_path WHERE id = p_report_id;
END $$;

REVOKE ALL ON FUNCTION pc49.attach_feedback_screenshot(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pc49.attach_feedback_screenshot(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0043_attach_feedback_screenshot')
ON CONFLICT (version) DO NOTHING;
