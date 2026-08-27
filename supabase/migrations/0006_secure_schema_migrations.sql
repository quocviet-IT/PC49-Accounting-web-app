-- 0006_secure_schema_migrations.sql
-- schema_migrations is created by scripts/migrate.mjs before any migration file
-- runs, so it was the one table in the schema without row level security.
-- A live check against the hosted database found it. The test suite now asserts
-- that no table in pc49 is left unprotected.
--
-- Nobody signing in through the application has any business reading or writing
-- the migration log: it is maintained by the migration runner, which connects
-- as the database owner and bypasses RLS.

ALTER TABLE pc49.schema_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schema_migrations_admin_read ON pc49.schema_migrations;
CREATE POLICY schema_migrations_admin_read ON pc49.schema_migrations
  FOR SELECT USING (pc49.effective_role() = 'ADMIN');

REVOKE ALL ON pc49.schema_migrations FROM authenticated;
GRANT SELECT ON pc49.schema_migrations TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0006_secure_schema_migrations')
ON CONFLICT (version) DO NOTHING;
