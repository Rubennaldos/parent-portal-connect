// EmitirComprobanteModal.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Modal de emisión manual de Boleta o Factura con soporte de múltiples ítems.
// Reutiliza el edge-function 'generate-document' probado en producción.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Loader2, FileText, Receipt, Search, AlertCircle,
  ExternalLink, CheckCircle2, Plus, Trash2,
} from 'lucide-react';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type TipoComprobante = 'boleta' | 'factura';
type TipoDoc        = 'sin_documento' | 'dni' | 'ruc';

interface LineItem {
  id:          string;
  descripcion: string;
  cantidad:    string;  // string para inputs controlados
  precioUnit:  string;  // string para inputs controlados
}

export interface TransaccionParaEmitir {
  id:           string;
  amount:       number;
  description?: string | null;
  school_id?:   string | null;
  ticket_code?: string | null;
}

interface Props {
  open:        boolean;
  onClose:     () => void;
  transaction: TransaccionParaEmitir;
  onSuccess?:  (invoiceId: string, pdfUrl: string | null) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function newItem(): LineItem {
  return { id: crypto.randomUUID(), descripcion: '', cantidad: '1', precioUnit: '' };
}

/** Parsea un string numérico con coma o punto → número */
function parseNum(s: string): number {
  return parseFloat(s.replace(',', '.')) || 0;
}

/** Total de una fila */
function rowTotal(item: LineItem): number {
  return Math.round(parseNum(item.cantidad) * parseNum(item.precioUnit) * 100) / 100;
}

/** Hoy en Lima (UTC-5) → 'YYYY-MM-DD' */
function hoyLima(): string {
  const d = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0];
}

/**
 * Construye el array de ítems para Nubefact a partir de cada LineItem.
 * Para modo normal (una sola transacción) conserva el helper original.
 */
function buildNubefactItems(items: LineItem[], igvPct: number) {
  return items.map((item) => {
    const total       = rowTotal(item);
    const totalCents  = Math.round(total * 100);
    const divisorX100 = 100 + igvPct;
    const baseCents   = Math.floor(totalCents * 100 / divisorX100);
    const igvCents    = totalCents - baseCents;
    const base        = baseCents / 100;
    const igv         = igvCents  / 100;
    const qty         = parseNum(item.cantidad);
    const unitPrice   = parseNum(item.precioUnit);

    return {
      unidad_de_medida:        'NIU',
      codigo:                  'SERV',
      descripcion:             item.descripcion.trim() || 'Servicio',
      cantidad:                qty,
      valor_unitario:          Math.round((base / qty) * 100) / 100,
      precio_unitario:         unitPrice,
      descuento:               '',
      subtotal:                base,
      tipo_de_igv:             1,
      igv,
      total,
      anticipo_regularizacion: false,
    };
  });
}

// ── Componente ────────────────────────────────────────────────────────────────

export function EmitirComprobanteModal({ open, onClose, transaction, onSuccess }: Props) {
  const { toast } = useToast();

  // Modo manual: sin transacción real
  const isManualMode = !transaction.id || transaction.amount === 0;

  // ── Datos del cliente ──────────────────────────────────────────────────────
  const [tipo,      setTipo]      = useState<TipoComprobante>('boleta');
  const [docType,   setDocType]   = useState<TipoDoc>('sin_documento');
  const [docNumber, setDocNumber] = useState('');
  const [nombre,    setNombre]    = useState('');
  const [direccion, setDireccion] = useState('');
  const [email,     setEmail]     = useState('');

  // ── Ítems (solo modo manual) ───────────────────────────────────────────────
  const [items, setItems] = useState<LineItem[]>([newItem()]);

  // ── Config y UI ───────────────────────────────────────────────────────────
  const [igvPct,     setIgvPct]     = useState(18);
  const [loading,    setLoading]    = useState(false);
  const [searching,  setSearching]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [pdfEmitido, setPdfEmitido] = useState<string | null>(null);

  // ── Calculos derivados ─────────────────────────────────────────────────────
  const subtotalBruto = isManualMode
    ? items.reduce((s, item) => s + rowTotal(item), 0)
    : Math.abs(transaction.amount);

  const igvMonto  = Math.round((subtotalBruto - subtotalBruto / (1 + igvPct / 100)) * 100) / 100;
  const baseImpon = Math.round((subtotalBruto / (1 + igvPct / 100)) * 100) / 100;
  const totalFinal = Math.round(subtotalBruto * 100) / 100;

  // ── Reset al abrir ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    setTipo('boleta');
    setDocType('sin_documento');
    setDocNumber('');
    setNombre('');
    setDireccion('');
    setEmail('');
    setItems([newItem()]);
    setError(null);
    setPdfEmitido(null);

    if (transaction.school_id) {
      supabase
        .from('billing_config')
        .select('igv_porcentaje')
        .eq('school_id', transaction.school_id)
        .single()
        .then(({ data }) => setIgvPct(Number(data?.igv_porcentaje ?? 18)));
    }
  }, [open, transaction.school_id]);

  // Factura siempre requiere RUC
  useEffect(() => {
    if (tipo === 'boleta') {
      if (docType === 'ruc') setDocType('sin_documento');
    } else {
      setDocType('ruc');
    }
  }, [tipo]);

  // ── Gestión de ítems ───────────────────────────────────────────────────────
  const updateItem = useCallback((id: string, field: keyof LineItem, value: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  }, []);

  const addItem = () => setItems(prev => [...prev, newItem()]);

  const removeItem = (id: string) => {
    setItems(prev => prev.length > 1 ? prev.filter(i => i.id !== id) : prev);
  };

  // ── Búsqueda RENIEC / SUNAT ────────────────────────────────────────────────
  const handleBuscar = async () => {
    if (!docNumber || docType === 'sin_documento') return;
    setSearching(true);
    setError(null);
    try {
      const res  = await fetch('/api/consult-dni', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tipo: docType, numero: docNumber }),
      });
      const data: Record<string, any> = await res.json();
      if (data.success) {
        setNombre(data.razon_social || data.nombre || '');
        if (data.direccion) setDireccion(data.direccion);
      } else {
        toast({
          variant:     'destructive',
          title:       `${docType.toUpperCase()} no encontrado`,
          description: data.error || 'No se encontró en SUNAT/RENIEC.',
        });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error de búsqueda', description: 'No se pudo consultar SUNAT/RENIEC.' });
    } finally {
      setSearching(false);
    }
  };

  // ── Validaciones ───────────────────────────────────────────────────────────
  const validar = (): string | null => {
    if (isManualMode) {
      if (items.every(i => !i.descripcion.trim()))
        return 'Al menos un ítem debe tener descripción.';
      if (items.some(i => parseNum(i.cantidad) <= 0))
        return 'La cantidad de todos los ítems debe ser mayor a 0.';
      if (items.some(i => parseNum(i.precioUnit) <= 0))
        return 'El precio de todos los ítems debe ser mayor a 0.';
      if (totalFinal <= 0)
        return 'El total debe ser mayor a 0.';
    }
    if (docType === 'dni' && docNumber.replace(/\D/g, '').length !== 8)
      return 'El DNI debe tener exactamente 8 dígitos.';
    if (docType === 'ruc' && docNumber.replace(/\D/g, '').length !== 11)
      return 'El RUC debe tener exactamente 11 dígitos.';
    if (!nombre.trim())
      return 'El nombre / razón social es obligatorio.';
    if (tipo === 'factura' && !direccion.trim())
      return 'La dirección fiscal es obligatoria para facturas.';
    return null;
  };

  // ── Generar comprobante ────────────────────────────────────────────────────
  const handleGenerar = async () => {
    const err = validar();
    if (err) { setError(err); return; }

    setLoading(true);
    setError(null);

    try {
      // Construir los items para Nubefact
      let nubefactItems;
      let montoTotal: number;

      if (isManualMode) {
        nubefactItems = buildNubefactItems(items, igvPct);
        montoTotal    = totalFinal;
      } else {
        // Modo normal: una sola línea con los datos de la transacción
        const monto      = Math.round(Math.abs(transaction.amount) * 100) / 100;
        const descripcion = (transaction.description || `Ticket ${transaction.ticket_code ?? ''}`.trim() || 'Consumo').slice(0, 200);
        const tCents     = Math.round(monto * 100);
        const div100     = 100 + igvPct;
        const baseCents  = Math.floor(tCents * 100 / div100);
        const igvCents   = tCents - baseCents;
        nubefactItems    = [{
          unidad_de_medida:        'NIU',
          codigo:                  'SERV',
          descripcion,
          cantidad:                1,
          valor_unitario:          baseCents / 100,
          precio_unitario:         monto,
          descuento:               '',
          subtotal:                baseCents / 100,
          tipo_de_igv:             1,
          igv:                     igvCents / 100,
          total:                   monto,
          anticipo_regularizacion: false,
        }];
        montoTotal = monto;
      }

      const tipoNubefact = tipo === 'factura' ? 1 : 2;

      const { data: result, error: fnErr } = await supabase.functions.invoke('generate-document', {
        body: {
          school_id:      transaction.school_id ?? '',
          tipo:           tipoNubefact,
          emission_date:  hoyLima(),
          cliente: {
            doc_type:     docType === 'sin_documento' ? '-' : docType,
            doc_number:   docType !== 'sin_documento' ? docNumber.replace(/\D/g, '') : '-',
            razon_social: nombre.trim() || 'Consumidor Final',
            direccion:    direccion.trim() || '-',
            ...(email.trim() ? { email: email.trim() } : {}),
          },
          items:          nubefactItems,
          monto_total:    montoTotal,
          payment_method: 'manual',
        },
      });

      if (fnErr) throw new Error(fnErr.message || 'Error en la Edge Function');
      if (!result?.success) {
        throw new Error(
          result?.error ||
          result?.nubefact?.errors ||
          'Nubefact rechazó el comprobante. Verifica los datos del cliente.',
        );
      }
      if (!result.documento?.id) {
        throw new Error('Nubefact respondió OK pero sin ID. Intenta de nuevo.');
      }

      const invoiceId = result.documento.id as string;
      const pdfUrl: string | null =
        result.documento?.enlace_pdf ?? result.nubefact?.enlace_del_pdf ?? null;

      // Solo actualizar BD si hay transacción real
      if (!isManualMode) {
        await supabase
          .from('transactions')
          .update({
            billing_status:         'sent',
            invoice_id:             invoiceId,
            document_type:          tipo,
            invoice_client_name:    nombre.trim() || null,
            invoice_client_dni_ruc: docType !== 'sin_documento' ? docNumber.replace(/\D/g, '') : null,
          })
          .eq('id', transaction.id);
      }

      let finalPdfUrl = pdfUrl;
      if (!finalPdfUrl) {
        const { data: inv } = await supabase
          .from('invoices').select('pdf_url').eq('id', invoiceId).maybeSingle();
        finalPdfUrl = inv?.pdf_url ?? null;
      }

      setPdfEmitido(finalPdfUrl);
      const serie = result.documento?.serie
        ? `${result.documento.serie}-${String(result.documento.numero ?? '').padStart(8, '0')}`
        : '';

      toast({
        title:       `✅ ${tipo === 'factura' ? 'Factura' : 'Boleta'} emitida${serie ? ` — ${serie}` : ''}`,
        description: `S/ ${montoTotal.toFixed(2)} para ${nombre || 'Consumidor Final'}.`,
      });

      onSuccess?.(invoiceId, finalPdfUrl);

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => { if (!loading) onClose(); };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Receipt className="h-5 w-5 text-indigo-600" />
            Emitir Comprobante Electrónico
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">

          {/* ── SECCIÓN: Ítems ─────────────────────────────────────────────── */}
          {isManualMode ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-bold text-blue-800">
                  📝 Ítems del Comprobante
                </Label>
                <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                  Manual — sin venta vinculada
                </span>
              </div>

              {/* Cabecera de columnas */}
              <div className="grid grid-cols-[1fr_70px_90px_80px_32px] gap-1.5 text-[10px] font-bold text-gray-500 uppercase px-1">
                <span>Descripción</span>
                <span className="text-center">Cant.</span>
                <span className="text-center">P. Unit (S/)</span>
                <span className="text-right">Total</span>
                <span />
              </div>

              {/* Filas de ítems */}
              <div className="space-y-1.5">
                {items.map((item, idx) => {
                  const total = rowTotal(item);
                  return (
                    <div key={item.id} className="grid grid-cols-[1fr_70px_90px_80px_32px] gap-1.5 items-center">
                      <input
                        type="text"
                        value={item.descripcion}
                        onChange={(e) => updateItem(item.id, 'descripcion', e.target.value)}
                        placeholder={`Ítem ${idx + 1}`}
                        className="h-9 rounded-md border border-input px-2.5 text-sm bg-white w-full"
                        autoFocus={idx === 0}
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.cantidad}
                        onChange={(e) => updateItem(item.id, 'cantidad', e.target.value.replace(/[^0-9.]/g, ''))}
                        className="h-9 rounded-md border border-input px-2 text-sm bg-white text-center font-mono w-full"
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        value={item.precioUnit}
                        onChange={(e) => updateItem(item.id, 'precioUnit', e.target.value.replace(/[^0-9.,]/g, ''))}
                        placeholder="0.00"
                        className="h-9 rounded-md border border-input px-2 text-sm bg-white text-right font-mono w-full"
                      />
                      <div className="h-9 flex items-center justify-end pr-0.5">
                        <span className={`text-sm font-semibold tabular-nums ${total > 0 ? 'text-gray-800' : 'text-gray-300'}`}>
                          {total > 0 ? `S/ ${total.toFixed(2)}` : '—'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        disabled={items.length === 1}
                        className="h-8 w-8 flex items-center justify-center rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-20 transition-colors"
                        title="Eliminar ítem"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Botón añadir ítem */}
              <button
                type="button"
                onClick={addItem}
                className="w-full flex items-center justify-center gap-1.5 h-8 rounded-md border-2 border-dashed border-indigo-300 text-xs font-semibold text-indigo-500 hover:border-indigo-500 hover:bg-indigo-50 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Añadir otro ítem
              </button>

              {/* Resumen de totales */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 divide-y divide-gray-200 text-sm">
                <div className="flex justify-between px-3 py-2 text-gray-600">
                  <span>Subtotal (base imponible)</span>
                  <span className="font-mono">S/ {baseImpon.toFixed(2)}</span>
                </div>
                <div className="flex justify-between px-3 py-2 text-gray-600">
                  <span>IGV ({igvPct}%)</span>
                  <span className="font-mono">S/ {igvMonto.toFixed(2)}</span>
                </div>
                <div className="flex justify-between px-3 py-2.5 font-bold text-gray-900 bg-white rounded-b-lg">
                  <span>Total a Pagar</span>
                  <span className="font-mono text-base text-green-700">S/ {totalFinal.toFixed(2)}</span>
                </div>
              </div>
            </div>
          ) : (
            /* Modo normal: caja de resumen fija */
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm space-y-0.5">
              <div className="flex justify-between">
                <span className="text-gray-500">Ticket</span>
                <span className="font-mono font-semibold text-gray-800">
                  {transaction.ticket_code || transaction.id.slice(-8)}
                </span>
              </div>
              {transaction.description && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Concepto</span>
                  <span className="text-gray-700 truncate max-w-[220px]" title={transaction.description}>
                    {transaction.description}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Monto</span>
                <span className="font-bold text-green-700">S/ {Math.abs(transaction.amount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Base / IGV ({igvPct}%)</span>
                <span className="text-gray-600 font-mono text-xs">
                  S/ {baseImpon.toFixed(2)} + S/ {igvMonto.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* ── SECCIÓN: Tipo de comprobante ──────────────────────────────── */}
          <div>
            <Label className="text-sm font-semibold mb-1.5 block">Tipo de Comprobante</Label>
            <div className="flex gap-2">
              {(['boleta', 'factura'] as TipoComprobante[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={`flex-1 py-2 px-3 rounded-md border text-sm font-medium transition-colors ${
                    tipo === t
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t === 'boleta' ? '🧾 Boleta' : '🏢 Factura'}
                </button>
              ))}
            </div>
          </div>

          {/* ── SECCIÓN: Documento del cliente ────────────────────────────── */}
          {tipo === 'boleta' && (
            <div>
              <Label className="text-sm font-semibold mb-1.5 block">Documento del cliente</Label>
              <div className="flex gap-2">
                {(['sin_documento', 'dni'] as TipoDoc[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { setDocType(d); setDocNumber(''); setNombre(''); }}
                    className={`flex-1 py-1.5 px-2 rounded-md border text-xs font-medium transition-colors ${
                      docType === d
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {d === 'sin_documento' ? 'Sin documento' : 'DNI'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Número de documento + búsqueda */}
          {docType !== 'sin_documento' && (
            <div>
              <Label className="text-sm font-semibold mb-1.5 block">
                {docType === 'dni' ? 'Número de DNI' : 'Número de RUC'}
              </Label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value.replace(/\D/g, '').slice(0, docType === 'dni' ? 8 : 11))}
                  placeholder={docType === 'dni' ? '12345678' : '20123456789'}
                  className="flex-1 h-9 rounded-md border border-input px-3 text-sm bg-white font-mono"
                />
                <Button
                  type="button" variant="outline" size="sm"
                  className="h-9 px-3 shrink-0"
                  onClick={handleBuscar}
                  disabled={searching || !docNumber}
                >
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {docType === 'dni' ? '8 dígitos' : '11 dígitos'} — busca en {docType === 'dni' ? 'RENIEC' : 'SUNAT'}
              </p>
            </div>
          )}

          {/* Nombre / Razón Social */}
          <div>
            <Label className="text-sm font-semibold mb-1.5 block">
              {tipo === 'factura' ? 'Razón Social' : 'Nombre del cliente'}
            </Label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder={tipo === 'factura' ? 'EMPRESA SAC' : 'Juan Pérez'}
              className="w-full h-9 rounded-md border border-input px-3 text-sm bg-white"
            />
            {docType === 'sin_documento' && (
              <p className="text-xs text-gray-400 mt-1">Deja vacío para "Consumidor Final"</p>
            )}
          </div>

          {/* Dirección */}
          {(tipo === 'factura' || docType === 'dni') && (
            <div>
              <Label className="text-sm font-semibold mb-1.5 block">
                Dirección {tipo === 'factura' && <span className="text-red-500">*</span>}
              </Label>
              <input
                type="text"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                placeholder="Av. Lima 123, San Isidro"
                className="w-full h-9 rounded-md border border-input px-3 text-sm bg-white"
              />
            </div>
          )}

          {/* Email */}
          <div>
            <Label className="text-sm font-semibold mb-1.5 block">
              Email (opcional — para envío automático de PDF)
            </Label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@empresa.com"
              className="w-full h-9 rounded-md border border-input px-3 text-sm bg-white"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-2.5">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* PDF emitido */}
          {pdfEmitido && (
            <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 p-2.5">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
              <a
                href={pdfEmitido}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-green-700 font-medium hover:underline flex items-center gap-1"
              >
                Ver PDF en Nubefact <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          {/* Botones de acción */}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="outline" size="sm" onClick={handleClose} disabled={loading}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleGenerar}
              disabled={loading || (isManualMode && totalFinal <= 0)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white min-w-[160px]"
            >
              {loading
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Generando…</>
                : <><FileText className="h-4 w-4 mr-1.5" />Generar Comprobante</>
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
