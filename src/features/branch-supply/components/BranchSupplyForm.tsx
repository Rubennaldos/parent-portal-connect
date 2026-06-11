/**
 * Formulario de registro de comprobantes de suministro para administradores de sede.
 *
 * SEDE CIEGA DE COSTOS (v2):
 *  - Sin columna "Costo unit." en la grilla de ítems.
 *  - Sin switch de IGV: el Auditor General lo establece al aprobar.
 *  - Buscador de proveedores con input + debounce (search_suppliers_smart RPC).
 *  - La sede registra: proveedor, tipo/n.° de doc., productos/cantidades/UoM,
 *    notas y comprobante físico opcional. El total lo fija el auditor en BD.
 *
 * Arquitectura:
 *  - Toda la lógica está en useBranchSupplyForm. Este componente es un "terminal tonto".
 *  - CERO aritmética financiera aquí.
 *  - CERO imports de logística central, billing o school-admin legados.
 */

import { useRef, useCallback } from 'react';
import { Plus, Trash2, Upload, X, CheckCircle2, Loader2, Search } from 'lucide-react';
import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useBranchSupplyForm } from '../hooks/useBranchSupplyForm';
import { DOC_TYPE_OPTIONS_SEDE, type DocTypeSedeForm, type LineItem } from '../types';

// ── Props ──────────────────────────────────────────────────────────────────────

interface BranchSupplyFormProps {
  schoolId:   string | null;
  onSuccess?: (receiptNumber: string) => void;
}

// ── Sub-componente: fila de ítem ───────────────────────────────────────────────

interface LineRowProps {
  line:            LineItem;
  isOnly:          boolean;
  onSearchChange:  (uid: string, q: string) => void;
  onSelectProduct: (uid: string, product: import('../types').ProductSearchResult) => Promise<void>;
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

        {line.showResults && !line.searchLoading && line.searchResults.length === 0 && line.searchQuery.trim().length >= 2 && (
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

      {/* Botón eliminar fila */}
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

// ── Componente principal ───────────────────────────────────────────────────────

export function BranchSupplyForm({ schoolId, onSuccess }: BranchSupplyFormProps) {
  const {
    header, lines, supplierSearch, evidence, submitting,
    setHeaderField,
    updateSupplierQuery, selectSupplier, clearSupplier, hideSupplierResults,
    addLine, removeLine, updateLineField, updateLineSearch,
    selectProduct, selectUom, hideResults,
    handleFileChange, removeEvidence, handleSubmit,
  } = useBranchSupplyForm(schoolId, onSuccess);

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const supplierWrapRef = useRef<HTMLDivElement>(null);

  const onFilePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileChange(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [handleFileChange]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileChange(file);
  }, [handleFileChange]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Sección 1: Datos del comprobante ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Datos del comprobante
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Proveedor — buscador inteligente (unaccent + ILIKE) */}
          <div className="md:col-span-2 space-y-1.5" ref={supplierWrapRef}>
            <Label className="text-sm font-medium">Proveedor <span className="text-red-500">*</span></Label>

            {/* Proveedor seleccionado */}
            {supplierSearch.selected ? (
              <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-blue-900 truncate">
                    {supplierSearch.selected.name}
                  </p>
                  {supplierSearch.selected.ruc && (
                    <p className="text-xs text-blue-600">RUC {supplierSearch.selected.ruc}</p>
                  )}
                </div>
                <button
                  type="button"
                  className="text-blue-400 hover:text-red-500 transition-colors flex-shrink-0"
                  onClick={clearSupplier}
                  title="Cambiar proveedor"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              /* Campo de búsqueda cuando no hay selección */
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  className="pl-9 text-sm"
                  placeholder="Buscar por nombre o RUC..."
                  value={supplierSearch.query}
                  onChange={e => updateSupplierQuery(e.target.value)}
                  onFocus={() => updateSupplierQuery(supplierSearch.query)}
                  onBlur={() => setTimeout(hideSupplierResults, 200)}
                  autoComplete="off"
                />
                {supplierSearch.loading && (
                  <Loader2 className="absolute right-3 top-2.5 h-4 w-4 text-gray-400 animate-spin" />
                )}

                {/* Dropdown de resultados de proveedores */}
                {supplierSearch.showResults && supplierSearch.results.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white rounded-md border border-gray-200 shadow-lg max-h-52 overflow-y-auto">
                    {supplierSearch.results.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                        onMouseDown={() => selectSupplier(s)}
                      >
                        <p className="font-medium text-gray-900 truncate">{s.name}</p>
                        {s.ruc && <p className="text-xs text-gray-500">RUC {s.ruc}</p>}
                      </button>
                    ))}
                  </div>
                )}

                {supplierSearch.showResults && !supplierSearch.loading &&
                  supplierSearch.results.length === 0 && supplierSearch.query.trim().length >= 2 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white rounded-md border border-gray-200 shadow-sm px-3 py-2.5 text-sm text-gray-500">
                    Sin proveedores para &ldquo;{supplierSearch.query}&rdquo;. Solicita a Logística central que lo cree.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tipo de comprobante */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Tipo de documento <span className="text-red-500">*</span></Label>
            <Select
              value={header.docType}
              onValueChange={v => setHeaderField('docType', v as DocTypeSedeForm)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPE_OPTIONS_SEDE.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Número de documento */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">N.° de documento</Label>
            <Input
              placeholder="Ej. F001-00012345"
              value={header.docNumber}
              onChange={e => setHeaderField('docNumber', e.target.value)}
            />
          </div>

          {/* Notas */}
          <div className="md:col-span-2 space-y-1.5">
            <Label className="text-sm font-medium">Notas u observaciones</Label>
            <Textarea
              placeholder="Observaciones internas (opcional)..."
              className="resize-none text-sm"
              rows={2}
              value={header.notes}
              onChange={e => setHeaderField('notes', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Sección 2: Grilla de ítems (sin columna de costo) ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Productos recibidos
          </h3>
          <Button type="button" variant="outline" size="sm" onClick={addLine} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Agregar ítem
          </Button>
        </div>

        {/* Encabezados de columnas — sin "Costo unit." */}
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

        <p className="text-xs text-gray-400 pt-1">
          Los costos unitarios serán registrados por el Administrador General durante la auditoría del comprobante.
        </p>
      </div>

      {/* ── Sección 3: Evidencia documental ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
          Comprobante físico <span className="text-gray-400 font-normal normal-case">(opcional)</span>
        </h3>

        {!evidence.path && !evidence.uploading ? (
          <div
            className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mx-auto h-8 w-8 text-gray-400 mb-2" />
            <p className="text-sm text-gray-600 font-medium">
              Arrastra el archivo aquí o haz clic para seleccionar
            </p>
            <p className="text-xs text-gray-400 mt-1">PDF, JPG, PNG, WebP · Máximo 15 MB</p>
            {evidence.error && (
              <p className="text-xs text-red-500 mt-2">{evidence.error}</p>
            )}
          </div>
        ) : evidence.uploading ? (
          <div className="flex items-center gap-3 bg-blue-50 rounded-lg p-4">
            <Loader2 className="h-4 w-4 text-blue-600 animate-spin flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-blue-800 font-medium truncate">{evidence.file?.name}</p>
              <div className="mt-1.5 bg-blue-200 rounded-full h-1.5">
                <div
                  className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${evidence.progress}%` }}
                />
              </div>
            </div>
            <span className="text-xs text-blue-600 tabular-nums">{evidence.progress}%</span>
          </div>
        ) : (
          <div className="flex items-center gap-3 bg-green-50 rounded-lg p-4">
            <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-green-800 font-medium truncate">{evidence.file?.name}</p>
              <p className="text-xs text-green-600">Archivo subido correctamente</p>
            </div>
            <button
              type="button"
              className="text-gray-400 hover:text-red-500 transition-colors"
              onClick={removeEvidence}
              title="Quitar archivo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={onFilePick}
        />
      </div>

      {/* ── Botón de envío ── */}
      <div className="flex justify-end pt-1">
        <Button
          type="button"
          size="lg"
          className="min-w-[200px] gap-2"
          disabled={submitting || evidence.uploading || !schoolId}
          onClick={handleSubmit}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Enviando...
            </>
          ) : (
            'Enviar Suministro'
          )}
        </Button>
      </div>

    </div>
  );
}
