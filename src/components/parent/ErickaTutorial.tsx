import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// ─── Constantes ───────────────────────────────────────────────────────────────
const LS_KEY = 'ericka_tutorial_completed';
const ERICKA_IMG = '/ericka.png';

// ─── Tipos ────────────────────────────────────────────────────────────────────
type TutorialFlow = 'cuenta' | 'almuerzo' | 'pagos' | null;
type TutorialPhase = 'welcome' | 'flow-menu' | 'flow-running' | 'done';

interface StepDef {
  /** Selector CSS del elemento a resaltar. Si no existe, se usa overlay genérico. */
  element?: string;
  /** Texto HTML del tooltip */
  text: string;
  /** Posición preferida del tooltip respecto al elemento */
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  /** Acción a ejecutar ANTES de mostrar este paso (cambiar pestaña, esperar modal, etc.) */
  beforeShow?: () => Promise<void>;
}

interface ErickaTutorialProps {
  userId?: string;
  schoolId?: string;
  onSetActiveTab?: (tab: string) => void;
  forceShow?: boolean;
  onClose?: () => void;
}

// ─── Helper: esperar a que un selector CSS esté en el DOM ────────────────────
function waitForElement(selector: string, timeoutMs = 3000): Promise<Element | null> {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) { observer.disconnect(); resolve(found); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
  });
}

// ─── Helper: tooltip con Ericka ──────────────────────────────────────────────
function tip(text: string): string {
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLUJO 1 — Configurar cuenta (6 pasos)
// ═══════════════════════════════════════════════════════════════════════════════
function buildFlujoCuenta(onSetActiveTab?: (tab: string) => void): StepDef[] {
  return [
    {
      element: '#nav-tab-alumnos',
      text: tip(`<strong>Paso 1/6</strong> — Lo primero es ir a la sección <strong>"Mis Hijos"</strong>. ¡Toca el botón de inicio en el menú de abajo! 👇`),
      position: 'top',
      beforeShow: async () => {
        onSetActiveTab?.('alumnos');
        await new Promise(r => setTimeout(r, 400));
      },
    },
    {
      element: '.student-card-tutorial',
      text: tip(`<strong>Paso 2/6</strong> — Aquí ves la tarjeta de tu hijo. ¿Ves el ícono de engranaje ⚙️ al lado de su nombre? Ese es el que necesitamos.`),
      position: 'bottom',
      beforeShow: async () => {
        onSetActiveTab?.('alumnos');
        await new Promise(r => setTimeout(r, 500));
      },
    },
    {
      element: '[id^="student-settings-btn-"]',
      text: tip(`<strong>Paso 3/6</strong> — ¡Ese engranaje ⚙️ es el que necesitas! Presiona el engranaje para abrir la <strong>Configuración de Cuenta</strong>.`),
      position: 'bottom',
    },
    {
      element: '#account-type-prepaid-btn',
      text: tip(`<strong>Paso 4/6</strong> — Aquí eliges entre:<br/>• <strong>Cuenta Libre</strong>: tu hijo consume y paga después.<br/>• <strong>Cuenta con Recargas</strong>: primero recargas, luego él gasta.<br/><br/>Selecciona <strong>"Cuenta con Recargas"</strong> para controlar el saldo.`),
      position: 'bottom',
      beforeShow: async () => {
        await waitForElement('#account-type-prepaid-btn', 4000);
      },
    },
    {
      element: '#account-config-save-btn',
      text: tip(`<strong>Paso 5/6</strong> — ¡Perfecto! Ahora presiona <strong>"Guardar"</strong> para que el cambio quede registrado.`),
      position: 'top',
    },
    {
      element: '.student-card-tutorial',
      text: tip(`<strong>Paso 6/6</strong> — ¡Listo! Tu hijo ahora está en <strong>Modo Recargas</strong>. 🎉<br/><br/>Cuando el módulo vuelva de mantenimiento, podrás cargarle saldo desde aquí mismo.`),
      position: 'bottom',
      beforeShow: async () => {
        await new Promise(r => setTimeout(r, 300));
      },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLUJO 2 — Pedir almuerzo (10 pasos)
// ═══════════════════════════════════════════════════════════════════════════════
function buildFlujoAlmuerzo(onSetActiveTab?: (tab: string) => void): StepDef[] {
  return [
    {
      element: '#nav-tab-almuerzos',
      text: tip(`<strong>Paso 1/10</strong> — Para pedir el almuerzo, toca el menú <strong>"Almuerzos"</strong> aquí abajo. 🍽️`),
      position: 'top',
      beforeShow: async () => {
        onSetActiveTab?.('alumnos');
        await new Promise(r => setTimeout(r, 300));
      },
    },
    {
      element: '#lunch-subtab-hacer-pedido',
      text: tip(`<strong>Paso 2/10</strong> — Estás en <strong>"Hacer Pedido"</strong>. ¡Aquí es donde se hace la magia! 🌟 También tienes "Mis Pedidos" para ver los que ya hiciste.`),
      position: 'bottom',
      beforeShow: async () => {
        onSetActiveTab?.('almuerzos');
        await waitForElement('#lunch-subtab-hacer-pedido', 2500);
      },
    },
    {
      element: '#lunch-student-selector',
      text: tip(`<strong>Paso 3/10</strong> — Primero elige a cuál de tus hijos le quieres pedir el almuerzo. Si tienes varios, aparecerán botones para cada uno. 👦👧`),
      position: 'bottom',
      beforeShow: async () => {
        await waitForElement('#lunch-student-selector', 2000);
      },
    },
    {
      element: '#lunch-calendar-header',
      text: tip(`<strong>Paso 4/10</strong> — Este es el <strong>calendario del mes</strong>. Las flechas ← → te permiten moverte entre meses.`),
      position: 'bottom',
      beforeShow: async () => {
        await waitForElement('#lunch-calendar-header', 2000);
      },
    },
    {
      element: '#lunch-calendar-header',
      text: tip(`<strong>Paso 5/10</strong> — Los días con círculo de color tienen <strong>menú disponible</strong>. Verde = ya pedido. Morado = disponible. Gris = sin menú. ¡Toca cualquier día morado! 👆`),
      position: 'bottom',
    },
    {
      element: '#lunch-calendar-header',
      text: tip(`<strong>Paso 6/10</strong> — Al tocar un día con menú, verás las <strong>categorías disponibles</strong> (Menú Escolar, Vegano, etc.). Selecciona la que prefiera tu hijo.`),
      position: 'bottom',
    },
    {
      element: '#lunch-wizard-confirm-btn',
      text: tip(`<strong>Paso 7/10</strong> — Revisa tu pedido: fecha, menú y cantidad. Si todo está bien, presiona <strong>Confirmar</strong>. ✅`),
      position: 'top',
      beforeShow: async () => {
        await waitForElement('#lunch-wizard-confirm-btn', 3000);
      },
    },
    {
      element: '#lunch-wizard-done-goto-cart',
      text: tip(`<strong>Paso 8/10</strong> — ¡Pedido creado! 🎉 Ahora tienes que pagar. El botón <strong>"Ir al Carrito"</strong> te lleva a donde puedes pagar con Yape, Plin o transferencia.`),
      position: 'top',
      beforeShow: async () => {
        await waitForElement('#lunch-wizard-done-goto-cart', 3000);
      },
    },
    {
      element: '#nav-tab-carrito',
      text: tip(`<strong>Paso 9/10</strong> — También puedes ir al <strong>Carrito</strong> desde el menú de abajo en cualquier momento. Si hay pagos pendientes, verás un número rojo que rebota. 🔴`),
      position: 'top',
    },
    {
      element: '#nav-tab-almuerzos',
      text: tip(`<strong>Paso 10/10</strong> — ¡Eso es todo! 🎊 Vuelve a <strong>Almuerzos → Mis Pedidos</strong> para ver todos tus pedidos y su estado. ¿Fácil, verdad?`),
      position: 'top',
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLUJO 3 — Hacer pagos / Carrito (8 pasos)
// ═══════════════════════════════════════════════════════════════════════════════
function buildFlujoPagos(onSetActiveTab?: (tab: string) => void): StepDef[] {
  return [
    {
      element: '#nav-tab-carrito',
      text: tip(`<strong>Paso 1/8</strong> — Para pagar tus deudas, toca el ícono del <strong>Carrito</strong> aquí abajo. Si hay deudas, verás un número rojo que rebota. 🔴`),
      position: 'top',
      beforeShow: async () => {
        onSetActiveTab?.('alumnos');
        await new Promise(r => setTimeout(r, 300));
      },
    },
    {
      element: '#cart-how-to-pay-card',
      text: tip(`<strong>Paso 2/8</strong> — ¡Importante! Puedes pagar de dos formas:<br/>• Yendo a pagar en caja del colegio.<br/>• Enviando un comprobante de <strong>Yape, Plin o transferencia</strong> desde aquí. 📱`),
      position: 'bottom',
      beforeShow: async () => {
        onSetActiveTab?.('carrito');
        await waitForElement('#cart-how-to-pay-card', 2500);
      },
    },
    {
      element: '#cart-total-pending-card',
      text: tip(`<strong>Paso 3/8</strong> — Aquí ves el <strong>total que debes</strong>. Cada línea debajo es una compra o almuerzo pendiente de pago.`),
      position: 'bottom',
      beforeShow: async () => {
        await waitForElement('#cart-total-pending-card', 2000);
      },
    },
    {
      element: '#cart-student-debt-card',
      text: tip(`<strong>Paso 4/8</strong> — Esta sección muestra las deudas por hijo. Puedes <strong>seleccionar qué compras pagar ahora</strong> y cuáles dejar para después. Muy flexible. 👌`),
      position: 'right',
      beforeShow: async () => {
        await waitForElement('#cart-student-debt-card', 2000);
      },
    },
    {
      element: '#cart-pay-selected-btn',
      text: tip(`<strong>Paso 5/8</strong> — Cuando tengas seleccionadas las compras que quieres pagar, presiona este <strong>botón verde</strong>. 💚`),
      position: 'top',
      beforeShow: async () => {
        await waitForElement('#cart-pay-selected-btn', 2000);
      },
    },
    {
      element: '#recharge-modal-amount',
      text: tip(`<strong>Paso 6/8</strong> — Se abrirá una ventana con el <strong>monto calculado automáticamente</strong>. Revísalo para confirmar que es correcto. 🔢`),
      position: 'bottom',
      beforeShow: async () => {
        await waitForElement('#recharge-modal-amount', 4000);
      },
    },
    {
      element: '#recharge-modal-upload-btn',
      text: tip(`<strong>Paso 7/8</strong> — Aquí subes la foto de tu comprobante (Yape, Plin, transferencia o voucher de caja). 📸 Es <strong>obligatorio</strong> para que el admin pueda verificarlo.`),
      position: 'top',
      beforeShow: async () => {
        await waitForElement('#recharge-modal-upload-btn', 2000);
      },
    },
    {
      element: '#recharge-modal-submit-btn',
      text: tip(`<strong>Paso 8/8</strong> — ¡Último paso! Presiona <strong>"Enviar comprobante"</strong>. El admin lo revisará y, en cuanto lo apruebe, la deuda desaparece automáticamente. ✅`),
      position: 'top',
      beforeShow: async () => {
        await waitForElement('#recharge-modal-submit-btn', 2000);
      },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASOS DE BIENVENIDA
// ═══════════════════════════════════════════════════════════════════════════════
const WELCOME_STEPS: StepDef[] = [
  {
    element: 'header',
    text: `¡Bienvenido al sistema de <strong>Lima Café 28</strong> del St George's College - Sede Miraflores! 👋<br/><br/>Mi nombre es <strong>Ericka Orrego</strong> y mi número es el <a href="https://wa.me/51932020912" target="_blank" style="color:#10b981;font-weight:bold;">+51 932 020 912</a>. ¡Presiona si quieres chatear conmigo!`,
    position: 'bottom',
  },
  {
    element: '#bottom-nav-bar',
    text: `En el menú de abajo tienes las <strong>secciones principales</strong>.<br/><br/>Presiona <strong>"¡Elegir flujo!"</strong> y te enseño paso a paso cómo usar cada parte del sistema. 👇`,
    position: 'top',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLTIP COMPONENT — Tooltip flotante posicionado sobre el elemento
// ═══════════════════════════════════════════════════════════════════════════════
interface TooltipProps {
  step: StepDef;
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  isFirst: boolean;
  isLast: boolean;
  doneLabel?: string;
  loading: boolean;
}

function ErickaTooltip({ step, stepIndex, totalSteps, onNext, onPrev, onSkip, isFirst, isLast, doneLabel, loading }: TooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, placement: 'bottom' as string });
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  // Calcular posición del tooltip relativa al elemento target
  useEffect(() => {
    if (!step.element) {
      // Sin elemento: centrar en pantalla
      setPos({ top: window.innerHeight / 2 - 120, left: window.innerWidth / 2 - 170, placement: 'center' });
      setTargetRect(null);
      return;
    }

    const el = document.querySelector(step.element);
    if (!el) {
      setPos({ top: window.innerHeight / 2 - 120, left: window.innerWidth / 2 - 170, placement: 'center' });
      setTargetRect(null);
      return;
    }

    const rect = el.getBoundingClientRect();
    setTargetRect(rect);
    const TW = 340; // tooltip width approx
    const TH = 200; // tooltip height approx
    const GAP = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let placement = step.position || 'bottom';
    let top = 0;
    let left = 0;

    if (placement === 'top') {
      top = rect.top - TH - GAP;
      left = rect.left + rect.width / 2 - TW / 2;
      if (top < 10) placement = 'bottom';
    }
    if (placement === 'bottom') {
      top = rect.bottom + GAP;
      left = rect.left + rect.width / 2 - TW / 2;
    }
    if (placement === 'left') {
      top = rect.top + rect.height / 2 - TH / 2;
      left = rect.left - TW - GAP;
      if (left < 10) placement = 'right';
    }
    if (placement === 'right') {
      top = rect.top + rect.height / 2 - TH / 2;
      left = rect.right + GAP;
    }
    if (placement === 'center') {
      top = vh / 2 - TH / 2;
      left = vw / 2 - TW / 2;
    }

    // Clamp dentro de la pantalla
    left = Math.max(8, Math.min(left, vw - TW - 8));
    top = Math.max(60, Math.min(top, vh - TH - 8));

    setPos({ top, left, placement });
  }, [step]);

  return (
    <>
      {/* Overlay oscuro */}
      <div
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.55)',
          zIndex: 99990,
        }}
        onClick={onSkip}
      />

      {/* Recuadro de highlight alrededor del elemento */}
      {targetRect && (
        <div
          style={{
            position: 'fixed',
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            border: '3px solid #10b981',
            borderRadius: '10px',
            boxShadow: '0 0 0 4px rgba(16,185,129,0.25)',
            zIndex: 99991,
            pointerEvents: 'none',
            transition: 'all 0.3s ease',
          }}
        />
      )}

      {/* Tooltip flotante */}
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          width: 340,
          zIndex: 99999,
          background: '#fff',
          border: '2px solid #10b981',
          borderRadius: '16px',
          padding: '16px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
          transition: 'all 0.25s ease',
        }}
      >
        {/* Botón omitir */}
        <button
          onClick={onSkip}
          style={{
            position: 'absolute', top: 10, right: 12,
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '11px', color: '#9ca3af', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}
        >
          Omitir
        </button>

        {/* Ericka + texto */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', marginBottom: '14px' }}>
          <img
            src={ERICKA_IMG}
            alt="Ericka"
            style={{
              width: 64, height: 'auto', flexShrink: 0,
              borderRadius: '10px', objectFit: 'cover', objectPosition: 'top center',
            }}
          />
          <div
            style={{ fontSize: '13px', lineHeight: 1.55, color: '#111', flex: 1 }}
            dangerouslySetInnerHTML={{ __html: step.text }}
          />
        </div>

        {/* Bullets de progreso */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginBottom: '12px' }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              style={{
                width: i === stepIndex ? 20 : 8,
                height: 8,
                borderRadius: 4,
                background: i === stepIndex ? '#10b981' : '#d1fae5',
                transition: 'all 0.3s',
              }}
            />
          ))}
        </div>

        {/* Botones de navegación */}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          {!isFirst && (
            <button
              onClick={onPrev}
              disabled={loading}
              style={{
                padding: '8px 16px', borderRadius: '8px',
                border: '1.5px solid #d1d5db', background: '#f9fafb',
                color: '#374151', fontSize: '13px', fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ← Atrás
            </button>
          )}
          <button
            onClick={onNext}
            disabled={loading}
            style={{
              padding: '8px 20px', borderRadius: '8px',
              border: 'none', background: loading ? '#6ee7b7' : '#10b981',
              color: '#fff', fontSize: '13px', fontWeight: 700,
              cursor: loading ? 'wait' : 'pointer',
              minWidth: 90,
            }}
          >
            {loading ? '...' : isLast ? (doneLabel || '¡Listo! 🎉') : 'Siguiente →'}
          </button>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// OVERLAY MENÚ DE FLUJOS
// ═══════════════════════════════════════════════════════════════════════════════
function FlowMenuOverlay({
  onSelect,
  onSkip,
}: {
  onSelect: (flow: TutorialFlow) => void;
  onSkip: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 99999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          background: '#fff', borderRadius: '20px',
          padding: '24px', maxWidth: '380px', width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          border: '2px solid #10b981',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', marginBottom: '20px' }}>
          <img
            src={ERICKA_IMG} alt="Ericka Orrego"
            style={{
              width: 72, height: 'auto', flexShrink: 0,
              borderRadius: '12px', objectFit: 'cover', objectPosition: 'top center',
            }}
          />
          <div>
            <p style={{ fontWeight: 700, fontSize: '16px', color: '#065f46', marginBottom: '4px' }}>
              ¿Qué quieres aprender hoy?
            </p>
            <p style={{ fontSize: '13px', color: '#6b7280' }}>
              Elige un flujo y te guío paso a paso.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
          {[
            { flow: 'cuenta' as TutorialFlow, label: '⚙️  Configurar cuenta de mi hijo', desc: '6 pasos' },
            { flow: 'almuerzo' as TutorialFlow, label: '🍽️  Hacer un pedido de almuerzo', desc: '10 pasos' },
            { flow: 'pagos' as TutorialFlow, label: '💳  Pagar deudas pendientes', desc: '8 pasos' },
          ].map(({ flow, label, desc }) => (
            <button
              key={flow}
              onClick={() => onSelect(flow)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px',
                background: '#f0fdf4', border: '2px solid #10b981',
                borderRadius: '12px', cursor: 'pointer',
                fontSize: '14px', fontWeight: 600, color: '#065f46',
                textAlign: 'left', transition: 'all 0.2s',
              }}
            >
              <span>{label}</span>
              <span style={{ fontSize: '11px', color: '#6b7280', fontWeight: 400 }}>{desc}</span>
            </button>
          ))}
        </div>

        <button
          onClick={onSkip}
          style={{
            width: '100%', padding: '10px',
            background: 'none', border: '1.5px solid #e5e7eb',
            borderRadius: '10px', cursor: 'pointer',
            fontSize: '13px', color: '#9ca3af', fontWeight: 600,
          }}
        >
          No por ahora
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════
export function ErickaTutorial({ schoolId, onSetActiveTab, forceShow = false, onClose }: ErickaTutorialProps) {
  const [phase, setPhase] = useState<TutorialPhase>('welcome');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stepLoading, setStepLoading] = useState(false);

  const [currentSteps, setCurrentSteps] = useState<StepDef[]>([]);
  const [stepIndex, setStepIndex] = useState(0);

  // ── Verificar si el tutorial debe mostrarse ─────────────────────────────────
  const checkShouldShow = useCallback(async () => {
    try {
      if (forceShow) {
        setEnabled(true);
        setPhase('welcome');
        setCurrentSteps(WELCOME_STEPS);
        setStepIndex(0);
        setLoading(false);
        return;
      }

      const done = localStorage.getItem(LS_KEY);
      let tutorialForced = false;

      if (schoolId) {
        const { data } = await supabase
          .from('maintenance_config')
          .select('enabled')
          .eq('school_id', schoolId)
          .eq('module_key', 'tutorial_padres')
          .maybeSingle();
        tutorialForced = data?.enabled === true;
      }

      // Solo mostrar si está explícitamente activado para esta sede en maintenance_config
      // Sin esa entrada activa, el tutorial NO aparece en ninguna sede
      if (tutorialForced) {
        setEnabled(true);
        setPhase('welcome');
        setCurrentSteps(WELCOME_STEPS);
        setStepIndex(0);
      } else {
        setEnabled(false);
      }
    } catch {
      setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, [schoolId, forceShow]);

  useEffect(() => {
    checkShouldShow();
  }, [checkShouldShow]);

  // ── Navegar a un paso (ejecuta beforeShow si existe) ────────────────────────
  const goToStep = useCallback(async (steps: StepDef[], index: number) => {
    const step = steps[index];
    if (!step) return;

    if (step.beforeShow) {
      setStepLoading(true);
      try {
        await step.beforeShow();
      } catch { /* ignorar errores de DOM */ }
      setStepLoading(false);
    }

    // Scroll al elemento si existe
    const el = step.element ? document.querySelector(step.element) : null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 250));
    }

    setStepIndex(index);
  }, []);

  // ── Siguiente paso ───────────────────────────────────────────────────────────
  const handleNext = useCallback(async () => {
    if (phase === 'welcome') {
      const isLast = stepIndex === currentSteps.length - 1;
      if (isLast) {
        // Ir al menú de flujos
        setPhase('flow-menu');
        return;
      }
      await goToStep(currentSteps, stepIndex + 1);
      return;
    }

    if (phase === 'flow-running') {
      const isLast = stepIndex === currentSteps.length - 1;
      if (isLast) {
        markDone();
        return;
      }
      await goToStep(currentSteps, stepIndex + 1);
    }
  }, [phase, stepIndex, currentSteps, goToStep]); // eslint-disable-line

  // ── Paso anterior ────────────────────────────────────────────────────────────
  const handlePrev = useCallback(async () => {
    if (stepIndex > 0) {
      await goToStep(currentSteps, stepIndex - 1);
    }
  }, [stepIndex, currentSteps, goToStep]);

  // ── Selección de flujo ───────────────────────────────────────────────────────
  const handleFlowSelect = useCallback(async (flow: TutorialFlow) => {
    if (!flow) return;

    let steps: StepDef[] = [];
    if (flow === 'cuenta')   steps = buildFlujoCuenta(onSetActiveTab);
    if (flow === 'almuerzo') steps = buildFlujoAlmuerzo(onSetActiveTab);
    if (flow === 'pagos')    steps = buildFlujoPagos(onSetActiveTab);

    setCurrentSteps(steps);
    setPhase('flow-running');
    await goToStep(steps, 0);
  }, [onSetActiveTab, goToStep]);

  // ── Cierre ───────────────────────────────────────────────────────────────────
  const markDone = useCallback(() => {
    localStorage.setItem(LS_KEY, '1');
    setEnabled(false);
    setPhase('done');
    onClose?.();
  }, [onClose]);

  if (loading || !enabled) return null;

  const totalSteps = currentSteps.length;
  const currentStep = currentSteps[stepIndex];

  return (
    <>
      {phase === 'flow-menu' && (
        <FlowMenuOverlay onSelect={handleFlowSelect} onSkip={markDone} />
      )}

      {(phase === 'welcome' || phase === 'flow-running') && currentStep && (
        <ErickaTooltip
          step={currentStep}
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          onNext={handleNext}
          onPrev={handlePrev}
          onSkip={markDone}
          isFirst={stepIndex === 0}
          isLast={stepIndex === totalSteps - 1}
          doneLabel={phase === 'welcome' ? '¡Elegir flujo! →' : '¡Listo! 🎉'}
          loading={stepLoading}
        />
      )}
    </>
  );
}
