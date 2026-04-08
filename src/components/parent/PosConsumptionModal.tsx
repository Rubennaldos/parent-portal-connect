/**
 * PosConsumptionModal — Estado de Cuenta de Cafetería / Kiosco
 *
 * v2: multi-select + detalle de productos + botón "Pagar selección"
 *
 * Muestra un estado de cuenta justificado:
 *  (−) Consumos en cafetería (source = 'pos')
 *  (+) Abonos y recargas previas
 *  (=) Deuda actual = Math.abs(students.balance)
 *
 * El padre puede seleccionar qué consumos pagar ahora.
 * Al presionar "Pagar selección (S/ XX.XX)", se llama onPay(totalSeleccionado).
 */
import { useEffect, useState, useMemo } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import {
  ShoppingBag,
  AlertCircle,
  TrendingDown,
  TrendingUp,
  Minus,
  CreditCard,
  CheckSquare,
  Square,
} from 'lucide-react';

interface Consumo {
  id: string;
  created_at: string;
  amount: number;
  description: string | null;
  ticket_code: string | null;
  payment_method: string | null;
  metadata: any;
  sale_items?: ProductItem[]; // productos del carrito (tabla sales.items)
}

/** Ítem de producto del carrito POS (columna sales.items) */
interface ProductItem {
  name: string;
  quantity: number;
  price?: number;
}

interface PosConsumptionModalProps {
  open: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  /** Math.abs(students.balance) — deuda oficial actual */
  kioskDebt: number;
  /** Callback cuando el padre presiona "Pagar selección" */
  onPay?: (totalSeleccionado: number) => void;
}

const Skeleton = ({ className }: { className?: string }) => (
  <div className={`animate-pulse bg-slate-100 rounded-lg ${className ?? ''}`} />
);

/**
 * Extrae un array de productos legibles desde un array JSONB de sales.items.
 * El RPC complete_pos_sale_v2 guarda cada línea con:
 *   { product_name, quantity, unit_price, subtotal, is_custom, product_id }
 */
function parseSaleItems(rawItems: any[]): ProductItem[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];
  return rawItems.map((it: any) => ({
    name:     it.product_name || it.name || it.descripcion || it.nombre || 'Producto',
    quantity: Number(it.quantity ?? it.cantidad ?? it.qty ?? 1),
    price:    it.unit_price != null ? Number(it.unit_price)
            : it.price     != null ? Number(it.price)
            : undefined,
  }));
}

export function PosConsumptionModal({
  open,
  onClose,
  studentId,
  studentName,
  kioskDebt,
  onPay,
}: PosConsumptionModalProps) {
  const [consumos, setConsumos]   = useState<Consumo[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Set de IDs seleccionados — inicia vacío; se llena al cargar
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !studentId) return;
    fetchConsumos();
  }, [open, studentId]);

  // Resetear selección al cerrar
  useEffect(() => {
    if (!open) setSelectedIds(new Set());
  }, [open]);

  const fetchConsumos = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Transacciones POS del alumno
      const { data: txData, error: txErr } = await supabase
        .from('transactions')
        .select('id, created_at, amount, description, ticket_code, payment_method, metadata')
        .eq('student_id', studentId)
        .eq('type', 'purchase')
        .filter('metadata->>source', 'eq', 'pos')
        .in('payment_status', ['paid', 'pending'])
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(300);

      if (txErr) throw txErr;

      const posOnly = (txData ?? []).filter((t: any) => !t.metadata?.lunch_order_id);

      // 2. Detalles de productos desde tabla `sales` (una query para todas)
      let salesMap: Map<string, ProductItem[]> = new Map();
      if (posOnly.length > 0) {
        const txIds = posOnly.map((t: any) => t.id);
        const { data: salesData } = await supabase
          .from('sales')
          .select('transaction_id, items')
          .in('transaction_id', txIds);

        (salesData ?? []).forEach((s: any) => {
          if (s.transaction_id && Array.isArray(s.items)) {
            salesMap.set(s.transaction_id, parseSaleItems(s.items));
          }
        });
      }

      // 3. Fusionar productos en cada consumo
      const enriched: Consumo[] = posOnly.map((t: any) => ({
        ...t,
        sale_items: salesMap.get(t.id) ?? [],
      }));

      setConsumos(enriched);
      setSelectedIds(new Set(enriched.map((c) => c.id)));
    } catch {
      setError('No se pudieron cargar los consumos. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  // ── Cálculos ────────────────────────────────────────────────────────────
  const allIds = useMemo(() => consumos.map(c => c.id), [consumos]);
  const allSelected  = selectedIds.size === allIds.length && allIds.length > 0;
  const noneSelected = selectedIds.size === 0;

  const totalConsumo = consumos.reduce((acc, c) => acc + Math.abs(c.amount), 0);

  const totalSelected = consumos
    .filter(c => selectedIds.has(c.id))
    .reduce((acc, c) => acc + Math.abs(c.amount), 0);

  const abonosHistoricos =
    totalConsumo > kioskDebt ? parseFloat((totalConsumo - kioskDebt).toFixed(2)) : 0;
  const saldoCalculado = parseFloat((totalConsumo - abonosHistoricos).toFixed(2));

  // ── Handlers ────────────────────────────────────────────────────────────
  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  };

  const firstName = studentName.split(' ')[0];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-sm w-full p-0 overflow-hidden rounded-2xl"
        aria-describedby={undefined}
      >
        {/* ── Header ── */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-5 h-5 text-rose-500" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-slate-800 leading-tight">
                Estado de Cuenta — Cafetería
              </DialogTitle>
              <p className="text-xs text-slate-400 mt-0.5">{firstName}</p>
            </div>
          </div>
        </DialogHeader>

        {/* ── Cuerpo: lista de consumos ── */}
        <div className="px-4 py-3 max-h-[48vh] overflow-y-auto space-y-1.5">
          {loading ? (
            <>{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</>
          ) : error ? (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-3">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          ) : consumos.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-slate-400">No se encontraron consumos digitales.</p>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed px-4">
                La deuda puede provenir de consumos en efectivo o períodos anteriores al sistema digital.
              </p>
            </div>
          ) : (
            <>
              {/* Encabezado de sección + Seleccionar todo */}
              <div className="flex items-center justify-between px-1 pb-1">
                <div className="flex items-center gap-1.5">
                  <TrendingDown className="w-3 h-3 text-rose-400" />
                  <p className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">
                    Consumos en cafetería
                  </p>
                </div>
                {onPay && (
                  <button
                    onClick={toggleAll}
                    className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 hover:text-emerald-600 transition-colors"
                  >
                    {allSelected
                      ? <><CheckSquare className="h-3.5 w-3.5 text-emerald-500" /> Desmarcar todo</>
                      : <><Square className="h-3.5 w-3.5" /> Seleccionar todo</>
                    }
                  </button>
                )}
              </div>

              {consumos.map((c) => {
                const source   = c.metadata?.source ?? 'pos';
                const label    = c.description
                  || (source === 'pos' ? 'Consumo en Cafetería' : `Consumo (${source})`);
                const products = c.sale_items ?? [];
                const isSelected = selectedIds.has(c.id);

                return (
                  <div
                    key={c.id}
                    onClick={() => onPay && toggleOne(c.id)}
                    className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-all duration-150 ${
                      onPay ? 'cursor-pointer' : ''
                    } ${
                      isSelected
                        ? 'bg-emerald-50/60 border-emerald-200 shadow-sm shadow-emerald-50'
                        : 'bg-slate-50/70 border-slate-100 opacity-60'
                    }`}
                  >
                    {/* Checkbox (solo cuando hay onPay) */}
                    {onPay && (
                      <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleOne(c.id)}
                          className="border-slate-300 data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                        />
                      </div>
                    )}

                    {/* Contenido */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700 truncate">{label}</p>

                      {/* Productos del carrito */}
                      {products.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {products.map((p, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[9px] font-medium text-slate-600"
                            >
                              <span className="font-bold text-slate-700">{p.quantity}×</span>
                              {p.name}
                              {p.price != null && (
                                <span className="text-slate-400 ml-0.5">S/{p.price.toFixed(2)}</span>
                              )}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-400 italic mt-0.5">
                          Detalle no disponible — consumo registrado antes del sistema digital
                        </p>
                      )}

                      <p className="text-[10px] text-slate-400 mt-1">
                        {format(new Date(c.created_at), "d MMM yyyy · HH:mm", { locale: es })}
                        {c.ticket_code && (
                          <span className="ml-1.5 text-slate-300">· {c.ticket_code}</span>
                        )}
                      </p>
                    </div>

                    <p className={`text-sm font-black shrink-0 ${isSelected ? 'text-rose-500' : 'text-slate-300'}`}>
                      −S/ {Math.abs(c.amount).toFixed(2)}
                    </p>
                  </div>
                );
              })}
            </>
          )}

          {/* ── Fila de ajuste: Abonos y Recargas Previas ── */}
          {!loading && !error && abonosHistoricos > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-2 px-1">
                <div className="h-px flex-1 bg-slate-200" />
                <Minus className="w-3 h-3 text-slate-300" />
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="flex items-center gap-1.5 px-1 pb-0.5">
                <TrendingUp className="w-3 h-3 text-emerald-500" />
                <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">
                  Abonos aplicados
                </p>
              </div>
              <div className="flex items-center gap-3 px-3 py-3 bg-emerald-50 rounded-xl border border-emerald-200">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-emerald-700">Abonos y Recargas Previas</p>
                  <p className="text-[10px] text-emerald-600 mt-0.5 leading-relaxed">
                    Pagos históricos que redujeron la deuda. Pueden incluir recargas en efectivo
                    o abonos registrados antes del sistema digital.
                  </p>
                </div>
                <p className="text-sm font-black text-emerald-600 shrink-0">
                  +S/ {abonosHistoricos.toFixed(2)}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer: cierre contable + botón de pago ── */}
        {!loading && !error && (
          <div className="px-5 pt-3 pb-5 border-t border-slate-100 bg-slate-50/60 space-y-3">

            {/* Resumen numérico */}
            {consumos.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Total consumos registrados</span>
                  <span className="font-semibold text-rose-400">−S/ {totalConsumo.toFixed(2)}</span>
                </div>
                {abonosHistoricos > 0 && (
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Abonos y recargas previas</span>
                    <span className="font-semibold text-emerald-500">+S/ {abonosHistoricos.toFixed(2)}</span>
                  </div>
                )}
                {/* Resumen de selección */}
                {onPay && !allSelected && selectedIds.size > 0 && (
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>{selectedIds.size} ítem(s) seleccionado(s)</span>
                    <span className="font-semibold text-emerald-600">−S/ {totalSelected.toFixed(2)}</span>
                  </div>
                )}
                <div className="h-px bg-slate-200" />
              </div>
            )}

            {/* Total final */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">
                  Deuda actual
                </p>
                <p className="text-[9px] text-slate-400 mt-0.5">
                  Saldo oficial de {firstName} en el sistema
                </p>
              </div>
              <p className="text-2xl font-black text-rose-500">
                S/ {kioskDebt.toFixed(2)}
              </p>
            </div>

            {/* Advertencias de integridad */}
            {consumos.length > 0 && Math.abs(saldoCalculado - kioskDebt) > 0.1 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                <p className="text-[9px] text-amber-600 leading-relaxed">
                  ⚠️ Existe una pequeña diferencia de S/ {Math.abs(saldoCalculado - kioskDebt).toFixed(2)} entre
                  el cálculo y el saldo oficial. Contacta a administración si necesitas el detalle exacto.
                </p>
              </div>
            )}
            {consumos.length === 0 && kioskDebt > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                <p className="text-[10px] font-bold text-amber-700">⚠️ Sin historial digital</p>
                <p className="text-[9px] text-amber-600 leading-relaxed mt-0.5">
                  La deuda de S/ {kioskDebt.toFixed(2)} existe pero no hay consumos digitales registrados.
                  Puede ser por consumos en efectivo o un ajuste anterior. Consulta a administración.
                </p>
              </div>
            )}

            {/* ── Botón de Pago ── */}
            {onPay && consumos.length > 0 && (
              <Button
                disabled={noneSelected}
                onClick={() => {
                  if (!noneSelected) onPay(totalSelected);
                }}
                className={`w-full rounded-xl font-bold text-sm py-3 transition-all ${
                  noneSelected
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md active:scale-95'
                }`}
              >
                <CreditCard className="w-4 h-4 mr-2 shrink-0" />
                {noneSelected
                  ? 'Selecciona al menos un consumo'
                  : allSelected
                  ? `Pagar todo — S/ ${totalSelected.toFixed(2)}`
                  : `Pagar selección — S/ ${totalSelected.toFixed(2)}`
                }
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
