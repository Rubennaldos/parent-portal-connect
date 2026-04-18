import { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, Search, CheckCircle2, AlertCircle, Receipt, FileText,
  User, Building2, MapPin, X, ChevronRight, Info, Save,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

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
  /**
   * ID del padre/usuario autenticado (profiles.id).
   * Si se pasa, el modal cargará sus datos fiscales guardados y
   * ofrecerá la opción de guardarlos para la próxima vez.
   */
  parentId?: string;
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
  parentId,
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

  // Estado para guardar datos fiscales en el perfil del padre
  const [wantSaveProfile, setWantSaveProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  // Datos guardados cargados desde el perfil
  const [savedProfileData, setSavedProfileData] = useState<{
    ruc?: string; razon_social?: string; direccion?: string; email?: string;
  } | null>(null);

  // Cargar datos fiscales guardados del perfil cuando se abre el modal
  useEffect(() => {
    if (!open || !parentId) return;
    supabase
      .from('profiles')
      .select('saved_ruc, saved_razon_social, saved_direccion_fiscal, saved_email_fiscal, preferred_invoice_type')
      .eq('id', parentId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setSavedProfileData({
          ruc: data.saved_ruc ?? undefined,
          razon_social: data.saved_razon_social ?? undefined,
          direccion: data.saved_direccion_fiscal ?? undefined,
          email: data.saved_email_fiscal ?? undefined,
        });
      });
  }, [open, parentId]);

  // Resetear al abrir
  useEffect(() => {
    if (open) {
      const tipo = defaultType || 'boleta';
      setInvoiceType(tipo);
      setDocNumber('');
      setRazonSocial(defaultName);
      setDireccion('');
      setSunatResult(null);
      setSunatError('');
      setManualMode(false);
      setWantSaveProfile(false);
      setDocType(tipo === 'factura' ? 'ruc' : 'sin_documento');
      if (tipo === 'factura' && savedProfileData) {
        if (savedProfileData.ruc)          setDocNumber(savedProfileData.ruc);
        if (savedProfileData.razon_social)  setRazonSocial(savedProfileData.razon_social);
        if (savedProfileData.direccion)     setDireccion(savedProfileData.direccion);
      }
      // Pre-cargar email guardado para CUALQUIER tipo de comprobante
      setEmail(savedProfileData?.email ?? '');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, defaultType, defaultName]);

  // Cuando cambia tipo de comprobante, ajustar doc_type y pre-rellenar desde perfil
  useEffect(() => {
    if (invoiceType === 'factura') {
      setDocType('ruc');
      if (parentId && savedProfileData) {
        if (savedProfileData.ruc)          setDocNumber(savedProfileData.ruc);
        if (savedProfileData.razon_social)  setRazonSocial(savedProfileData.razon_social);
        if (savedProfileData.direccion)     setDireccion(savedProfileData.direccion);
        // email ya está pre-cargado desde el useEffect de apertura, no pisarlo
      } else {
        setRazonSocial('');
        setDireccion('');
      }
    } else {
      if (docType === 'ruc') setDocType('sin_documento');
      setRazonSocial(defaultName);
      setDireccion('');
    }
    setSunatResult(null);
    setSunatError('');
    setDocNumber(invoiceType === 'factura' && savedProfileData?.ruc ? savedProfileData.ruc : '');
  }, [invoiceType]);

  // Búsqueda automática al completar dígitos
  useEffect(() => {
    if (docType === 'sin_documento') return;
    const len = docNumber.replace(/\D/g, '').length;
    if ((docType === 'dni' && len === 8) || (docType === 'ruc' && len === 11)) {
      buscarEnSUNAT();
    }
  }, [docNumber, docType]);

  const buscarEnSUNAT = async () => {
    const numero = docNumber.replace(/\D/g, '');
    if (!numero) return;
    setSunatError('');
    setSunatResult(null);
    setSearching(true);
    try {
      const result = await consultarDNIRUCPublico(docType as 'dni' | 'ruc', numero);
      if (!result.success) {
        // Mensaje claro: el padre PUEDE seguir escribiendo su nombre manualmente
        setSunatError(
          result.error ||
          `No se encontró el ${docType === 'ruc' ? 'RUC' : 'DNI'} en los registros oficiales. ` +
          `Escribe tu nombre completo manualmente en el campo de abajo y continúa.`
        );
        setManualMode(true);
        return;
      }
      setSunatResult(result as SUNATResult);
      setRazonSocial(result.razon_social || '');
      setDireccion(result.direccion || '');
      setManualMode(false);
    } catch {
      setSunatError(
        `No se pudo conectar con ${docType === 'ruc' ? 'SUNAT' : 'RENIEC'} en este momento. ` +
        `Escribe tu nombre completo manualmente en el campo de abajo y continúa.`
      );
      setManualMode(true);
    } finally {
      setSearching(false);
    }
  };

  const handleConfirm = async () => {
    const cleanDoc = docNumber.replace(/\D/g, '');

    // ── Validación de documento ──
    if (docType === 'dni') {
      if (cleanDoc.length !== 8) {
        toast({ title: 'DNI inválido', description: 'El DNI debe tener exactamente 8 dígitos.', variant: 'destructive' });
        return;
      }
      // Si RENIEC falló y el nombre está vacío, SUNAT rechazará la boleta con DNI sin nombre
      if (!razonSocial.trim()) {
        toast({
          title: 'Nombre requerido',
          description: 'Escribe tu nombre completo. SUNAT rechaza boletas con DNI pero sin nombre del titular.',
          variant: 'destructive',
        });
        return;
      }
    }
    if (docType === 'ruc') {
      if (cleanDoc.length !== 11) {
        toast({ title: 'RUC inválido', description: 'El RUC debe tener exactamente 11 dígitos.', variant: 'destructive' });
        return;
      }
      if (!cleanDoc.startsWith('10') && !cleanDoc.startsWith('20')) {
        toast({ title: 'RUC inválido', description: 'El RUC debe comenzar con 10 (persona natural) o 20 (empresa).', variant: 'destructive' });
        return;
      }
    }

    // ── Regla SUNAT: boleta >= S/ 700 requiere identificación del comprador ──
    if (
      invoiceType === 'boleta' &&
      docType === 'sin_documento' &&
      typeof totalAmount === 'number' &&
      totalAmount >= 700
    ) {
      toast({
        variant: 'destructive',
        title: 'DNI requerido por SUNAT',
        description: `Las boletas de S/ ${totalAmount.toFixed(2)} o más requieren DNI o RUC del cliente. Selecciona el tipo de documento e ingrésalo.`,
      });
      return;
    }

    // ── Validar formato de email (si fue ingresado) ──
    // Un email mal formado hace que Nubefact rechace el envío del PDF automático.
    const emailTrimmed = email.trim();
    if (emailTrimmed) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      if (!emailRegex.test(emailTrimmed)) {
        toast({
          title: 'Correo electrónico inválido',
          description: 'Verifica el formato del correo (ej: nombre@gmail.com). Si no quieres recibirlo por email, deja el campo vacío.',
          variant: 'destructive',
        });
        return;
      }
    }

    // ── Validaciones adicionales por tipo de comprobante ──
    if (invoiceType === 'factura') {
      if (!cleanDoc || cleanDoc.length !== 11) {
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

    // Guardar datos en perfil del padre (si lo pidió)
    if (wantSaveProfile && parentId) {
      setSavingProfile(true);
      const updatePayload: Record<string, string | null> = {
        saved_email_fiscal:     email.trim() || null,
        preferred_invoice_type: invoiceType,
      };
      // Para factura, guardar también el RUC, razón social y dirección
      if (invoiceType === 'factura') {
        updatePayload.saved_ruc              = cleanDoc || null;
        updatePayload.saved_razon_social     = razonSocial.trim() || null;
        updatePayload.saved_direccion_fiscal = direccion.trim() || null;
      }
      const { error: saveErr } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', parentId);
      setSavingProfile(false);
      if (saveErr) {
        console.warn('⚠️ No se pudieron guardar los datos fiscales:', saveErr.message);
      } else {
        toast({
          title: '✅ Datos guardados',
          description: invoiceType === 'factura'
            ? 'Tus datos de facturación se guardaron para la próxima vez.'
            : 'Tu correo se guardó para próximas boletas.',
        });
      }
    }

    onConfirm({
      tipo: invoiceType,
      doc_type: docType,
      doc_number: cleanDoc || '-',
      razon_social: razonSocial.trim() || 'Consumidor Final',
      direccion: direccion.trim(),
      email: email.trim() || undefined,
      sunat_estado: sunatResult?.estado,
      sunat_condicion: sunatResult?.condicion,
    });
  };

  const isFactura = invoiceType === 'factura';

  // SUNAT: boleta >= S/ 700 exige identificación del comprador (DNI/RUC).
  // Emitir a "Consumidor Final" (sin_documento) por ese monto → rechazo inmediato.
  const needs700DocRule =
    invoiceType === 'boleta' &&
    typeof totalAmount === 'number' &&
    totalAmount >= 700 &&
    docType === 'sin_documento';

  const canConfirm = isFactura
    ? docNumber.replace(/\D/g, '').length === 11 && !!razonSocial.trim() && !!direccion.trim()
    : needs700DocRule
      ? false   // bloqueado hasta que seleccione DNI/RUC con datos
      : true;   // boleta < S/ 700 sin documento: válido

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden" aria-describedby={undefined}>
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

          {/* Error SUNAT / RENIEC */}
          {sunatError && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-amber-900">
                  {docType === 'ruc' ? 'SUNAT no disponible' : 'RENIEC no disponible'}
                </p>
                <p className="text-xs text-amber-800">{sunatError}</p>
                <p className="text-xs text-amber-700 font-medium">
                  ✏️ Escribe tu nombre en el campo de abajo y continúa normalmente.
                </p>
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

          {/* Nota / bloqueo para boleta sin documento */}
          {invoiceType === 'boleta' && docType === 'sin_documento' && (
            needs700DocRule ? (
              // ── BLOQUEO SUNAT: monto >= S/ 700 exige identificación ──
              <div className="bg-red-50 border border-red-400 rounded-lg p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-red-700">
                    SUNAT exige DNI para boletas mayores a S/ 700
                  </p>
                  <p className="text-xs text-red-600 mt-0.5">
                    No se puede emitir a "Consumidor Final" por S/ {totalAmount?.toFixed(2)}.
                    Selecciona <strong>DNI</strong> o <strong>RUC</strong> e ingresa el número del cliente.
                  </p>
                </div>
              </div>
            ) : (
              // ── Informativo: boleta sin doc por montos normales ──
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-xs text-blue-700">
                  Se emitirá boleta a <strong>"Consumidor Final"</strong> sin número de documento.
                  Es válido para SUNAT para ventas al público en general.
                </p>
              </div>
            )
          )}

          {/* Banner de datos pre-cargados desde el perfil */}
          {parentId && isFactura && savedProfileData?.ruc && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
              <p className="text-xs text-indigo-700">
                Datos pre-cargados desde tu perfil. Puedes editarlos si cambiaron.
              </p>
            </div>
          )}

          {/* Guardar datos en perfil: para factura guarda todo; para boleta solo el email */}
          {parentId && email.trim() && (
            <div className="flex items-center gap-2.5 py-2 px-3 bg-gray-50 rounded-lg border border-gray-200">
              <Checkbox
                id="save-profile"
                checked={wantSaveProfile}
                onCheckedChange={(v) => setWantSaveProfile(!!v)}
              />
              <label htmlFor="save-profile" className="text-xs text-gray-600 cursor-pointer select-none">
                {isFactura
                  ? <><span className="font-semibold">Guardar mis datos de facturación</span> para la próxima vez</>
                  : <><span className="font-semibold">Guardar mi correo</span> para próximas boletas</>
                }
              </label>
              <Save className="h-3.5 w-3.5 text-gray-400 ml-auto shrink-0" />
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
            disabled={!canConfirm || searching || savingProfile}
            className={`flex-1 gap-2 ${isFactura ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {savingProfile
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : isFactura ? <FileText className="h-4 w-4" /> : <Receipt className="h-4 w-4" />
            }
            Emitir {isFactura ? 'Factura' : 'Boleta'}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
