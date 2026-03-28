import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Loader2, RefreshCw, BadgeCheck, AlertTriangle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  is_verified: boolean;
}

interface School {
  id: string;
  name: string;
}

interface StockCell {
  stock: number;
  enabled: boolean;
  /** true mientras se está guardando esta celda */
  saving: boolean;
}

/** stockMatrix[productId][schoolId] */
type StockMatrix = Record<string, Record<string, StockCell>>;

// ─── Helper: celda vacía por defecto ─────────────────────────────────────────

const emptyCell = (): StockCell => ({ stock: 0, enabled: false, saving: false });

// ─── Abreviar nombre de sede para la cabecera ─────────────────────────────────

function abrevSede(name: string): string {
  // Máximo 14 chars; si hay guión o coma, usar solo la primera parte
  const clean = name.split(/[,\-–]/)[0].trim();
  return clean.length <= 14 ? clean : clean.substring(0, 13) + '…';
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function InventoryMatrixView() {
  const { toast } = useToast();

  const [loading, setLoading]     = useState(true);
  const [products, setProducts]   = useState<Product[]>([]);
  const [schools, setSchools]     = useState<School[]>([]);
  const [matrix, setMatrix]       = useState<StockMatrix>({});

  // Input local mientras el cajero tipea (antes del onBlur)
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  // Ref para evitar guardar si el valor no cambió
  const prevStockRef = useRef<Record<string, number>>({});

  // ── Carga inicial ──────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Sedes activas
      const { data: schoolsData, error: schoolsErr } = await supabase
        .from('schools')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (schoolsErr) throw schoolsErr;

      // 2. Productos activos (sin archivados, sin absorbidos)
      //    is_verified = true → Producto Maestro (fila verde)
      const { data: productsData, error: productsErr } = await supabase
        .from('products')
        .select('id, name, is_verified')
        .eq('active', true)
        .order('name');
      if (productsErr) throw productsErr;

      const scs  = (schoolsData  || []) as School[];
      const prds = (productsData || []) as Product[];

      // 3. Stock matrix
      const schoolIds  = scs.map(s => s.id);
      const productIds = prds.map(p => p.id);

      let stockRows: { product_id: string; school_id: string; current_stock: number; is_enabled: boolean }[] = [];

      if (schoolIds.length && productIds.length) {
        const { data: stockData, error: stockErr } = await supabase
          .from('product_stock')
          .select('product_id, school_id, current_stock, is_enabled')
          .in('school_id', schoolIds)
          .in('product_id', productIds);
        if (stockErr) throw stockErr;
        stockRows = (stockData || []) as typeof stockRows;
      }

      // 4. Construir la matriz y los inputs locales
      const mat: StockMatrix = {};
      const inputs: Record<string, string> = {};
      const prevStocks: Record<string, number> = {};

      for (const p of prds) {
        mat[p.id] = {};
        for (const s of scs) {
          mat[p.id][s.id] = emptyCell();
        }
      }

      for (const row of stockRows) {
        if (mat[row.product_id]?.[row.school_id] !== undefined) {
          mat[row.product_id][row.school_id] = {
            stock:   row.current_stock,
            enabled: row.is_enabled ?? true,
            saving:  false,
          };
          const key = `${row.product_id}__${row.school_id}`;
          inputs[key]     = String(row.current_stock);
          prevStocks[key] = row.current_stock;
        }
      }

      setSchools(scs);
      setProducts(prds);
      setMatrix(mat);
      setInputValues(inputs);
      prevStockRef.current = prevStocks;
    } catch (err: any) {
      console.error('[InventoryMatrix] loadData error:', err);
      toast({ variant: 'destructive', title: 'Error cargando inventario', description: err.message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Upsert stock ──────────────────────────────────────────────────────────

  const upsertCell = async (
    productId: string,
    schoolId: string,
    patch: Partial<{ current_stock: number; is_enabled: boolean }>,
  ) => {
    setMatrix(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        [schoolId]: { ...prev[productId][schoolId], saving: true },
      },
    }));

    const { error } = await supabase
      .from('product_stock')
      .upsert(
        {
          product_id:    productId,
          school_id:     schoolId,
          current_stock: patch.current_stock ?? matrix[productId]?.[schoolId]?.stock ?? 0,
          is_enabled:    patch.is_enabled    ?? matrix[productId]?.[schoolId]?.enabled ?? false,
          last_updated:  new Date().toISOString(),
        },
        { onConflict: 'product_id,school_id' },
      );

    if (error) {
      toast({ variant: 'destructive', title: 'No se pudo guardar', description: error.message });
      // Revertir estado visual
      setMatrix(prev => ({
        ...prev,
        [productId]: {
          ...prev[productId],
          [schoolId]: { ...prev[productId][schoolId], saving: false },
        },
      }));
      return;
    }

    // Actualizar estado local con los nuevos valores
    setMatrix(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        [schoolId]: {
          ...prev[productId][schoolId],
          ...patch,
          saving: false,
        },
      },
    }));
  };

  // ── Handler: input pierde foco (guarda solo si cambió) ───────────────────

  const handleStockBlur = (productId: string, schoolId: string) => {
    const key     = `${productId}__${schoolId}`;
    const raw     = (inputValues[key] ?? '').replace(',', '.');
    const newStock = Math.max(0, parseFloat(raw) || 0);
    const prev    = prevStockRef.current[key] ?? 0;

    // Normalizar el input a número limpio
    setInputValues(v => ({ ...v, [key]: String(newStock) }));

    if (newStock === prev) return; // Sin cambio, no guardar

    prevStockRef.current[key] = newStock;

    // Actualizar también el estado de la matriz
    setMatrix(prev2 => ({
      ...prev2,
      [productId]: {
        ...prev2[productId],
        [schoolId]: { ...prev2[productId][schoolId], stock: newStock },
      },
    }));

    upsertCell(productId, schoolId, { current_stock: newStock });
  };

  // ── Handler: toggle activar/desactivar ───────────────────────────────────

  const handleToggle = (productId: string, schoolId: string, enabled: boolean) => {
    setMatrix(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        [schoolId]: { ...prev[productId][schoolId], enabled },
      },
    }));
    upsertCell(productId, schoolId, { is_enabled: enabled });
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[#8B4513] mr-3" />
        <span className="text-slate-500 font-medium">Cargando matriz de inventario…</span>
      </div>
    );
  }

  if (schools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-400">
        <AlertTriangle className="h-10 w-10" />
        <p>No hay sedes activas. Activa al menos una sede para ver el inventario.</p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-slate-400">
        <AlertTriangle className="h-10 w-10" />
        <p>No hay productos activos. Los productos archivados o absorbidos se ocultan aquí.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">

      {/* ── Cabecera + acciones ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-black text-slate-800">Inventario por Sedes</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {products.length} productos · {schools.length} sedes ·{' '}
            <span className="text-green-700 font-semibold">
              {products.filter(p => p.is_verified).length} maestros
            </span>{' '}
            · Edita y presiona Tab para avanzar como en Excel
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={loadData} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Actualizar
        </Button>
      </div>

      {/* ── Leyenda ── */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-green-100 border border-green-300" />
          Producto Maestro (verificado)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-white border border-slate-200" />
          Producto estándar
        </span>
        <span className="flex items-center gap-1 ml-auto italic">
          Toggle = activo en esa sede · Input = stock actual
        </span>
      </div>

      {/* ── Tabla pivot ── */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
        <table className="w-full text-xs border-collapse min-w-max">

          {/* Cabecera: sedes */}
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="sticky left-0 z-20 bg-slate-800 text-left px-3 py-2.5 font-bold min-w-[180px] max-w-[220px] border-r border-slate-600">
                Producto
              </th>
              {schools.map(s => (
                <th
                  key={s.id}
                  className="px-2 py-2.5 font-semibold text-center min-w-[110px] border-l border-slate-600 whitespace-nowrap"
                  title={s.name}
                >
                  {abrevSede(s.name)}
                </th>
              ))}
            </tr>
          </thead>

          {/* Filas: productos */}
          <tbody>
            {products.map((product, idx) => {
              const isMaster = product.is_verified;
              const rowBg = isMaster
                ? 'bg-green-50 hover:bg-green-100'
                : idx % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50 hover:bg-slate-100';

              return (
                <tr key={product.id} className={`${rowBg} border-t border-slate-200 transition-colors`}>

                  {/* Columna fija: nombre del producto */}
                  <td className={`sticky left-0 z-10 px-3 py-1.5 font-medium border-r border-slate-200 max-w-[220px] ${
                    isMaster ? 'bg-green-50' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                  }`}>
                    <div className="flex items-center gap-1.5 truncate">
                      {isMaster && (
                        <BadgeCheck className="h-3.5 w-3.5 text-green-600 shrink-0" title="Producto Maestro" />
                      )}
                      <span className="truncate" title={product.name}>{product.name}</span>
                    </div>
                  </td>

                  {/* Celdas: una por sede */}
                  {schools.map(school => {
                    const cell = matrix[product.id]?.[school.id] ?? emptyCell();
                    const key  = `${product.id}__${school.id}`;
                    const inputVal = inputValues[key] ?? String(cell.stock);

                    return (
                      <td
                        key={school.id}
                        className={`px-2 py-1.5 border-l border-slate-200 text-center align-middle ${
                          cell.saving ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex flex-col items-center gap-1">

                          {/* Input de cantidad — estilo Excel */}
                          <input
                            type="text"
                            inputMode="numeric"
                            value={inputVal}
                            disabled={!cell.enabled || cell.saving}
                            onChange={(e) => {
                              const clean = e.target.value.replace(/[^0-9]/g, '');
                              setInputValues(v => ({ ...v, [key]: clean }));
                            }}
                            onFocus={(e) => e.target.select()}
                            onBlur={() => handleStockBlur(product.id, school.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            }}
                            className={`w-14 h-7 text-center text-xs font-bold rounded border transition-colors
                              ${!cell.enabled
                                ? 'bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed'
                                : cell.stock === 0
                                  ? 'bg-red-50 border-red-300 text-red-700 focus:border-red-500 focus:outline-none'
                                  : cell.stock <= 5
                                    ? 'bg-amber-50 border-amber-300 text-amber-800 focus:border-amber-500 focus:outline-none'
                                    : 'bg-white border-slate-300 text-slate-800 focus:border-blue-500 focus:outline-none'
                              }`
                            }
                          />

                          {/* Switch de activación */}
                          <Switch
                            checked={cell.enabled}
                            disabled={cell.saving}
                            onCheckedChange={(checked) => handleToggle(product.id, school.id, checked)}
                            className="scale-75 data-[state=checked]:bg-green-600"
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>

          {/* Footer con totales por sede */}
          <tfoot>
            <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
              <td className="sticky left-0 z-10 bg-slate-100 px-3 py-2 text-xs text-slate-600 border-r border-slate-300">
                Total activos / stock
              </td>
              {schools.map(school => {
                const activeCount = products.filter(p => matrix[p.id]?.[school.id]?.enabled).length;
                const totalStock  = products.reduce((sum, p) => sum + (matrix[p.id]?.[school.id]?.stock ?? 0), 0);
                return (
                  <td key={school.id} className="px-2 py-2 text-center border-l border-slate-300">
                    <div className="text-[10px] text-slate-500 leading-tight">
                      <div className="font-bold text-green-700">{activeCount} act.</div>
                      <div className="text-slate-500">{totalStock} un.</div>
                    </div>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Guía de colores del input ── */}
      <div className="flex gap-4 text-[10px] text-slate-400 pt-1">
        <span className="flex items-center gap-1">
          <span className="inline-block w-5 h-3 rounded bg-red-50 border border-red-300" /> Stock 0
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-5 h-3 rounded bg-amber-50 border border-amber-300" /> Stock ≤ 5
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-5 h-3 rounded bg-white border border-slate-300" /> Stock normal
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-5 h-3 rounded bg-slate-100 border border-slate-200" /> Desactivado
        </span>
      </div>
    </div>
  );
}
