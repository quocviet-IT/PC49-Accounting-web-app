-- 0053_somebody_has_to_manage_the_people.sql
-- Adding a colleague, changing what they may do, and closing the account of
-- somebody who has left.
--
-- `user.manage` has been a capability since 0001 and no screen has ever used
-- it. So all three of those jobs are done by editing the database by hand
-- today: no record of who granted what, no rule stopping a mistake, and the
-- system in practice serves one person because giving it to a second is an
-- errand for whoever has the connection string.
--
-- The rules go here rather than in the screen, for the reason this codebase
-- has now learned twice — the payment limit and the sales-person column were
-- both written down as screen behaviour and both turned out to be table
-- behaviour. A rule about who may do what is the last one that should live
-- somewhere it can be walked around.
--
-- What cannot live here is creating a login and setting a password: Supabase
-- keeps those outside the database, in `auth.users`, and there is no SQL that
-- reaches them. Those two, and only those two, are done by the application.

ALTER TABLE pc49.app_user
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN pc49.app_user.must_change_password IS
  'Set when an administrator issues a temporary password. Every screen sends '
  'the holder to change it until it is cleared.';

-- ---- Reading the list ---------------------------------------------------------

/**
 * Everybody, for an administrator.
 *
 * The one place `auth.users` is read, and it returns the address and nothing
 * else from there — no password hash, no tokens, no session. The email is not
 * copied into `app_user`: two copies of the same address is two answers to
 * "who is this", and they drift.
 */
CREATE OR REPLACE FUNCTION pc49.user_directory()
RETURNS TABLE (
  id                   uuid,
  email                text,
  full_name            text,
  role                 pc49.user_role,
  is_active            boolean,
  suspended_at         timestamptz,
  must_change_password boolean,
  created_at           timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pc49, public AS $$
BEGIN
  IF pc49.effective_role() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'only an administrator may see the list of people';
  END IF;

  RETURN QUERY
    SELECT u.id, a.email::text, u.full_name, u.role, u.is_active, u.suspended_at,
           u.must_change_password, u.created_at
      FROM pc49.app_user u
      JOIN auth.users a ON a.id = u.id
     ORDER BY u.full_name;
END $$;

-- ---- The rules ----------------------------------------------------------------

/**
 * Refuses unless the caller is an administrator and the subject exists.
 *
 * Acting on yourself is allowed here, deliberately. Forbidding it outright
 * looks safer and is not: it makes the last-administrator rule below
 * unreachable, because removing the last administrator would need a second
 * administrator to do it, and a second administrator means there was never
 * only one. A guard that cannot fire is not a guard. So self-action is
 * allowed and the count is what decides — which also lets somebody hand the
 * job over by stepping down once a successor is in place.
 */
CREATE OR REPLACE FUNCTION pc49.assert_may_administer(p_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pc49, public AS $$
BEGIN
  IF pc49.effective_role() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'only an administrator may change who people are and what they may do';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pc49.app_user WHERE id = p_id) THEN
    RAISE EXCEPTION 'there is no such person';
  END IF;
END $$;

/**
 * Refuses a change that would leave nobody able to administer the system.
 *
 * Counted after the change rather than before, because the question is not
 * "are there other administrators" but "will there be one". Without this the
 * system can be locked out of its own administration by one careless click,
 * and there is no way back in from the inside.
 */
CREATE OR REPLACE FUNCTION pc49.assert_an_admin_remains(p_excluding uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pc49, public AS $$
DECLARE
  v_left int;
BEGIN
  SELECT count(*) INTO v_left
    FROM pc49.app_user
   WHERE role = 'ADMIN' AND suspended_at IS NULL AND is_active
     AND id <> p_excluding;
  IF v_left = 0 THEN
    RAISE EXCEPTION 'this would leave nobody able to administer the system';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pc49.set_user_role(p_id uuid, p_role pc49.user_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pc49, public AS $$
DECLARE
  v_before pc49.user_role;
BEGIN
  PERFORM pc49.assert_may_administer(p_id);
  SELECT role INTO v_before FROM pc49.app_user WHERE id = p_id FOR UPDATE;
  IF v_before = p_role THEN RETURN; END IF;

  -- Whoever is losing the role, including the caller: what matters is whether
  -- anybody is left holding it afterwards.
  IF v_before = 'ADMIN' THEN
    PERFORM pc49.assert_an_admin_remains(p_id);
  END IF;

  UPDATE pc49.app_user SET role = p_role, updated_at = now() WHERE id = p_id;

  INSERT INTO pc49.audit_log (actor, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), 'UPDATE', 'app_user', p_id::text,
          jsonb_build_object('role', v_before),
          jsonb_build_object('role', p_role));
END $$;

CREATE OR REPLACE FUNCTION pc49.suspend_user(p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pc49, public AS $$
DECLARE
  v_role pc49.user_role;
BEGIN
  PERFORM pc49.assert_may_administer(p_id);

  -- Closing your own account is the one action here with no way back: stepping
  -- down from administrator leaves you signed in as something, but closing
  -- yourself leaves you signed in as nothing, and the undo is behind the door
  -- you just locked. Step down first, or ask somebody else.
  IF p_id = auth.uid() THEN
    RAISE EXCEPTION 'an administrator cannot close their own account';
  END IF;

  -- The same demand the rest of the system makes of a cancellation: an account
  -- closed for no recorded reason is the one somebody re-opens next month
  -- because nobody remembers why it was closed.
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'closing an account needs a reason';
  END IF;

  SELECT role INTO v_role FROM pc49.app_user WHERE id = p_id FOR UPDATE;
  IF v_role = 'ADMIN' THEN
    PERFORM pc49.assert_an_admin_remains(p_id);
  END IF;

  UPDATE pc49.app_user
     SET suspended_at = coalesce(suspended_at, now()), updated_at = now()
   WHERE id = p_id;

  INSERT INTO pc49.audit_log (actor, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), 'UPDATE', 'app_user', p_id::text,
          jsonb_build_object('suspended', false),
          jsonb_build_object('suspended', true, 'reason', p_reason));
END $$;

CREATE OR REPLACE FUNCTION pc49.restore_user(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pc49, public AS $$
BEGIN
  PERFORM pc49.assert_may_administer(p_id);

  UPDATE pc49.app_user SET suspended_at = NULL, updated_at = now() WHERE id = p_id;

  INSERT INTO pc49.audit_log (actor, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), 'UPDATE', 'app_user', p_id::text,
          jsonb_build_object('suspended', true),
          jsonb_build_object('suspended', false));
END $$;

CREATE OR REPLACE FUNCTION pc49.rename_user(p_id uuid, p_full_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pc49, public AS $$
DECLARE
  v_before text;
BEGIN
  PERFORM pc49.assert_may_administer(p_id);
  IF btrim(coalesce(p_full_name, '')) = '' THEN
    RAISE EXCEPTION 'a person needs a name';
  END IF;

  SELECT full_name INTO v_before FROM pc49.app_user WHERE id = p_id FOR UPDATE;
  IF v_before = btrim(p_full_name) THEN RETURN; END IF;

  UPDATE pc49.app_user
     SET full_name = btrim(p_full_name), updated_at = now() WHERE id = p_id;

  INSERT INTO pc49.audit_log (actor, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), 'UPDATE', 'app_user', p_id::text,
          jsonb_build_object('full_name', v_before),
          jsonb_build_object('full_name', btrim(p_full_name)));
END $$;

/**
 * Clears the flag once somebody has chosen a password of their own.
 *
 * Called with the holder's own session, never an administrator's: changing the
 * password itself is Supabase's job and it has already happened by the time
 * this runs. Nobody else may clear it, or a temporary password could be left
 * in place while the system stopped asking for it to be changed.
 */
CREATE OR REPLACE FUNCTION pc49.password_was_changed()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pc49, public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nobody is signed in';
  END IF;
  UPDATE pc49.app_user
     SET must_change_password = false, updated_at = now()
   WHERE id = auth.uid();
END $$;

/**
 * Records who a newly created login belongs to.
 *
 * The login itself is made by the application, because `auth.users` is out of
 * reach from here. This is the other half, and it is a function rather than an
 * insert from the screen for two reasons: `authenticated` is granted SELECT
 * and UPDATE on `app_user` but not INSERT, and adding somebody is exactly the
 * kind of event the audit log exists for. Doing it as a plain insert would
 * have left the one change nobody can see afterwards — who let them in.
 */
CREATE OR REPLACE FUNCTION pc49.register_user(
  p_id uuid, p_full_name text, p_role pc49.user_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pc49, public AS $$
BEGIN
  IF pc49.effective_role() IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'only an administrator may add people';
  END IF;
  IF btrim(coalesce(p_full_name, '')) = '' THEN
    RAISE EXCEPTION 'a person needs a name';
  END IF;

  INSERT INTO pc49.app_user (id, full_name, role, must_change_password)
  VALUES (p_id, btrim(p_full_name), p_role, true);

  INSERT INTO pc49.audit_log (actor, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), 'INSERT', 'app_user', p_id::text, NULL,
          jsonb_build_object('full_name', btrim(p_full_name), 'role', p_role));
END $$;

/**
 * Marks somebody as holding a password an administrator issued.
 *
 * Called after a reset. Audited for the same reason: an administrator who can
 * silently put an account back into "somebody else knows your password" is an
 * administrator nobody can hold to account for having done it.
 */
CREATE OR REPLACE FUNCTION pc49.require_new_password(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pc49, public AS $$
BEGIN
  PERFORM pc49.assert_may_administer(p_id);

  UPDATE pc49.app_user
     SET must_change_password = true, updated_at = now() WHERE id = p_id;

  INSERT INTO pc49.audit_log (actor, action, entity_type, entity_id, before, after)
  VALUES (auth.uid(), 'UPDATE', 'app_user', p_id::text,
          jsonb_build_object('password', 'theirs'),
          jsonb_build_object('password', 'reset by an administrator'));
END $$;

GRANT EXECUTE ON FUNCTION pc49.user_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.set_user_role(uuid, pc49.user_role) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.suspend_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.restore_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.rename_user(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.password_was_changed() TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.register_user(uuid, text, pc49.user_role) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.require_new_password(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0053_somebody_has_to_manage_the_people')
ON CONFLICT (version) DO NOTHING;
