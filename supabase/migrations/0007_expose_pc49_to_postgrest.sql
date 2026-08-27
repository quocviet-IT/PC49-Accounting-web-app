-- 0007_expose_pc49_to_postgrest.sql
-- Lets the application read its own tables through PostgREST.
--
-- The dashboard field for this is Settings > API > Exposed schemas, but it is a
-- field inside that page rather than a page of its own, so the dashboard search
-- box does not find it. Setting it here instead keeps the configuration in
-- version control and makes a fresh project reproducible from migrations alone.
--
-- Security note: exposing the schema does NOT expose the data. Every table in
-- pc49 has row level security with policies keyed on pc49.effective_role(), and
-- the anon role is deliberately never granted USAGE on the schema, so an
-- unauthenticated caller holding the publishable key still sees nothing.
-- scripts/verify-rls.mjs proves this against the live database.

ALTER ROLE authenticator SET pgrst.db_schemas = 'public, graphql_public, pc49';

-- PostgREST reloads its configuration and re-introspects on these signals.
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0007_expose_pc49_to_postgrest')
ON CONFLICT (version) DO NOTHING;
