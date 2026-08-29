-- 0036_feedback.sql
-- Reporting a problem from wherever you hit it.
--
-- The accountant meets this system every day and is the only person who will
-- ever find most of what is wrong with it. Without a way to say so from the
-- screen where it happened, a fault reaches the people who can fix it as "the
-- gold page was strange yesterday" — if it reaches them at all.
--
-- So a report carries the page it was filed from, in enough detail to open the
-- same view again: the full address, including whatever was being filtered or
-- which day was being looked at.
--
-- A report is evidence. Once filed, what it says and where it came from never
-- change; only its status moves, and only through a function that records who
-- moved it.

DO $$ BEGIN
  CREATE TYPE pc49.feedback_kind AS ENUM ('BROKEN', 'WRONG_NUMBER', 'SUGGESTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pc49.feedback_status AS ENUM ('NEW', 'LOOKING', 'FIXED', 'DECLINED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- How much it costs to leave alone. Worst first, which is the order the buttons
-- read in.
DO $$ BEGIN
  CREATE TYPE pc49.feedback_impact AS ENUM ('BLOCKING', 'SLOWS_WORK', 'MINOR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.feedback_report (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          pc49.feedback_kind NOT NULL,
  impact        pc49.feedback_impact NOT NULL DEFAULT 'SLOWS_WORK',
  -- What happened, in the reporter's own words. Required: a report with no
  -- description is a report nobody can act on, and the screenshot this system
  -- does not take cannot stand in for one.
  description   text NOT NULL CHECK (btrim(description) <> '' AND length(description) <= 4000),

  -- Where it happened, in enough detail to open the same view again. The full
  -- address matters: "the report was wrong" and "the report for January was
  -- wrong" are different reports.
  page_url      text NOT NULL,
  page_route    text NOT NULL,
  page_title    text,

  status        pc49.feedback_status NOT NULL DEFAULT 'NEW',
  reporter_id   uuid,
  reporter_role pc49.user_role,
  triaged_by    uuid,
  triaged_at    timestamptz,
  triage_note   text CHECK (triage_note IS NULL OR length(triage_note) <= 2000),
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT feedback_declined_needs_a_reason CHECK (
    status <> 'DECLINED' OR btrim(coalesce(triage_note, '')) <> '')
);

CREATE INDEX IF NOT EXISTS feedback_report_status_idx
  ON pc49.feedback_report (status, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_report_reporter_idx
  ON pc49.feedback_report (reporter_id);

/**
 * Moves a report between queues, and records who moved it.
 *
 * The only thing about a report that may change. Declining one needs a reason
 * in the same call, because a report declined without one is the thing that
 * teaches people not to file the next one.
 */
CREATE OR REPLACE FUNCTION pc49.set_feedback_status(
  p_id     uuid,
  p_status pc49.feedback_status,
  p_note   text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_before pc49.feedback_status;
BEGIN
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

-- Once filed, a report says what it said. Only the triage columns move, and the
-- function above is what moves them.
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
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS feedback_report_is_evidence ON pc49.feedback_report;
CREATE TRIGGER feedback_report_is_evidence
  BEFORE UPDATE ON pc49.feedback_report
  FOR EACH ROW EXECUTE FUNCTION pc49.feedback_report_is_evidence();

ALTER TABLE pc49.feedback_report ENABLE ROW LEVEL SECURITY;

-- Anybody signed in may file one. Reporting a problem is not a privilege.
DROP POLICY IF EXISTS feedback_file ON pc49.feedback_report;
CREATE POLICY feedback_file ON pc49.feedback_report
  FOR INSERT WITH CHECK (pc49.effective_role() IS NOT NULL AND reporter_id = auth.uid());

-- Everybody sees their own; an administrator sees the queue. During the first
-- months that is the whole team seeing that their reports went somewhere, which
-- is what keeps them filing.
DROP POLICY IF EXISTS feedback_read ON pc49.feedback_report;
CREATE POLICY feedback_read ON pc49.feedback_report
  FOR SELECT USING (
    reporter_id = auth.uid() OR pc49.effective_role() = 'ADMIN');

DROP POLICY IF EXISTS feedback_triage ON pc49.feedback_report;
CREATE POLICY feedback_triage ON pc49.feedback_report
  FOR UPDATE USING (pc49.effective_role() = 'ADMIN')
  WITH CHECK (pc49.effective_role() = 'ADMIN');

GRANT SELECT, INSERT, UPDATE ON pc49.feedback_report TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0036_feedback')
ON CONFLICT (version) DO NOTHING;
