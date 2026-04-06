import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, RefreshCw, AlertTriangle, Lightbulb, TrendingUp,
  PackageX, Trophy, BoxesIcon, ArrowUpDown,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface TopProduct  { name: string; shortName: string; total_sales: number }
interface AlertRow    { productName: string; schoolName: string; stock: number }
interface MovementRow {
  productId:    string;
  productName:  string;
  schoolId:     string;
  schoolName:   string;
  qtySold:      number;
  currentStock: number | null;
}
interface TopSede { name: string; qty: number }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function short(n: string, max = 18): string {
  return n.length <= max ? n : n.substring(0, max - 1) + '…';
}

/** Rango UTC que cubre el "día de hoy" en Lima (UTC−5, sin DST). */
function limaToday(): { gte: string; lt: string } {
  const now  = new Date();
  // Hora Lima = UTC − 5 h
  const lima = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const date = lima.toISOString().slice(0, 10); // "YYYY-MM-DD"
  return {
    gte: `${date}T05:00:00.000Z`,          // 00:00 Lima = 05:00 UTC
    lt:  `${date}T05:00:00.000Z`.replace(  // + 24 h
      date,
      new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    ),
  };
}

function generateTips(
  top5:       TopProduct[],
  alerts:     AlertRow[],
  topSede:    TopSede | null,
  totalVol:   number,
  movement:   MovementRow[],
): string[] {
  const tips: string[] = [];
  const topNames = new Set(top5.map(p => p.name));

  // 🚀 Sede top del día
  if (topSede && topSede.qty > 0) {
    tips.push(`🚀 ${short(topSede.name, 30)} está liderando las salidas de inventario hoy con ${topSede.qty} productos vendidos.`);
  }

  // 🔥 Top sellers sin stock
  const criticals = alerts.filter(a => topNames.has(a.productName) && a.stock === 0);
  if (criticals.length > 0) {
    const names = criticals.slice(0, 2).map(a => `"${short(a.productName, 18)}" en ${short(a.schoolName, 14)}`).join(' y ');
    tips.push(`🔥 Top vendedores AGOTADOS: ${names}. Cada venta perdida es dinero real. Reabastecer urgente.`);
  }

  // ⚡ Top sellers con stock bajo
  const lowTops = alerts.filter(a => topNames.has(a.productName) && a.stock > 0 && a.stock <= 5);
  if (lowTops.length > 0) {
    const names = lowTops.slice(0, 2).map(a => `${short(a.productName, 16)} (${a.stock} un.)`).join(', ');
    tips.push(`⚡ Top vendedores con stock crítico: ${names}. Programa reabastecimiento antes de que se agoten.`);
  }

  // 🏫 Sede con muchos agotados
  const zeroBySchool: Record<string, number> = {};
  for (const a of alerts.filter(r => r.stock === 0)) {
    zeroBySchool[a.schoolName] = (zeroBySchool[a.schoolName] || 0) + 1;
  }
  const worstSchool = Object.entries(zeroBySchool).sort((a, b) => b[1] - a[1])[0];
  if (worstSchool && worstSchool[1] >= 2) {
    tips.push(`🏫 ${worstSchool[0]} tiene ${worstSchool[1]} productos sin stock. Verifica si hay pedidos de entrada pendientes.`);
  }

  // 📦 Volumen del día
  if (totalVol > 0 && movement.length > 0) {
    const topProd = movement[0];
    tips.push(`📦 Hoy salieron ${totalVol} productos en total. El más vendido del día es "${short(topProd.productName, 22)}" con ${topProd.qtySold} unidades.`);
  }

  // 📈 Líder histórico
  if (top5[0]?.total_sales > 50) {
    tips.push(`📈 "${short(top5[0].name, 25)}" lidera histórico con ${top5[0].total_sales} ventas acumuladas. Mantenlo siempre activo en todas las sedes.`);
  }

  if (tips.length === 0) {
    tips.push('✅ Sin ventas ni alertas críticas por ahora. El inventario está estable.');
  }

  return tips;
}

const BAR_COLORS = ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5'];

function StockBadge({ stock }: { stock: number | null }) {
  if (stock === null) return <span className="text-[10px] text-slate-300">—</span>;
  if (stock === 0)    return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">✖ Agotado</span>;
  if (stock <= 5)     return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">⚠ {stock} un.</span>;
  return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">{stock} un.</span>;
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface LogisticsDashboardProps {
  userSchoolId?:     string | null;
  canViewAllSchools?: boolean;
}

export default function LogisticsDashboard({
  userSchoolId,
  canViewAllSchools = false,
}: LogisticsDashboardProps) {
  const { toast } = useToast();

  const [loadingStatic,  setLoadingStatic]  = useState(true);
  const [loadingDaily,   setLoadingDaily]   = useState(true);

  // Datos estáticos (top 5 all-time + alertas stock)
  const [top5,   setTop5]   = useState<TopProduct[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);

  // Datos del día de hoy
  const [movement,    setMovement]    = useState<MovementRow[]>([]);
  const [totalVolume, setTotalVolume] = useState(0);
  const [topSede,     setTopSede]     = useState<TopSede | null>(null);

  const [tips,     setTips]     = useState<string[]>([]);
  const [lastSync, setLastSync] = useState('');

  // Detectar si hay filtro activo de sede
  const hasSchoolFilter = !canViewAllSchools && !!userSchoolId;

  // ── Datos estáticos: top 5 + alertas stock ─────────────────────────────────

  const fetchStaticData = useCallback(async () => {
    setLoadingStatic(true);
    try {
      // Top 5 all-time — filtrado por sede si corresponde
      let top5Query = supabase
        .from('products')
        .select('id, name, total_sales')
        .eq('active', true)
        .not('total_sales', 'is', null)
        .order('total_sales', { ascending: false })
        .limit(5);
      if (hasSchoolFilter) {
        top5Query = (top5Query as any).or(`school_ids.is.null,school_ids.cs.{${userSchoolId}}`);
      }
      const { data: topData, error: topErr } = await top5Query;
      if (topErr) throw topErr;

      const top5Rows: TopProduct[] = (topData || []).map((p: any) => ({
        name:        p.name,
        shortName:   short(p.name, 18),
        total_sales: p.total_sales ?? 0,
      }));

      // Alertas stock ≤ 10 — filtrado por sede si corresponde
      let stockAlertQuery = supabase
        .from('product_stock')
        .select('product_id, school_id, current_stock')
        .eq('is_enabled', true)
        .lte('current_stock', 10)
        .order('current_stock');
      if (hasSchoolFilter) {
        stockAlertQuery = (stockAlertQuery as any).eq('school_id', userSchoolId);
      }
      const { data: lowData, error: lowErr } = await stockAlertQuery;
      if (lowErr) throw lowErr;

      const productIds = [...new Set((lowData || []).map(r => r.product_id))];
      const schoolIds  = [...new Set((lowData || []).map(r => r.school_id))];

      const [pRes, sRes] = await Promise.all([
        productIds.length ? supabase.from('products').select('id, name').in('id', productIds)
                          : Promise.resolve({ data: [] as any[] }),
        schoolIds.length  ? supabase.from('schools').select('id, name').in('id', schoolIds)
                          : Promise.resolve({ data: [] as any[] }),
      ]);

      const pMap = new Map(((pRes as any).data || []).map((p: any) => [p.id, p.name]));
      const sMap = new Map(((sRes as any).data || []).map((s: any) => [s.id, s.name]));

      const alertRows: AlertRow[] = (lowData || []).map(r => ({
        productName: pMap.get(r.product_id) || '?',
        schoolName:  sMap.get(r.school_id)  || '?',
        stock:       r.current_stock,
      }));

      setTop5(top5Rows);
      setAlerts(alertRows);
      return top5Rows;
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error cargando datos estáticos', description: err.message });
      return [];
    } finally {
      setLoadingStatic(false);
    }
  }, [toast, hasSchoolFilter, userSchoolId]);

  // ── Movimiento del día ──────────────────────────────────────────────────────

  const fetchDailyMovement = useCallback(async () => {
    setLoadingDaily(true);
    try {
      const { gte, lt } = limaToday();

      // 1. Transacciones de compra de hoy — FILTRADO POR SEDE cuando aplica
      //    Esto evita el 400 Bad Request por URL demasiado larga en el .in() de abajo
      let txQuery = supabase
        .from('transactions')
        .select('id, school_id')
        .eq('type', 'purchase')
        .neq('payment_status', 'cancelled')
        .gte('created_at', gte)
        .lt('created_at', lt)
        .limit(500); // guardia de seguridad
      if (hasSchoolFilter) {
        txQuery = (txQuery as any).eq('school_id', userSchoolId);
      }
      const { data: txs, error: txErr } = await txQuery;
      if (txErr) throw txErr;

      if (!txs || txs.length === 0) {
        setMovement([]);
        setTotalVolume(0);
        setTopSede(null);
        return [];
      }

      const txIds        = txs.map((t: any) => t.id);
      const schoolByTxId = new Map(txs.map((t: any) => [t.id, t.school_id as string]));
      const allSchoolIds = [...new Set(txs.map((t: any) => t.school_id).filter(Boolean) as string[])];

      // 2. Items de esas transacciones — chunked para evitar URLs largas
      const CHUNK = 200;
      let allItems: any[] = [];
      for (let i = 0; i < txIds.length; i += CHUNK) {
        const chunk = txIds.slice(i, i + CHUNK);
        const { data: chunkItems, error: chunkErr } = await supabase
          .from('transaction_items')
          .select('transaction_id, product_id, product_name, quantity')
          .in('transaction_id', chunk);
        if (chunkErr) throw chunkErr;
        allItems = allItems.concat(chunkItems || []);
      }
      const items = allItems;

      if (!items || items.length === 0) {
        setMovement([]);
        setTotalVolume(0);
        setTopSede(null);
        return [];
      }

      const productIds = [...new Set(items.map((i: any) => i.product_id).filter(Boolean) as string[])];

      // 3. Nombres de sedes
      const { data: schools } = await supabase
        .from('schools')
        .select('id, name')
        .in('id', allSchoolIds);
      const schoolNameMap = new Map((schools || []).map(s => [s.id, s.name]));

      // 4. Stock actual por producto × sede
      const stockMap = new Map<string, Map<string, number>>();
      if (productIds.length && allSchoolIds.length) {
        const { data: stockRows } = await supabase
          .from('product_stock')
          .select('product_id, school_id, current_stock')
          .in('product_id', productIds)
          .in('school_id', allSchoolIds);
        for (const row of stockRows || []) {
          if (!stockMap.has(row.product_id)) stockMap.set(row.product_id, new Map());
          stockMap.get(row.product_id)!.set(row.school_id, row.current_stock);
        }
      }

      // 5. Agrupar por producto × sede
      const rowMap = new Map<string, MovementRow>();
      for (const item of items) {
        const schoolId = schoolByTxId.get(item.transaction_id) || '';
        const key = `${item.product_id ?? item.product_name}__${schoolId}`;
        if (!rowMap.has(key)) {
          rowMap.set(key, {
            productId:    item.product_id ?? '',
            productName:  item.product_name,
            schoolId,
            schoolName:   schoolNameMap.get(schoolId) || '—',
            qtySold:      0,
            currentStock: stockMap.get(item.product_id)?.get(schoolId) ?? null,
          });
        }
        rowMap.get(key)!.qtySold += item.quantity;
      }

      const rows = [...rowMap.values()].sort((a, b) => b.qtySold - a.qtySold);

      // 6. KPIs agregados
      const totalVol = rows.reduce((s, r) => s + r.qtySold, 0);

      const volBySchool = new Map<string, { name: string; qty: number }>();
      for (const r of rows) {
        const cur = volBySchool.get(r.schoolId) || { name: r.schoolName, qty: 0 };
        cur.qty += r.qtySold;
        volBySchool.set(r.schoolId, cur);
      }
      const topSedeVal = [...volBySchool.values()].sort((a, b) => b.qty - a.qty)[0] || null;

      setMovement(rows);
      setTotalVolume(totalVol);
      setTopSede(topSedeVal);
      return rows;
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error cargando movimiento diario', description: err.message });
      return [];
    } finally {
      setLoadingDaily(false);
    }
  }, [toast, hasSchoolFilter, userSchoolId]);

  // ── Carga inicial ──────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    const [top5Rows, movRows] = await Promise.all([fetchStaticData(), fetchDailyMovement()]);

    // Actualizar tips con todos los datos disponibles
    setAlerts(prev => {
      setTips(generateTips(top5Rows as TopProduct[], prev, topSede, totalVolume, movRows as MovementRow[]));
      return prev;
    });

    setLastSync(new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }));
  }, [fetchStaticData, fetchDailyMovement, topSede, totalVolume]);

  useEffect(() => {
    fetchStaticData();
    fetchDailyMovement();
    setLastSync(new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Regenerar tips cuando cambien los datos
  useEffect(() => {
    if (!loadingStatic && !loadingDaily) {
      setTips(generateTips(top5, alerts, topSede, totalVolume, movement));
    }
  }, [top5, alerts, topSede, totalVolume, movement, loadingStatic, loadingDaily]);

  const handleRefresh = async () => {
    await Promise.all([fetchStaticData(), fetchDailyMovement()]);
    setLastSync(new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }));
  };

  // ─── Datos derivados ────────────────────────────────────────────────────────

  const zeroStockAlerts = alerts.filter(a => a.stock === 0);
  const lowStockAlerts  = alerts.filter(a => a.stock > 0);
  const isLoading       = loadingStatic || loadingDaily;

  // ─── UI ─────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 sm:space-y-5">

      {/* ── Cabecera ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-black text-slate-800 flex items-center gap-2">
            <BoxesIcon className="h-5 w-5 text-emerald-600" />
            Centro de Control Diario
          </h2>
          <p className="text-[11px] text-slate-400">
            Movimiento de mercadería · Hoy ·{' '}
            {isLoading ? 'Actualizando…' : `Sync ${lastSync}`}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">Actualizar</span>
        </button>
      </div>

      {/* ── 4 KPI Cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

        {/* 🏆 Sede Top del día */}
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-xl p-3 sm:p-4 text-white col-span-1">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Trophy className="h-4 w-4 text-yellow-300" />
            <span className="text-[10px] sm:text-xs font-semibold text-emerald-100">Sede Top Hoy</span>
          </div>
          {loadingDaily ? (
            <Loader2 className="h-5 w-5 animate-spin text-emerald-200 mt-1" />
          ) : topSede ? (
            <>
              <p className="font-black text-sm sm:text-base leading-tight line-clamp-2">{topSede.name}</p>
              <p className="text-[11px] text-emerald-200 mt-0.5 font-medium">{topSede.qty} productos</p>
            </>
          ) : (
            <p className="text-sm font-medium text-emerald-200 mt-1">Sin ventas hoy</p>
          )}
        </div>

        {/* 📦 Volumen total de salidas */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <ArrowUpDown className="h-4 w-4 text-blue-600" />
            <span className="text-[10px] sm:text-xs font-semibold text-slate-500">Salidas Hoy</span>
          </div>
          {loadingDaily ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-300 mt-1" />
          ) : (
            <>
              <p className="font-black text-2xl sm:text-3xl text-slate-800">{totalVolume}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">unidades vendidas</p>
            </>
          )}
        </div>

        {/* 🚨 Sin Stock */}
        <div className={`rounded-xl p-3 sm:p-4 border ${
          zeroStockAlerts.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'
        }`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <PackageX className={`h-4 w-4 ${zeroStockAlerts.length > 0 ? 'text-red-600' : 'text-slate-400'}`} />
            <span className="text-[10px] sm:text-xs font-semibold text-slate-500">Sin Stock</span>
          </div>
          {loadingStatic ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-300 mt-1" />
          ) : (
            <>
              <p className={`font-black text-2xl sm:text-3xl ${zeroStockAlerts.length > 0 ? 'text-red-700' : 'text-slate-800'}`}>
                {zeroStockAlerts.length}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">registros agotados</p>
            </>
          )}
        </div>

        {/* ⚠️ Stock Bajo */}
        <div className={`rounded-xl p-3 sm:p-4 border ${
          lowStockAlerts.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'
        }`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle className={`h-4 w-4 ${lowStockAlerts.length > 0 ? 'text-amber-600' : 'text-slate-400'}`} />
            <span className="text-[10px] sm:text-xs font-semibold text-slate-500">Stock Bajo (1–10)</span>
          </div>
          {loadingStatic ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-300 mt-1" />
          ) : (
            <>
              <p className={`font-black text-2xl sm:text-3xl ${lowStockAlerts.length > 0 ? 'text-amber-700' : 'text-slate-800'}`}>
                {lowStockAlerts.length}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">registros en alerta</p>
            </>
          )}
        </div>

      </div>

      {/* ── Gráfico top 5 + Alertas stock ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Top 5 all-time */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            Top 5 Productos Más Vendidos (histórico)
          </h3>
          {loadingStatic ? (
            <div className="flex items-center justify-center h-[180px]">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
            </div>
          ) : top5.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-10">Sin datos de ventas.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={top5} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="shortName" width={115} tick={{ fontSize: 10, fill: '#475569' }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(v: number) => [`${v} ventas`, 'Total acumulado']}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
                <Bar dataKey="total_sales" radius={[0, 4, 4, 0]} maxBarSize={24}>
                  {top5.map((_, i) => <Cell key={i} fill={BAR_COLORS[i] || '#10b981'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Alertas de quiebre */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            Quiebre de Stock por Sede
          </h3>
          {loadingStatic ? (
            <div className="flex items-center justify-center h-[180px]">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
              <div className="text-3xl">✅</div>
              <p className="text-xs text-center">Sin alertas. Inventario saludable.</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
              {alerts.map((a, i) => (
                <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
                  a.stock === 0 ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-100'
                }`}>
                  <div className="min-w-0">
                    <p className={`font-semibold truncate ${a.stock === 0 ? 'text-red-800' : 'text-amber-900'}`}>
                      {a.productName}
                    </p>
                    <p className="text-[10px] text-slate-500">{a.schoolName}</p>
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

      {/* ── Tabla: Detalle de Salidas de Hoy ────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
            <ArrowUpDown className="h-4 w-4 text-blue-600" />
            Detalle de Salidas de Hoy
          </h3>
          {!loadingDaily && (
            <span className="text-[10px] text-slate-400">
              {movement.length} registros · {totalVolume} unidades
            </span>
          )}
        </div>

        {loadingDaily ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-300 mr-2" />
            <span className="text-xs text-slate-400">Cargando movimiento del día…</span>
          </div>
        ) : movement.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-slate-400 gap-2">
            <div className="text-4xl">📭</div>
            <p className="text-sm font-medium">Sin salidas registradas hoy</p>
            <p className="text-xs text-slate-300">Las ventas del POS aparecerán aquí en tiempo real.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[500px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">#</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Producto</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-slate-600">Cant. Vendida</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-slate-600">Sede</th>
                  <th className="text-center px-4 py-2.5 font-semibold text-slate-600">Stock Actual</th>
                </tr>
              </thead>
              <tbody>
                {movement.map((row, i) => (
                  <tr
                    key={`${row.productId}__${row.schoolId}__${i}`}
                    className={`border-b border-slate-50 transition-colors hover:bg-slate-50 ${
                      i === 0 ? 'bg-emerald-50/60' : ''
                    }`}
                  >
                    <td className="px-4 py-2.5 text-slate-400 font-mono">{i + 1}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {i === 0 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 shrink-0">
                            🥇 Top
                          </span>
                        )}
                        <span className="font-medium text-slate-800 truncate max-w-[200px]" title={row.productName}>
                          {row.productName}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="font-black text-blue-700 text-sm">{row.qtySold}</span>
                      <span className="text-slate-400 ml-0.5">un.</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 truncate max-w-[150px]" title={row.schoolName}>
                      {row.schoolName}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <StockBadge stock={row.currentStock} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Consejos de BI ──────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-4 sm:p-5">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-yellow-400" />
          Consejos de Business Intelligence
        </h3>
        {(loadingStatic || loadingDaily) ? (
          <div className="flex items-center gap-2 text-slate-400 text-xs py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Analizando datos…
          </div>
        ) : (
          <div className="space-y-2.5">
            {tips.map((tip, i) => (
              <div key={i} className="bg-white/10 rounded-lg px-3 py-2.5 text-[12px] sm:text-sm text-slate-100 leading-relaxed">
                {tip}
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-slate-500 mt-3">
          Análisis automático basado en ventas y stock en tiempo real.
        </p>
      </div>

    </div>
  );
}
