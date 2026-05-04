/**
 * PaymentReturn — Página de retorno post-pago IziPay (modo redirección)
 * ────────────────────────────────────────────────────────────────────────
 * El padre llega aquí después de completar (o cancelar) el formulario de
 * IziPay. izipay-frame.html redirige a esta URL con los params:
 *   ?status=success&oid=<orderId>&sid=<sessionId>
 *
 * La sesión de pago se lee desde localStorage (escrito justo antes de redirigir)
 * y también desde los query params como fallback.
 *
 * DISEÑO:
 *  - Si status=success → confirmedByGateway=true → check verde inmediato
 *  - Si no hay status   → confirmedByGateway=false → spinner con polling
 *  - onSuccess/onClose  → navega a "/" (home del padre)
 */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import { GatewayPaymentWaiting } from '@/components/parent/GatewayPaymentWaiting';

const REDIRECT_KEY = 'izipay_redirect_pending';
const MAX_AGE_MS   = 60 * 60 * 1000; // 1 hora — después se considera stale

interface StoredSession {
  sessionId:   string;
  amount:      number;
  studentName: string;
  studentId?:  string;
  savedAt:     number;
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(REDIRECT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as StoredSession;
    if (!data.sessionId || Date.now() - data.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(REDIRECT_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export default function PaymentReturn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const status  = searchParams.get('status');   // 'success' | null
  const orderId = searchParams.get('oid') ?? null;
  const sidParam = searchParams.get('sid') ?? null;

  const [stored] = useState<StoredSession | null>(() => readStoredSession());

  const sessionId   = stored?.sessionId   ?? sidParam ?? '';
  const amount      = stored?.amount      ?? 0;
  const studentName = stored?.studentName ?? 'tu hijo(a)';
  const studentId   = stored?.studentId;

  const confirmedByGateway = status === 'success';

  // Limpiar localStorage solo cuando el componente se monta (una vez)
  useEffect(() => {
    return () => {
      // Limpiar al desmontar (ya sea por éxito o por navegación manual)
      localStorage.removeItem(REDIRECT_KEY);
    };
  }, []);

  const handleDone = () => navigate('/', { replace: true });

  // Sin session → datos incompletos → redirigir a home
  if (!sessionId) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4 p-4">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        <p className="text-sm text-gray-500">Verificando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col items-center justify-center p-4">

      {/* Header de marca */}
      <div className="w-full max-w-sm mb-4">
        <div className="flex items-center gap-2 px-1">
          <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-700 leading-none">Lima Café 28</p>
            <p className="text-[10px] text-gray-400 leading-none mt-0.5">Portal de padres · Pago seguro</p>
          </div>
        </div>
      </div>

      {/* Tarjeta principal */}
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-100 p-6">
        <GatewayPaymentWaiting
          sessionId={sessionId}
          amount={amount}
          studentName={studentName}
          studentId={studentId}
          confirmedByGateway={confirmedByGateway}
          gatewayOrderId={orderId}
          onSuccess={() => {
            localStorage.removeItem(REDIRECT_KEY);
            navigate('/', { replace: true });
          }}
          onFailure={handleDone}
          onRetry={handleDone}
          onClose={handleDone}
        />
      </div>

      <p className="mt-4 text-[11px] text-slate-400 text-center">
        Procesado vía IziPay · Cifrado TLS · PCI DSS
      </p>
    </div>
  );
}
