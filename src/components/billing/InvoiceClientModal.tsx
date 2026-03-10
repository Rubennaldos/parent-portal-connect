import { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, Search, CheckCircle2, AlertCircle, Receipt, FileText,
  User, Building2, MapPin, X, ChevronRight, Info,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Consulta DNI/RUC via nuestra función serverless en Vercel (/api/consult-dni)
// Esto evita los problemas de CORS al llamar apis.net.pe desde el navegador.
// ─────────────────────────────────────────────────────────────────────────────
async function consultarDNIRUCPublico(tipo: 'dni' | 'ruc', numero: string): Promise<Record<string, any>> {
  const res = await fetch('/api/consult-dni', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo, numero }),
  });
  if (!res.ok) {
    return { success: false, error: `Error del servidor (${res.status})` };
  }
  return res.json();
}

export type InvoiceType = 'boleta' | 'factura';

export interface InvoiceClientData {
  tipo: InvoiceType;
  // Datos del cliente
  doc_type: 'dni' | 'ruc' | 'sin_documento';
  doc_number: string;
  razon_social: string;
  direccion: string;
  email?: string;
  // Metadatos SUNAT
  sunat_estado?: string;
  sunat_condicion?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Tipo preseleccionado: si viene del POS ya saben si es boleta o factura */
  defaultType?: InvoiceType;
  /** Si true, oculta el selector de tipo (ya fue elegido antes, no preguntar dos veces) */
  lockedType?: boolean;
  /** Nombre del cliente por defecto (alumno, padre, etc.) */
  defaultName?: string;
  /** Al confirmar, devuelve los datos del cliente */
  onConfirm: (data: InvoiceClientData) => void;
  /** Monto total de la venta (informativo) */
  totalAmount?: number;
  /** school_id para usar las credenciales Nubefact de la sede al consultar */
  schoolId?: string;
}

interface SUNATResult {
  tipo: 'ruc' | 'dni';
  numero: string;
  razon_social: string;
  nombre?: string;
  direccion: string;
  estado?: string;
  condicion?: string;
  activo?: boolean;
}

export const InvoiceClientModal = ({
  open,
  onClose,
  defaultType,
  lockedType = false,
  defaultName = '',
  onConfirm,
  totalAmount,
  schoolId,
}: Props) => {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [invoiceType, setInvoiceType] = useState<InvoiceType>(defaultType || 'boleta');
  const [docType, setDocType] = useState<'dni' | 'ruc' | 'sin_documento'>('sin_documento');
  const [docNumber, setDocNumber] = useState('');
  const [razonSocial, setRazonSocial] = useState(defaultName);
  const [direccion, setDireccion] = useState('');
  const [email, setEmail] = useState('');
  const [searching, setSearching] = useState(false);
  const [sunatResult, setSunatResult] = useState<SUNATResult | null>(null);
  const [sunatError, setSunatError] = useState('');
  const [manualMode, setManualMode] = useState(false);

  // Resetear al abrir
  useEffect(() => {
    if (open) {
      setInvoiceType(defaultType || 'boleta');
      setDocNumber('');
      setRazonSocial(defaultName);
      setDireccion('');
      setEmail('');
      setSunatResult(null);
      setSunatError('');
      setManualMode(false);
      // Para boleta sin doc por defecto
      setDocType(defaultType === 'factura' ? 'ruc' : 'sin_documento');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, defaultType, defaultName]);

  // Cuando cambia tipo de comprobante, ajustar doc_type
  useEffect(() => {
    if (invoiceType === 'factura') {
      setDocType('ruc');
    } else {
      if (docType === 'ruc') setDocType('sin_documento');
    }
    setSunatResult(null);
    setSunatError('');
    setDocNumber('');
    setRazonSocial(invoiceType === 'boleta' ? defaultName : '');
    setDireccion('');
  }, [invoiceType]);

  // Búsqueda automática al completar dígitos
  useEffect(() => {
    if (docType === 'sin_documento') return;
    const len = docNumber.replace(/\D/g, '').length;
    if ((docType === 'dni' && len === 8) || (docType === 'ruc' && len === 11)) {
      buscarEnSUNAT();
    }
  }, [docNumber, docType]);

  /** Consulta DNI/RUC directamente a apis.net.pe (sin Edge Function) */
  const buscarEnSUNAT = async () => {
    const numero = docNumber.replace(/\D/g, '');
    if (!numero) return;
    setSunatError('');
    setSunatResult(null);
    setSearching(true);
    try {
      const result = await consultarDNIRUCPublico(docType as 'dni' | 'ruc', numero);
      if (!result.success) {
        setSunatError(result.error || 'No encontrado. Puedes ingresar los datos manualmente.');
        setManualMode(true);
        return;
      }
      setSunatResult(result as SUNATResult);
      setRazonSocial(result.razon_social || '');
      setDireccion(result.direccion || '');
      setManualMode(false);
    } catch (err: any) {
      setSunatError('Error de conexión con SUNAT/RENIEC. Puedes ingresar los datos manualmente.');
      setManualMode(true);
    } finally {
      setSearching(false);
    }
  };

  const handleConfirm = () => {
    // Validaciones
    if (invoiceType === 'factura') {
      if (!docNumber || docNumber.replace(/\D/g, '').length !== 11) {
        toast({ title: 'RUC requerido', description: 'Para facturas necesitas ingresar un RUC de 11 dígitos.', variant: 'destructive' });
        return;
      }
      if (!razonSocial.trim()) {
        toast({ title: 'Razón Social requerida', description: 'Ingresa la razón social de la empresa.', variant: 'destructive' });
        return;
      }
      if (!direccion.trim()) {
        toast({ title: 'Dirección requerida', description: 'Para facturas la dirección fiscal es obligatoria.', variant: 'destructive' });
        return;
      }
    }

    onConfirm({
      tipo: invoiceType,
      doc_type: docType,
      doc_number: docNumber.replace(/\D/g, '') || '-',
      razon_social: razonSocial.trim() || 'Consumidor Final',
      direccion: direccion.trim(),
      email: email.trim() || undefined,
      sunat_estado: sunatResult?.estado,
      sunat_condicion: sunatResult?.condicion,
    });
  };

  const isFactura = invoiceType === 'factura';
  const canConfirm = isFactura
    ? docNumber.replace(/\D/g, '').length === 11 && !!razonSocial.trim() && !!direccion.trim()
    : true; // Boleta puede ser sin datos

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden">
        <DialogHeader className="bg-gradient-to-r from-blue-600 to-indigo-700 p-5 text-white">
          <DialogTitle className="text-white text-xl font-bold flex items-center gap-2">
            <Receipt className="h-6 w-6" />
            Datos del Comprobante
          </DialogTitle>
          {totalAmount !== undefined && (
            <p className="text-blue-100 text-sm mt-1">
              Total a facturar: <strong>S/ {totalAmount.toFixed(2)}</strong>
            </p>
          )}
        </DialogHeader>

        <div className="p-5 space-y-5">
          {/* Selector Boleta / Factura — se oculta cuando el tipo ya fue elegido antes */}
          {!lockedType ? (
            <div>
              <Label className="text-sm font-semibold text-gray-700 mb-2 block">Tipo de Comprobante</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setInvoiceType('boleta')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                    invoiceType === 'boleta'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-blue-300 text-gray-500'
                  }`}
                >
                  <Receipt className="h-7 w-7" />
                  <div className="text-center">
                    <p className="font-bold text-sm">BOLETA</p>
                    <p className="text-xs opacity-70">Persona natural</p>
                  </div>
                </button>
                <button
                  onClick={() => setInvoiceType('factura')}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                    invoiceType === 'factura'
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 hover:border-indigo-300 text-gray-500'
                  }`}
                >
                  <FileText className="h-7 w-7" />
                  <div className="text-center">
                    <p className="font-bold text-sm">FACTURA</p>
                    <p className="text-xs opacity-70">Empresa / RUC</p>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            /* Tipo ya definido: mostrar solo badge informativo */
            <div className={`flex items-center gap-3 p-3 rounded-xl border-2 ${
              invoiceType === 'factura'
                ? 'border-indigo-300 bg-indigo-50'
                : 'border-blue-300 bg-blue-50'
            }`}>
              {invoiceType === 'factura'
                ? <FileText className="h-6 w-6 text-indigo-600 shrink-0" />
                : <Receipt className="h-6 w-6 text-blue-600 shrink-0" />}
              <div>
                <p className={`font-bold text-sm ${invoiceType === 'factura' ? 'text-indigo-700' : 'text-blue-700'}`}>
                  {invoiceType === 'factura' ? 'FACTURA ELECTRÓNICA' : 'BOLETA ELECTRÓNICA'}
                </p>
                <p className="text-xs text-gray-500">
                  {invoiceType === 'factura' ? 'Empresa / RUC' : 'Persona natural / Consumidor Final'}
                </p>
              </div>
            </div>
          )}

          {/* Selector de tipo de documento */}
          {invoiceType === 'boleta' && (
            <div>
              <Label className="text-sm font-semibold text-gray-700 mb-2 block">Documento del cliente</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'sin_documento', label: 'Sin Doc.', icon: <User className="h-3.5 w-3.5" /> },
                  { value: 'dni', label: 'DNI', icon: <User className="h-3.5 w-3.5" /> },
                  { value: 'ruc', label: 'RUC', icon: <Building2 className="h-3.5 w-3.5" /> },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setDocType(opt.value as any);
                      setDocNumber('');
                      setSunatResult(null);
                      setSunatError('');
                    }}
                    className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border text-xs font-medium transition-all ${
                      docType === opt.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-500 hover:border-blue-300'
                    }`}
                  >
                    {opt.icon} {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Campo de número de documento */}
          {docType !== 'sin_documento' && (
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-gray-700">
                {docType === 'ruc' ? 'RUC (11 dígitos)' : 'DNI (8 dígitos)'}
                <span className="text-red-500 ml-1">*</span>
              </Label>
              <div className="relative">
                <Input
                  ref={inputRef}
                  type="text"
                  inputMode="numeric"
                  placeholder={docType === 'ruc' ? '20xxxxxxxxx' : '12345678'}
                  maxLength={docType === 'ruc' ? 11 : 8}
                  value={docNumber}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    setDocNumber(val);
                    if (sunatResult) setSunatResult(null);
                    setSunatError('');
                  }}
                  className={`pr-10 font-mono text-base ${
                    sunatResult ? 'border-green-400 bg-green-50' :
                    sunatError ? 'border-red-300 bg-red-50' : ''
                  }`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {searching && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
                  {!searching && sunatResult && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                  {!searching && sunatError && <AlertCircle className="h-4 w-4 text-red-400" />}
                </div>
              </div>
              <p className="text-xs text-gray-400">
                Se buscará automáticamente en {docType === 'ruc' ? 'SUNAT' : 'RENIEC'} al completar los dígitos
              </p>
            </div>
          )}

          {/* Botón manual de búsqueda */}
          {docType !== 'sin_documento' && !searching && (
            <Button
              variant="outline"
              size="sm"
              onClick={buscarEnSUNAT}
              disabled={searching || (docType === 'dni' ? docNumber.length < 8 : docNumber.length < 11)}
              className="w-full gap-2 text-blue-600 border-blue-300 hover:bg-blue-50"
            >
              <Search className="h-4 w-4" />
              Buscar en {docType === 'ruc' ? 'SUNAT' : 'RENIEC'}
            </Button>
          )}

          {/* Resultado SUNAT - Badge de estado */}
          {sunatResult && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <p className="text-sm font-bold text-green-800">Encontrado en {docType === 'ruc' ? 'SUNAT' : 'RENIEC'}</p>
                {sunatResult.estado && (
                  <Badge className={`text-xs ml-auto ${sunatResult.activo ? 'bg-green-600' : 'bg-red-500'}`}>
                    {sunatResult.estado}
                  </Badge>
                )}
              </div>
              {sunatResult.condicion && (
                <p className="text-xs text-green-700 ml-6">Condición: {sunatResult.condicion}</p>
              )}
            </div>
          )}

          {/* Error SUNAT */}
          {sunatError && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
              <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-amber-800">{sunatError}</p>
                <button
                  onClick={() => setManualMode(true)}
                  className="text-xs text-amber-700 underline mt-1"
                >
                  Ingresar datos manualmente
                </button>
              </div>
            </div>
          )}

          {/* Razón Social */}
          {(docType !== 'sin_documento' || invoiceType === 'boleta') && (
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                {isFactura ? 'Razón Social *' : 'Nombre del cliente'}
              </Label>
              <Input
                placeholder={isFactura ? 'EMPRESA SAC' : 'Dejar vacío para Consumidor Final'}
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                className={isFactura && !razonSocial.trim() ? 'border-red-300' : ''}
                readOnly={!manualMode && !!sunatResult && !isFactura}
              />
              {!manualMode && !!sunatResult && (
                <button
                  onClick={() => setManualMode(true)}
                  className="text-xs text-blue-500 underline"
                >
                  Editar manualmente
                </button>
              )}
            </div>
          )}

          {/* Dirección fiscal — obligatoria en factura */}
          {(isFactura || (sunatResult && sunatResult.direccion)) && (
            <div className="space-y-1">
              <Label className="text-sm font-semibold text-gray-700 flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                Dirección Fiscal {isFactura && <span className="text-red-500">*</span>}
              </Label>
              <Input
                placeholder="Av. Ejemplo 123, Lima"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                className={isFactura && !direccion.trim() ? 'border-red-300' : ''}
              />
            </div>
          )}

          {/* Email opcional */}
          <div className="space-y-1">
            <Label className="text-sm font-semibold text-gray-700">
              Email (opcional — para enviar PDF automáticamente)
            </Label>
            <Input
              type="email"
              placeholder="correo@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* Nota informativa para boleta sin documento */}
          {invoiceType === 'boleta' && docType === 'sin_documento' && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">
                Se emitirá boleta a <strong>"Consumidor Final"</strong> sin número de documento.
                Es válido para SUNAT para ventas al público en general.
              </p>
            </div>
          )}
        </div>

        {/* Botones */}
        <div className="px-5 pb-5 flex gap-3">
          <Button variant="outline" onClick={onClose} className="flex-1 gap-2">
            <X className="h-4 w-4" /> Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm || searching}
            className={`flex-1 gap-2 ${isFactura ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {isFactura ? <FileText className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
            Emitir {isFactura ? 'Factura' : 'Boleta'}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
