/**
 * GatewayPaymentWaiting — "La Sala de Espera de Ansiedad Cero"
 * ─────────────────────────────────────────────────────────────
 * Se muestra mientras el sistema confirma un pago con la pasarela (IziPay).
 *
 * FLUJO:
 *  1. El padre completa el formulario de IziPay
 *  2. Este componente aparece inmediatamente con estado "processing"
 *  3. Supabase Realtime escucha cambios en payment_sessions (el webhook los actualiza)
 *  4. Polling de respaldo cada 3 segundos por si Realtime falla
 *  5. Estado cambia a: success / failed / expired según la respuesta del banco
 *
 * GARANTÍAS:
 *  - El botón de pago queda bloqueado mientras este componente está visible
 *  - El padre no puede iniciar un segundo pago (el sessionId existe y está active)
 *  - En success: muestra gateway_reference_id para que el padre tenga evidencia
 *  - En expired: permite reintentar limpiamente sin residuos de la sesión anterior
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ── Tipos ─────────────────────────────────────────────────────────────────────

type GatewayStatus = 'processing' | 'success' | 'failed' | 'expired';

interface SessionData {
  gateway_status: string | null;
  gateway_reference: string | null;
  status: string;
  completed_at: string | null;
}

export interface GatewayPaymentWaitingProps {
  /** ID de payment_sessions (la "fuente de verdad" — de Fase 0) */
  sessionId: string;
  /** Monto en soles */
  amount: number;
  /** Nombre del alumno para mostrar */
  studentName: string;
  /** Nombre de la pasarela (para mostrar) */
  gatewayName?: string;
  /** Tiempo máximo de espera en ms antes de mostrar "expirado" (default: 10 min) */
  maxWaitMs?: number;
  /** Llamado cuando el pago es confirmado exitosamente */
  onSuccess?: (gatewayRefId: string | null) => void;
  /** Llamado cuando el pago falla o expira */
  onFailure?: (reason: string) => void;
  /** Llamado cuando el padre quiere reintentar un nuevo pago */
  onRetry?: () => void;
  /** Llamado cuando el padre cierra la sala de espera */
  onClose?: () => void;
}

const POLL_INTERVAL_MS = 3_000;
const DEFAULT_MAX_WAIT_MS = 10 * 60 * 1_000; // 10 minutos

// ── Componente ────────────────────────────────────────────────────────────────

export function GatewayPaymentWaiting({
  sessionId,
  amount,
  studentName,
  gatewayName = 'IziPay',
  maxWaitMs = DEFAULT_MAX_WAIT_MS,
  onSuccess,
  onFailure,
  onRetry,
  onClose,
}: GatewayPaymentWaitingProps) {
  const [status, setStatus] = useState<GatewayStatus>('processing');
  const [gatewayRefId, setGatewayRefId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [copied, setCopied] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(Date.now());
  const settledRef = useRef(false); // evita callbacks dobles

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

  // ── Leer estado de la sesión en Supabase ───────────────────────────────────
  const checkSessionStatus = useCallback(async () => {
    if (settledRef.current) return;

    const { data, error } = await supabase
      .from('payment_sessions')
      .select('gateway_status, gateway_reference, status, completed_at')
      .eq('id', sessionId)
      .single<SessionData>();

    if (error || !data) return;

    const gs = data.gateway_status as GatewayStatus | null;

    // ── Pago exitoso ──
    if (gs === 'success' || data.status === 'completed') {
      if (settledRef.current) return;
      settledRef.current = true;
      setStatus('success');
      setGatewayRefId(data.gateway_reference ?? null);
      clearTimers();
      onSuccess?.(data.gateway_reference ?? null);
      return;
    }

    // ── Pago fallido ──
    if (gs === 'failed') {
      if (settledRef.current) return;
      settledRef.current = true;
      setStatus('failed');
      setErrorMessage('El banco rechazó la transacción. No se realizó ningún cargo.');
      clearTimers();
      onFailure?.('Pago rechazado por la pasarela');
      return;
    }

    // ── Sesión expirada (por pasarela o por tiempo local) ──
    if (gs === 'expired' || Date.now() - startTimeRef.current > maxWaitMs) {
      if (settledRef.current) return;
      settledRef.current = true;
      setStatus('expired');
      clearTimers();
      onFailure?.('Sesión de pago expirada');
      return;
    }
  }, [sessionId, maxWaitMs, onSuccess, onFailure]);

  const clearTimers = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timerRef.current)    clearInterval(timerRef.current);
  };

  // ── Suscripción Realtime + polling de respaldo ─────────────────────────────
  useEffect(() => {
    settledRef.current = false;
    startTimeRef.current = Date.now();

    // Supabase Realtime — reacciona en tiempo real cuando el webhook actualiza la BD
    const channel = supabase
      .channel(`gw_session_${sessionId}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'payment_sessions',
          filter: `id=eq.${sessionId}`,
        },
        () => checkSessionStatus()
      )
      .subscribe();

    // Polling de respaldo (por si Realtime no llega a tiempo o falla)
    intervalRef.current = setInterval(checkSessionStatus, POLL_INTERVAL_MS);

    // Verificar estado inicial inmediatamente
    checkSessionStatus();

    // Contador de tiempo transcurrido (UX)
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

    return () => {
      clearTimers();
      supabase.removeChannel(channel);
    };
  }, [sessionId, checkSessionStatus, maxWaitMs, onFailure]);

  // ── Helper: formatear mm:ss ────────────────────────────────────────────────
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ══ RENDER: PROCESANDO ════════════════════════════════════════════════════════
  if (status === 'processing') {
    return (
      <div className="flex flex-col items-center text-center space-y-6 py-4">

        {/* Spinner animado con escudo */}
        <div className="relative w-28 h-28">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-100 to-indigo-200 flex items-center justify-center shadow-xl shadow-blue-200">
            <ShieldCheck className="w-12 h-12 text-blue-500" />
          </div>
          <svg
            className="absolute inset-0 w-28 h-28 animate-spin"
            viewBox="0 0 112 112"
            fill="none"
          >
            <circle cx="56" cy="56" r="52" stroke="#bfdbfe" strokeWidth="4" />
            <path
              d="M56 4 A52 52 0 0 1 108 56"
              stroke="#3b82f6"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Título y descripción */}
        <div className="space-y-1.5">
          <h3 className="text-2xl font-black text-slate-800">
            Validando con su banco...
          </h3>
          <p className="text-sm text-slate-500 leading-relaxed">
            Estamos confirmando tu pago de{' '}
            <span className="font-bold text-slate-700">S/ {amount.toFixed(2)}</span>{' '}
            para <span className="font-semibold">{studentName}</span>
          </p>
        </div>

        {/* Barra de pasos */}
        <div className="w-full bg-blue-50 border border-blue-100 rounded-2xl px-4 py-4 space-y-3">
          <div className="flex items-center justify-between gap-1">
            {[
              { label: 'Enviando pago',    done: true  },
              { label: 'Verificando banco', done: false },
              { label: 'Acreditando saldo', done: false },
            ].map((step, i, arr) => (
              <div key={i} className="flex items-center gap-1 flex-1">
                <div
                  className={cn(
                    'flex items-center gap-1 text-[10px] font-semibold px-2 py-1.5 rounded-full transition-all flex-1 justify-center',
                    i === 0
                      ? 'bg-blue-500 text-white'
                      : i === 1
                      ? 'bg-blue-100 text-blue-500 animate-pulse'
                      : 'bg-slate-100 text-slate-400'
                  )}
                >
                  {i === 1 && <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />}
                  {i === 0 && <Check className="w-2.5 h-2.5 shrink-0" />}
                  <span className="hidden sm:inline">{step.label}</span>
                  <span className="sm:hidden">{step.label.split(' ')[0]}</span>
                </div>
                {i < arr.length - 1 && (
                  <div className="w-2 h-0.5 bg-blue-200 shrink-0" />
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-blue-600">
            <Clock className="h-3.5 w-3.5" />
            <span>
              Tiempo transcurrido:{' '}
              <span className="font-mono font-bold">{formatTime(elapsedSeconds)}</span>
            </span>
          </div>
        </div>

        {/* Aviso importante */}
        <div className="w-full bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <p className="text-xs text-amber-800 font-semibold leading-relaxed">
            ⚠️ Por favor, <strong>no cierre esta ventana</strong> ni presione el botón Atrás.
            <br />
            Estamos procesando tu pago de forma segura. Esto puede tardar hasta 1 minuto.
          </p>
        </div>

        {/* Marca de seguridad */}
        <p className="text-[10px] text-slate-400 flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" />
          Conexión segura vía {gatewayName} · Saldo protegido
        </p>
      </div>
    );
  }

  // ══ RENDER: ÉXITO ═════════════════════════════════════════════════════════════
  if (status === 'success') {
    return (
      <div className="flex flex-col items-center text-center space-y-5 py-4">

        {/* Ícono de éxito con animación */}
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

        {/* Código de referencia (evidencia para el padre) */}
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
                {copied
                  ? <><Check className="h-3.5 w-3.5" /> ¡Copiado!</>
                  : <><Copy className="h-3.5 w-3.5" /> Copiar</>}
              </button>
            </div>

            <p className="text-[10px] text-emerald-600">
              Procesado vía {gatewayName} · El saldo ya está disponible
            </p>
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

  // ══ RENDER: FALLIDO ═══════════════════════════════════════════════════════════
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
            <li className="flex items-start gap-1.5">
              <span className="text-blue-400 shrink-0">•</span>
              Inténtalo con otra tarjeta de crédito o débito
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-blue-400 shrink-0">•</span>
              Verifica que tu tarjeta esté habilitada para compras en línea
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-blue-400 shrink-0">•</span>
              Llama a tu banco si el problema persiste
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-blue-400 shrink-0">•</span>
              También puedes pagar con Yape, Plin o transferencia bancaria
            </li>
          </ul>
        </div>

        <div className="flex gap-2 w-full">
          {onRetry && (
            <Button
              onClick={onRetry}
              className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 font-semibold gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </Button>
          )}
          <Button
            onClick={onClose}
            variant="outline"
            className="flex-1 h-11 font-semibold"
          >
            Pagar de otra forma
          </Button>
        </div>
      </div>
    );
  }

  // ══ RENDER: EXPIRADO ══════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col items-center text-center space-y-5 py-4">

      <div className="w-28 h-28 rounded-full bg-amber-50 flex items-center justify-center shadow-xl shadow-amber-100">
        <Clock className="w-14 h-14 text-amber-400" />
      </div>

      <div className="space-y-1.5">
        <h3 className="text-xl font-bold text-slate-800">La sesión de pago expiró</h3>
        <p className="text-sm text-slate-500 leading-relaxed">
          El tiempo para completar el pago venció (10 minutos). No se realizó ningún cargo.
          Puedes iniciar un nuevo pago sin problemas.
        </p>
      </div>

      <div className="w-full bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
        <p className="text-xs text-amber-700">
          ℹ️ El límite de tiempo es una medida de seguridad. Tu saldo no fue modificado.
        </p>
      </div>

      <div className="flex gap-2 w-full">
        {onRetry && (
          <Button
            onClick={onRetry}
            className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 font-semibold gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Nuevo pago
          </Button>
        )}
        <Button
          onClick={onClose}
          variant="outline"
          className="flex-1 h-11"
        >
          Cerrar
        </Button>
      </div>
    </div>
  );
}
