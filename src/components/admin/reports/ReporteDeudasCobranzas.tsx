/**
 * ReporteDeudasCobranzas — Reporte 2
 * Resumen de deudas pendientes usando view_student_debts como
 * fuente única de verdad (Regla arquitectura deudas).
 *
 * Desglose:
 *  - Kiosco  → fuente = 'transaccion' con es_almuerzo = false
 *  - Comedor → fuente = 'almuerzo_virtual' | es_almuerzo = true
 *  - Saldo negativo → fuente = 'saldo_negativo'
 */
import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import {
  AlertCircle,
  RefreshCw,
  Download,
  Loader2,
  Store,
  UtensilsCrossed,
  AlertTriangle,
  Users,
  TrendingDown,
} from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface DebtRow {
  deuda_id:    string;
  student_id:  string;
  school_id:   string;
  monto:       number;
  descripcion: string;
  fecha:       string;
  fuente:      'transaccion' | 'almuerzo_virtual' | 'saldo_negativo';
  es_almuerzo: boolean;
  ticket_code: string | null;
  student_name?: string;
  school_name?:  string;
}

interface AggBySchool {
  school_name: string;
  kiosco:      number;
  comedor:     number;
  saldo_neg:   number;
  total:       number;
  students:    number;
}

interface Props {
  schoolId?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number) => `S/ ${Math.abs(n).toFixed(2)}`;

// ── Componente principal ───────────────────────────────────────────────────────

export function ReporteDeudasCobranzas({ schoolId }: Props) {
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [rows, setRows]         = useState<DebtRow[] | null>(null);

  // Totales calculados del conjunto de datos
  const totalKiosco   = rows?.filter(r => !r.es_almuerzo && r.fuente === 'transaccion').reduce((s, r) => s + r.monto, 0) ?? 0;
  const totalComedor  = rows?.filter(r => r.es_almuerzo || r.fuente === 'almuerzo_virtual').reduce((s, r) => s + r.monto, 0) ?? 0;
  const totalSaldoNeg = rows?.filter(r => r.fuente === 'saldo_negativo').reduce((s, r) => s + r.monto, 0) ?? 0;
  const totalGeneral  = totalKiosco + totalComedor + totalSaldoNeg;
  const uniqueStudents = rows ? new Set(rows.map(r => r.student_id)).size : 0;

  // Agrupado por sede
  const bySchool: AggBySchool[] = (() => {
    if (!rows) return [];
    const map = new Map<string, AggBySchool>();
    rows.forEach(r => {
      const key = r.school_name ?? r.school_id ?? 'Sin sede';
      if (!map.has(key)) {
        map.set(key, { school_name: key, kiosco: 0, comedor: 0, saldo_neg: 0, total: 0, students: 0 });
      }
      const s = map.get(key)!;
      if (r.fuente === 'saldo_negativo')        s.saldo_neg += r.monto;
      else if (r.es_almuerzo || r.fuente === 'almuerzo_virtual') s.comedor += r.monto;
      else                                       s.kiosco   += r.monto;
      s.total = s.kiosco + s.comedor + s.saldo_neg;
    });
    // contar alumnos únicos por sede
    const studentMap = new Map<string, Set<string>>();
    rows.forEach(r => {
      const key = r.school_name ?? r.school_id ?? 'Sin sede';
      if (!studentMap.has(key)) studentMap.set(key, new Set());
      studentMap.get(key)!.add(r.student_id);
    });
    studentMap.forEach((set, key) => {
      if (map.has(key)) map.get(key)!.students = set.size;
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  })();

  // Top 10 deudores
  const topDebtors: { student_id: string; name: string; total: number; kiosco: number; comedor: number }[] = (() => {
    if (!rows) return [];
    const map = new Map<string, { name: string; kiosco: number; comedor: number; saldo_neg: number }>();
    rows.forEach(r => {
      if (!map.has(r.student_id)) map.set(r.student_id, { name: r.student_name ?? r.student_id, kiosco: 0, comedor: 0, saldo_neg: 0 });
      const s = map.get(r.student_id)!;
      if (r.fuente === 'saldo_negativo') s.saldo_neg += r.monto;
      else if (r.es_almuerzo || r.fuente === 'almuerzo_virtual') s.comedor += r.monto;
      else s.kiosco += r.monto;
    });
    return Array.from(map.entries())
      .map(([sid, v]) => ({ student_id: sid, name: v.name, total: v.kiosco + v.comedor + v.saldo_neg, kiosco: v.kiosco, comedor: v.comedor }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  })();

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Consulta directa a la vista (fuente única de verdad per arquitectura deudas)
      let query = supabase
        .from('view_student_debts')
        .select(`
          deuda_id,
          student_id,
          school_id,
          monto,
          descripcion,
          fecha,
          fuente,
          es_almuerzo,
          ticket_code,
          students!inner(full_name, schools(name))
        `)
        .gt('monto', 0);

      if (schoolId) query = query.eq('school_id', schoolId);

      const { data, error: qErr } = await query;
      if (qErr) throw qErr;

      const mapped: DebtRow[] = (data ?? []).map((r: any) => ({
        ...r,
        student_name: r.students?.full_name ?? '—',
        school_name:  r.students?.schools?.name ?? '—',
      }));
      setRows(mapped);
    } catch (e: any) {
      setError(e.message ?? 'Error al cargar deudas');
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  const exportCSV = () => {
    if (!rows) return;
    const headers = ['Alumno', 'Sede', 'Monto', 'Fuente', 'Descripción', 'Fecha', 'Ticket'];
    const body = rows.map(r => [
      r.student_name ?? '',
      r.school_name  ?? '',
      r.monto,
      r.fuente,
      r.descripcion,
      r.fecha,
      r.ticket_code ?? '',
    ]);
    const csv  = [headers, ...body].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `deudas_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">

      {/* ── Controles ── */}
      <div className="bg-white rounded-2xl border p-4 flex flex-wrap gap-3 items-center">
        <Button onClick={fetchReport} disabled={loading} className="bg-slate-800 hover:bg-slate-700 text-white gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {loading ? 'Cargando...' : 'Generar Reporte de Deudas'}
        </Button>
        {rows && rows.length > 0 && (
          <Button variant="outline" onClick={exportCSV} className="gap-2 text-rose-700 border-rose-300">
            <Download className="w-4 h-4" />
            Exportar CSV
          </Button>
        )}
        <p className="text-xs text-slate-400">
          Muestra deudas activas en tiempo real usando la vista centralizada de deudas.
        </p>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Sin datos ── */}
      {!rows && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
          <AlertCircle className="w-12 h-12 opacity-30" />
          <p className="text-sm">Presiona "Generar Reporte de Deudas" para ver el estado actual</p>
        </div>
      )}

      {/* ── Sin deudas ── */}
      {rows && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-emerald-500" />
          </div>
          <p className="text-sm font-semibold text-emerald-700">¡Sin deudas pendientes!</p>
          <p className="text-xs text-slate-400">Todos los alumnos tienen sus pagos al día.</p>
        </div>
      )}

      {/* ── Resultados ── */}
      {rows && rows.length > 0 && (
        <div className="space-y-5">

          {/* Tarjetas resumen */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <DebtCard
              title="Deuda Total"
              value={fmt(totalGeneral)}
              sub={`${uniqueStudents} alumnos`}
              color="bg-gradient-to-br from-rose-600 to-rose-800 text-white"
              icon={<TrendingDown className="w-5 h-5" />}
            />
            <DebtCard
              title="Kiosco"
              value={fmt(totalKiosco)}
              sub={`${((totalKiosco / totalGeneral) * 100).toFixed(1)}% del total`}
              color="bg-gradient-to-br from-emerald-50 to-teal-50"
              icon={<Store className="w-5 h-5 text-emerald-600" />}
            />
            <DebtCard
              title="Comedor"
              value={fmt(totalComedor)}
              sub={`${((totalComedor / totalGeneral) * 100).toFixed(1)}% del total`}
              color="bg-gradient-to-br from-amber-50 to-orange-50"
              icon={<UtensilsCrossed className="w-5 h-5 text-amber-600" />}
            />
            <DebtCard
              title="Saldo Negativo"
              value={fmt(totalSaldoNeg)}
              sub="Deuda en cuenta kiosco"
              color="bg-gradient-to-br from-slate-50 to-slate-100"
              icon={<AlertCircle className="w-5 h-5 text-slate-500" />}
            />
          </div>

          {/* Por sede (si hay más de una) */}
          {bySchool.length > 1 && (
            <div className="bg-white rounded-2xl border overflow-hidden">
              <div className="px-5 py-3 border-b bg-slate-50">
                <h4 className="text-sm font-semibold text-slate-700">Deuda por Sede</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b">
                      <th className="text-left px-5 py-2.5">Sede</th>
                      <th className="text-right px-4 py-2.5">Kiosco</th>
                      <th className="text-right px-4 py-2.5">Comedor</th>
                      <th className="text-right px-4 py-2.5">Saldo Neg.</th>
                      <th className="text-right px-4 py-2.5">Total</th>
                      <th className="text-right px-5 py-2.5">Alumnos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bySchool.map((s, i) => (
                      <tr key={s.school_name} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                        <td className="px-5 py-2.5 font-medium text-slate-700">{s.school_name}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(s.kiosco)}</td>
                        <td className="px-4 py-2.5 text-right text-amber-700">{fmt(s.comedor)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-500">{fmt(s.saldo_neg)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-rose-700">{fmt(s.total)}</td>
                        <td className="px-5 py-2.5 text-right text-slate-500">{s.students}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top deudores */}
          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="px-5 py-3 border-b bg-slate-50 flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-500" />
              <h4 className="text-sm font-semibold text-slate-700">Top 10 Deudores</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b">
                    <th className="text-center px-4 py-2.5 w-8">#</th>
                    <th className="text-left px-4 py-2.5">Alumno</th>
                    <th className="text-right px-4 py-2.5">Kiosco</th>
                    <th className="text-right px-4 py-2.5">Comedor</th>
                    <th className="text-right px-5 py-2.5">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {topDebtors.map((d, i) => (
                    <tr key={d.student_id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                      <td className="px-4 py-2.5 text-center text-xs text-slate-400 font-bold">{i + 1}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-700 max-w-[200px] truncate">{d.name}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-700">{fmt(d.kiosco)}</td>
                      <td className="px-4 py-2.5 text-right text-amber-700">{fmt(d.comedor)}</td>
                      <td className="px-5 py-2.5 text-right font-bold text-rose-700">{fmt(d.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Nota legal */}
          <p className="text-xs text-slate-400 px-1">
            Los datos provienen de <code className="font-mono bg-slate-100 px-1 rounded">view_student_debts</code> en tiempo real.
            Incluye: deudas de kiosco por transacciones negativas, almuerzos sin pagar y saldo prepago negativo.
            Las deudas anuladas (<code className="font-mono bg-slate-100 px-1 rounded">cancelled</code>) no aparecen.
          </p>

        </div>
      )}
    </div>
  );
}

// ── Sub-componentes ────────────────────────────────────────────────────────────

function DebtCard({ title, value, sub, color, icon }: {
  title: string; value: string; sub: string; color: string; icon: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl p-4 border ${color}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs font-semibold opacity-70">{title}</span>
      </div>
      <p className="text-xl font-black mb-0.5">{value}</p>
      <p className="text-xs opacity-60">{sub}</p>
    </div>
  );
}
