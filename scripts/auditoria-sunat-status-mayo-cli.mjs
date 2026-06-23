/**
 * Genera SQL y consulta estado SUNAT de las 519 boletas vía Supabase CLI.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import XLSX from 'xlsx';

const ROOT = process.cwd();
const MISSING_FILE = path.join(ROOT, 'DESCUADRE CONTADORA/BOLETAS_FALTAN_EN_SUNAT_MAYO.xlsx');
const SQL_FILE = path.join(ROOT, 'DESCUADRE CONTADORA/auditoria_sunat_status_mayo.sql');
const OUT_JSON = path.join(ROOT, 'DESCUADRE CONTADORA/auditoria_sunat_status_mayo.json');

function normNum(n) {
  return String(n).trim().replace(/\.0+$/, '').padStart(8, '0');
}

const wb = XLSX.readFile(MISSING_FILE);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
const fullNumbers = rows.map((r) => `'${String(r.serie).trim()}-${normNum(r.numero)}'`);

const values = fullNumbers.map((n) => `(${n})`).join(',\n  ');

const sql = `-- Auditoría read-only: 519 boletas en facturador pero no en PLE SUNAT (mayo 2026)
WITH missing(full_number) AS (
  VALUES
  ${values}
),
joined AS (
  SELECT
    m.full_number,
    i.id,
    i.serie,
    i.numero,
    i.emission_date,
    i.total_amount,
    i.sunat_status,
    i.sunat_response_message,
    i.nubefact_ticket,
    i.is_demo,
    s.name AS school_name
  FROM missing m
  LEFT JOIN invoices i ON i.full_number = m.full_number
  LEFT JOIN schools s ON s.id = i.school_id
)
-- Resumen por estado
SELECT
  COALESCE(sunat_status, 'NO_ENCONTRADA_EN_BD') AS estado,
  count(*)::int AS cantidad,
  round(COALESCE(sum(total_amount), 0)::numeric, 2) AS monto_total
FROM joined
GROUP BY 1
ORDER BY monto_total DESC;
`;

fs.writeFileSync(SQL_FILE, sql, 'utf8');
console.log('SQL generado:', SQL_FILE, `(${fullNumbers.length} boletas)`);

const summaryRaw = execSync(
  `npx supabase db query --linked --agent=no -o json -f "${SQL_FILE.replace(/\\/g, '/')}"`,
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
);
const summary = JSON.parse(summaryRaw.trim());
console.log('\n=== RESUMEN POR ESTADO SUNAT ===');
for (const row of summary) {
  console.log(`${row.estado}: ${row.cantidad} boletas | S/ ${row.monto_total}`);
}
fs.writeFileSync(OUT_JSON, JSON.stringify({ summary }, null, 2));

// Detalle query
const sqlDetail = `-- Detalle de las 519 boletas
WITH missing(full_number) AS (
  VALUES
  ${values}
)
SELECT
  m.full_number,
  i.emission_date,
  i.total_amount,
  COALESCE(i.sunat_status, 'NO_ENCONTRADA_EN_BD') AS sunat_status,
  left(coalesce(i.sunat_response_message, ''), 120) AS sunat_msg,
  i.nubefact_ticket IS NOT NULL AS tiene_ticket,
  i.is_demo,
  s.name AS school_name
FROM missing m
LEFT JOIN invoices i ON i.full_number = m.full_number
LEFT JOIN schools s ON s.id = i.school_id
ORDER BY i.emission_date NULLS LAST, m.full_number;
`;

const SQL_DETAIL = path.join(ROOT, 'DESCUADRE CONTADORA/auditoria_sunat_status_mayo_detalle.sql');
fs.writeFileSync(SQL_DETAIL, sqlDetail, 'utf8');

const detailRaw = execSync(
  `npx supabase db query --linked --agent=no -o json -f "${SQL_DETAIL.replace(/\\/g, '/')}"`,
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }
);
const detail = JSON.parse(detailRaw.trim());
fs.writeFileSync(
  path.join(ROOT, 'DESCUADRE CONTADORA/auditoria_sunat_status_mayo_detalle.json'),
  JSON.stringify(detail, null, 2)
);

// Por fecha
const byDate = {};
for (const r of detail) {
  const d = r.emission_date || 'sin_fecha';
  byDate[d] = byDate[d] || { c: 0, t: 0, estados: {} };
  byDate[d].c++;
  byDate[d].t += Number(r.total_amount) || 0;
  const st = r.sunat_status;
  byDate[d].estados[st] = (byDate[d].estados[st] || 0) + 1;
}

console.log('\n=== TOP FECHAS (detalle BD) ===');
for (const [d, v] of Object.entries(byDate).sort((a, b) => b[1].t - a[1].t).slice(0, 10)) {
  const est = Object.entries(v.estados).map(([k, n]) => `${k}:${n}`).join(', ');
  console.log(`${d}: ${v.c} boletas | S/ ${Math.round(v.t * 100) / 100} | ${est}`);
}

// Export excel from detail json
const outRows = detail.map((r) => ({
  full_number: r.full_number,
  emission_date: r.emission_date,
  total_amount: r.total_amount,
  sunat_status: r.sunat_status,
  sunat_msg: r.sunat_msg,
  tiene_ticket: r.tiene_ticket,
  is_demo: r.is_demo,
  school_name: r.school_name,
}));
const outWs = XLSX.utils.json_to_sheet(outRows);
const sumWs = XLSX.utils.json_to_sheet(summary);
const outWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(outWb, outWs, 'DETALLE_BD');
XLSX.utils.book_append_sheet(outWb, sumWs, 'RESUMEN');
const OUT_XLSX = path.join(ROOT, 'DESCUADRE CONTADORA/AUDITORIA_SUNAT_STATUS_MAYO.xlsx');
XLSX.writeFile(outWb, OUT_XLSX);
console.log('\nExportado:', OUT_XLSX);
