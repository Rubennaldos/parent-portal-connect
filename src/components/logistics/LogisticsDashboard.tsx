import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Loader2, RefreshCw, AlertTriangle, Lightbulb, TrendingUp, PackageX } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface TopProduct {
  name: string;
  shortName: string;
  total_sales: number;
}

interface AlertRow {
  productName: string;
  schoolName: string;
  stock: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortName(n: string, max = 16): string {
  return n.length <= max ? n : n.substring(0, max - 1) + '…';
}

function generateTips(top5: TopProduct[], alerts: AlertRow[]): string[] {
  const tips: string[] = [];
  const topNames = new Set(top5.map(p => p.name));

  // Top sellers sin stock
  const criticals = alerts.filter(a => topNames.has(a.productName) && a.stock === 0);
  if (criticals.length > 0) {
    const names = criticals.slice(0, 2).map(a => `"${shortName(a.productName, 20)}" (${shortName(a.schoolName, 15)})`).join(' y ');
    tips.push(`🔥 Top vendedores AGOTADOS: ${names}. Cada venta perdida es dinero real. Reabastecer YA.`);
  }

  // Top sellers con stock bajo
  const lowTops = alerts.filter(a => topNames.has(a.productName) && a.stock > 0 && a.stock <= 5);
  if (lowTops.length > 0) {
    const names = lowTops.slice(0, 2).map(a => `${shortName(a.productName, 18)} (${a.stock} un. en ${shortName(a.schoolName, 12)})`).join(', ');
    tips.push(`⚡ Top vendedores con stock crítico: ${names}. Programa reabastecimiento antes de que se agoten.`);
  }

  // Sede con muchos productos sin stock
  const zeroBySchool: Record<string, number> = {};
  for (const a of alerts.filter(r => r.stock === 0)) {
    zeroBySchool[a.schoolName] = (zeroBySchool[a.schoolName] || 0) + 1;
  }
  const worstSchool = Object.entries(zeroBySchool).sort((a, b) => b[1] - a[1])[0];
  if (worstSchool && worstSchool[1] >= 2) {
    tips.push(`🏫 ${worstSchool[0]} tiene ${worstSchool[1]} productos sin stock. Posiblemente no se ha registrado una entrada de mercadería recientemente.`);
  }

  // Líder de ventas
  if (top5[0]?.total_sales > 50) {
    tips.push(`📈 "${shortName(top5[0].name, 25)}" lidera con ${top5[0].total_sales} ventas. Asegúrate de tenerlo siempre activo y con stock en todas las sedes.`);
  }

  // Todo bien
  if (tips.length === 0 && alerts.length === 0) {
    tips.push('✅ ¡Inventario saludable! Todos los productos habilitados tienen stock ≥ 6 unidades en sus sedes.');
  } else if (tips.length === 0) {
    tips.push(`📦 ${alerts.length} producto(s) con stock bajo pero ninguno crítico por ahora. Programa reabastecimientos para las próximas semanas.`);
  }

  return tips;
}

const BAR_COLORS = ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5'];

// ─── Componente ───────────────────────────────────────────────────────────────

export default function LogisticsDashboard() {
  const { toast } = useToast();

  const [loading,  setLoading]  = useState(true);
  const [top5,     setTop5]     = useState<TopProduct[]>([]);
  const [alerts,   setAlerts]   = useState<AlertRow[]>([]);
  const [tips,     setTips]     = useState<string[]>([]);
  const [lastSync, setLastSync] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // ── 1. Top 5 productos más vendidos ──────────────────────────────────
      const { data: topData, error: topErr } = await supabase
        .from('products')
        .select('id, name, total_sales')
        .eq('active', true)
        .not('total_sales', 'is', null)
        .order('total_sales', { ascending: false })
        .limit(5);
      if (topErr) throw topErr;

      const top5Rows: TopProduct[] = (topData || []).map(p => ({
        name:        p.name,
        shortName:   shortName(p.name, 18),
        total_sales: p.total_sales ?? 0,
      }));

      // ── 2. Alertas de quiebre de stock (≤ 10 unidades, producto habilitado) ─
      const { data: lowStockData, error: lowErr } = await supabase
        .from('product_stock')
        .select('product_id, school_id, current_stock')
        .eq('is_enabled', true)
        .lte('current_stock', 10)
        .order('current_stock');
      if (lowErr) throw lowErr;

      // Resolver nombres en paralelo
      const productIds = [...new Set((lowStockData || []).map(r => r.product_id))];
      const schoolIds  = [...new Set((lowStockData || []).map(r => r.school_id))];

      const [pRes, sRes] = await Promise.all([
        productIds.length
          ? supabase.from('products').select('id, name').in('id', productIds)
          : Promise.resolve({ data: [] }),
        schoolIds.length
          ? supabase.from('schools').select('id, name').in('id', schoolIds)
          : Promise.resolve({ data: [] }),
      ]);

      const pMap = new Map((pRes.data || []).map((p: any) => [p.id, p.name]));
      const sMap = new Map((sRes.data || []).map((s: any) => [s.id, s.name]));

      const alertRows: AlertRow[] = (lowStockData || []).map(r => ({
        productName: pMap.get(r.product_id) || r.product_id.slice(0, 8),
        schoolName:  sMap.get(r.school_id)  || r.school_id.slice(0, 8),
        stock:       r.current_stock,
      }));

      // ── 3. Generar consejos ───────────────────────────────────────────────
      const generatedTips = generateTips(top5Rows, alertRows);

      setTop5(top5Rows);
      setAlerts(alertRows);
      setTips(generatedTips);
      setLastSync(new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }));
    } catch (err: any) {
      console.error('[LogisticsDashboard] error:', err);
      toast({ variant: 'destructive', title: 'Error cargando dashboard', description: err.message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600 mr-3" />
        <span className="text-slate-500 text-sm">Cargando dashboard…</span>
      </div>
    );
  }

  const zeroStockAlerts = alerts.filter(a => a.stock === 0);
  const lowStockAlerts  = alerts.filter(a => a.stock > 0);

  return (
    <div className="space-y-4 sm:space-y-5">

      {/* ── Cabecera ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-800">Dashboard de Movimientos</h2>
          <p className="text-[11px] text-slate-400">Última actualización: {lastSync}</p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Actualizar</span>
        </button>
      </div>

      {/* ── Tarjetas de resumen ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <span className="text-[11px] sm:text-xs text-slate-500 font-medium">Top producto</span>
          </div>
          <p className="font-black text-slate-800 text-sm sm:text-base leading-tight line-clamp-2">
            {top5[0]?.name || '—'}
          </p>
          <p className="text-[11px] text-emerald-600 mt-0.5 font-semibold">
            {top5[0]?.total_sales ?? 0} ventas
          </p>
        </div>

        <div className={`border rounded-xl p-3 sm:p-4 ${zeroStockAlerts.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
          <div className="flex items-center gap-2 mb-1">
            <PackageX className={`h-4 w-4 ${zeroStockAlerts.length > 0 ? 'text-red-600' : 'text-slate-400'}`} />
            <span className="text-[11px] sm:text-xs text-slate-500 font-medium">Sin stock</span>
          </div>
          <p className={`font-black text-2xl sm:text-3xl ${zeroStockAlerts.length > 0 ? 'text-red-700' : 'text-slate-800'}`}>
            {zeroStockAlerts.length}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">registros agotados</p>
        </div>

        <div className={`border rounded-xl p-3 sm:p-4 col-span-2 sm:col-span-1 ${lowStockAlerts.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className={`h-4 w-4 ${lowStockAlerts.length > 0 ? 'text-amber-600' : 'text-slate-400'}`} />
            <span className="text-[11px] sm:text-xs text-slate-500 font-medium">Stock bajo (1–10)</span>
          </div>
          <p className={`font-black text-2xl sm:text-3xl ${lowStockAlerts.length > 0 ? 'text-amber-700' : 'text-slate-800'}`}>
            {lowStockAlerts.length}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">registros en alerta</p>
        </div>
      </div>

      {/* ── Fila principal: gráfico + alertas ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Top 5 productos más vendidos */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            Top 5 Productos Más Vendidos
          </h3>

          {top5.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-8">Sin datos de ventas aún.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={top5} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="shortName"
                  width={110}
                  tick={{ fontSize: 10, fill: '#475569' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  formatter={(v: number) => [`${v} ventas`, 'Total']}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Bar dataKey="total_sales" radius={[0, 4, 4, 0]} maxBarSize={22}>
                  {top5.map((_, i) => (
                    <Cell key={i} fill={BAR_COLORS[i] || '#10b981'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Alertas de quiebre de stock */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            Quiebre de Stock por Sede
          </h3>

          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400">
              <div className="text-2xl mb-2">✅</div>
              <p className="text-xs text-center">Sin alertas. Todos los productos habilitados tienen stock suficiente.</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
              {alerts.map((a, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
                    a.stock === 0
                      ? 'bg-red-50 border border-red-200'
                      : 'bg-amber-50 border border-amber-100'
                  }`}
                >
                  <div className="min-w-0">
                    <p className={`font-semibold truncate ${a.stock === 0 ? 'text-red-800' : 'text-amber-900'}`}>
                      {a.productName}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate">{a.schoolName}</p>
                  </div>
                  <span className={`ml-2 shrink-0 font-black text-sm ${a.stock === 0 ? 'text-red-600' : 'text-amber-600'}`}>
                    {a.stock === 0 ? '✖ 0' : a.stock}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Consejos de IA ──────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-4 sm:p-5">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-yellow-400" />
          Consejos de Business Intelligence
        </h3>
        <div className="space-y-2.5">
          {tips.map((tip, i) => (
            <div key={i} className="bg-white/10 rounded-lg px-3 py-2.5 text-[12px] sm:text-sm text-slate-100 leading-relaxed">
              {tip}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 mt-3">
          Análisis basado en datos de ventas y stock en tiempo real.
        </p>
      </div>

    </div>
  );
}
