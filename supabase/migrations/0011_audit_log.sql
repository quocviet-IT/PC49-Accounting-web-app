-- 0011_audit_log.sql
-- Who changed what, and what it looked like before and after.
--
-- Attached to the tables where a change has accounting consequence. Posting and
-- voiding are recorded as their own actions rather than as anonymous updates,
-- because those are the two moments an auditor asks about.

DO $$ BEGIN
  CREATE TYPE pc49.audit_action AS ENUM
    ('INSERT', 'UPDATE', 'DELETE', 'POST', 'VOID', 'CLOSE_PERIOD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor        uuid,
  action       pc49.audit_action NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  before       jsonb,
  after        jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON pc49.audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_at_idx     ON pc49.audit_log (at DESC);

CREATE OR REPLACE FUNCTION pc49.audit_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pc49, public AS $$
DECLARE
  v_action    pc49.audit_action;
  v_before    jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  v_after     jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_entity_id text;
BEGIN
  v_action := TG_OP::pc49.audit_action;

  -- Name the two transitions an auditor actually looks for.
  IF TG_OP = 'UPDATE' THEN
    IF v_after ? 'posted_at' AND v_before ->> 'posted_at' IS NULL
       AND v_after ->> 'posted_at' IS NOT NULL THEN
      v_action := 'POST';
    ELSIF v_after ? 'voided_at' AND v_before ->> 'voided_at' IS NULL
       AND v_after ->> 'voided_at' IS NOT NULL THEN
      v_action := 'VOID';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'accounting_period'
     AND coalesce(v_after ->> 'status', '') = 'CLOSED'
     AND coalesce(v_before ->> 'status', '') IS DISTINCT FROM 'CLOSED' THEN
    v_action := 'CLOSE_PERIOD';
  END IF;

  v_entity_id := coalesce(v_after, v_before) ->> CASE
    WHEN TG_TABLE_NAME = 'accounting_period' THEN 'period' ELSE 'id' END;

  INSERT INTO pc49.audit_log (actor, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), v_action, TG_TABLE_NAME, v_entity_id, v_before, v_after);

  RETURN coalesce(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS audit_journal_entry ON pc49.journal_entry;
CREATE TRIGGER audit_journal_entry
  AFTER INSERT OR UPDATE OR DELETE ON pc49.journal_entry
  FOR EACH ROW EXECUTE FUNCTION pc49.audit_trigger();

DROP TRIGGER IF EXISTS audit_journal_line ON pc49.journal_line;
CREATE TRIGGER audit_journal_line
  AFTER INSERT OR UPDATE OR DELETE ON pc49.journal_line
  FOR EACH ROW EXECUTE FUNCTION pc49.audit_trigger();

DROP TRIGGER IF EXISTS audit_accounting_period ON pc49.accounting_period;
CREATE TRIGGER audit_accounting_period
  AFTER INSERT OR UPDATE OR DELETE ON pc49.accounting_period
  FOR EACH ROW EXECUTE FUNCTION pc49.audit_trigger();

-- The log is append-only from the application's point of view: readable by an
-- administrator, writable by nobody. Only the SECURITY DEFINER trigger inserts.
ALTER TABLE pc49.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_admin_read ON pc49.audit_log;
CREATE POLICY audit_log_admin_read ON pc49.audit_log
  FOR SELECT USING (pc49.effective_role() = 'ADMIN');

REVOKE ALL ON pc49.audit_log FROM authenticated;
GRANT SELECT ON pc49.audit_log TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0011_audit_log')
ON CONFLICT (version) DO NOTHING;
