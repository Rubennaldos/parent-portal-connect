-- Bloque B: rls_policies
SELECT 
    pol.tablename, 
    tbl.rowsecurity, 
    pol.policyname, 
    pol.permissive, 
    pol.roles, 
    pol.cmd, 
    pol.qual,
    pol.with_check
FROM pg_policies pol
JOIN pg_tables tbl
  ON tbl.schemaname = pol.schemaname
 AND tbl.tablename = pol.tablename
WHERE pol.schemaname = 'public'
ORDER BY pol.tablename, pol.policyname;
