-- 0037_feedback_triage_can_audit.sql
-- Lets triage record itself in the audit log.
--
-- `set_feedback_status` writes to `pc49.audit_log`, and 0011 deliberately gives
-- that table to nobody: `REVOKE ALL ... FROM authenticated`, no INSERT policy,
-- and only a SECURITY DEFINER trigger allowed through. So the function's audit
-- insert was refused, the exception rolled the whole call back, and moving a
-- report from New to Looking silently did nothing at all.
--
-- The SQL suite could not have caught it. It runs as the database owner, which
-- is exempt from both grants and row-level security, so the insert it exercises
-- is not the insert the application makes. A browser check against the real
-- database found it on the first run.
--
-- The fix is to run the function as its owner, the same way the audit trigger
-- does. That is what makes the check below necessary rather than belt-and-
-- braces: SECURITY DEFINER steps around the `feedback_triage` policy, so the
-- rule that policy carried has to be stated here instead. `IS DISTINCT FROM`
-- because a signed-out caller's role is NULL, and NULL <> 'ADMIN' is not true.

CREATE OR REPLACE FUNCTION pc49.set_feedback_status(
  p_id     uuid,
  p_status pc49.feedback_status,
  p_note   text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pc49, public AS $$
DECLARE
  v_before pc49.feedback_status;
BEGIN
  IF pc49.effective_role() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'only an administrator can move a report';
  END IF;

  SELECT status INTO v_before FROM pc49.feedback_report WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report % does not exist', p_id;
  END IF;

  IF p_status = 'DECLINED' AND btrim(coalesce(p_note, '')) = '' THEN
    RAISE EXCEPTION 'declining a report needs a reason the reporter can read';
  END IF;

  UPDATE pc49.feedback_report
     SET status = p_status,
         triage_note = coalesce(p_note, triage_note),
         triaged_by = auth.uid(),
         triaged_at = now()
   WHERE id = p_id;

  INSERT INTO pc49.audit_log (actor, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), 'UPDATE', 'feedback_report', p_id::text,
          jsonb_build_object('status', v_before),
          jsonb_build_object('status', p_status, 'note', p_note));
END $$;

-- A function that runs as its owner should be callable by named roles only,
-- not by PUBLIC, which is what EXECUTE defaults to.
REVOKE ALL ON FUNCTION pc49.set_feedback_status(uuid, pc49.feedback_status, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pc49.set_feedback_status(uuid, pc49.feedback_status, text)
  TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0037_feedback_triage_can_audit')
ON CONFLICT (version) DO NOTHING;
