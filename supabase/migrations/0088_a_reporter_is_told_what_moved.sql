-- 0088_a_reporter_is_told_what_moved.sql
-- The menu calls somebody back to the reports screen when something there is
-- waiting for them.
--
-- "Người báo không biết gì tiếp theo" (17-09-2026). The screen already showed a
-- reporter their reports, what became of each and the note beside it (0036).
-- Nothing brought them back to look. A report was filed, its status moved, a
-- note was written for its reporter, and they found out only if they happened
-- to open the screen. Nor did an administrator learn that a report had arrived
-- without going to see.
--
--   feedback_seen        when each person last opened the reports screen
--   feedback_seen_at     that moment for whoever is asking; never is -infinity
--   feedback_unseen      what is waiting for them: for an administrator, the
--                        reports nobody has picked up; for anybody else, their
--                        own reports that moved since they last looked
--   mark_feedback_seen   opening the screen is looking
--
-- Nothing here decides who sees which report. feedback_report's own policies
-- (0036) already give a reporter theirs and an administrator the queue, and
-- these run as the person asking, so the counts follow the same line.

CREATE TABLE IF NOT EXISTS pc49.feedback_seen (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pc49.feedback_seen ENABLE ROW LEVEL SECURITY;

-- Each person's own row, and nobody else's: when somebody last looked is theirs.
DROP POLICY IF EXISTS feedback_seen_own ON pc49.feedback_seen;
CREATE POLICY feedback_seen_own ON pc49.feedback_seen
  FOR ALL USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE ON pc49.feedback_seen TO authenticated;

CREATE OR REPLACE FUNCTION pc49.feedback_seen_at()
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = pc49, public, auth AS $$
  SELECT coalesce((SELECT s.seen_at FROM pc49.feedback_seen s WHERE s.user_id = auth.uid()),
                  '-infinity'::timestamptz)
$$;

CREATE OR REPLACE FUNCTION pc49.feedback_unseen()
RETURNS int LANGUAGE sql STABLE SET search_path = pc49, public, auth AS $$
  SELECT CASE
    WHEN pc49.effective_role() = 'ADMIN' THEN
      (SELECT count(*) FROM pc49.feedback_report r WHERE r.status = 'NEW')
    ELSE
      (SELECT count(*) FROM pc49.feedback_report r
        WHERE r.reporter_id = auth.uid()
          AND r.triaged_at IS NOT NULL
          AND r.triaged_at > pc49.feedback_seen_at())
  END::int
$$;

CREATE OR REPLACE FUNCTION pc49.mark_feedback_seen()
RETURNS timestamptz LANGUAGE plpgsql SET search_path = pc49, public, auth AS $$
DECLARE
  v_at timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nobody is signed in'; END IF;
  INSERT INTO pc49.feedback_seen (user_id, seen_at) VALUES (auth.uid(), v_at)
  ON CONFLICT (user_id) DO UPDATE SET seen_at = excluded.seen_at;
  RETURN v_at;
END $$;

GRANT EXECUTE ON FUNCTION pc49.feedback_seen_at() TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.feedback_unseen() TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.mark_feedback_seen() TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0088_a_reporter_is_told_what_moved')
ON CONFLICT (version) DO NOTHING;
