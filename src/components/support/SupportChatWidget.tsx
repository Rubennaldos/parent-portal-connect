import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { supabase } from '@/lib/supabase';
import { getRecentConsoleErrors } from '@/lib/consoleErrorCapture';
import {
  MessageCircle,
  X,
  Send,
  Paperclip,
  Loader2,
  Video,
  Trash2,
  Bot,
  User,
  Minimize2,
  CheckCircle2,
  Upload,
} from 'lucide-react';

// ─── Tipos ──────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: Date;
  attachment?: { name: string; type: string; preview?: string };
  classification?: 'user_error' | 'system_error' | 'ui_bug' | 'feature_request' | 'unknown';
  savedToBacklog?: boolean;
}

// ─── Constantes ─────────────────────────────────────────────────
// gemini-2.5-flash en v1beta — modelo más reciente disponible
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// 🔑 API Key definitiva de AI Studio — embebida para todos los usuarios
const BUILT_IN_GEMINI_KEY = 'AIzaSyDp3GAyFd7RVg_n6KwlsUP_e6V4wycF9Wg';

const SYSTEM_PROMPT = `Eres el Asistente Inteligente de LimaCafé28, una plataforma de gestión escolar (kiosco, almuerzos, cobranzas, POS, NFC).
Respondes SIEMPRE en español. Eres amable, claro y breve. Los usuarios NO son técnicos.

════════════════════════════════════════
📚 BASE DE CONOCIMIENTO DEL SISTEMA
════════════════════════════════════════

─── RECARGAS DE SALDO (KIOSCO) ───
• El saldo de recarga es EXCLUSIVAMENTE para compras en el kiosco (bebidas, snacks, etc.).
• NO se puede usar para pagar almuerzos. Los almuerzos se pagan por separado en "Pagos".
• PROCESO COMPLETO:
  1. El padre ingresa al portal, va a "Recargas" y completa el formulario con monto + foto del voucher (transferencia/depósito).
  2. El voucher llega al módulo "Aprobación de Recargas" (VoucherApproval) del admin.
  3. El admin revisa la foto del voucher y aprueba o rechaza.
  4. Al aprobar, el saldo se acredita automáticamente en la cuenta del alumno.
  5. Si el alumno tenía deudas del kiosco pendientes, el sistema las salda automáticamente al aprobar.
• El saldo aparece en el módulo POS cuando el cajero busca al alumno.
• Para ver el historial de recargas: módulo "Transacciones" o "Recargas".

─── PUNTO DE VENTA (POS / KIOSCO) ───
• El cajero busca al alumno por nombre o pasa la tarjeta NFC.
• Al seleccionar el alumno se ve: saldo disponible, topes configurados, estado de cuenta.
• TOPES DE GASTO: limitan cuánto puede gastar un alumno por día/semana/mes.
  - Se configuran en el perfil del alumno (módulo Alumnos → editar → sección Topes).
  - Los topes se renuevan: Diario = cada día a las 00:00 / Semanal = cada lunes / Mensual = cada 1° del mes.
  - Si el alumno supera el tope, el botón COBRAR se bloquea automáticamente.
• CUENTA LIBRE: el alumno puede comprar aunque tenga saldo $0 (genera deuda que queda pendiente).
• KIOSCO DESACTIVADO: el alumno no puede comprar nada.
• Para cobrar: seleccionar alumno → agregar productos → presionar COBRAR (verde).

─── TARJETAS NFC ───
• Las tarjetas NFC permiten identificar alumnos/profesores en el POS sin buscar por nombre.
• CONFIGURACIÓN (solo admins):
  1. Ir a "Administración de Sede" → pestaña "Tarjetas ID".
  2. Presionar "Nueva Tarjeta" → acercar la tarjeta al lector NFC → el sistema captura el UID automáticamente.
  3. Buscar el alumno o profesor → asignar → Guardar.
• USO EN POS: el cajero presiona "Escanear NFC" y el alumno pasa su tarjeta → se selecciona automáticamente.
• Si la tarjeta no funciona: verificar que esté activa en "Tarjetas ID" y que el lector esté conectado.
• SEGURIDAD: el UID de la tarjeta NO se imprime en la tarjeta física (para evitar clonación). La tarjeta solo muestra nombre + número visible.

─── PEDIDOS DE ALMUERZO ───
• Los padres hacen pedidos desde el portal, módulo "Almuerzo" → calendario.
• El padre selecciona el hijo, elige los días del mes, elige el menú (estándar o especial con proteína/guarnición).
• Al finalizar el pedido, se genera el pago que debe ser aprobado por el admin.
• El admin aprueba en "Cobranzas" → "Aprobación de Pagos".
• IMPORTANTE: si el padre tiene varios hijos, debe seleccionar cada hijo por separado. No se pueden hacer pedidos simultáneos para varios hijos a la vez.
• Los pedidos YA REALIZADOS aparecen en el calendario marcados con el color del estado (pagado, pendiente).

─── MÓDULO DE COCINA (COMEDOR) ───
• Muestra un resumen de cuántos platos hay que preparar por día.
• Se puede filtrar por: fecha, sede, grado, sección, o ver solo profesores.
• Columna izquierda = Alumnos / Columna derecha = Profesores.
• Las observaciones de padres (ej. "sin cebolla") aparecen siempre visibles en cada tarjeta de menú.
• Si no aparecen todos los menús: verificar que los pedidos estén en estado "aprobado" y que la fecha sea correcta.

─── COBRANZAS Y PAGOS DE ALMUERZO ───
• Los pagos de almuerzo son AL CONTADO (transferencia, Yape, etc.), NO con saldo del kiosco.
• El padre sube el voucher al hacer el pedido. El admin lo aprueba en "Cobranzas".
• Si el voucher llega vacío (sin foto): el padre debe volver a hacer la solicitud y adjuntar correctamente la imagen.
• Para ver reportes de pagos: módulo "Cobranzas" → "Reportes".

─── ALUMNOS Y PERFILES ───
• Para agregar/editar un alumno: "Administración de Sede" → "Alumnos" → editar.
• Para activar/desactivar kiosco: editar alumno → sección "Estado del kiosco".
• Para configurar topes: editar alumno → sección "Topes de gasto".
• Para ver historial de compras de un alumno: módulo "Transacciones" → filtrar por nombre.

─── ROLES DEL SISTEMA ───
• superadmin: acceso total, ve todos los colegios, monitor de errores.
• admin_general: gestiona todos los colegios.
• gestor_unidad: gestiona su sede específica.
• operador_caja: solo opera el POS/kiosco de su sede.
• parent: solo ve el portal de sus hijos (almuerzo, recargas, pagos).

════════════════════════════════════════
🛠️ MODO DE RESPUESTA
════════════════════════════════════════

Clasifica cada mensaje en uno de estos modos:

1. **GUÍA / PROCESO** — El usuario pregunta cómo hacer algo o no entiende cómo funciona algo.
   → Responde con pasos claros y simples. Usa emojis para que sea fácil de leer.
   → CLASIFICACIÓN: user_error

2. **ERROR DE USUARIO** — Hizo algo mal (campo vacío, proceso incorrecto, confusión).
   → Explica amablemente qué debe hacer correctamente.
   → CLASIFICACIÓN: user_error

3. **ERROR DEL SISTEMA** — Bug real (404, datos que no cuadran, UI rota, botón que no funciona, pantalla en blanco, error en consola).
   → Genera un reporte técnico con TODAS estas etiquetas:

   CLASIFICACIÓN: system_error | ui_bug | feature_request
   PRIORIDAD: critical | high | medium | low
   RESUMEN: [una línea describiendo el problema]
   ANÁLISIS TÉCNICO: [qué está fallando y por qué]
   CURSOR_FIX_PROMPT: [Prompt exacto y detallado para pegar en Cursor AI. Incluye: archivo a editar, función a modificar, cambio específico y contexto del error. En español.]
   --- FIN REPORTE ---

REGLAS GENERALES:
- Si recibes imagen o video, analízala visualmente. Busca: elementos cortados, texto ilegible, errores de layout, botones rotos, mensajes de error visibles.
- Usa siempre el contexto (URL, errores de consola, rol, sede) para respuestas más precisas.
- No inventes. Si necesitas más info, dilo.
- Sé breve y amable. Máximo 3-4 pasos cuando expliques un proceso.
- Nunca uses jerga técnica con usuarios no técnicos.`;

// ─── Helper: subir archivo a Supabase Storage ──────────────────
const STORAGE_BUCKET = 'support-attachments';

async function uploadFileToStorage(file: File, userId: string): Promise<string | null> {
  try {
    const ext = file.name.split('.').pop() || 'bin';
    const path = `${userId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: uploadError } = await supabase!.storage
      .from(STORAGE_BUCKET)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      // Si el bucket no existe, intentar crearlo (solo superadmin puede, pero intentamos)
      console.warn('Error subiendo archivo al storage:', uploadError.message);
      // Fallback: si el bucket no existe, no bloqueamos el flujo
      return null;
    }

    const { data: urlData } = supabase!.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(path);

    return urlData?.publicUrl || null;
  } catch (err) {
    console.warn('Error en uploadFileToStorage:', err);
    return null;
  }
}

// ─── Componente Principal ───────────────────────────────────────
export default function SupportChatWidget() {
  const { user } = useAuth();
  const { role } = useRole();

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<{ school_id: string | null; school_name: string | null }>({ school_id: null, school_name: null });
  const [uploadingFile, setUploadingFile] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 🔑 Llave definitiva embebida — sin localStorage, sin overrides
  const geminiKey = BUILT_IN_GEMINI_KEY;

  // ─── Filtro de rol: Personal de sedes (admin_general, gestor_unidad, operador_caja) ──────────
  const isAllowed = role === 'admin_general' || role === 'gestor_unidad' || role === 'operador_caja';
  
  // ─── Cargar perfil ────────────────────────────────────────────
  useEffect(() => {
    if (!user || !isAllowed) return;

    (async () => {
      const { data } = await supabase
        ?.from('profiles')
        .select('school_id')
        .eq('id', user.id)
        .single();
      
      if (data?.school_id) {
        const { data: school } = await supabase
          ?.from('schools')
          .select('name')
          .eq('id', data.school_id)
          .single();
        
        setUserProfile({
          school_id: data.school_id,
          school_name: school?.name || null,
        });
      }
    })();
  }, [user, isAllowed]);

  // Auto-scroll al último mensaje
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ─── No renderizar si no tiene permiso ──────────────────────
  if (!isAllowed) return null;

  // ─── Adjuntar archivo ───────────────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];
    if (!validTypes.includes(file.type)) {
      alert('Solo se permiten imágenes (PNG, JPG, WebP, GIF) y videos (MP4, WebM)');
      return;
    }

    // Límite 10MB para compatibilidad con Gemini inline_data
    if (file.size > 10 * 1024 * 1024) {
      alert('El archivo no puede superar 10MB');
      return;
    }

    setAttachment(file);

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setAttachmentPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setAttachmentPreview(null);
    }
  };

  const removeAttachment = () => {
    setAttachment(null);
    setAttachmentPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── Convertir archivo a base64 para Gemini ─────────────────
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // ─── Llamar a Gemini 2.0 Flash ─────────────────────────────
  const callGemini = async (userMessage: string, file?: File): Promise<string> => {
    const consoleErrors = getRecentConsoleErrors();

    // Construir el texto completo (system prompt + contexto + mensaje)
    const fullText = `${SYSTEM_PROMPT}

--- CONTEXTO AUTOMÁTICO ---
URL: ${window.location.href}
Usuario: ${user?.email} (ID: ${user?.id})
Rol: ${role}
Sede: ${userProfile.school_name || 'N/A'} (${userProfile.school_id || 'N/A'})
Pantalla: ${window.innerWidth}x${window.innerHeight}
Errores de consola recientes:
${consoleErrors.length > 0 ? consoleErrors.map((e, i) => `  ${i + 1}. [${e.timestamp}] ${e.message}`).join('\n') : '  (ninguno)'}
---

MENSAJE DEL USUARIO:
${userMessage}`;

    // Construir parts según la estructura exacta de Google AI Studio
    const parts: any[] = [{ text: fullText }];

    // Si hay archivo adjunto, agregar como inline_data
    if (file) {
      const base64Data = await fileToBase64(file);
      parts.push({
        inline_data: {
          mime_type: file.type,
          data: base64Data,
        },
      });
      parts.push({
        text: `[El usuario adjuntó: ${file.name} (${file.type}, ${(file.size / 1024).toFixed(0)}KB). Analízalo visualmente.]`,
      });
    }

    // Body exacto: { contents: [{ parts: [{ text: "..." }] }] }
    const body = JSON.stringify({
      contents: [{ parts }],
    });

    // POST con key como query parameter, solo Content-Type en headers
    const response = await fetch(`${GEMINI_API_URL}?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errMsg = errorData?.error?.message || response.statusText;

      if (response.status === 429) {
        throw new Error(
          '⚠️ Cuota agotada. Tu llave de Google superó el límite gratuito. Genera una nueva en aistudio.google.com'
        );
      }

      if (response.status === 404) {
        throw new Error(`Modelo no encontrado (404): ${errMsg}`);
      }

      throw new Error(`Error de IA (${response.status}): ${errMsg}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sin respuesta de la IA.';
  };

  // ─── Parsear clasificación de la respuesta ─────────────────
  const parseClassification = (
    aiText: string
  ): {
    classification: ChatMessage['classification'];
    priority: string;
    cursorPrompt: string | null;
    technicalAnalysis: string | null;
  } => {
    const classMatch = aiText.match(/CLASIFICACIÓN:\s*(system_error|ui_bug|feature_request|user_error|unknown)/i);
    const priorityMatch = aiText.match(/PRIORIDAD:\s*(critical|high|medium|low)/i);
    // Mejorado: captura hasta "--- FIN REPORTE ---" o fin del texto
    const cursorMatch = aiText.match(/CURSOR_FIX_PROMPT:\s*([\s\S]*?)(?=\n---\s*FIN\s*REPORTE|$)/i);
    const techMatch = aiText.match(/ANÁLISIS TÉCNICO:\s*([\s\S]*?)(?=\nCURSOR_FIX_PROMPT:|$)/i);

    return {
      classification: (classMatch?.[1]?.toLowerCase() as ChatMessage['classification']) || undefined,
      priority: priorityMatch?.[1]?.toLowerCase() || 'medium',
      cursorPrompt: cursorMatch?.[1]?.trim() || null,
      technicalAnalysis: techMatch?.[1]?.trim() || null,
    };
  };

  // ─── Guardar en dev_backlog si es error del sistema ─────────
  const saveToBacklog = async (
    userMessage: string,
    aiResponse: string,
    classification: string,
    priority: string,
    cursorPrompt: string | null,
    technicalAnalysis: string | null,
    screenshotUrl: string | null
  ) => {
    try {
      const consoleErrors = getRecentConsoleErrors();
      
      const { error } = await supabase!.from('dev_backlog').insert({
        reporter_id: user?.id,
        reporter_email: user?.email,
        reporter_role: role,
        reporter_school_id: userProfile.school_id,
        reporter_school_name: userProfile.school_name,
        page_url: window.location.pathname,
        console_errors: consoleErrors,
        user_message: userMessage,
        screenshot_url: screenshotUrl,
        ai_classification: classification,
        ai_response: aiResponse,
        ai_technical_analysis: technicalAnalysis,
        cursor_fix_prompt: cursorPrompt,
        priority,
      });

      if (error) console.error('Error guardando en dev_backlog:', error);
      return !error;
    } catch (err) {
      console.error('Error guardando en dev_backlog:', err);
      return false;
    }
  };

  // ─── Enviar mensaje ─────────────────────────────────────────
  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed && !attachment) return;

    // Agregar mensaje del usuario
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: trimmed || '(archivo adjunto)',
      timestamp: new Date(),
      attachment: attachment
        ? {
            name: attachment.name,
            type: attachment.type,
            preview: attachmentPreview || undefined,
          }
        : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    const currentFile = attachment;
    removeAttachment();

    try {
      // H1 FIX: Subir archivo a Supabase Storage en paralelo con Gemini
      let screenshotUrl: string | null = null;
      const uploadPromise = currentFile && user?.id
        ? (async () => {
            setUploadingFile(true);
            screenshotUrl = await uploadFileToStorage(currentFile, user.id);
            setUploadingFile(false);
          })()
        : Promise.resolve();

      const [aiText] = await Promise.all([
        callGemini(trimmed, currentFile || undefined),
        uploadPromise,
      ]);

      const parsed = parseClassification(aiText);

      // Guardar en dev_backlog si es error del sistema
      const isSystemIssue = ['system_error', 'ui_bug'].includes(parsed.classification || '');
      let savedToBacklog = false;

      if (isSystemIssue) {
        savedToBacklog = await saveToBacklog(
          trimmed,
          aiText,
          parsed.classification!,
          parsed.priority,
          parsed.cursorPrompt,
          parsed.technicalAnalysis,
          screenshotUrl
        );
      }

      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'ai',
        text: aiText,
        timestamp: new Date(),
        classification: parsed.classification,
        savedToBacklog,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      const errMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'ai',
        text: `❌ Error al contactar con la IA: ${err.message}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
      setUploadingFile(false);
    }
  };

  // ─── Render: Burbuja flotante ───────────────────────────────
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 left-6 z-[9999] w-14 h-14 bg-gradient-to-br from-violet-600 to-indigo-700 text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition-transform group"
        title="Soporte IA — ¿Tienes un problema? ¡Reporta aquí!"
      >
        <MessageCircle className="h-6 w-6" />
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white animate-pulse" />
      </button>
    );
  }

  // ─── Render: Chat minimizado ────────────────────────────────
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 left-6 z-[9999] flex items-center gap-2">
        <button
          onClick={() => setIsMinimized(false)}
          className="bg-gradient-to-br from-violet-600 to-indigo-700 text-white rounded-full px-4 py-2 shadow-xl flex items-center gap-2 hover:scale-105 transition-transform text-sm font-medium"
        >
          <Bot className="h-4 w-4" />
          Soporte IA
          {messages.length > 0 && (
            <span className="bg-white/20 rounded-full px-2 py-0.5 text-xs">
              {messages.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setIsOpen(false); setIsMinimized(false); }}
          className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center hover:bg-gray-300 transition-colors"
        >
          <X className="h-4 w-4 text-gray-600" />
        </button>
      </div>
    );
  }

  // ─── Render: Chat abierto ───────────────────────────────────
  return (
    <div className="fixed bottom-6 left-6 z-[9999] w-[420px] max-w-[calc(100vw-2rem)] h-[600px] max-h-[calc(100vh-3rem)] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-indigo-700 text-white px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          <div>
            <h3 className="font-semibold text-sm">Asistente IA</h3>
            <p className="text-[10px] text-white/70">
              {userProfile.school_name || 'LimaCafé28'} • Gemini 2.5 Flash
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(true)}
            className="w-7 h-7 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="w-7 h-7 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="py-4 text-gray-400">
            <div className="text-center mb-4">
              <Bot className="h-10 w-10 mx-auto mb-2 text-violet-300" />
              <p className="text-sm font-semibold text-gray-600">Hola 👋 ¿En qué te ayudo?</p>
              <p className="text-xs mt-1 text-gray-400">
                Puedo guiarte en procesos o reportar errores del sistema.
              </p>
            </div>

            {/* Preguntas rápidas */}
            <div className="space-y-1.5 px-1">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-1">Preguntas frecuentes</p>
              {[
                { emoji: '💳', label: '¿Cómo apruebo una recarga?' },
                { emoji: '🍱', label: '¿Cómo apruebo un pago de almuerzo?' },
                { emoji: '🏪', label: '¿Cómo cobro en el kiosco (POS)?' },
                { emoji: '📊', label: '¿Cómo configuro un tope de gasto?' },
                { emoji: '📡', label: '¿Cómo asigno una tarjeta NFC?' },
                { emoji: '👨‍👩‍👧', label: '¿Cómo un padre hace un pedido de almuerzo?' },
                { emoji: '🍳', label: '¿Cómo uso el módulo de cocina?' },
              ].map((q) => (
                <button
                  key={q.label}
                  onClick={() => {
                    setInput(q.label);
                    setTimeout(() => {
                      const input = document.getElementById('support-chat-input') as HTMLTextAreaElement;
                      if (input) {
                        input.focus();
                        // Auto-enviar
                        setInput('');
                        const fakeMsg: ChatMessage = {
                          id: crypto.randomUUID(),
                          role: 'user',
                          text: q.label,
                          timestamp: new Date(),
                        };
                        setMessages([fakeMsg]);
                        setIsLoading(true);
                        callGemini(q.label).then((aiText) => {
                          const parsed = parseClassification(aiText);
                          setMessages((prev) => [...prev, {
                            id: crypto.randomUUID(),
                            role: 'ai',
                            text: aiText,
                            timestamp: new Date(),
                            classification: parsed.classification,
                            savedToBacklog: false,
                          }]);
                        }).catch((err) => {
                          setMessages((prev) => [...prev, {
                            id: crypto.randomUUID(),
                            role: 'ai',
                            text: `❌ Error: ${err.message}`,
                            timestamp: new Date(),
                          }]);
                        }).finally(() => setIsLoading(false));
                      }
                    }, 0);
                  }}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 hover:bg-violet-50 hover:border-violet-200 border border-transparent transition-all text-xs text-gray-700 hover:text-violet-700"
                >
                  <span className="text-base leading-none">{q.emoji}</span>
                  <span>{q.label}</span>
                </button>
              ))}
            </div>

            <div className="mt-4 text-[10px] text-gray-400 text-center space-y-0.5 border-t pt-3">
              <p>📍 {window.location.pathname}</p>
              <p>👤 {user?.email} · 🏫 {userProfile.school_name || 'Sin sede'}</p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            {/* Avatar */}
            <div
              className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center ${
                msg.role === 'user'
                  ? 'bg-blue-100 text-blue-600'
                  : 'bg-violet-100 text-violet-600'
              }`}
            >
              {msg.role === 'user' ? (
                <User className="h-3.5 w-3.5" />
              ) : (
                <Bot className="h-3.5 w-3.5" />
              )}
            </div>

            {/* Burbuja */}
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-none'
                  : 'bg-gray-100 text-gray-800 rounded-tl-none'
              }`}
            >
              {/* Adjunto */}
              {msg.attachment && (
                <div className="mb-2">
                  {msg.attachment.preview ? (
                    <img
                      src={msg.attachment.preview}
                      alt="Captura"
                      className="rounded-lg max-h-40 object-cover"
                    />
                  ) : (
                    <div className="flex items-center gap-1 text-xs opacity-80">
                      <Video className="h-3 w-3" />
                      {msg.attachment.name}
                    </div>
                  )}
                </div>
              )}

              {/* Texto */}
              <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                {msg.text}
              </div>

              {/* Indicadores para mensajes de IA */}
              {msg.role === 'ai' && msg.classification && (
                <div className="mt-2 pt-2 border-t border-gray-200 flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      msg.classification === 'user_error'
                        ? 'bg-green-100 text-green-700'
                        : msg.classification === 'system_error'
                        ? 'bg-red-100 text-red-700'
                        : msg.classification === 'ui_bug'
                        ? 'bg-orange-100 text-orange-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {msg.classification === 'user_error' && '✅ No es un error'}
                    {msg.classification === 'system_error' && '🐛 Bug reportado'}
                    {msg.classification === 'ui_bug' && '🎨 Bug de pantalla'}
                    {msg.classification === 'feature_request' && '💡 Sugerencia'}
                    {msg.classification === 'unknown' && '❓ Sin clasificar'}
                  </span>
                  {msg.savedToBacklog && (
                    <span className="text-[10px] text-violet-600 flex items-center gap-0.5">
                      <CheckCircle2 className="h-3 w-3" />
                      Ticket creado
                    </span>
                  )}
                </div>
              )}

              {/* Timestamp */}
              <p
                className={`text-[10px] mt-1 ${
                  msg.role === 'user' ? 'text-white/60' : 'text-gray-400'
                }`}
              >
                {msg.timestamp.toLocaleTimeString('es-PE', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        ))}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center">
              <Bot className="h-3.5 w-3.5 text-violet-600" />
            </div>
            <div className="bg-gray-100 rounded-xl px-4 py-3 rounded-tl-none">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {uploadingFile ? 'Subiendo archivo...' : 'Analizando...'}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Preview de adjunto */}
      {attachment && (
        <div className="px-3 py-2 bg-gray-50 border-t flex items-center gap-2 flex-shrink-0">
          {attachmentPreview ? (
            <img src={attachmentPreview} alt="" className="h-10 w-10 object-cover rounded" />
          ) : (
            <div className="h-10 w-10 bg-gray-200 rounded flex items-center justify-center">
              <Video className="h-5 w-5 text-gray-500" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{attachment.name}</p>
            <p className="text-[10px] text-gray-400">{(attachment.size / 1024).toFixed(0)} KB</p>
          </div>
          <button
            onClick={removeAttachment}
            className="w-6 h-6 rounded-full hover:bg-gray-200 flex items-center justify-center"
          >
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
          </button>
        </div>
      )}

      {/* Input — Ya no necesita API key, siempre listo para usar */}
      <div className="p-3 border-t bg-white flex-shrink-0">
        <div className="flex items-end gap-2">
          {/* Botón adjuntar */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 hover:text-violet-600 transition-colors flex-shrink-0"
            title="Adjuntar imagen o video"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Campo de texto */}
          <div className="flex-1 relative">
            <textarea
              id="support-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Pregunta algo o describe un problema..."
              className="w-full resize-none border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 max-h-24 min-h-[38px]"
              rows={1}
              disabled={isLoading}
            />
          </div>

          {/* Botón enviar */}
          <button
            onClick={handleSend}
            disabled={isLoading || (!input.trim() && !attachment)}
            className="w-9 h-9 rounded-full bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 disabled:opacity-50 disabled:hover:bg-violet-600 transition-colors flex-shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
