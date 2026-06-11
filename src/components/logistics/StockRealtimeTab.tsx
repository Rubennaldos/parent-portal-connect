import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, Search, Activity, RefreshCw, Plus, Minus, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { StockBitacoraModal } from '@/features/stock-live/components/StockBitacoraModal';
import type { StockBitacoraTarget } from '@/features/stock-live/types';

type StockRow = {
  product_id: string;
  school_id: string;
  nombre_producto: string;
  categoria: string;
  sede: string;
  stock_actual: number;
  min_stock: number;
  estado: 'Agotado' | 'Bajo Stock' | 'OK';
};

const ESTADO_OPTIONS = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'Agotado', label: 'Agotado' },
  { value: 'Bajo Stock', label: 'Bajo Stock' },
  { value: 'OK', label: 'Disponible (OK)' },
];

// Deltas pendientes por fila: key = `product_id__school_id`, value = número entero (puede ser negativo)
type DeltaMap = Record<string, number>;

export default function StockRealtimeTab() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [loadingSwitch, setLoadingSwitch] = useState(true);
  const [savingSwitch, setSavingSwitch] = useState(false);
  const [switchUnavailable, setSwitchUnavailable] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [schoolFilter, setSchoolFilter] = useState<string>('all');
  const [estadoFilter, setEstadoFilter] = useState<string>('all');
  const [deltas, setDeltas] = useState<DeltaMap>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [bitacoraOpen, setBitacoraOpen] = useState(false);
  const [bitacoraSelection, setBitacoraSelection] = useState<StockBitacoraTarget | null>(null);
  const debounceRef = useRef<number | null>(null);
  const reloadTimerRef = useRef<number | null>(null);

  const openBitacora = (r: StockRow) => {
    setBitacoraSelection({
      productId: r.product_id,
      schoolId: r.school_id,
      productName: r.nombre_producto,
      schoolName: r.sede,
    });
    setBitacoraOpen(true);
  };

  const rowKey = (r: StockRow) => `${r.product_id}__${r.school_id}`;

  const adjustDelta = (r: StockRow, dir: 1 | -1) => {
    const k = rowKey(r);
    setDeltas(prev => ({ ...prev, [k]: (prev[k] ?? 0) + dir }));
  };

  const saveAdjustment = useCallback(async (r: StockRow) => {
    const k = rowKey(r);
    const delta = deltas[k] ?? 0;
    if (delta === 0) return;

    setSavingKey(k);
    try {
      if (delta > 0) {
        const { error } = await supabase.rpc('increment_product_stock', {
          p_product_id: r.product_id,
          p_school_id:  r.school_id,
          p_quantity:   delta,
          p_reason:     'Ajuste manual de entrada desde Stock Live',
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('decrement_product_stock_with_kardex', {
          p_product_id: r.product_id,
          p_school_id:  r.school_id,
          p_quantity:   Math.abs(delta),
          p_reason:     'Ajuste manual de salida desde Stock Live',
        });
        if (error) throw error;
      }

      toast({
        title: 'Stock actualizado',
        description: `${r.nombre_producto} en ${r.sede}: ${delta > 0 ? '+' : ''}${delta} unidades guardadas.`,
      });
      setDeltas(prev => { const next = { ...prev }; delete next[k]; return next; });
      loadRows(query, estadoFilter, schoolFilter);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('STOCK_BLOQUEADO')) {
        toast({ variant: 'destructive', title: 'Stock bloqueado', description: 'No hay suficiente stock y la venta negativa está desactivada.' });
      } else {
        toast({ variant: 'destructive', title: 'Error al guardar ajuste', description: msg });
      }
    } finally {
      setSavingKey(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deltas, query, estadoFilter, schoolFilter, toast]);

  const loadRows = useCallback(async (searchText: string, estado: string, schoolId: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_live_stock_v2', {
        p_query:     searchText?.trim() || null,
        p_school_id: schoolId !== 'all' ? schoolId : null,
        p_estado:    estado !== 'all' ? estado : null,
        p_limit:     1000,
      });
      if (error) throw error;
      setRows((data || []) as StockRow[]);
    } catch (e: unknown) {
      toast({
        variant: 'destructive',
        title: 'Error cargando stock en tiempo real',
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadRows('', 'all', 'all');
  }, [loadRows]);

  const loadNegativeStockSwitch = useCallback(async () => {
    setLoadingSwitch(true);
    setSwitchUnavailable(null);

    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'allow_negative_stock')
        .maybeSingle();

      if (error) throw error;

      const enabled = Boolean(data?.value?.enabled);
      setAllowNegativeStock(enabled);
    } catch (e: any) {
      const msg = e?.message || '';

      // Si aún no aplicaron la migración Brain & Wall, no bloqueamos la pantalla.
      if (msg.toLowerCase().includes('app_settings') || msg.toLowerCase().includes('does not exist')) {
        setSwitchUnavailable('Pendiente aplicar migración de app_settings.');
      } else {
        setSwitchUnavailable('No se pudo cargar la configuración.');
      }

      toast({
        variant: 'destructive',
        title: 'No se pudo cargar el switch de stock',
        description: msg || 'Error desconocido',
      });
    } finally {
      setLoadingSwitch(false);
    }
  }, [toast]);

  useEffect(() => {
    loadNegativeStockSwitch();
  }, [loadNegativeStockSwitch]);

  const updateNegativeStockSwitch = useCallback(async (nextValue: boolean) => {
    setSavingSwitch(true);
    setSwitchUnavailable(null);

    const prevValue = allowNegativeStock;
    setAllowNegativeStock(nextValue);

    try {
      const { error } = await supabase
        .from('app_settings')
        .update({ value: { enabled: nextValue } })
        .eq('key', 'allow_negative_stock');

      if (error) throw error;

      toast({
        title: 'Switch actualizado',
        description: nextValue
          ? 'Ahora se permite stock negativo.'
          : 'Venta en negativo desactivada.',
      });
    } catch (e: any) {
      setAllowNegativeStock(prevValue);
      toast({
        variant: 'destructive',
        title: 'No se pudo guardar el switch',
        description: e?.message || 'Verifica permisos de admin_general y migración.',
      });
    } finally {
      setSavingSwitch(false);
    }
  }, [allowNegativeStock, toast]);

  // Debounce del buscador
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      loadRows(query, estadoFilter, schoolFilter);
    }, 280);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, estadoFilter, schoolFilter, loadRows]);

  // Realtime: refresco throttled cuando cambian product_stock o products
  useEffect(() => {
    const scheduleReload = () => {
      if (reloadTimerRef.current) return;
      reloadTimerRef.current = window.setTimeout(() => {
        reloadTimerRef.current = null;
        loadRows(query, estadoFilter, schoolFilter);
      }, 500);
    };

    const channel = supabase
      .channel('stock-realtime-console-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'product_stock' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, scheduleReload)
      .subscribe();

    return () => {
      if (reloadTimerRef.current) window.clearTimeout(reloadTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [loadRows, query, estadoFilter, schoolFilter]);

  // Sedes disponibles en el resultado actual (para el filtro)
  const schools = useMemo(() => {
    const seen = new Map<string, string>();
    rows.forEach(r => seen.set(r.school_id, r.sede));
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
            <Activity className="h-5 w-5 text-emerald-600" />
            Stock en Tiempo Real
          </h2>
          <p className="text-xs text-slate-400">
            Monitoreo puro (solo lectura). Actualiza en vivo con Realtime.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 bg-white">
            <Label className="text-xs text-slate-600">
              Permitir stock negativo
            </Label>
            <Switch
              checked={allowNegativeStock}
              disabled={loadingSwitch || savingSwitch || !!switchUnavailable}
              onCheckedChange={updateNegativeStockSwitch}
            />
          </div>
          <button
            onClick={() => loadRows(query, estadoFilter, schoolFilter)}
            className="text-xs border rounded-md px-2.5 py-1.5 text-slate-600 hover:bg-slate-50 inline-flex items-center gap-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Actualizar
          </button>
        </div>
      </div>

      {switchUnavailable && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
          Switch no disponible: {switchUnavailable}
        </div>
      )}

      {/* Filtros */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="relative">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por nombre, categoría o sede..."
            className="pl-9"
          />
        </div>

        <Select value={schoolFilter} onValueChange={setSchoolFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Todas las sedes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las sedes</SelectItem>
            {schools.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={estadoFilter} onValueChange={setEstadoFilter}>
          <SelectTrigger>
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            {ESTADO_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tabla */}
      <div className="border rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-14 flex items-center justify-center gap-2 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Cargando...
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center text-slate-400">
            Sin resultados para los filtros seleccionados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[820px]">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2">Producto</th>
                  <th className="text-left px-3 py-2">Categoría</th>
                  <th className="text-left px-3 py-2">Sede</th>
                  <th className="text-center px-3 py-2">Stock</th>
                  <th className="text-center px-3 py-2">Mínimo</th>
                  <th className="text-center px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const k = rowKey(r);
                  const delta = deltas[k] ?? 0;
                  const isSaving = savingKey === k;
                  const displayStock = r.stock_actual + delta;
                  return (
                    <tr
                      key={`${r.product_id}__${r.school_id}__${i}`}
                      className="border-t hover:bg-slate-50 cursor-pointer"
                      onClick={() => openBitacora(r)}
                      title="Ver bitácora de movimientos (esta sede)"
                    >
                      <td className="px-3 py-2 font-medium text-slate-700">{r.nombre_producto}</td>
                      <td className="px-3 py-2 text-slate-500">{r.categoria}</td>
                      <td className="px-3 py-2 text-slate-600">{r.sede}</td>

                      {/* Stock + controles de ajuste rápido */}
                      <td
                        className="px-3 py-2 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => adjustDelta(r, -1)}
                            disabled={isSaving}
                            className="w-5 h-5 rounded flex items-center justify-center bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 border border-red-200"
                            title="Restar 1 unidad"
                          >
                            <Minus className="h-2.5 w-2.5" />
                          </button>

                          <span className={`font-bold min-w-[2rem] text-center ${delta !== 0 ? 'text-amber-600' : 'text-slate-800'}`}>
                            {displayStock}
                            {delta !== 0 && (
                              <span className="text-[9px] text-amber-500 ml-0.5">
                                ({delta > 0 ? '+' : ''}{delta})
                              </span>
                            )}
                          </span>

                          <button
                            type="button"
                            onClick={() => adjustDelta(r, 1)}
                            disabled={isSaving}
                            className="w-5 h-5 rounded flex items-center justify-center bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 border border-emerald-200"
                            title="Sumar 1 unidad"
                          >
                            <Plus className="h-2.5 w-2.5" />
                          </button>

                          {delta !== 0 && (
                            <button
                              type="button"
                              onClick={() => saveAdjustment(r)}
                              disabled={isSaving}
                              className="w-5 h-5 rounded flex items-center justify-center bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 border border-blue-200"
                              title="Guardar ajuste"
                            >
                              {isSaving
                                ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                : <Save className="h-2.5 w-2.5" />
                              }
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="px-3 py-2 text-center text-slate-500">{r.min_stock}</td>
                      <td className="px-3 py-2 text-center">
                        {r.estado === 'Agotado' && (
                          <Badge className="bg-red-100 text-red-700 border-red-200">Agotado</Badge>
                        )}
                        {r.estado === 'Bajo Stock' && (
                          <Badge className="bg-amber-100 text-amber-800 border-amber-200">Bajo Stock</Badge>
                        )}
                        {r.estado === 'OK' && (
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">OK</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <StockBitacoraModal
        open={bitacoraOpen}
        onOpenChange={(open) => {
          setBitacoraOpen(open);
          if (!open) setBitacoraSelection(null);
        }}
        selection={bitacoraSelection}
      />
    </div>
  );
}
