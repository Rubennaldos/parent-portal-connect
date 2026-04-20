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
import { supabaseConfig } from '@/config/supabase.config';

// ─────────────────────────────────────────────────────────────────────────────
// Consulta DNI/RUC via fetch directo a la Edge Function 'consult-document'.
// Usamos fetch() en vez de supabase.functions.invoke() porque en algunas
// versiones del SDK los headers personalizados REEMPLAZAN los defaults (en vez
// de fusionarse), eliminando el header 'apikey' que Supabase Gateway requiere.
// Con fetch() tenemos control total: enviamos Authorization + apikey siempre.
// ─────────────────────────────────────────────────────────────────────────────
async function consultarDNIRUCPublico(
  tipo: 'dni' | 'ruc',
  numero: string,
  schoolId?: string,
): Promise<Record<string, any>> {
  // Construir URL y clave anon desde la config activa (dev o prod según entorno)
  const supabaseUrl  = supabaseConfig.url.replace(/\/$/, '');
  const anonKey      = supabaseConfig.anonKey;
  const functionUrl  = `${supabaseUrl}/functions/v1/consult-document`;

  // Usar siempre el anon key (HS256) como Bearer.
  // Los tokens de sesión de usuario usan ES256 (algoritmo nuevo de Supabase)
  // pero la Edge Function solo acepta HS256 → usar el anon key garantiza HS256.
  // Esta función solo consulta SUNAT/RENIEC — no requiere identidad de usuario.
  const authToken = anonKey;

  try {
    const res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${authToken}`,
        'apikey':        anonKey,          // Supabase Gateway lo exige siempre
      },
      body: JSON.stringify({ tipo, numero, school_id: schoolId ?? null }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[consult-document] HTTP ${res.status}:`, text);
      return { success: false, error: `Servicio no disponible (${res.status}). Escribe tu nombre manualmente.` };
    }

    const data = await res.json();
    return data ?? { success: false, error: 'Respuesta vacía del servidor.' };
  } catch (err) {
    console.warn('[consult-document] Error de red:', err);
    return { success: false, error: 'No se pudo conectar con el servicio de consulta.' };
  }
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
  const [docType, setDocType] = useState<'dni' | 'ruc' | 'sin_documento'>('dni');
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
      setDocType(tipo === 'factura' ? 'ruc' : 'dni');
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
      if (docType === 'ruc') setDocType('dni');
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
      const result = await consultarDNIRUCPublico(docType as 'dni' | 'ruc', numero, schoolId);
      if (!result.success) {
        const errorMsg = result.error || `No se encontró el ${docType === 'ruc' ? 'RUC' : 'DNI'} en los registros oficiales.`;
        // Log para auditoría del administrador (no visible al padre)
        console.warn(`[SUNAT/RENIEC] Consulta ${docType.toUpperCase()} ${docNumber} fallida:`, errorMsg);
        setSunatError(errorMsg);
        setManualMode(true);
        return;
      }
      setSunatResult(result as SUNATResult);
      setRazonSocial(result.razon_social || '');
      setDireccion(result.direccion || '');
      setManualMode(false);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn('[SUNAT/RENIEC] Error inesperado en consulta:', errMsg);
      setSunatError(
        `No se pudo conectar con ${docType === 'ruc' ? 'SUNAT' : 'RENIEC'} en este momento.`
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

  // Documento siempre obligatorio:
  //  · Boleta DNI  → 8 dígitos exactos
  //  · Boleta RUC  → 11 dígitos + razón social
  //  · Factura     → 11 dígitos + razón social + dirección
  const cleanDocLen = docNumber.replace(/\D/g, '').length;
  const canConfirm = isFactura
    ? cleanDocLen === 11 && !!razonSocial.trim() && !!direccion.trim()
    : docType === 'ruc'
      ? cleanDocLen === 11 && !!razonSocial.trim()
      : cleanDocLen === 8;  // boleta DNI: 8 dígitos (nombre validado al confirmar)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="w-[96vw] sm:max-w-[480px] max-h-[92vh] p-0 overflow-hidden flex flex-col"
        aria-describedby={undefined}
        /* Evita que un toque accidental fuera cierre el modal */
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        {/* ── Header compacto ── */}
        <DialogHeader className={`px-4 py-2.5 text-white shrink-0 ${isFactura ? 'bg-indigo-600' : 'bg-blue-600'}`}>
          <DialogTitle className="text-white text-base font-bold flex items-center justify-between">
            <span className="flex items-center gap-2">
              {isFactura ? <FileText className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
              Datos del Comprobante
            </span>
            {totalAmount !== undefined && (
              <span className="text-white/90 text-sm font-semibold">
                S/ {totalAmount.toFixed(2)}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          <div className="space-y-2.5">

          {/* ── Selector Boleta / Factura ── */}
          {!lockedType ? (
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: 'boleta',  label: 'BOLETA',  sub: 'Persona / DNI', Icon: Receipt,  active: 'border-blue-500 bg-blue-50 text-blue-700',   inactive: 'border-gray-200 text-gray-500' },
                { v: 'factura', label: 'FACTURA', sub: 'Empresa / RUC',  Icon: FileText, active: 'border-indigo-500 bg-indigo-50 text-indigo-700', inactive: 'border-gray-200 text-gray-500' },
              ].map(({ v, label, sub, Icon, active, inactive }) => (
                <button
                  key={v}
                  onClick={() => setInvoiceType(v as InvoiceType)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all text-left ${invoiceType === v ? active : inactive}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-bold text-xs leading-none">{label}</p>
                    <p className="text-[10px] opacity-60 mt-0.5">{sub}</p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
              isFactura ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-blue-300 bg-blue-50 text-blue-700'
            }`}>
              {isFactura ? <FileText className="h-4 w-4 shrink-0" /> : <Receipt className="h-4 w-4 shrink-0" />}
              <span className="font-bold text-xs">{isFactura ? 'FACTURA ELECTRÓNICA' : 'BOLETA ELECTRÓNICA'}</span>
              <span className="text-[10px] opacity-60 ml-1">{isFactura ? 'Empresa / RUC' : 'Persona natural'}</span>
            </div>
          )}

          {/* ── Selector DNI / RUC (solo para boleta) ── */}
          {invoiceType === 'boleta' && (
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'dni', label: 'DNI' },
                { value: 'ruc', label: 'RUC empresa' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setDocType(opt.value as any); setDocNumber(''); setSunatResult(null); setSunatError(''); }}
                  className={`py-1.5 px-2 rounded-lg border text-xs font-semibold transition-all ${
                    docType === opt.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-500 hover:border-blue-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* ── Campo documento + botón búsqueda en la misma fila ── */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-gray-700">
              {docType === 'ruc' ? 'RUC (11 dígitos)' : 'DNI (8 dígitos)'}
              <span className="text-red-500 ml-1">*</span>
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
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
                  className={`pr-8 font-mono h-9 text-sm ${
                    sunatResult ? 'border-green-400 bg-green-50' :
                    sunatError  ? 'border-red-300 bg-red-50' : ''
                  }`}
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  {searching         && <Loader2      className="h-3.5 w-3.5 animate-spin text-blue-500" />}
                  {!searching && sunatResult && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                  {!searching && sunatError  && <AlertCircle  className="h-3.5 w-3.5 text-red-400" />}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={buscarEnSUNAT}
                disabled={searching || (docType === 'dni' ? docNumber.length < 8 : docNumber.length < 11)}
                className="h-9 px-2.5 text-blue-600 border-blue-300 hover:bg-blue-50 shrink-0"
              >
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          {/* ── Resultado SUNAT compacto ── */}
          {sunatResult && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
              <span className="text-xs font-semibold text-green-800 flex-1">
                Encontrado en {docType === 'ruc' ? 'SUNAT' : 'RENIEC'}
              </span>
              {sunatResult.estado && (
                <Badge className={`text-[10px] py-0 ${sunatResult.activo ? 'bg-green-600' : 'bg-red-500'}`}>
                  {sunatResult.estado}
                </Badge>
              )}
            </div>
          )}

          {/* ── Error SUNAT compacto ── */}
          {sunatError && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
              <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                <span className="font-semibold">{docType === 'ruc' ? 'SUNAT' : 'RENIEC'} no disponible.</span>{' '}
                Escribe tu nombre manualmente y continúa.
              </p>
            </div>
          )}

          {/* ── Razón Social / Nombre ── */}
          {(docType !== 'sin_documento' || invoiceType === 'boleta') && (
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-gray-700">
                {isFactura ? 'Razón Social *' : 'Nombre del cliente'}
              </Label>
              <Input
                placeholder={isFactura ? 'EMPRESA SAC' : 'Dejar vacío = Consumidor Final'}
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                className={`h-9 text-sm ${isFactura && !razonSocial.trim() ? 'border-red-300' : ''}`}
                readOnly={!manualMode && !!sunatResult && !isFactura}
              />
              {!manualMode && !!sunatResult && (
                <button onClick={() => setManualMode(true)} className="text-[11px] text-blue-500 underline">
                  Editar manualmente
                </button>
              )}
            </div>
          )}

          {/* ── Dirección fiscal (factura o si SUNAT la trajo) ── */}
          {(isFactura || (sunatResult && sunatResult.direccion)) && (
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                Dirección Fiscal {isFactura && <span className="text-red-500">*</span>}
              </Label>
              <Input
                placeholder="Av. Ejemplo 123, Lima"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                className={`h-9 text-sm ${isFactura && !direccion.trim() ? 'border-red-300' : ''}`}
              />
            </div>
          )}

          {/* ── Email opcional ── */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-gray-700">
              Email <span className="font-normal text-gray-400">(opcional — para recibir el PDF)</span>
            </Label>
            <Input
              type="email"
              placeholder="correo@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 text-sm"
            />
          </div>

          {/* ── Guardar en perfil ── */}
          {parentId && email.trim() && (
            <div className="flex items-center gap-2 py-1.5 px-2.5 bg-gray-50 rounded-lg border border-gray-200">
              <Checkbox
                id="save-profile"
                checked={wantSaveProfile}
                onCheckedChange={(v) => setWantSaveProfile(!!v)}
              />
              <label htmlFor="save-profile" className="text-[11px] text-gray-600 cursor-pointer select-none flex-1">
                {isFactura ? 'Guardar datos de facturación para la próxima vez' : 'Guardar correo para próximas boletas'}
              </label>
            </div>
          )}

          </div>
        </div>

        {/* ── Botones sticky ── */}
        <div className="shrink-0 px-3 py-2.5 flex gap-2 border-t bg-white">
          <Button variant="outline" onClick={onClose} className="flex-1 h-10 gap-1 text-sm">
            <X className="h-3.5 w-3.5" /> Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canConfirm || searching || savingProfile}
            className={`flex-2 h-10 gap-1 text-sm px-5 ${isFactura ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {savingProfile
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : isFactura ? <FileText className="h-3.5 w-3.5" /> : <Receipt className="h-3.5 w-3.5" />
            }
            Continuar
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
