/**
 * IziPayEmbeddedForm — Bunker iframe strategy
 *
 * El formulario de IziPay vive en /izipay-frame.html (su propio window).
 * Cada vez que el modal se abre, el iframe carga un entorno limpio:
 *  - window.KR nace y muere con el iframe
 *  - Cero conflicto de scripts (tags.js, KR.js, etc.)
 *  - CLIENT_725 es imposible: nunca hay "formulario anterior" en ese window
 *
 * Comunicación React ↔ iframe vía postMessage:
 *  IZIPAY_READY      → ocultar spinner, mostrar iframe
 *  IZIPAY_HEIGHT     → ajustar altura del iframe dinámicamente
 *  IZIPAY_SUCCESS    → pago exitoso, notificar al padre
 *  IZIPAY_ERROR      → error de formulario (tarjeta rechazada, etc.)
 *  IZIPAY_LOAD_ERROR → error de carga del SDK
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, ShieldCheck, Lock, CreditCard } from 'lucide-react';

interface IziPayEmbeddedFormProps {
  formToken:     string;
  publicKey:     string;
  amount:        number;
  onFormSubmit?: () => void;
  onFormError?:  (msg: string) => void;
  onCancel?:     () => void;
}

export function IziPayEmbeddedForm({
  formToken,
  publicKey,
  amount,
  onFormSubmit,
  onFormError,
  onCancel,
}: IziPayEmbeddedFormProps) {
  const [loading,      setLoading]      = useState(true);
  const [errMsg,       setErrMsg]       = useState<string | null>(null);
  const [iframeHeight, setIframeHeight] = useState(360);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Refs para handlers siempre actualizados sin re-montar el iframe
  const onSubmitRef = useRef(onFormSubmit);
  const onErrorRef  = useRef(onFormError);
  useEffect(() => { onSubmitRef.current = onFormSubmit; }, [onFormSubmit]);
  useEffect(() => { onErrorRef.current  = onFormError;  }, [onFormError]);

  // Escuchar mensajes del iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Ignorar mensajes de otros orígenes (seguridad básica)
      if (event.source !== iframeRef.current?.contentWindow) return;

      const { type, message, height } = event.data ?? {};

      switch (type) {
        case 'IZIPAY_READY':
          setLoading(false);
          break;

        case 'IZIPAY_HEIGHT':
          if (typeof height === 'number' && height > 0) {
            setIframeHeight(height + 16); // +16px de margen
          }
          break;

        case 'IZIPAY_SUCCESS':
          onSubmitRef.current?.();
          break;

        case 'IZIPAY_ERROR':
          onErrorRef.current?.(message || 'Error en el formulario');
          break;

        case 'IZIPAY_LOAD_ERROR':
          setErrMsg(message || 'Error al cargar el formulario de pago.');
          setLoading(false);
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []); // Sin deps: los handlers usan refs

  // URL del iframe: token y publicKey como parámetros de query
  const iframeSrc =
    `/izipay-frame.html` +
    `?token=${encodeURIComponent(formToken)}` +
    `&key=${encodeURIComponent(publicKey)}` +
    `&ts=${Date.now()}`; // cache-bust por si el browser cachea el HTML

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
      className="flex items-center justify-center p-4"
    >
      {/* Fondo */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(15,23,42,.72)',
          backdropFilter: 'blur(6px)',
        }}
        onClick={onCancel}
      />

      {/* Tarjeta */}
      <div
        className="relative w-full bg-white rounded-2xl shadow-2xl"
        style={{ maxWidth: 420, animation: 'izipayIn .2s ease-out' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-5 py-4 rounded-t-2xl"
          style={{ background: 'linear-gradient(135deg,#1e3a8a,#2563eb)' }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="bg-white/20 rounded-full p-1.5">
                <ShieldCheck className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-white font-bold text-sm leading-tight">Pago seguro</p>
                <p className="text-blue-200 text-[11px] mt-0.5">Cifrado TLS · Powered by IziPay</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                <p className="text-blue-200 text-[10px] uppercase tracking-widest">Total</p>
                <p className="text-white font-extrabold text-2xl leading-tight">
                  S/ {amount.toFixed(2)}
                </p>
              </div>
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="ml-2 bg-white/15 hover:bg-white/30 rounded-full p-1.5 transition-colors"
                  aria-label="Cerrar"
                >
                  <X className="h-4 w-4 text-white" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 mt-3">
            {['VISA', 'Mastercard', 'AMEX', 'Diners', 'Yape QR'].map(m => (
              <span key={m}
                className="text-[9px] font-bold text-white/90 bg-white/15 px-2 py-0.5 rounded-md tracking-wide"
              >
                {m}
              </span>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-4 pt-4 pb-3" style={{ position: 'relative' }}>

          {/* Spinner mientras el iframe carga */}
          {loading && !errMsg && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 className="h-9 w-9 animate-spin text-blue-500" />
              <p className="text-sm font-medium text-slate-400">Cargando formulario seguro…</p>
            </div>
          )}

          {/* Error de carga */}
          {errMsg && (
            <div className="text-center py-8 text-sm text-red-500 font-medium">{errMsg}</div>
          )}

          {/*
            El iframe es el búnker: KR.js vive aquí, aislado del React principal.
            Se muestra con opacity:0 mientras carga (IZIPAY_READY lo hace visible).
            border:none y overflow:hidden dan aspecto embebido.
          */}
          {!errMsg && (
            <iframe
              ref={iframeRef}
              src={iframeSrc}
              title="Formulario de pago seguro IziPay"
              style={{
                width: '100%',
                height: loading ? 0 : iframeHeight,
                border: 'none',
                display: 'block',
                overflow: 'hidden',
                transition: 'height .3s ease',
              }}
              allow="payment"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            />
          )}
        </div>

        {/* Footer */}
        {!loading && !errMsg && (
          <div className="px-5 pb-4 pt-1 flex items-center justify-center gap-4 border-t border-slate-100">
            <div className="flex items-center gap-1 text-slate-400">
              <Lock className="h-3 w-3" />
              <span className="text-[10px] font-medium">SSL 256-bit</span>
            </div>
            <span className="text-slate-200">|</span>
            <div className="flex items-center gap-1 text-slate-400">
              <CreditCard className="h-3 w-3" />
              <span className="text-[10px] font-medium">Datos encriptados</span>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes izipayIn {
          from { opacity:0; transform:translateY(18px) scale(.97); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
      `}</style>
    </div>,
    document.body
  );
}
