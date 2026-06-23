/**
 * PASO 3 — Auditoría estructural completa de la BD (4 bloques).
 * Ejecuta consultas read-only vía Supabase CLI y guarda resultados en AUDITORIA_ESTRUCTURAL_BD/
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'AUDITORIA_ESTRUCTURAL_BD');

const BLOCKS = [
  {
    id: 'A',
    name: 'foreign_keys',
    sqlFile: 'bloque_a_foreign_keys.sql',
    outTxt: 'bloque_a_foreign_keys.txt',
    outJson: 'bloque_a_foreign_keys.json',
    sql: `SELECT 
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;`,
  },
  {
    id: 'B',
    name: 'rls_policies',
    sqlFile: 'bloque_b_rls_policies.sql',
    outTxt: 'bloque_b_rls_policies.txt',
    outJson: 'bloque_b_rls_policies.json',
    sql: `SELECT 
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
ORDER BY pol.tablename, pol.policyname;`,
  },
  {
    id: 'C',
    name: 'triggers',
    sqlFile: 'bloque_c_triggers.sql',
    outTxt: 'bloque_c_triggers.txt',
    outJson: 'bloque_c_triggers.json',
    sql: `SELECT 
    trigger_name, 
    event_object_table AS table_name, 
    action_statement AS action, 
    action_timing AS timing,
    event_manipulation AS event
FROM information_schema.triggers 
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;`,
  },
  {
    id: 'C2',
    name: 'funciones',
    sqlFile: 'bloque_c2_funciones.sql',
    outTxt: 'bloque_c2_funciones.txt',
    outJson: 'bloque_c2_funciones.json',
    sql: `SELECT
    p.proname AS function_name,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    CASE p.provolatile
      WHEN 'i' THEN 'IMMUTABLE'
      WHEN 's' THEN 'STABLE'
      WHEN 'v' THEN 'VOLATILE'
    END AS volatility,
    CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS security,
    l.lanname AS language
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname = 'public'
ORDER BY p.proname;`,
  },
  {
    id: 'B2',
    name: 'tablas_sin_rls_o_sin_politicas',
    sqlFile: 'bloque_b2_tablas_rls_huecos.sql',
    outTxt: 'bloque_b2_tablas_rls_huecos.txt',
    outJson: 'bloque_b2_tablas_rls_huecos.json',
    sql: `SELECT
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
ORDER BY t.rowsecurity, t.tablename;`,
  },
  {
    id: 'D',
    name: 'columnas',
    sqlFile: 'bloque_d_columnas.sql',
    outTxt: 'bloque_d_columnas.txt',
    outJson: 'bloque_d_columnas.json',
    sql: `SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
ORDER BY table_name, ordinal_position;`,
  },
];

function writeUtf8NoBom(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: 'utf8' });
}

function runBlock(block) {
  const sqlPath = path.join(OUT_DIR, block.sqlFile);
  writeUtf8NoBom(sqlPath, `-- Bloque ${block.id}: ${block.name}\n${block.sql}\n`);

  console.log(`\n=== Bloque ${block.id}: ${block.name} ===`);
  const sqlArg = sqlPath.replace(/\\/g, '/');

  const jsonRaw = execSync(
    `npx supabase db query --linked --agent=no -o json -f "${sqlArg}"`,
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
  );

  const rows = JSON.parse(jsonRaw.trim());
  const count = Array.isArray(rows) ? rows.length : 0;

  writeUtf8NoBom(
    path.join(OUT_DIR, block.outJson),
    JSON.stringify({ generated_at: new Date().toISOString(), row_count: count, rows }, null, 2)
  );

  const lines = [
    `AUDITORIA ESTRUCTURAL — Bloque ${block.id}: ${block.name}`,
    `Generado: ${new Date().toISOString()}`,
    `Filas: ${count}`,
    '='.repeat(80),
    '',
  ];

  if (count === 0) {
    lines.push('(sin resultados)');
  } else {
    const headers = Object.keys(rows[0]);
    lines.push(headers.join('\t'));
    lines.push('-'.repeat(80));
    for (const row of rows) {
      lines.push(headers.map((h) => String(row[h] ?? '')).join('\t'));
    }
  }

  writeUtf8NoBom(path.join(OUT_DIR, block.outTxt), lines.join('\n'));
  console.log(`  Filas: ${count}`);
  console.log(`  -> ${block.outTxt}`);
  console.log(`  -> ${block.outJson}`);

  return { block: block.id, name: block.name, count };
}

function writeSummary(results) {
  const summary = {
    generated_at: new Date().toISOString(),
    project: 'Lima_cafe_28 (linked)',
    blocks: results,
    files: BLOCKS.flatMap((b) => [b.outTxt, b.outJson, b.sqlFile]),
  };

  const summaryPath = path.join(OUT_DIR, 'RESUMEN_AUDITORIA.txt');
  const lines = [
    'AUDITORIA ESTRUCTURAL COMPLETA — RESUMEN',
    `Generado: ${summary.generated_at}`,
    '',
    'Conteo por bloque:',
    ...results.map((r) => `  Bloque ${r.block} (${r.name}): ${r.count} filas`),
    '',
    'Archivos generados:',
    ...summary.files.map((f) => `  - ${f}`),
  ];

  writeUtf8NoBom(summaryPath, lines.join('\n'));
  writeUtf8NoBom(path.join(OUT_DIR, 'RESUMEN_AUDITORIA.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== RESUMEN ===');
  console.log(lines.slice(3).join('\n'));
}

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const results = [];
for (const block of BLOCKS) {
  results.push(runBlock(block));
}
writeSummary(results);
