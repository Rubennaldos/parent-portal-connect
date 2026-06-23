-- Bloque B2: tablas_sin_rls_o_sin_politicas
SELECT
    t.tablename,
    t.rowsecurity,
    COUNT(p.policyname) AS policy_count
FROM pg_tables t
LEFT JOIN pg_policies p
  ON p.schemaname = t.schemaname
 AND p.tablename = t.tablename
WHERE t.schemaname = 'public'
GROUP BY t.tablename, t.rowsecurity
HAVING NOT t.rowsecurity OR COUNT(p.policyname) = 0
ORDER BY t.rowsecurity, t.tablename;
