-- 0070_a_role_is_read_once_per_query.sql
-- Row-level security asks who is signed in once per query, not once per row.
--
-- Nearly every policy in pc49 reads pc49.effective_role(), and a few read
-- auth.uid(). A function call written straight into a policy is made for every
-- row the policy checks, and effective_role() is a SECURITY DEFINER function
-- that reads app_user each time. On the live database on 15-09 a signed-in scan
-- of gold_txn's 1062 rows took 18 ms, against half a millisecond without its
-- policies; after 0069 that was most of what was left of the ledger's reads (34
-- and 22 ms), and it grows with every row recorded. Neither answer depends on
-- the row, so written as a sub-select each is made once for the whole query,
-- the form Supabase recommends for auth.uid().
--
-- The policies are rewritten from their own stored definitions rather than
-- restated here, so what each one allows is exactly what it allowed before;
-- only the calls change. The one policy on storage.objects (feedback
-- screenshots) is left alone: that table belongs to the storage service, and
-- screenshots are read one at a time.
DO $$
DECLARE
  p          record;
  using_expr text;
  check_expr text;
  stmt       text;
BEGIN
  -- With nothing but pg_catalog on the path, the stored definitions come back
  -- with every name qualified (pc49.effective_role(), auth.uid()), which is
  -- what the replacements below look for.
  PERFORM set_config('search_path', 'pg_catalog', true);

  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'pc49'
       AND (position('effective_role()' IN coalesce(qual, '') || coalesce(with_check, '')) > 0
            OR position('auth.uid()' IN coalesce(qual, '') || coalesce(with_check, '')) > 0)
  LOOP
    using_expr := replace(replace(p.qual, 'pc49.effective_role()', '(SELECT pc49.effective_role())'),
                          'auth.uid()', '(SELECT auth.uid())');
    check_expr := replace(replace(p.with_check, 'pc49.effective_role()', '(SELECT pc49.effective_role())'),
                          'auth.uid()', '(SELECT auth.uid())');
    stmt := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF using_expr IS NOT NULL THEN stmt := stmt || format(' USING (%s)', using_expr); END IF;
    IF check_expr IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', check_expr); END IF;
    EXECUTE stmt;
  END LOOP;
END
$$;

INSERT INTO pc49.schema_migrations (version) VALUES ('0070_a_role_is_read_once_per_query')
ON CONFLICT (version) DO NOTHING;
