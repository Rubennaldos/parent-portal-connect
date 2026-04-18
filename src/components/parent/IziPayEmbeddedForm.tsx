/**
 * IziPayEmbeddedForm — Formulario embebido IziPay (KR.js correcto)
 *
 * REGLAS CRÍTICAS de KR.js (aprendidas de la doc oficial):
 *  1. NUNCA ocultar .kr-embedded con display:none — rompe los iframes PCI
 *  2. Los campos PAN/Expiry/CVV están en iframes — no se pueden estilizar desde afuera
 *  3. El spinner de carga debe ser un overlay ENCIMA, no reemplazar el div
 *  4. El contenedor NO puede tener overflow:hidden — corta los iframes
 *  5. Solo se puede estilizar: botón PAGAR, selects de cuotas, nombre del titular
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, ShieldCheck, Lock, CreditCard } from 'lucide-react';

declare global {
  interface Window {
    KR?: {
      onSubmit:      (cb: (r: any) => boolean | void) => void;
      onError:       (cb: (e: any) => void) => void;
      setFormConfig: (cfg: Record<string, string>) => void;
    };
  }
}

interface IziPayEmbeddedFormProps {
  formToken:     string;
  publicKey:     string;
  amount:        number;
  krJsUrl?:      string;
  onFormSubmit?: () => void;
  onFormError?:  (msg: string) => void;
  onCancel?:     () => void;
}

const KR_JS  = 'https://static.micuentaweb.pe/static/js/krypton-client/V4.0/stable/kr-payment-form.min.js';
const KR_CSS = 'https://static.micuentaweb.pe/static/js/krypton-client/V4.0/stable/kr-payment-form.css';

/**
 * Solo estilos en elementos NO-iframe:
 * Los campos PAN/fecha/CVV están en iframes → sólo podemos estilizar sus CONTENEDORES
 * y el resto del form (botón, selects, nombre).
 */
const SAFE_CSS = `
  /* Wrapper limpio */
  .kr-embedded {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
  }

  /* ── Contenedores de los iframes (PAN, fecha, CVV) ────────────────────────
     No podemos estilizar DENTRO del iframe, pero sí su caja exterior.
     Le damos borde, fondo, altura y radio para que se vea como un input real. */
  .kr-field-wrapper {
    margin-bottom: 14px !important;
  }
  .kr-label, .kr-field-label {
    display: block !important;
    font-size: 11px !important;
    font-weight: 600 !important;
    color: #64748b !important;
    text-transform: uppercase !important;
    letter-spacing: .05em !important;
    margin-bottom: 5px !important;
  }
  /* La caja que rodea al iframe */
  .kr-field,
  .kr-pan-field,
  .kr-expiry-field,
  .kr-security-code-field,
  .kr-card-holder-name-field {
    border: 1.5px solid #e2e8f0 !important;
    border-radius: 10px !important;
    background: #f8fafc !important;
    min-height: 46px !important;
    height: 46px !important;
    display: flex !important;
    align-items: center !important;
    padding: 0 14px !important;
    transition: border-color .2s, box-shadow .2s !important;
    overflow: hidden !important;
  }
  .kr-field:focus-within,
  .kr-pan-field:focus-within,
  .kr-expiry-field:focus-within,
  .kr-security-code-field:focus-within {
    border-color: #3b82f6 !important;
    box-shadow: 0 0 0 3px rgba(59,130,246,.15) !important;
    background: #fff !important;
  }
  /* El iframe dentro de la caja */
  .kr-field iframe,
  .kr-pan-field iframe,
  .kr-expiry-field iframe,
  .kr-security-code-field iframe {
    width: 100% !important;
    height: 38px !important;
    min-height: 38px !important;
    border: none !important;
    background: transparent !important;
    display: block !important;
  }

  /* ── Fila Fecha + CVV lado a lado ── */
  .kr-expiry-field,
  .kr-security-code-field {
    width: 100% !important;
  }

  /* ── Botón PAGAR ── */
  .kr-payment-button {
    width: 100% !important;
    background: linear-gradient(135deg, #1d4ed8, #2563eb) !important;
    color: #fff !important;
    font-size: 15px !important;
    font-weight: 700 !important;
    letter-spacing: .04em !important;
    border: none !important;
    border-radius: 12px !important;
    padding: 14px 0 !important;
    margin-top: 12px !important;
    cursor: pointer !important;
    box-shadow: 0 4px 14px rgba(37,99,235,.30) !important;
    transition: opacity .15s, transform .1s !important;
  }
  .kr-payment-button:hover  { opacity: .92 !important; }
  .kr-payment-button:active { transform: scale(.98) !important; }

  /* ── Selects de cuotas ── */
  .kr-installment-number-field select,
  .kr-first-installment-delay-field select {
    width: 100% !important;
    border: 1.5px solid #e2e8f0 !important;
    border-radius: 10px !important;
    padding: 10px 12px !important;
    font-size: 14px !important;
    background: #f8fafc !important;
    color: #1e293b !important;
    margin-bottom: 10px !important;
    height: 44px !important;
  }

  /* ── Campo nombre del titular (input normal, no iframe) ── */
  .kr-card-holder-name input {
    width: 100% !important;
    border: none !important;
    background: transparent !important;
    font-size: 15px !important;
    color: #1e293b !important;
    outline: none !important;
    height: 38px !important;
  }

  /* ── Mensajes de error ── */
  .kr-form-error, .kr-field-error {
    color: #ef4444 !important;
    font-size: 12px !important;
    margin-top: 4px !important;
    padding: 0 !important;
  }
`;

export function IziPayEmbeddedForm({
  formToken,
  publicKey,
  amount,
  krJsUrl = KR_JS,
  onFormSubmit,
  onFormError,
  onCancel,
}: IziPayEmbeddedFormProps) {
  const [loading, setLoading] = useState(true);
  const mountedRef             = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // CSS base de KR.js
    if (!document.querySelector(`link[href="${KR_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel   = 'stylesheet';
      link.href  = KR_CSS;
      document.head.appendChild(link);
    }

    // CSS personalizado seguro (solo elementos no-iframe)
    const STYLE_ID = 'izipay-safe-style';
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id        = STYLE_ID;
      style.innerHTML = SAFE_CSS;
      document.head.appendChild(style);
    }

    // Si KR.js ya está cargado → actualizar token y reiniciar
    const existing = document.querySelector(`script[src="${krJsUrl}"]`);
    if (existing) {
      const tryInit = () => {
        if (!window.KR) { setTimeout(tryInit, 150); return; }
        try {
          window.KR.setFormConfig({
            'kr-public-key': publicKey,
            'kr-form-token': formToken,
          });
        } catch { /* ignore */ }
        registerCallbacks();
        if (mountedRef.current) setLoading(false);
      };
      tryInit();
      return;
    }

    // Primera carga
    const script = document.createElement('script');
    script.src = krJsUrl;
    script.setAttribute('kr-public-key', publicKey);
    script.setAttribute('kr-post-url',   'javascript:void(0);');
    script.setAttribute('kr-language',   'es-PE');

    script.onload = () => {
      if (!mountedRef.current) return;
      registerCallbacks();
      setLoading(false);
    };
    script.onerror = () => {
      if (!mountedRef.current) return;
      onFormError?.('No se pudo cargar el formulario de pago.');
      setLoading(false);
    };

    document.head.appendChild(script);
    return () => { mountedRef.current = false; };
  }, [formToken, publicKey, krJsUrl]);

  const registerCallbacks = () => {
    if (!window.KR) return;
    window.KR.onSubmit?.(() => { onFormSubmit?.(); return false; });
    window.KR.onError?.((err: any) => {
      const msg = err?.clientMessage || err?.errorMessage || 'Error en el formulario';
      onFormError?.(msg);
    });
  };

  const overlay = (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
      className="flex items-center justify-center p-4"
    >
      {/* Fondo oscuro — click cierra */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(15,23,42,0.72)',
          backdropFilter: 'blur(6px)',
        }}
        onClick={onCancel}
      />

      {/* Tarjeta de pago — SIN overflow:hidden para no cortar iframes */}
      <div
        className="relative w-full bg-white rounded-2xl shadow-2xl"
        style={{ maxWidth: 420, animation: 'izipayIn .2s ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
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
                  aria-label="Cancelar pago"
                >
                  <X className="h-4 w-4 text-white" />
                </button>
              )}
            </div>
          </div>

          {/* Marcas aceptadas */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {['VISA', 'Mastercard', 'AMEX', 'Diners', 'Yape QR'].map((m) => (
              <span
                key={m}
                className="text-[9px] font-bold text-white/90 bg-white/15 px-2 py-0.5 rounded-md tracking-wide"
              >
                {m}
              </span>
            ))}
          </div>
        </div>

        {/* ── Cuerpo ── */}
        {/* IMPORTANTE: position:relative para el spinner overlay, pero NO overflow:hidden */}
        <div className="px-5 pt-5 pb-3" style={{ position: 'relative', minHeight: 180 }}>
          {/* Spinner de carga — overlay encima del form, NO reemplaza el div kr-embedded */}
          {loading && (
            <div
              style={{
                position: 'absolute', inset: 0,
                background: '#fff',
                zIndex: 10,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                borderRadius: 8,
              }}
            >
              <Loader2 className="h-9 w-9 animate-spin text-blue-500" />
              <p className="text-sm font-medium text-slate-400">Cargando formulario seguro…</p>
            </div>
          )}

          {/*
            KR.js inyecta el formulario aquí.
            NUNCA poner display:none — rompe los iframes PCI internos.
            El token va en el atributo data-kr-form-token (KR.js lo lee al cargar).
          */}
          <div
            className="kr-embedded"
            data-kr-form-token={formToken}
          />
        </div>

        {/* ── Footer ── */}
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
      </div>

      <style>{`
        @keyframes izipayIn {
          from { opacity:0; transform:translateY(18px) scale(.97); }
          to   { opacity:1; transform:translateY(0)    scale(1);   }
        }
      `}</style>
    </div>
  );

  return createPortal(overlay, document.body);
}
