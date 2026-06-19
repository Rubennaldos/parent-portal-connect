#!/usr/bin/env node
/**
 * qa-smoke-test.mjs — Certificación local v1.9.2 (RPC idempotencia + timeouts)
 *
 * Ejecuta 3 pruebas contra Supabase REAL:
 *   TEST 1 — Idempotencia doble clic cocina (create_and_deliver_lunch_order)
 *   TEST 2 — Efectivo en caja (payment_status = paid)
 *   TEST 3 — Batch padres (create_lunch_orders_batch_v2)
 *
 * REQUISITOS (.env en la raíz del proyecto):
 *   VITE_SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...   ← Dashboard → Settings → API → service_role
 *
 * ⚠️  NUNCA commitees la service_role key. Solo uso local / CI privado.
 *
 * Windows:
 *   Set-Location "C:\Users\Alberto Naldos\Desktop\miproyecto\parent-portal-connect"
 *   node scripts/qa-smoke-test.mjs
 *
 * Opcional — cancelar pedidos QA al terminar:
 *   node scripts/qa-smoke-test.mjs --cleanup
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CLEANUP = process.argv.includes('--cleanup');

// ── Carga .env sin dependencias externas ─────────────────────────────────────
function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(resolve(ROOT, '.env'));
loadEnvFile(resolve(ROOT, '.env.local'));

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('\n❌ FATAL: Faltan variables de entorno.\n');
  console.error('  Crea .env en la raíz con:');
  console.error('    VITE_SUPABASE_URL=https://tu-proyecto.supabase.co');
  console.error('    SUPABASE_SERVICE_ROLE_KEY=eyJ...  (Settings → API → service_role)\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Utilidades de salida ─────────────────────────────────────────────────────
const results = [];

function passed(name, detail = '') {
  console.log(`✅ PASSED — ${name}${detail ? `: ${detail}` : ''}`);
  results.push({ name, ok: true });
}

function failed(name, detail = '') {
  console.error(`❌ FAILED — ${name}${detail ? `: ${detail}` : ''}`);
  results.push({ name, ok: false });
}

function qaDates(count, startOffset = 0) {
  // Fechas en 2099 + offset único por minuto → evita colisión entre ejecuciones
  const runBase = Math.floor(Date.now() / 60_000) % 300;
  const dates = [];
  for (let i = 0; i < count; i++) {
    const day = runBase + startOffset + i + 1;
    const month = 1 + Math.floor((day - 1) / 28);
    const dom = ((day - 1) % 28) + 1;
    dates.push(`2099-${String(month).padStart(2, '0')}-${String(dom).padStart(2, '0')}`);
  }
  return dates;
}

// ── Fixtures desde la DB real ────────────────────────────────────────────────
async function loadFixtures() {
  const { data: teacher, error: te } = await supabase
    .from('teacher_profiles')
    .select('id, full_name, school_id_1')
    .not('school_id_1', 'is', null)
    .limit(1)
    .maybeSingle();
  if (te || !teacher) throw new Error(`No se pudo cargar profesor de prueba: ${te?.message ?? 'sin filas'}`);

  const { data: student, error: se } = await supabase
    .from('students')
    .select('id, full_name, school_id')
    .eq('is_active', true)
    .not('school_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (se || !student) throw new Error(`No se pudo cargar alumno de prueba: ${se?.message ?? 'sin filas'}`);

  const { data: menu, error: me } = await supabase
    .from('lunch_menus')
    .select('id, category_id, school_id, date')
    .not('category_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (me || !menu?.category_id) throw new Error(`No se pudo cargar menú con category_id: ${me?.message ?? 'sin filas'}`);

  const { data: category, error: ce } = await supabase
    .from('lunch_categories')
    .select('id, name, price')
    .eq('id', menu.category_id)
    .maybeSingle();
  if (ce || !category) throw new Error(`No se pudo cargar categoría: ${ce?.message ?? 'sin filas'}`);

  const { data: profile, error: pe } = await supabase
    .from('profiles')
    .select('id')
    .limit(1)
    .maybeSingle();
  if (pe || !profile) throw new Error(`No se pudo cargar profiles.id para created_by: ${pe?.message ?? 'sin filas'}`);

  const schoolId = teacher.school_id_1 ?? student.school_id ?? menu.school_id;
  if (!schoolId) throw new Error('No se pudo resolver school_id para las pruebas');

  return {
    teacherId:   teacher.id,
    teacherName: teacher.full_name,
    studentId:   student.id,
    studentName: student.full_name,
    categoryId:  category.id,
    categoryName: category.name,
    menuId:      menu.id,
    schoolId,
    createdBy:   profile.id,
    price:       Number(category.price) > 0 ? Number(category.price) : 5.0,
  };
}

async function cancelQaOrders({ teacherId, studentId, dates }) {
  for (const orderDate of dates) {
    await supabase
      .from('lunch_orders')
      .update({
        status: 'cancelled',
        is_cancelled: true,
        cancellation_reason: 'QA_SMOKE_TEST cleanup',
      })
      .or(`teacher_id.eq.${teacherId},student_id.eq.${studentId}`)
      .eq('order_date', orderDate)
      .neq('status', 'cancelled');
  }
}

// ── TEST 1 — Idempotencia doble clic cocina ──────────────────────────────────
async function test1Idempotency(fixtures, orderDate) {
  const label = 'TEST 1 — Idempotencia doble clic cocina';
  try {
    const params = {
      p_person_type:    'teacher',
      p_person_id:      fixtures.teacherId,
      p_order_date:     orderDate,
      p_category_id:    fixtures.categoryId,
      p_menu_id:        fixtures.menuId,
      p_school_id:      fixtures.schoolId,
      p_price:          fixtures.price,
      p_created_by:     fixtures.createdBy,
      p_description:    `QA smoke TEST1 — ${fixtures.teacherName}`,
      p_category_name:  fixtures.categoryName,
      p_payment_method: 'credit',
    };

    const { data: first, error: err1 } = await supabase.rpc('create_and_deliver_lunch_order', params);
    if (err1) {
      failed(label, `Primera llamada falló: ${err1.message}`);
      return;
    }
    if (!first?.lunch_order_id) {
      failed(label, `Primera llamada sin lunch_order_id: ${JSON.stringify(first)}`);
      return;
    }
    if (first.idempotent === true) {
      failed(label, 'Primera llamada no debería ser idempotent=true (pedido ya existía — ejecuta de nuevo en 1 min o usa --cleanup)');
      return;
    }

    const { data: second, error: err2 } = await supabase.rpc('create_and_deliver_lunch_order', params);
    if (err2) {
      failed(label, `Segunda llamada lanzó error (debería ser idempotente): ${err2.message}`);
      return;
    }
    if (second?.idempotent !== true) {
      failed(label, `Segunda llamada debería devolver idempotent=true. Recibido: ${JSON.stringify(second)}`);
      return;
    }
    if (second.lunch_order_id !== first.lunch_order_id) {
      failed(label, `order_id distinto en retry: ${first.lunch_order_id} vs ${second.lunch_order_id}`);
      return;
    }

    passed(label, `order_id=${first.lunch_order_id}, retry idempotent=true sin error`);
  } catch (e) {
    failed(label, e instanceof Error ? e.message : String(e));
  }
}

// ── TEST 2 — Efectivo en caja (payment_status = paid) ──────────────────────
async function test2CashPayment(fixtures, orderDate) {
  const label = 'TEST 2 — Caja física efectivo (paid)';
  try {
    const cashPrice = 5.0;
    const { data, error } = await supabase.rpc('create_and_deliver_lunch_order', {
      p_person_type:    'teacher',
      p_person_id:      fixtures.teacherId,
      p_order_date:     orderDate,
      p_category_id:    fixtures.categoryId,
      p_menu_id:        fixtures.menuId,
      p_school_id:      fixtures.schoolId,
      p_price:          cashPrice,
      p_created_by:     fixtures.createdBy,
      p_description:    `QA smoke TEST2 cash — ${fixtures.teacherName}`,
      p_category_name:  fixtures.categoryName,
      p_payment_method: 'cash',
    });

    if (error) {
      failed(label, error.message);
      return;
    }
    if (data?.payment_status !== 'paid') {
      failed(label, `payment_status esperado 'paid', recibido '${data?.payment_status}'`);
      return;
    }
    if (!data?.lunch_order_id) {
      failed(label, 'Sin lunch_order_id en respuesta');
      return;
    }

    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .select('id, payment_status, payment_method, amount')
      .eq('teacher_id', fixtures.teacherId)
      .contains('metadata', { lunch_order_id: data.lunch_order_id })
      .maybeSingle();

    if (txErr) {
      failed(label, `No se pudo verificar transacción: ${txErr.message}`);
      return;
    }
    if (!tx) {
      failed(label, 'Transacción no encontrada en DB');
      return;
    }
    if (tx.payment_status !== 'paid') {
      failed(label, `Transacción en DB con payment_status='${tx.payment_status}' (esperado 'paid')`);
      return;
    }
    if (tx.payment_method !== 'cash') {
      failed(label, `payment_method='${tx.payment_method}' (esperado 'cash')`);
      return;
    }

    passed(label, `tx=${tx.id}, payment_status=paid, payment_method=cash, amount=${tx.amount}`);
  } catch (e) {
    failed(label, e instanceof Error ? e.message : String(e));
  }
}

// ── TEST 3 — Batch padres (3 fechas) ───────────────────────────────────────
async function test3BatchParents(fixtures, dates) {
  const label = 'TEST 3 — Batch padres (3 fechas)';
  try {
    const p_date_menus = dates.map((order_date, i) => ({
      order_date,
      category_id: fixtures.categoryId,
      menu_id:     fixtures.menuId,
      description: `QA smoke TEST3 día ${i + 1}`,
    }));

    const { data, error } = await supabase.rpc('create_lunch_orders_batch_v2', {
      p_person_type:   'student',
      p_person_id:     fixtures.studentId,
      p_school_id:     fixtures.schoolId,
      p_base_price:    fixtures.price,
      p_final_price:   fixtures.price,
      p_created_by:    fixtures.createdBy,
      p_source:        'qa_smoke_test',
      p_category_name: fixtures.categoryName,
      p_date_menus,
    });

    if (error) {
      failed(label, error.message);
      return;
    }

    const succeeded = data?.succeeded ?? [];
    const failedItems = data?.failed ?? [];
    const total = data?.total ?? 0;

    if (total !== 3) {
      failed(label, `total esperado 3, recibido ${total}`);
      return;
    }
    if (!Array.isArray(succeeded) || succeeded.length !== 3) {
      failed(label, `succeeded.length=${succeeded?.length ?? 0}, failed=${JSON.stringify(failedItems)}`);
      return;
    }
    if (failedItems.length > 0) {
      failed(label, `fechas fallidas: ${JSON.stringify(failedItems)}`);
      return;
    }

    const { count, error: countErr } = await supabase
      .from('lunch_orders')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', fixtures.studentId)
      .in('order_date', dates)
      .neq('status', 'cancelled');

    if (countErr) {
      failed(label, `Verificación DB falló: ${countErr.message}`);
      return;
    }
    if (count !== 3) {
      failed(label, `DB tiene ${count} pedidos activos (esperado 3) para fechas ${dates.join(', ')}`);
      return;
    }

    passed(label, `succeeded=${succeeded.length}/3, pedidos en DB=${count}, alumno=${fixtures.studentName}`);
  } catch (e) {
    failed(label, e instanceof Error ? e.message : String(e));
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  QA SMOKE TEST — v1.9.2 RPC Hardening');
  console.log(`  Supabase: ${SUPABASE_URL}`);
  console.log('══════════════════════════════════════════════════════════\n');

  let fixtures;
  try {
    fixtures = await loadFixtures();
    console.log(`Fixtures: profesor="${fixtures.teacherName}", alumno="${fixtures.studentName}"`);
    console.log(`          categoría="${fixtures.categoryName}", precio=S/${fixtures.price}\n`);
  } catch (e) {
    console.error(`❌ FATAL — No se pudieron cargar fixtures: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  const [dateT1, dateT2, dateT3, dateT4, dateT5] = qaDates(5, 0);
  const batchDates = [dateT3, dateT4, dateT5];
  const allDates = [dateT1, dateT2, ...batchDates];

  console.log('Pre-limpieza de fechas QA (cancelar pedidos previos en mismas fechas)...');
  await cancelQaOrders({ teacherId: fixtures.teacherId, studentId: fixtures.studentId, dates: allDates });

  await test1Idempotency(fixtures, dateT1);
  await test2CashPayment(fixtures, dateT2);
  await test3BatchParents(fixtures, batchDates);

  if (CLEANUP) {
    console.log('\n--cleanup: cancelando pedidos QA...');
    await cancelQaOrders({ teacherId: fixtures.teacherId, studentId: fixtures.studentId, dates: allDates });
    console.log('Pedidos QA cancelados.');
  } else {
    console.log('\nNota: pedidos QA quedaron en DB (fechas 2099). Para limpiar: node scripts/qa-smoke-test.mjs --cleanup');
  }

  const passedCount = results.filter(r => r.ok).length;
  const failedCount = results.filter(r => !r.ok).length;

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  RESULTADO: ${passedCount} passed, ${failedCount} failed`);
  console.log('══════════════════════════════════════════════════════════\n');

  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ FATAL:', e);
  process.exit(1);
});
