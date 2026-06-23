/**
 * Genera PDF del informe forense — Incidentes almuerzo + caché PWA
 * Ejecutar: node scripts/generate-audit-report-pdf.mjs
 */
import { jsPDF } from 'jspdf';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'PROBLEMA DE ORDENES DE ALMUERZO18.06');
const OUT_FILE = resolve(OUT_DIR, 'AUDITORIA_FORENSE_ALMUERZOS_CACHE_18-06-2026.pdf');

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const doc = new jsPDF({ unit: 'mm', format: 'a4' });
const margin = 18;
const pageW = 210;
const contentW = pageW - margin * 2;
let y = 20;
const lineH = 5.5;

function newPage() {
  doc.addPage();
  y = 20;
}

function ensureSpace(need = 20) {
  if (y + need > 285) newPage();
}

function title(text) {
  ensureSpace(14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(30, 30, 30);
  doc.text(text, margin, y);
  y += 9;
}

function h2(text) {
  ensureSpace(12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(50, 50, 120);
  doc.text(text, margin, y);
  y += 7;
}

function h3(text) {
  ensureSpace(10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(40, 40, 40);
  doc.text(text, margin, y);
  y += 6;
}

function para(text, indent = 0) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 30, 30);
  const lines = doc.splitTextToSize(text, contentW - indent);
  ensureSpace(lines.length * lineH + 2);
  doc.text(lines, margin + indent, y);
  y += lines.length * lineH + 2;
}

function bullet(text, indent = 4) {
  para(`• ${text}`, indent);
}

function codeBlock(text) {
  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(20, 20, 20);
  const lines = doc.splitTextToSize(text, contentW - 4);
  ensureSpace(lines.length * 4.5 + 6);
  doc.setFillColor(245, 245, 245);
  doc.rect(margin, y - 3, contentW, lines.length * 4.5 + 4, 'F');
  doc.text(lines, margin + 2, y + 1);
  y += lines.length * 4.5 + 6;
  doc.setFont('helvetica', 'normal');
}

function footer() {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(
      `Auditoría Forense Lima Café 28 / Tuqui POS — 18 Jun 2026 — Pág. ${i}/${pages}`,
      pageW / 2,
      292,
      { align: 'center' }
    );
  }
}

// ── PORTADA ──
doc.setFont('helvetica', 'bold');
doc.setFontSize(20);
doc.setTextColor(80, 40, 120);
doc.text('INFORME DE AUDITORÍA FORENSE', pageW / 2, 45, { align: 'center' });
doc.setFontSize(14);
doc.setTextColor(50, 50, 50);
doc.text('Incidentes de Pedidos Anulados + Persistencia de Caché Frontend', pageW / 2, 58, { align: 'center' });
doc.setFont('helvetica', 'normal');
doc.setFontSize(11);
doc.text('Lima Café 28 / Tuqui POS — parent-portal-connect', pageW / 2, 70, { align: 'center' });
doc.text('Fecha del informe: 18 de junio de 2026', pageW / 2, 78, { align: 'center' });
doc.setFontSize(10);
doc.text('Metodología: análisis estático del repositorio real (SQL, triggers, RPC,', pageW / 2, 95, { align: 'center' });
doc.text('Edge Functions, vercel.json, PWA/Workbox, componentes React). Sin suposiciones.', pageW / 2, 101, { align: 'center' });

doc.setDrawColor(120, 80, 180);
doc.setLineWidth(0.8);
doc.line(margin, 110, pageW - margin, 110);

para('Resumen ejecutivo:', 0);
y += 1;
bullet('NO existe cron job ni trigger de servidor que cancele pedidos de almuerzo por expiración horaria. Los crons de Vercel solo ejecutan auto-facturación y consulta SUNAT.');
bullet('Las anulaciones automáticas provienen del FRONTEND cuando falla el INSERT de la transacción (deuda) después de crear lunch_orders — patrón no atómico de 2 pasos.');
bullet('En hora punta (7–9 AM), fn_sync_student_balance + contención de locks provocan timeouts; el cliente interpreta fallo y ejecuta UPDATE is_cancelled=true.');
bullet('El panel de cocina muestra pedidos "Anulados" vía Realtime UPDATE sin remover filas canceladas de la lista.');
bullet('La PWA tiene skipWaiting+clientsClaim, pero VersionChecker DELIBERADAMENTE no recarga; usuarios siguen ejecutando bundle JS viejo en memoria.');
bullet('Usuarios en builds anteriores a VersionChecker nunca ven el botón de actualización.');

newPage();

// ── TASK 1 ──
title('TASK 1 — Causa raíz de anulaciones/cancelaciones');

h2('1.1 Hallazgo principal: NO hay auto-cancelación server-side por tiempo');
para('Se revisaron migraciones SQL, triggers, RPCs, Edge Functions y vercel.json. No hay job que pase pedidos a cancelled por TTL/expiración.');
bullet('vercel.json crons: /api/cron/auto-invoice (04:50 UTC) y /api/cron/check-invoice-status (c/5 min). Solo facturación.');
bullet('Triggers en lunch_orders: trg_validate_lunch_order_deadline (BLOQUEA INSERT, no cancela), trg_lunch_orders_prepayment (asigna payment_flow_state), trg_lunch_order_cancellation_cascade (REACCIONA a cancelación, no la inicia).');
bullet('void_pending_lunch_order_v2 y cancel_lunch_order*: solo se invocan por acción explícita de usuario/admin.');
bullet('cancelled_expired existe como valor de enum en payment_flow_state pero NO hay código que lo asigne automáticamente.');

h2('1.2 Lógica exacta que SÍ cambia pedidos a anulado (AUTO)');
para('Patrón común: INSERT lunch_orders OK → INSERT transactions FALLA → UPDATE lunch_orders SET is_cancelled=true, status=cancelled.');

h3('A) src/components/lunch/OrderLunchMenus.tsx — líneas 565-572');
codeBlock('if (transactionError) {\n  await supabase.from("lunch_orders").update({\n    is_cancelled: true, status: "cancelled",\n    cancellation_reason: "AUTO: transacción de almuerzo fallida al crear pedido"\n  }).eq("id", insertedOrder.id);\n}');

h3('B) src/components/lunch/UnifiedLunchCalendar.tsx — líneas 556-566');
codeBlock('cancellation_reason: "AUTO: transacción de almuerzo fallida en UnifiedLunchCalendar"');

h3('C) src/components/teacher/TeacherLunchCalendar.tsx — líneas 319-327');
codeBlock('cancellation_reason: "AUTO: transacción de almuerzo fallida en TeacherLunchCalendar"');
para('Nota: Teacher.tsx ya usa UnifiedLunchCalendarV2 (RPC atómica). TeacherLunchCalendar.tsx sigue en repo pero NO es la ruta activa de profesores.');

h3('D) src/components/parent/LunchOrderCalendar.tsx — líneas 668-676');
codeBlock('// Batch: si falla insert masivo de transactions, cancela TODOS los pedidos del batch\n.update({ is_cancelled: true, status: "cancelled" }).in("id", orphanedIds)');
para('CRÍTICO: LunchOrderCalendar sigue montado en Index.tsx (modal showMenuModal, línea 1150) y se abre desde StudentCard onViewMenu (línea 956). Convive con UnifiedLunchCalendarV2.');

h3('E) src/components/lunch/LunchDeliveryDashboard.tsx — líneas 882-892');
codeBlock('cancellation_reason: "AUTO: transacción fallida en delivery_no_order"');
para('Flujo "Agregar almuerzo sin pedido" en cocina — también usa patrón 2 pasos.');

h2('1.3 RPC atómica (correcta) vs rutas legacy');
h3('supabase/migrations/20260615_create_lunch_order_v2_atomic_rpc.sql');
para('create_lunch_order_v2 inserta lunch_order + transaction en UNA transacción SQL. Si falla, rollback total — no hay huérfano ni auto-cancel.');
h3('src/components/lunch/UnifiedLunchCalendarV2.tsx — líneas 1503-1527');
para('Padres y profesores en flujo principal usan create_lunch_order_v2. NO contiene lógica AUTO-cancel.');
para('PROBLEMA: padres aún pueden entrar al modal LunchOrderCalendar (legacy) desde la tarjeta del hijo → vuelven al patrón peligroso de batch cancel.');

h2('1.4 Por qué falla la transacción en hora punta (7–9 AM)');
para('La migración 20260615 documenta la causa: fn_sync_student_balance hace SUM(amount) sobre transactions pending por student_id. Sin índice cubriente, bajo concurrencia matutina el advisory lock se sostiene → statement timeout → INSERT transactions falla.');
bullet('Índice propuesto: idx_transactions_balance_sync_covering (student_id, payment_status) INCLUDE (amount).');
bullet('resilientFetch (src/lib/resilientFetch.ts) NO reintenta POST/RPC — correcto financieramente, pero amplifica percepción de fallo ante timeout de red.');
bullet('tg_enforce_spending_limit BYPASS almuerzos si metadata.lunch_order_id IS NOT NULL (20260428) — descartado como causa de bloqueo.');

h2('1.5 Bug de visualización en cocina (parece "anulación automática")');
h3('src/components/lunch/LunchDeliveryDashboard.tsx — líneas 1836-1850');
para('Fetch inicial filtra is_active_unified=true (excluye cancelados). Pero Realtime en UPDATE parchea la fila IN SITU con is_cancelled=true sin removerla. Resultado: pedido aparece en cocina y luego se muestra como Anulado tras fallo de deuda.');
para('Gestión LunchOrders.tsx SÍ puede listar anulados cuando el filtro lo permite (líneas 538-542, 2474-2475).');

newPage();

// ── TASK 2 ──
title('TASK 2 — Auditoría de actualización y caché');

h2('2.1 vercel.json — cabeceras Cache-Control');
bullet('/index.html → no-cache, no-store, must-revalidate (OK).');
bullet('/version.json → no-cache + Pragma + Expires:0 (OK).');
bullet('/sw.js → no-cache (OK).');
bullet('/manifest.webmanifest → no-cache (OK).');
para('PROBLEMA: regla catch-all "/(.*)" solo aplica CSP/HSTS — NO define Cache-Control para assets hashed (/assets/index-*.js). Vercel CDN aplica cache immutable por defecto en assets con hash (aceptable). El riesgo real NO es HTML persistente sino JS en memoria + Service Worker precache.');

h2('2.2 PWA / Service Worker (vite.config.ts)');
codeBlock('registerType: "autoUpdate"\nworkbox: { skipWaiting: true, clientsClaim: true }\nglobPatterns: ["**/*.{js,css,html,...}"]\nruntimeCaching: version.json → NetworkOnly\n              *.supabase.co → NetworkOnly');
para('El SW nuevo SÍ se activa sin estado waiting. PERO el bundle React ya cargado en memoria NO se reemplaza hasta location.reload().');

h2('2.3 VersionChecker — por qué el botón no aparece o no soluciona');
h3('src/components/VersionChecker.tsx');
bullet('Líneas 18-22: auto-reload ELIMINADO intencionalmente ("no romper wizard de almuerzos").');
bullet('Líneas 92-115: solo muestra toast con botón "Actualizar ahora" — acción manual.');
bullet('Líneas 54-89: si /version.json falla (HTTP≠200, Content-Type HTML por rewrite, red offline) → return null → CERO notificación.');
bullet('Líneas 124-126: primera lectura solo guarda versión baseline; detecta cambio en lecturas posteriores (intervalo 60s, delay inicial 15s).');
bullet('Usuarios con PWA instalada en build anterior a VersionChecker: no tienen el componente → imposible ver el botón.');
bullet('Toast viewport (toast.tsx L17): en móvil aparece arriba (top-0); puede quedar oculto tras teclado/navbar.');
bullet('Dashboard handleForceUpdate (Dashboard.tsx L576-586): envía broadcast pero VersionChecker solo muestra toast — NO recarga automáticamente (contradice mensaje admin "recargarán automáticamente").');

h2('2.4 Inconsistencias detectadas');
bullet('index.html referencia /manifest.json; VitePWA genera manifest.webmanifest — vercel.json cachea .webmanifest pero no .json duplicado.');
bullet('main.tsx comentario L62-64 desactualizado (dice NetworkFirst Supabase; real es NetworkOnly).');
bullet('package.json version 1.22.0 vs app.config.ts version 1.9.1 — divergencia cosmética, no afecta version.json (usa app.config).');

newPage();

// ── TASK 3 ──
title('TASK 3 — Solución estructural (Enterprise)');

h2('3.1 Backend / datos — mitigar anulaciones');
h3('P0 — Verificar despliegue en producción');
bullet('Confirmar que idx_transactions_balance_sync_covering y create_lunch_order_v2 están aplicados en Supabase prod (migración 20260615).');

h3('P0 — Eliminar rutas legacy de creación 2 pasos');
bullet('Retirar LunchOrderCalendar modal de Index.tsx (línea 1150) o redirigir a UnifiedLunchCalendarV2.');
bullet('Migrar LunchDeliveryDashboard AddWithoutOrderModal a RPC atómica.');
bullet('Deprecar OrderLunchMenus, UnifiedLunchCalendar, TeacherLunchCalendar si aún referenciados.');

h3('P1 — RPC backend de compensación (no cancelar en frontend)');
para('Si create_lunch_order_v2 falla por timeout de red pero el pedido SÍ se creó, el cliente no debe hacer UPDATE cancel. Patrón: RPC get_order_status(order_id) + idempotencia por (student, date, category).');

h3('P1 — Ventana hora crítica (opcional negocio)');
para('Ampliar global_lunch_deadline_time en system_status solo bloquea nuevos INSERT (trigger BEFORE INSERT). NO evita auto-cancel frontend. La palanca real es performance de fn_sync_student_balance + atomicidad.');

h3('P1 — Fix Realtime cocina');
para('En LunchDeliveryDashboard handler UPDATE: si is_cancelled=true OR status=cancelled → remover de lista (filter), no patch in-place.');

h2('3.2 Frontend — Zero-Manual-Refresh (configuración exacta)');
h3('A) vercel.json — añadir headers para assets');
codeBlock('{\n  "source": "/assets/(.*)",\n  "headers": [{ "key": "Cache-Control",\n    "value": "public, max-age=31536000, immutable" }]\n}\n// Mantener index.html, version.json, sw.js en no-cache');

h3('B) vite.config.ts — activación + recarga controlada');
codeBlock('VitePWA({ registerType: "prompt" }) // o mantener autoUpdate\n// Añadir en main.tsx listener:\nnavigator.serviceWorker.addEventListener("controllerchange", () => {\n  if (sessionStorage.getItem("sw_reload_done")) return;\n  sessionStorage.setItem("sw_reload_done", "1");\n  window.location.reload();\n});');
para('Alternativa menos agresiva: recargar solo si document.visibilityState==="visible" y no hay wizard activo (sessionStorage lunch_wizard_*).');

h3('C) VersionChecker — política enterprise');
bullet('Detectar controllerchange del SW → reload automático fuera de flujos críticos.');
bullet('Mantener toast solo como fallback si version.json cambia pero SW no actualizó.');
bullet('Reducir INITIAL_DELAY_MS de 15s a 0 en producción.');

h2('3.3 Consultas forenses recomendadas (producción)');
codeBlock('SELECT cancellation_reason, COUNT(*)\nFROM lunch_orders\nWHERE created_at >= (timezone("America/Lima", now())::date)::timestamptz\n  AND is_cancelled = true\nGROUP BY 1 ORDER BY 2 DESC;\n-- Esperado: filas AUTO: transacción... en horas 07-09');

h2('3.4 Riesgos si no se corrige');
bullet('Pedidos válidos cancelados en pico → cocina sin comida registrada → reclamos de padres/profesores.');
bullet('Builds viejos en celulares → bugs ya corregidos no llegan → soporte eterno.');
bullet('Datos Supabase frescos + UI vieja → estados contradictorios (parece anulado en UI cacheada).');

footer();

const pdfBuffer = doc.output('arraybuffer');
writeFileSync(OUT_FILE, Buffer.from(pdfBuffer));
console.log(`PDF generado: ${OUT_FILE}`);
