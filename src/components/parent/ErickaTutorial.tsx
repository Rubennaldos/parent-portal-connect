import { useState, useEffect, useCallback, useRef } from 'react';
import { Steps } from 'intro.js-react';
import 'intro.js/introjs.css';
import { supabase } from '@/lib/supabase';

// ─── Constantes ───────────────────────────────────────────────────────────────
const LS_KEY = 'ericka_tutorial_completed';
const ERICKA_IMG = '/ericka.png';

// ─── Tipos ────────────────────────────────────────────────────────────────────
type TutorialFlow = 'cuenta' | 'almuerzo' | 'pagos' | null;
type TutorialPhase = 'welcome' | 'flow-menu' | 'flow-running' | 'done';

interface StepDef {
  element: string;
  intro: string;
  position?: string;
  tooltipClass?: string;
  highlightClass?: string;
  /**
   * Acción que se ejecuta ANTES de que Intro.js muestre este paso.
   * Usado para cambiar pestañas o abrir modales antes de buscar el elemento.
   * El callback debe devolver una Promise que resuelva cuando el DOM esté listo.
   */
  beforeShow?: () => Promise<void>;
}

interface ErickaTutorialProps {
  userId?: string;
  schoolId?: string;
  onSetActiveTab?: (tab: string) => void;
  /** Si es true, abre el tutorial directamente sin verificar localStorage */
  forceShow?: boolean;
  /** Callback cuando el tutorial se cierra (para desmontarlo desde el padre) */
  onClose?: () => void;
}

// ─── Helper: esperar a que un selector CSS esté en el DOM ────────────────────
function waitForElement(selector: string, timeoutMs = 3000): Promise<Element | null> {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) {
        observer.disconnect();
        resolve(found);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

// ─── Helper: tooltip HTML con foto de Ericka ─────────────────────────────────
function tip(text: string, pos: 'right' | 'left' | 'center' = 'right'): string {
  const dir = pos === 'left' ? 'row-reverse' : 'row';
  return `
    <div style="display:flex;flex-direction:${dir};align-items:flex-end;gap:10px;max-width:300px;">
      <img src="${ERICKA_IMG}" alt="Ericka"
        style="width:72px;height:auto;flex-shrink:0;border-radius:8px;
               object-fit:cover;object-position:top center;" />
      <div style="background:#fff;border:2px solid #10b981;border-radius:12px;
                  padding:10px 12px;font-size:13px;line-height:1.5;color:#111;
                  box-shadow:0 2px 10px rgba(0,0,0,0.1);">
        ${text}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FLUJO 1 — Configurar cuenta (6 pasos)
// ═══════════════════════════════════════════════════════════════════════════════
function buildFlujoCuenta(onSetActiveTab?: (tab: string) => void): StepDef[] {
  return [
    {
      element: '#nav-tab-alumnos',
      intro: tip(
        `<strong>Paso 1/6</strong> — Lo primero es ir a la sección "Mis Hijos". ` +
        `¡Toca el botón de inicio en el menú de abajo! 👇`,
        'center'
      ),
      position: 'top',
      beforeShow: async () => {
        onSetActiveTab?.('alumnos');
        await new Promise(r => setTimeout(r, 300));
      },
    },
    {
      element: '.student-card-tutorial',
      intro: tip(
        `<strong>Paso 2/6</strong> — Aquí ves la tarjeta de tu hijo con toda su información. ` +
        `¿Ves el ícono de engranaje ⚙️ al lado de su nombre? Ese es el que necesitamos.`,
        'right'
      ),
      position: 'bottom',
      beforeShow: async () => {
        onSetActiveTab?.('alumnos');
        await new Promise(r => setTimeout(r, 400));
      },
    },
    {
      element: '[id^="student-settings-btn-"]',
      intro: tip(
        `<strong>Paso 3/6</strong> — ¡Ese engranaje ⚙️ es el que necesitas! ` +
        `Presiona el engranaje para abrir la <strong>Configuración de Cuenta</strong>.`,
        'right'
      ),
      position: 'bottom',
    },
    {
      element: '#account-type-prepaid-btn',
      intro: tip(
        `<strong>Paso 4/6</strong> — Aquí eliges entre dos modos:<br/>` +
        `• <strong>Cuenta Libre</strong>: tu hijo consume y paga después.<br/>` +
        `• <strong>Cuenta con Recargas</strong>: primero recargas, luego él gasta.<br/><br/>` +
        `Selecciona <strong>"Cuenta con Recargas"</strong> si quieres controlar el saldo.`,
        'left'
      ),
      position: 'right',
      beforeShow: async () => {
        // El modal se abre al hacer clic en el engranaje manualmente.
        // Esperamos a que el dialog aparezca en el DOM.
        await waitForElement('#account-type-prepaid-btn', 3000);
      },
    },
    {
      element: '#account-config-save-btn',
      intro: tip(
        `<strong>Paso 5/6</strong> — ¡Perfecto! Ahora presiona <strong>"Guardar"</strong> ` +
        `para que el cambio quede registrado en el sistema.`,
        'right'
      ),
      position: 'top',
    },
    {
      element: '.student-card-tutorial',
      intro: tip(
        `<strong>Paso 6/6</strong> — ¡Listo! Tu hijo ahora está en <strong>Modo Recargas</strong>. 🎉<br/><br/>` +
        `Cuando el módulo de recargas vuelva de mantenimiento, podrás cargarle saldo desde aquí mismo.`,
        'right'
      ),
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
      intro: tip(
        `<strong>Paso 1/10</strong> — Para pedir el almuerzo de tu hijo, toca el ` +
        `menú <strong>"Almuerzos"</strong> aquí abajo. 🍽️`,
        'center'
      ),
      position: 'top',
      beforeShow: async () => {
        onSetActiveTab?.('alumnos');
        await new Promise(r => setTimeout(r, 300));
      },
    },
    {
      element: '#lunch-subtab-hacer-pedido',
      intro: tip(
        `<strong>Paso 2/10</strong> — Estás en <strong>"Hacer Pedido"</strong>. ` +
        `¡Aquí es donde se hace la magia! 🌟<br/>` +
        `También tienes la pestaña "Mis Pedidos" para ver los que ya hiciste.`,
        'right'
      ),
      position: 'bottom',
      beforeShow: async () => {
        onSetActiveTab?.('almuerzos');
        await waitForElement('#lunch-subtab-hacer-pedido', 2000);
      },
    },
    {
      element: '#lunch-student-selector',
      intro: tip(
        `<strong>Paso 3/10</strong> — Primero elige a cuál de tus hijos le ` +
        `quieres pedir el almuerzo. Si tienes varios, aparecerán botones para cada uno. 👦👧`,
        'right'
      ),
      position: 'bottom',
      beforeShow: async () => {
        await waitForElement('#lunch-student-selector', 2000);
      },
    },
    {
      element: '#lunch-calendar-header',
      intro: tip(
        `<strong>Paso 4/10</strong> — Este es el <strong>calendario del mes</strong>. ` +
        `Las flechas ← → te permiten moverte entre meses.<br/>` +
        `Desliza los días para ver cuáles tienen menú disponible.`,
        'center'
      ),
      position: 'bottom',
      beforeShow: async () => {
        await waitForElement('#lunch-calendar-header', 2000);
      },
    },
    {
      element: '#lunch-calendar-header',
      intro: tip(
        `<strong>Paso 5/10</strong> — Los días con un círculo de color tienen ` +
        `<strong>menú disponible</strong> para pedir. ` +
        `Verde = ya pedido. Morado = disponible. Gris = sin menú.<br/>` +
        `¡Toca cualquier día morado para pedirlo! 👆`,
        'right'
      ),
      position: 'bottom',
    },
    {
      element: '#lunch-calendar-header',
      intro: tip(
        `<strong>Paso 6/10</strong> — Al tocar un día con menú, verás las ` +
        `<strong>categorías disponibles</strong> (ej: Menú Escolar, Vegano, etc.).<br/>` +
        `Selecciona la que prefiera tu hijo.`,
        'right'
      ),
      position: 'bottom',
    },
    {
      element: '#lunch-wizard-confirm-btn',
      intro: tip(
        `<strong>Paso 7/10</strong> — Ya casi terminamos. ` +
        `Revisa tu pedido: la fecha, el menú y la cantidad.<br/>` +
        `Si todo está bien, presiona <strong>Confirmar</strong>. ✅`,
        'left'
      ),
      position: 'top',
      beforeShow: async () => {
        await waitForElement('#lunch-wizard-confirm-btn', 2000);
      },
    },
    {
      element: '#lunch-wizard-done-goto-cart',
      intro: tip(
        `<strong>Paso 8/10</strong> — ¡Pedido creado! 🎉<br/>` +
        `Ahora tienes que pagar. El botón <strong>"Ir al Carrito"</strong> te lleva ` +
        `a donde puedes pagar con Yape, Plin o transferencia.`,
        'center'
      ),
      position: 'top',
      beforeShow: async () => {
        await waitForElement('#lunch-wizard-done-goto-cart', 2000);
      },
    },
    {
      element: '#nav-tab-carrito',
      intro: tip(
        `<strong>Paso 9/10</strong> — También puedes ir al <strong>Carrito</strong> ` +
        `desde el menú de abajo en cualquier momento.<br/>` +
        `Si hay pagos pendientes, verás un número rojo que rebota. 🔴`,
        'center'
      ),
      position: 'top',
    },
    {
      element: '#nav-tab-almuerzos',
      intro: tip(
        `<strong>Paso 10/10</strong> — ¡Eso es todo! 🎊<br/>` +
        `Vuelve a <strong>Almuerzos → Mis Pedidos</strong> cuando quieras ` +
        `ver todos tus pedidos y su estado.<br/><br/>¿Fácil, verdad?`,
        'center'
      ),
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
      intro: tip(
        `<strong>Paso 1/8</strong> — Para pagar tus deudas pendientes, toca el ` +
        `ícono del <strong>Carrito</strong> aquí abajo.<br/>` +
        `Si hay deudas, verás un número rojo que rebota. 🔴`,
        'center'
      ),
      position: 'top',
      beforeShow: async () => {
        onSetActiveTab?.('alumnos');
        await new Promise(r => setTimeout(r, 300));
      },
    },
    {
      element: '#cart-how-to-pay-card',
      intro: tip(
        `<strong>Paso 2/8</strong> — ¡Importante! Puedes pagar de dos formas:<br/>` +
        `• Yendo a pagar en caja del colegio.<br/>` +
        `• Enviando un comprobante de <strong>Yape, Plin o transferencia</strong> ` +
        `directamente desde aquí. 📱`,
        'right'
      ),
      position: 'bottom',
      beforeShow: async () => {
        onSetActiveTab?.('carrito');
        await waitForElement('#cart-how-to-pay-card', 2500);
      },
    },
    {
      element: '#cart-total-pending-card',
      intro: tip(
        `<strong>Paso 3/8</strong> — Aquí ves el <strong>total que debes</strong>.<br/>` +
        `Cada línea debajo es una compra o almuerzo pendiente de pago.`,
        'right'
      ),
      position: 'bottom',
      beforeShow: async () => {
        await waitForElement('#cart-total-pending-card', 2000);
      },
    },
    {
      element: '#cart-student-debt-card',
      intro: tip(
        `<strong>Paso 4/8</strong> — Esta sección muestra las deudas por hijo. ` +
        `Puedes <strong>seleccionar qué compras pagar ahora</strong> y cuáles dejar ` +
        `para después. Muy flexible. 👌`,
        'left'
      ),
      position: 'right',
      beforeShow: async () => {
        await waitForElement('#cart-student-debt-card', 2000);
      },
    },
    {
      element: '#cart-pay-selected-btn',
      intro: tip(
        `<strong>Paso 5/8</strong> — Cuando tengas seleccionadas las compras ` +
        `que quieres pagar, presiona este <strong>botón verde</strong>. 💚`,
        'right'
      ),
      position: 'top',
      beforeShow: async () => {
        await waitForElement('#cart-pay-selected-btn', 2000);
      },
    },
    {
      element: '#recharge-modal-amount',
      intro: tip(
        `<strong>Paso 6/8</strong> — Se abrirá una ventana con el ` +
        `<strong>monto calculado automáticamente</strong>. Revísalo para confirmar ` +
        `que es correcto. 🔢`,
        'right'
      ),
      position: 'bottom',
      beforeShow: async () => {
        await waitForElement('#recharge-modal-amount', 3000);
      },
    },
    {
      element: '#recharge-modal-upload-btn',
      intro: tip(
        `<strong>Paso 7/8</strong> — Aquí subes la foto o captura de tu ` +
        `comprobante de pago (Yape, Plin, transferencia o voucher de caja). 📸<br/>` +
        `Es <strong>obligatorio</strong> para que el admin pueda verificarlo.`,
        'left'
      ),
      position: 'top',
      beforeShow: async () => {
        await waitForElement('#recharge-modal-upload-btn', 2000);
      },
    },
    {
      element: '#recharge-modal-submit-btn',
      intro: tip(
        `<strong>Paso 8/8</strong> — ¡Último paso! Presiona <strong>"Enviar comprobante"</strong>.<br/>` +
        `El administrador lo revisará y, en cuanto lo apruebe, ` +
        `la deuda desaparece del carrito automáticamente. ✅`,
        'right'
      ),
      position: 'top',
      beforeShow: async () => {
        await waitForElement('#recharge-modal-submit-btn', 2000);
      },
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════
export function ErickaTutorial({ userId, schoolId, onSetActiveTab, forceShow = false, onClose }: ErickaTutorialProps) {
  const [phase, setPhase] = useState<TutorialPhase>('welcome');
  const [enabled, setEnabled] = useState(false);
  const [stepsEnabled, setStepsEnabled] = useState(false);
  const [activeFlow, setActiveFlow] = useState<TutorialFlow>(null);
  const [flowSteps, setFlowSteps] = useState<StepDef[]>([]);
  const [loading, setLoading] = useState(true);

  const introRef = useRef<any>(null);

  // ── Verificar si el tutorial debe mostrarse ───────────────────────────────
  const checkShouldShow = useCallback(async () => {
    try {
      // Si forceShow es true (botón del header), siempre mostrar
      if (forceShow) {
        setEnabled(true);
        setPhase('welcome');
        setLoading(false);
        setTimeout(() => setStepsEnabled(true), 400);
        return;
      }

      // Verificar localStorage primero (evita flash innecesario)
      const done = localStorage.getItem(LS_KEY);

      // Verificar override del admin solo si tenemos schoolId
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

      if (tutorialForced || !done) {
        setEnabled(true);
        setPhase('welcome');
        // Delay para que el DOM esté completamente pintado
        setTimeout(() => setStepsEnabled(true), 1200);
      } else {
        setEnabled(false);
      }
    } catch {
      // Ante cualquier error, no bloquear la experiencia
    } finally {
      setLoading(false);
    }
  }, [schoolId, forceShow]);

  useEffect(() => {
    checkShouldShow();
  }, [checkShouldShow]);

  // ── Selección de flujo ──────────────────────────────────────────────────────
  const handleFlowSelect = useCallback((flow: TutorialFlow) => {
    if (!flow) return;

    let steps: StepDef[] = [];
    if (flow === 'cuenta')   steps = buildFlujoCuenta(onSetActiveTab);
    if (flow === 'almuerzo') steps = buildFlujoAlmuerzo(onSetActiveTab);
    if (flow === 'pagos')    steps = buildFlujoPagos(onSetActiveTab);

    setActiveFlow(flow);
    setFlowSteps(steps);
    setPhase('flow-running');

    // Pequeño delay para que React actualice el estado antes de arrancar Steps
    setTimeout(() => setStepsEnabled(true), 300);
  }, [onSetActiveTab]);

  // ── Cierre / finalización ────────────────────────────────────────────────────
  const markDone = useCallback(() => {
    localStorage.setItem(LS_KEY, '1');
    setStepsEnabled(false);
    setEnabled(false);
    setPhase('done');
    onClose?.();
  }, [onClose]);

  const handleSkipAll = useCallback(() => markDone(), [markDone]);
  const handleComplete = useCallback(() => {
    if (phase === 'welcome') {
      setStepsEnabled(false);
      setPhase('flow-menu');
    } else {
      markDone();
    }
  }, [phase, markDone]);

  const handleExit = useCallback(() => {
    markDone();
  }, [markDone]);

  // ── Cambio de paso: ejecutar beforeShow antes de que Intro.js busque el elemento ──
  // onBeforeChange acepta Promise<void | false> en intro.js-react.
  // Si el paso tiene beforeShow, esperamos a que el DOM esté listo antes de continuar.
  const handleBeforeChange = useCallback(async (nextIndex: number) => {
    const steps = phase === 'welcome' ? WELCOME_STEPS_PLAIN : flowSteps;
    const step = steps[nextIndex] as StepDef | undefined;
    if (!step?.beforeShow) return; // Sin acción → Intro.js avanza normalmente
    await step.beforeShow();
    // Después de beforeShow, Intro.js continúa automáticamente
  }, [phase, flowSteps]);

  if (loading || !enabled) return null;

  const currentSteps = phase === 'flow-running' ? flowSteps : WELCOME_STEPS_PLAIN;

  return (
    <>
      {/* ── Estilos globales de Intro.js personalizados ── */}
      <style>{INTRO_CSS}</style>

      {/* ── Steps de Intro.js ── */}
      {stepsEnabled && (phase === 'welcome' || phase === 'flow-running') && (
        <Steps
          ref={introRef}
          enabled={stepsEnabled}
          steps={currentSteps}
          initialStep={0}
          onExit={handleExit}
          onComplete={handleComplete}
          onBeforeChange={handleBeforeChange}
          options={{
            nextLabel: 'Siguiente →',
            prevLabel: '← Atrás',
            skipLabel: 'Omitir',
            doneLabel: phase === 'welcome' ? '¡Elegir flujo!' : '¡Listo! 🎉',
            showBullets: true,
            showProgress: false,
            exitOnOverlayClick: false,
            exitOnEsc: true,
            scrollToElement: true,
            disableInteraction: false,
            overlayOpacity: 0.6,
          }}
        />
      )}

      {/* ── Menú de selección de flujo (Escena 2) ── */}
      {phase === 'flow-menu' && (
        <FlowMenuOverlay
          onSelect={handleFlowSelect}
          onSkip={handleSkipAll}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PASOS DE BIENVENIDA (Escena 1) — versión plana (sin beforeShow)
// ═══════════════════════════════════════════════════════════════════════════════
const WELCOME_STEPS_PLAIN: StepDef[] = [
  {
    // Apuntamos al header (siempre existe) pero le quitamos el highlight
    // para que parezca un overlay de pantalla completa
    element: 'header',
    intro: tip(
      `¡Bienvenido al sistema de <strong>Lima Café 28</strong><br/>
       del St George's College - Sede Miraflores! 👋<br/><br/>
       Mi nombre es <strong>Ericka Orrego</strong> y mi número es el
       <a href="https://wa.me/51932020912" target="_blank"
          style="color:#10b981;font-weight:bold;text-decoration:underline;">
         +51 932 020 912
       </a>. ¡Presiona si quieres chatear conmigo!`,
      'right'
    ),
    tooltipClass: 'ericka-tooltip-welcome',
    highlightClass: 'ericka-no-highlight',
    position: 'bottom',
  },
  {
    element: 'nav.fixed',
    intro: tip(
      `En el menú de abajo tienes las <strong>secciones principales</strong>.<br/><br/>
       Presiona <strong>"¡Elegir flujo!"</strong> y te enseño paso a paso
       cómo usar cada parte del sistema. 👇`,
      'center'
    ),
    position: 'top',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// OVERLAY DE SELECCIÓN DE FLUJO
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
        {/* Ericka + pregunta */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', marginBottom: '20px' }}>
          <img
            src={ERICKA_IMG} alt="Ericka Orrego"
            style={{
              width: '90px', height: 'auto', borderRadius: '10px',
              objectFit: 'cover', objectPosition: 'top center', flexShrink: 0,
            }}
          />
          <div>
            <p style={{ fontSize: '15px', fontWeight: 700, color: '#065f46', marginBottom: '4px' }}>
              ¿Qué quieres hacer hoy?
            </p>
            <p style={{ fontSize: '12px', color: '#6b7280', lineHeight: 1.4 }}>
              Elige un flujo y te explico paso a paso.
            </p>
          </div>
        </div>

        {/* Botones de flujo */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <FlowButton
            onClick={() => onSelect('cuenta')}
            borderColor="#d1fae5" hoverColor="#10b981" bg="#f0fdf4"
            emoji="⚙️" title="Configurar mi cuenta"
            subtitle="Pasar de cuenta libre a modo recargas"
            titleColor="#065f46"
          />
          <FlowButton
            onClick={() => onSelect('almuerzo')}
            borderColor="#fde68a" hoverColor="#f59e0b" bg="#fffbeb"
            emoji="🍽️" title="Pedir el almuerzo de mi hijo"
            subtitle="Elegir fecha, categoría y confirmar"
            titleColor="#78350f"
          />
          <FlowButton
            onClick={() => onSelect('pagos')}
            borderColor="#bfdbfe" hoverColor="#3b82f6" bg="#eff6ff"
            emoji="💳" title="Hacer un pago"
            subtitle="Enviar comprobante de deuda pendiente"
            titleColor="#1e3a8a"
          />
        </div>

        <button
          onClick={onSkip}
          style={{
            marginTop: '16px', width: '100%', padding: '8px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: '12px', color: '#9ca3af', textDecoration: 'underline',
          }}
        >
          Omitir tutorial y explorar solo
        </button>
      </div>
    </div>
  );
}

// ─── Botón de flujo reutilizable ──────────────────────────────────────────────
function FlowButton({
  onClick, borderColor, hoverColor, bg,
  emoji, title, subtitle, titleColor,
}: {
  onClick: () => void;
  borderColor: string; hoverColor: string; bg: string;
  emoji: string; title: string; subtitle: string; titleColor: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '12px 16px', borderRadius: '12px', cursor: 'pointer',
        textAlign: 'left', transition: 'all 0.15s', background: bg,
        border: `2px solid ${hovered ? hoverColor : borderColor}`,
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.1)' : 'none',
      }}
    >
      <p style={{ fontSize: '14px', fontWeight: 700, color: titleColor, margin: 0 }}>
        {emoji} {title}
      </p>
      <p style={{ fontSize: '11px', color: '#6b7280', margin: '2px 0 0' }}>
        {subtitle}
      </p>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ESTILOS GLOBALES DE INTRO.JS
// ═══════════════════════════════════════════════════════════════════════════════
const INTRO_CSS = `
  /* Ocultar título nativo */
  .introjs-tooltip .introjs-tooltip-title { display: none !important; }

  /* Tooltip container */
  .introjs-tooltip {
    max-width: 390px !important;
    padding: 16px !important;
    border-radius: 16px !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.18) !important;
    border: 2px solid #10b981 !important;
    font-family: inherit !important;
  }

  /* Texto del tooltip */
  .introjs-tooltiptext {
    padding: 0 !important;
    margin: 0 !important;
  }

  /* Botón Siguiente */
  .introjs-nextbutton {
    background: #10b981 !important;
    border-color: #10b981 !important;
    color: #fff !important;
    border-radius: 8px !important;
    font-weight: 700 !important;
    padding: 8px 18px !important;
    text-shadow: none !important;
    box-shadow: 0 2px 6px rgba(16,185,129,0.35) !important;
  }
  .introjs-nextbutton:hover { background: #059669 !important; border-color: #059669 !important; }

  /* Botón Atrás */
  .introjs-prevbutton {
    color: #374151 !important;
    border-color: #d1d5db !important;
    border-radius: 8px !important;
    font-weight: 600 !important;
    padding: 8px 14px !important;
  }

  /* Botón Omitir */
  .introjs-skipbutton { color: #9ca3af !important; font-size: 12px !important; }

  /* Highlight verde esmeralda */
  .introjs-helperLayer {
    border: 3px solid #10b981 !important;
    border-radius: 12px !important;
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.58) !important;
  }

  /* Paso bienvenida: sin highlight — solo overlay oscuro */
  .ericka-no-highlight .introjs-helperLayer {
    border: none !important;
    box-shadow: none !important;
    background: transparent !important;
  }

  /* Bullets de progreso */
  .introjs-bullets ul li a { background: #d1d5db !important; border-radius: 6px !important; }
  .introjs-bullets ul li a.active { background: #10b981 !important; width: 16px !important; }

  /* Overlay */
  .introjs-overlay { background: rgba(0,0,0,0.6) !important; }

  /* Flecha del tooltip */
  .introjs-arrow.top { border-bottom-color: #10b981 !important; }
  .introjs-arrow.bottom { border-top-color: #10b981 !important; }
  .introjs-arrow.left { border-right-color: #10b981 !important; }
  .introjs-arrow.right { border-left-color: #10b981 !important; }
`;
