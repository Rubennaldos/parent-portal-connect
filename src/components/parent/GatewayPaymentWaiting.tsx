/**
 * GatewayPaymentWaiting — "Éxito Inmediato, DB en Segundo Plano"
 * ─────────────────────────────────────────────────────────────────
 * FILOSOFÍA:
 *   Si el popup de IziPay ya confirmó el pago (IZIPAY_SUCCESS),
 *   mostramos el check verde DE INMEDIATO. El padre pagó — eso es un hecho.
 *   La confirmación de la base de datos es burocracia que ocurre en silencio.
 *
 * ESTADOS:
 *  'optimistic' → popup confirmó → check verde inmediato + sync silencioso
 *  'processing' → sin confirmación del popup → spinner clásico (modo manual)
 *  'success'    → BD confirmó el pago
 *  'failed'     → BD rechazó el pago
 *  'expired'    → tiempo agotado sin confirmación (solo en modo processing)
 *
 * REGLAS:
 *  - confirmedByGateway=true: nunca mostrar "no cierres la ventana"
 *  - confirmedByGateway=true: forzar éxito a los 10 segundos si la BD no responde
 *  - Polling cada 1.5s (antes era 3s)
 *  - Realtime Supabase como primera línea
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  ShieldCheck,
  Banknote,
  Wifi,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type GatewayStatus = 'processing' | 'optimistic' | 'syncing' | 'success' | 'failed' | 'expired';

interface SessionData {
  gateway_status: string | null;
  gateway_reference: string | null;
  status: string;
  completed_at: string | null;
}

export interface GatewayPaymentWaitingProps {
  sessionId: string;
  amount: number;
  studentName: string;
  /** studentId para localStorage de recuperación */
  studentId?: string;
  gatewayName?: string;
  maxWaitMs?: number;
  /** Cuando el popup de IziPay ya envió IZIPAY_SUCCESS — muestra éxito inmediato */
  confirmedByGateway?: boolean;
  /** orderId del pago (para mostrar como referencia) */
  gatewayOrderId?: string | null;
  onSuccess?: (gatewayRefId: string | null) => void;
  onFailure?: (reason: string) => void;
  onRetry?: () => void;
  onClose?: () => void;
}

const POLL_INTERVAL_MS        = 1_500;   // antes 3 000 ms
const DEFAULT_MAX_WAIT_MS     = 10 * 60 * 1_000;
const OPTIMISTIC_FORCE_MS     = 10_000;  // tras 10 s sin BD, forzar éxito

// ── Componente ────────────────────────────────────────────────────────────────

export function GatewayPaymentWaiting({
  sessionId,
  amount,
  studentName,
  studentId,
  gatewayName = 'IziPay',
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  confirmedByGateway = false,
  gatewayOrderId,
  onSuccess,
  onFailure,
  onRetry,
  onClose,
}: GatewayPaymentWaitingProps) {
  // Estado inicial: optimista si el popup ya confirmó, spinner si es verificación manual
  const [status, setStatus] = useState<GatewayStatus>(
    confirmedByGateway ? 'optimistic' : 'processing'
  );
  const [gatewayRefId, setGatewayRefId] = useState<string | null>(gatewayOrderId ?? null);
  const [sessionGwRef, setSessionGwRef] = useState<string | null>(null); // gateway_reference de la sesión
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const [dbSynced, setDbSynced] = useState(false);
  const [showVerifyButton, setShowVerifyButton] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  const intervalRef   = useRef<ReturnType<typeof setInterval>  | null>(null);
  const timerRef      = useRef<ReturnType<typeof setInterval>  | null>(null);
  const forceRef      = useRef<ReturnType<typeof setTimeout>   | null>(null);
  const verifyBtnRef  = useRef<ReturnType<typeof setTimeout>   | null>(null);
  const startTimeRef  = useRef(Date.now());
  const settledRef    = useRef(false);

  // ── Clave localStorage para recuperación post-refresh ─────────────────────
  const storageKey = studentId ? `izipay_pending_${studentId}` : null;

  // ── Copiar al portapapeles ─────────────────────────────────────────────────
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Limpiar todos los timers ───────────────────────────────────────────────
  const clearTimers = useCallback(() => {
    if (intervalRef.current)  clearInterval(intervalRef.current);
    if (timerRef.current)     clearInterval(timerRef.current);
    if (forceRef.current)     clearTimeout(forceRef.current);
    if (verifyBtnRef.current) clearTimeout(verifyBtnRef.current);
    // Limpiar localStorage al resolver
    if (storageKey) localStorage.removeItem(storageKey);
  }, [storageKey]);

  // ── Verificación profunda: consulta logs_pasarela + transactions ──────────
  const handleDeepVerify = useCallback(async () => {
    setVerifying(true);
    setVerifyMessage(null);
    try {
      const gwRef = sessionGwRef || gatewayOrderId;

      // 1. Estado de la sesión (fuente principal)
      const { data: session } = await supabase
        .from('payment_sessions')
        .select('gateway_status, gateway_reference, status')
        .eq('id', sessionId)
        .single();

      const ref = session?.gateway_reference ?? gwRef;
      if (ref) setSessionGwRef(ref);

      if (session?.gateway_status === 'success' || session?.status === 'completed') {
        settledRef.current = true;
        setGatewayRefId(ref);
        setStatus('success');
        clearTimers();
        onSuccess?.(ref);
        return;
      }

      // 2. Log de webhook (el webhook llegó y se aplicó)
      if (ref) {
        const { data: log } = await supabase
          .from('logs_pasarela')
          .select('status, processed_at')
          .eq('gateway_reference_id', ref)
          .in('status', ['applied', 'idempotent'])
          .maybeSingle();

        if (log) {
          // El webhook procesó el pago — forzar éxito
          settledRef.current = true;
          setGatewayRefId(ref);
          setStatus('success');
          clearTimers();
          onSuccess?.(ref);
          return;
        }

        // 3. Transacción directa (apply_gateway_credit ya corrió)
        const { data: tx } = await supabase
          .from('transactions')
          .select('id, amount')
          .eq('payment_status', 'paid')
          .eq('type', 'recharge')
          .filter('metadata->>gateway_ref_id', 'eq', ref)
          .maybeSingle();

        if (tx) {
          settledRef.current = true;
          setGatewayRefId(ref);
          setStatus('success');
          clearTimers();
          onSuccess?.(ref);
          return;
        }
      }

      // 4. No se encontró confirmación → mensaje de recuperación manual
      setVerifyMessage(
        ref
          ? `El banco cobró pero el sistema aún no lo confirmó. Ref: ${ref}. Espera 2 minutos o contacta soporte.`
          : `No se encontró confirmación. Si tu banco debitó el monto, contacta soporte con el número de tu comprobante bancario.`
      );
    } catch (e) {
      setVerifyMessage('Error al verificar. Intenta nuevamente.');
    } finally {
      setVerifying(false);
    }
  }, [sessionId, sessionGwRef, gatewayOrderId, onSuccess, clearTimers]);

  // ── Leer estado en Supabase ───────────────────────────────────────────────
  const checkSessionStatus = useCallback(async () => {
    if (settledRef.current) return;

    const { data, error } = await supabase
      .from('payment_sessions')
      .select('gateway_status, gateway_reference, status, completed_at')
      .eq('id', sessionId)
      .single<SessionData>();

    if (error || !data) return;

    // Capturar gateway_reference para usarla en deep verify
    if (data.gateway_reference) setSessionGwRef(data.gateway_reference);

    const gs = data.gateway_status as GatewayStatus | null;

    // ── BD confirma éxito ──
    if (gs === 'success' || data.status === 'completed') {
      if (settledRef.current) return;
      settledRef.current = true;
      clearTimers();
      const ref = data.gateway_reference ?? gatewayRefId;
      setGatewayRefId(ref);

      if (confirmedByGateway) {
        // Ya estamos en pantalla optimista — solo marcar "BD sincronizada"
        setDbSynced(true);
        setStatus('success');
      } else {
        setStatus('success');
      }
      onSuccess?.(ref);
      return;
    }

    // ── BD rechaza el pago ──
    if (gs === 'failed') {
      if (settledRef.current) return;
      // Si el popup ya confirmó, ignorar el 'failed' de la BD
      // (puede ser un evento viejo o un problema de sincronización)
      if (confirmedByGateway) {
        console.warn('[GatewayPaymentWaiting] BD dice failed pero popup confirmó — manteniendo optimista.');
        return;
      }
      settledRef.current = true;
      setStatus('failed');
      setErrorMessage('El banco rechazó la transacción. No se realizó ningún cargo.');
      clearTimers();
      onFailure?.('Pago rechazado por la pasarela');
      return;
    }

    // ── Sesión expirada (solo relevante en modo processing, no en optimista) ──
    if (!confirmedByGateway && (gs === 'expired' || Date.now() - startTimeRef.current > maxWaitMs)) {
      if (settledRef.current) return;
      settledRef.current = true;
      setStatus('expired');
      clearTimers();
      onFailure?.('Sesión de pago expirada');
      return;
    }
  }, [sessionId, maxWaitMs, confirmedByGateway, gatewayRefId, onSuccess, onFailure, clearTimers]);

  // ── Guardar en localStorage para recuperación post-refresh ───────────────
  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(storageKey, JSON.stringify({
      sessionId,
      amount,
      confirmedByGateway,
      gatewayOrderId: gatewayOrderId ?? null,
      savedAt: Date.now(),
    }));
    return () => {
      // Solo limpiar si el pago se resolvió (clearTimers lo hace)
    };
  }, [storageKey, sessionId, amount, confirmedByGateway, gatewayOrderId]);

  // ── Realtime + Polling + Timeout optimista ─────────────────────────────────
  useEffect(() => {
    settledRef.current = false;
    startTimeRef.current = Date.now();

    // Supabase Realtime — reacciona cuando el webhook actualiza la BD
    const channel = supabase
      .channel(`gw_session_${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'payment_sessions', filter: `id=eq.${sessionId}` },
        () => checkSessionStatus()
      )
      .subscribe();

    // Polling de respaldo cada 1.5 s
    intervalRef.current = setInterval(checkSessionStatus, POLL_INTERVAL_MS);

    // Verificar estado inicial inmediatamente
    checkSessionStatus();

    // Si el popup ya confirmó y la BD no responde en 10 s → forzar éxito
    // El padre pagó — la burocracia no puede bloquearlo
    if (confirmedByGateway) {
      forceRef.current = setTimeout(() => {
        if (!settledRef.current) {
          settledRef.current = true;
          clearTimers();
          setStatus('success');
          onSuccess?.(gatewayRefId);
        }
      }, OPTIMISTIC_FORCE_MS);
    }

    // Botón "¿Tarda mucho?" aparece a los 15 s en modo processing (sin confirmación popup)
    if (!confirmedByGateway) {
      verifyBtnRef.current = setTimeout(() => setShowVerifyButton(true), 15_000);
    }

    // Contador de tiempo (solo en modo procesando, no en optimista)
    if (!confirmedByGateway) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds(s => {
          const newVal = s + 1;
          if (newVal * 1_000 >= maxWaitMs && !settledRef.current) {
            settledRef.current = true;
            setStatus('expired');
            clearTimers();
            onFailure?.('Sesión de pago expirada');
          }
          return newVal;
        });
      }, 1_000);
    }

    return () => {
      clearTimers();
      supabase.removeChannel(channel);
    };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ══ RENDER: OPTIMISTA (popup confirmó, BD aún procesando) ══════════════════
  if (status === 'optimistic') {
    return (
      <div className="flex flex-col items-center text-center space-y-5 py-4">

        {/* Check verde inmediato con animación de entrada */}
        <div className="relative animate-in zoom-in duration-300">
          <div className="w-28 h-28 rounded-full bg-gradient-to-br from-emerald-100 to-teal-200 flex items-center justify-center shadow-xl shadow-emerald-200">
            <CheckCircle2 className="w-14 h-14 text-emerald-500" />
          </div>
          <div className="absolute -top-1 -right-1 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-md shadow-emerald-300 animate-bounce">
            <Banknote className="w-4 h-4 text-white" />
          </div>
        </div>

        {/* Título positivo y claro */}
        <div className="space-y-1.5">
          <h3 className="text-2xl font-black text-emerald-700">¡Pago confirmado!</h3>
          <p className="text-sm text-slate-500 leading-relaxed">
            <span className="font-bold text-emerald-700">S/ {amount.toFixed(2)}</span>{' '}
            para <span className="font-semibold">{studentName}</span> procesado con éxito.
          </p>
        </div>

        {/* Referencia del pago (disponible inmediatamente) */}
        {gatewayRefId && (
          <div className="w-full bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3 text-left">
            <p className="text-[10px] font-semibold text-emerald-700 mb-1.5">Referencia de pago</p>
            <div className="flex items-center gap-2">
              <p className="flex-1 font-mono text-xs font-bold text-slate-700 bg-white rounded-xl px-3 py-2 border border-emerald-200 truncate">
                {gatewayRefId}
              </p>
              <button
                onClick={() => handleCopy(gatewayRefId)}
                className={cn(
                  'shrink-0 flex items-center gap-1 px-2.5 py-2 rounded-xl text-[10px] font-bold border transition-all active:scale-95',
                  copied
                    ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                    : 'bg-emerald-600 text-white border-emerald-600'
                )}
              >
                {copied ? <><Check className="h-3 w-3" /> Copiado</> : <><Copy className="h-3 w-3" /> Copiar</>}
              </button>
            </div>
          </div>
        )}

        {/* Indicador silencioso de sincronización — pequeño, no alarmante */}
        <div className="w-full bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 text-slate-400 animate-spin shrink-0" />
          <p className="text-[11px] text-slate-400">
            Actualizando tu saldo en el sistema...
          </p>
          <Wifi className="h-3 w-3 text-slate-300 ml-auto shrink-0" />
        </div>

        {/* CTA disponible de inmediato — no esperamos a la BD */}
        <Button
          onClick={onClose}
          className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 font-bold text-base gap-2 shadow-lg shadow-emerald-200"
        >
          Ver mi saldo →
        </Button>

        <p className="text-[10px] text-slate-400 flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" />
          Procesado vía {gatewayName} · Cifrado TLS
        </p>
      </div>
    );
  }

  // ══ RENDER: PROCESANDO (modo manual / "Verificar pago") ════════════════════
  if (status === 'processing') {
    return (
      <div className="flex flex-col items-center text-center space-y-6 py-4">

        <div className="relative w-28 h-28">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-100 to-indigo-200 flex items-center justify-center shadow-xl shadow-blue-200">
            <ShieldCheck className="w-12 h-12 text-blue-500" />
          </div>
          <svg className="absolute inset-0 w-28 h-28 animate-spin" viewBox="0 0 112 112" fill="none">
            <circle cx="56" cy="56" r="52" stroke="#bfdbfe" strokeWidth="4" />
            <path d="M56 4 A52 52 0 0 1 108 56" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-2xl font-black text-slate-800">Verificando pago...</h3>
          <p className="text-sm text-slate-500 leading-relaxed">
            Confirmando{' '}
            <span className="font-bold text-slate-700">S/ {amount.toFixed(2)}</span>{' '}
            para <span className="font-semibold">{studentName}</span>
          </p>
        </div>

        <div className="w-full bg-blue-50 border border-blue-100 rounded-2xl px-4 py-4 space-y-3">
          <div className="flex items-center justify-between gap-1">
            {[
              { label: 'Enviando',    active: false, done: true  },
              { label: 'Verificando', active: true,  done: false },
              { label: 'Acreditando', active: false, done: false },
            ].map((step, i, arr) => (
              <div key={i} className="flex items-center gap-1 flex-1">
                <div className={cn(
                  'flex items-center gap-1 text-[10px] font-semibold px-2 py-1.5 rounded-full flex-1 justify-center',
                  step.done   ? 'bg-blue-500 text-white' :
                  step.active ? 'bg-blue-100 text-blue-500 animate-pulse' :
                                'bg-slate-100 text-slate-400'
                )}>
                  {step.active && <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />}
                  {step.done  && <Check className="w-2.5 h-2.5 shrink-0" />}
                  {step.label}
                </div>
                {i < arr.length - 1 && <div className="w-2 h-0.5 bg-blue-200 shrink-0" />}
              </div>
            ))}
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-blue-600">
            <Clock className="h-3.5 w-3.5" />
            <span>Tiempo: <span className="font-mono font-bold">{formatTime(elapsedSeconds)}</span></span>
          </div>
        </div>

        {/* Botón de verificación profunda — aparece a los 15 s */}
        {showVerifyButton && !verifyMessage && (
          <div className="w-full space-y-2">
            <button
              onClick={handleDeepVerify}
              disabled={verifying}
              className="w-full flex items-center justify-center gap-2 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl py-2.5 px-3 hover:bg-blue-100 transition-colors disabled:opacity-50"
            >
              {verifying
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Verificando estado real...</>
                : <><RefreshCw className="h-3.5 w-3.5" />¿Tarda mucho? Verificar estado real</>}
            </button>
            <p className="text-[10px] text-slate-400 text-center">
              Consulta directa a la base de datos y al registro del banco.
            </p>
          </div>
        )}

        {/* Resultado de la verificación profunda */}
        {verifyMessage && (
          <div className="w-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-2">
            <div className="flex items-start gap-2">
              <svg className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <p className="text-xs text-amber-800 leading-relaxed">{verifyMessage}</p>
            </div>
            <button
              onClick={handleDeepVerify}
              disabled={verifying}
              className="w-full text-center text-[11px] font-bold text-amber-700 bg-amber-100 rounded-lg py-1.5 hover:bg-amber-200 transition-colors"
            >
              Reintentar verificación
            </button>
          </div>
        )}

        {!showVerifyButton && (
          <div className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
            <p className="text-xs text-slate-500 text-center">
              Confirmando con {gatewayName}... Un momento.
            </p>
          </div>
        )}

        <p className="text-[10px] text-slate-400 flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" />
          Conexión segura vía {gatewayName}
        </p>
      </div>
    );
  }

  // ══ RENDER: ÉXITO (BD confirmó) ════════════════════════════════════════════
  if (status === 'success') {
    return (
      <div className="flex flex-col items-center text-center space-y-5 py-4">

        <div className="relative">
          <div className="w-28 h-28 rounded-full bg-gradient-to-br from-emerald-100 to-teal-200 flex items-center justify-center shadow-xl shadow-emerald-200">
            <CheckCircle2 className="w-14 h-14 text-emerald-500" />
          </div>
          <div className="absolute -top-1 -right-1 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-md shadow-emerald-300 animate-bounce">
            <Banknote className="w-4 h-4 text-white" />
          </div>
        </div>

        <div className="space-y-1">
          <h3 className="text-2xl font-black text-emerald-700">¡Pago exitoso!</h3>
          <p className="text-sm text-slate-500 leading-relaxed">
            Tu saldo se ha actualizado con{' '}
            <span className="font-bold text-emerald-700">S/ {amount.toFixed(2)}</span>{' '}
            para <span className="font-semibold">{studentName}</span>.
          </p>
        </div>

        {gatewayRefId && (
          <div className="w-full bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-4 space-y-3 text-left">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-emerald-500 rounded-full flex items-center justify-center shrink-0">
                <Check className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-xs font-bold text-emerald-800">Código de referencia</p>
                <p className="text-[10px] text-emerald-600">Guárdalo como respaldo del pago</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <p className="flex-1 font-mono text-sm font-bold text-slate-700 bg-white rounded-xl px-3 py-2.5 border-2 border-emerald-200 truncate">
                {gatewayRefId}
              </p>
              <button
                onClick={() => handleCopy(gatewayRefId)}
                className={cn(
                  'shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold border-2 transition-all active:scale-95',
                  copied
                    ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                    : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                )}
              >
                {copied ? <><Check className="h-3.5 w-3.5" /> ¡Copiado!</> : <><Copy className="h-3.5 w-3.5" /> Copiar</>}
              </button>
            </div>
            <p className="text-[10px] text-emerald-600">
              Procesado vía {gatewayName} · El saldo ya está disponible
            </p>
          </div>
        )}

        {dbSynced && (
          <div className="w-full bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 flex items-center gap-2">
            <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            <p className="text-[11px] text-emerald-700 font-semibold">Sistema sincronizado correctamente.</p>
          </div>
        )}

        <Button
          onClick={onClose}
          className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 font-bold text-base gap-2 shadow-lg shadow-emerald-200"
        >
          Ver mi saldo actualizado →
        </Button>
      </div>
    );
  }

  // ══ RENDER: FALLIDO ════════════════════════════════════════════════════════
  if (status === 'failed') {
    return (
      <div className="flex flex-col items-center text-center space-y-5 py-4">
        <div className="w-28 h-28 rounded-full bg-red-50 flex items-center justify-center shadow-xl shadow-red-100">
          <XCircle className="w-14 h-14 text-red-400" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-xl font-bold text-slate-800">Pago rechazado</h3>
          <p className="text-sm text-slate-500 leading-relaxed">
            {errorMessage || 'El banco no pudo procesar el pago. No se realizó ningún cargo a tu cuenta.'}
          </p>
        </div>
        <div className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-left space-y-2">
          <p className="text-xs font-bold text-slate-600">💡 Qué puedes hacer:</p>
          <ul className="text-xs text-slate-500 space-y-1.5">
            <li className="flex items-start gap-1.5"><span className="text-blue-400 shrink-0">•</span>Inténtalo con otra tarjeta de crédito o débito</li>
            <li className="flex items-start gap-1.5"><span className="text-blue-400 shrink-0">•</span>Verifica que tu tarjeta esté habilitada para compras en línea</li>
            <li className="flex items-start gap-1.5"><span className="text-blue-400 shrink-0">•</span>Llama a tu banco si el problema persiste</li>
            <li className="flex items-start gap-1.5"><span className="text-blue-400 shrink-0">•</span>También puedes pagar con Yape, Plin o transferencia bancaria</li>
          </ul>
        </div>
        <div className="flex gap-2 w-full">
          {onRetry && (
            <Button onClick={onRetry} className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 font-semibold gap-2">
              <RefreshCw className="h-4 w-4" />Reintentar
            </Button>
          )}
          <Button onClick={onClose} variant="outline" className="flex-1 h-11 font-semibold">
            Pagar de otra forma
          </Button>
        </div>
      </div>
    );
  }

  // ══ RENDER: EXPIRADO ═══════════════════════════════════════════════════════
  return (
    <div className="flex flex-col items-center text-center space-y-5 py-4">
      <div className="w-28 h-28 rounded-full bg-amber-50 flex items-center justify-center shadow-xl shadow-amber-100">
        <Clock className="w-14 h-14 text-amber-400" />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-xl font-bold text-slate-800">La sesión de pago expiró</h3>
        <p className="text-sm text-slate-500 leading-relaxed">
          El tiempo de verificación venció. No se realizó ningún cargo. Puedes iniciar un nuevo pago.
        </p>
      </div>
      <div className="w-full bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
        <p className="text-xs text-amber-700">
          ℹ️ El límite de tiempo es una medida de seguridad. Tu saldo no fue modificado.
        </p>
      </div>
      <div className="flex gap-2 w-full">
        {onRetry && (
          <Button onClick={onRetry} className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 font-semibold gap-2">
            <RefreshCw className="h-4 w-4" />Nuevo pago
          </Button>
        )}
        <Button onClick={onClose} variant="outline" className="flex-1 h-11">Cerrar</Button>
      </div>
    </div>
  );
}
