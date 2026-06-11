/**
 * Formulario de ingreso rápido de mercadería (modo sin comprobante).
 *
 * Muestra solo: producto + cantidad + empaque (+ nota opcional).
 * No pide proveedor, tipo de documento, número, monto ni foto.
 * El correlativo se genera automáticamente en la BD.
 * El stock se actualiza al instante al presionar "Registrar".
 *
 * Arquitectura:
 *  - Terminal tonto: toda la lógica en useBranchSupplyQuickForm.
 *  - Reutiliza LineRow (mismo componente que el formulario estándar).
 *  - CERO aritmética financiera aquí.
 */

import { useRef } from 'react';
import { Plus, Trash2, Loader2, Search, Zap } from 'lucide-react';
import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useBranchSupplyQuickForm } from '../hooks/useBranchSupplyQuickForm';
import type { LineItem } from '../types';
import type { ProductSearchResult } from '../types';

// ── Props ───────────────────────────────────────────────────────────────────────

interface BranchSupplyQuickFormProps {
  schoolId:   string | null;
  onSuccess?: (receiptNumber: string) => void;
}

// ── Sub-componente: fila de ítem ────────────────────────────────────────────────
// Idéntico en estructura al formulario estándar; extraído para claridad.

interface LineRowProps {
  line:            LineItem;
  isOnly:          boolean;
  onSearchChange:  (uid: string, q: string) => void;
  onSelectProduct: (uid: string, product: ProductSearchResult) => Promise<void>;
  onHideResults:   (uid: string) => void;
  onFieldChange:   (uid: string, field: 'quantity', value: string) => void;
  onSelectUom:     (uid: string, uomId: string) => void;
  onRemove:        (uid: string) => void;
}

function LineRow({
  line, isOnly,
  onSearchChange, onSelectProduct, onHideResults, onFieldChange, onSelectUom, onRemove,
}: LineRowProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  return (
    <div className="grid grid-cols-[1fr_130px_160px_36px] gap-2 items-start py-2 border-b border-gray-100 last:border-0">

      {/* Búsqueda de producto */}
      <div className="relative" ref={wrapperRef}>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
          <Input
            className="pl-8 text-sm"
            placeholder="Buscar producto..."
            value={line.searchQuery}
            onChange={e => onSearchChange(line.uid, e.target.value)}
            onBlur={() => setTimeout(() => onHideResults(line.uid), 200)}
          />
          {line.searchLoading && (
            <Loader2 className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-gray-400 animate-spin" />
          )}
        </div>

        {line.showResults && line.searchResults.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white rounded-md border border-gray-200 shadow-lg max-h-52 overflow-y-auto">
            {line.searchResults.map(p => (
              <button
                key={p.product_id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                onMouseDown={() => onSelectProduct(line.uid, p)}
              >
                <p className="font-medium text-gray-900 truncate">{p.product_name}</p>
                <p className="text-xs text-gray-500">
                  {p.category}{p.product_code ? ` · ${p.product_code}` : ''}
                </p>
              </button>
            ))}
          </div>
        )}

        {line.showResults && !line.searchLoading &&
          line.searchResults.length === 0 && line.searchQuery.trim().length >= 2 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white rounded-md border border-gray-200 shadow-sm px-3 py-2 text-sm text-gray-500">
            Sin resultados para &ldquo;{line.searchQuery}&rdquo;
          </div>
        )}
      </div>

      {/* Cantidad */}
      <Input
        type="number"
        min="1"
        step="1"
        placeholder="Cant."
        className="text-sm"
        value={line.quantity}
        onChange={e => onFieldChange(line.uid, 'quantity', e.target.value)}
      />

      {/* Selector de empaque/UoM */}
      <Select
        value={line.uomId || '__base__'}
        onValueChange={v => onSelectUom(line.uid, v === '__base__' ? '' : v)}
        disabled={!line.productId}
      >
        <SelectTrigger className="text-sm h-9">
          <SelectValue placeholder="Unidad base" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__base__">Unidad base</SelectItem>
          {line.packagings.map(pk => (
            <SelectItem key={pk.id} value={pk.id}>
              {pk.uom_name} (×{pk.conversion_factor})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Eliminar fila */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-gray-400 hover:text-red-500"
        disabled={isOnly}
        onClick={() => onRemove(line.uid)}
        title="Eliminar ítem"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ── Componente principal ─────────────────────────────────────────────────────────

export function BranchSupplyQuickForm({ schoolId, onSuccess }: BranchSupplyQuickFormProps) {
  const {
    lines, notes, submitting,
    setNotes,
    addLine, removeLine, updateLineField, updateLineSearch,
    selectProduct, selectUom, hideResults,
    handleSubmit,
  } = useBranchSupplyQuickForm(schoolId, onSuccess);

  return (
    <div className="space-y-5">

      {/* Aviso explicativo */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        <Zap className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800 leading-snug">
          <span className="font-semibold">Modo rápido:</span> el stock se actualiza al instante.
          El número de seguimiento se genera automáticamente. Sin proveedor ni foto.
        </div>
      </div>

      {/* Productos */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Productos a ingresar
          </h3>
          <Button type="button" variant="outline" size="sm" onClick={addLine} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Agregar ítem
          </Button>
        </div>

        {/* Encabezados */}
        <div className="grid grid-cols-[1fr_130px_160px_36px] gap-2 text-xs font-medium text-gray-500 uppercase tracking-wide border-b border-gray-100 pb-1">
          <span>Producto</span>
          <span>Cantidad</span>
          <span>Empaque</span>
          <span />
        </div>

        {lines.map(line => (
          <LineRow
            key={line.uid}
            line={line}
            isOnly={lines.length === 1}
            onSearchChange={updateLineSearch}
            onSelectProduct={selectProduct}
            onHideResults={hideResults}
            onFieldChange={updateLineField}
            onSelectUom={selectUom}
            onRemove={removeLine}
          />
        ))}
      </div>

      {/* Nota opcional */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-2">
        <Label className="text-sm font-medium text-gray-700">
          Nota interna <span className="text-gray-400 font-normal">(opcional)</span>
        </Label>
        <Textarea
          placeholder="Ej: Reposición de emergencia, donación, ajuste por conteo físico..."
          className="resize-none text-sm"
          rows={2}
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>

      {/* Botón */}
      <div className="flex justify-end pt-1">
        <Button
          type="button"
          size="lg"
          className="min-w-[200px] gap-2 bg-amber-600 hover:bg-amber-700 text-white"
          disabled={submitting || !schoolId}
          onClick={handleSubmit}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Registrando...
            </>
          ) : (
            <>
              <Zap className="h-4 w-4" />
              Registrar ingreso rápido
            </>
          )}
        </Button>
      </div>

    </div>
  );
}
