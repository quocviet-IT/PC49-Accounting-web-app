-- 0001_foundation.sql
-- Schema, roles and the user table. Everything else builds on this.
CREATE SCHEMA IF NOT EXISTS pc49;

CREATE TABLE IF NOT EXISTS pc49.schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE pc49.user_role AS ENUM ('KT', 'GS_US', 'OC', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pc49.locale AS ENUM ('vi', 'en');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.app_user (
  id            uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  role          pc49.user_role NOT NULL DEFAULT 'KT',
  locale        pc49.locale NOT NULL DEFAULT 'vi',
  is_active     boolean NOT NULL DEFAULT true,
  suspended_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Effective role of the signed-in user. A suspended user has no role at all.
-- Named effective_role, not current_role: CURRENT_ROLE is a reserved word in PostgreSQL.
CREATE OR REPLACE FUNCTION pc49.effective_role()
RETURNS pc49.user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pc49, public AS $$
  SELECT role FROM pc49.app_user
   WHERE id = auth.uid() AND is_active AND suspended_at IS NULL
$$;

ALTER TABLE pc49.app_user ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_user_self_read ON pc49.app_user;
CREATE POLICY app_user_self_read ON pc49.app_user
  FOR SELECT USING (id = auth.uid() OR pc49.effective_role() = 'ADMIN');

DROP POLICY IF EXISTS app_user_self_update_locale ON pc49.app_user;
CREATE POLICY app_user_self_update_locale ON pc49.app_user
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS app_user_admin_write ON pc49.app_user;
CREATE POLICY app_user_admin_write ON pc49.app_user
  FOR ALL USING (pc49.effective_role() = 'ADMIN') WITH CHECK (pc49.effective_role() = 'ADMIN');

GRANT USAGE ON SCHEMA pc49 TO authenticated;
GRANT SELECT, UPDATE ON pc49.app_user TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0001_foundation')
ON CONFLICT (version) DO NOTHING;
