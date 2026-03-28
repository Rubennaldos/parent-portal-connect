import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Bot,
  Send,
  Loader2,
  ChevronDown,
  Sparkles,
  RotateCcw,
  ShieldCheck,
  GripVertical,
} from 'lucide-react';

const FIOBOT_DOCK_KEY = 'fiobot-dock-v1';
const DRAG_THRESHOLD_PX = 8;

// ──────────────────────────────────────────────────────────
// Tipos
// ──────────────────────────────────────────────────────────

interface Mensaje {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

// ──────────────────────────────────────────────────────────
// Sugerencias rápidas para la CEO
// ──────────────────────────────────────────────────────────

const SUGERENCIAS: string[] = [
  '¿Cuántos vouchers están pendientes hoy?',
  '¿Qué fraudes detectó la IA esta semana?',
  'Dame las estadísticas del mes actual',
  '¿Qué alumnos tienen saldo negativo?',
];

// ──────────────────────────────────────────────────────────
// Componente principal
// ──────────────────────────────────────────────────────────

function readDock(): { right: number; bottom: number } {
  try {
    const raw = sessionStorage.getItem(FIOBOT_DOCK_KEY);
    if (!raw) return { right: 24, bottom: 24 };
    const p = JSON.parse(raw) as { right?: number; bottom?: number };
    if (typeof p.right === 'number' && typeof p.bottom === 'number') {
      return { right: p.right, bottom: p.bottom };
    }
  } catch {
    /* ignore */
  }
  return { right: 24, bottom: 24 };
}

export function ChatAuditoria() {
  const { session } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dock, setDock] = useState(readDock);
  const [arrastrando, setArrastrando] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startRight: number;
    startBottom: number;
    moved: boolean;
  } | null>(null);
  const ignorarSiguienteClick = useRef(false);
  const lastDockRef = useRef(readDock());

  const clampDock = (right: number, bottom: number) => {
    const pad = 8;
    const minVisible = 72;
    const maxRight = Math.max(pad, window.innerWidth - minVisible);
    const maxBottom = Math.max(pad, window.innerHeight - minVisible);
    return {
      right: Math.min(maxRight, Math.max(pad, right)),
      bottom: Math.min(maxBottom, Math.max(pad, bottom)),
    };
  };

  const persistDock = (next: { right: number; bottom: number }) => {
    try {
      sessionStorage.setItem(FIOBOT_DOCK_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  const iniciarArrastre = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    dragState.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startRight: dock.right,
      startBottom: dock.bottom,
      moved: false,
    };
    setArrastrando(true);
  };

  const moverArrastre = (e: React.PointerEvent) => {
    if (!dragState.current || e.pointerId !== dragState.current.pointerId) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
      dragState.current.moved = true;
    }
    const next = clampDock(
      dragState.current.startRight - dx,
      dragState.current.startBottom - dy
    );
    setDock(next);
  };

  const finalizarArrastre = (e: React.PointerEvent) => {
    if (!dragState.current || e.pointerId !== dragState.current.pointerId) return;
    const huboMovimiento = dragState.current.moved;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragState.current = null;
    setArrastrando(false);
    if (huboMovimiento) {
      ignorarSiguienteClick.current = true;
      persistDock(lastDockRef.current);
    }
  };

  const clickEnFab = () => {
    if (ignorarSiguienteClick.current) {
      ignorarSiguienteClick.current = false;
      return;
    }
    setAbierto((v) => !v);
  };

  // Scroll automático al último mensaje
  useEffect(() => {
    if (abierto) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [mensajes, abierto]);

  // Foco automático al abrir
  useEffect(() => {
    if (abierto) {
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, [abierto]);

  // Mensaje de bienvenida
  useEffect(() => {
    if (abierto && mensajes.length === 0) {
      setMensajes([
        {
          role: 'assistant',
          content:
            '¡Hola! Soy **FioBot**, tu auditor financiero de UFRASAC.\n\nPuedo consultarte sobre vouchers, fraudes detectados, saldos de alumnos y estadísticas de cobranzas. ¿En qué te ayudo?',
          ts: Date.now(),
        },
      ]);
    }
  }, [abierto, mensajes.length]);

  const limpiarChat = () => {
    setMensajes([]);
    setError(null);
  };

  const enviarMensaje = async (texto?: string) => {
    const pregunta = (texto ?? input).trim();
    if (!pregunta || cargando) return;

    setInput('');
    setError(null);

    const nuevoMensajeUsuario: Mensaje = {
      role: 'user',
      content: pregunta,
      ts: Date.now(),
    };

    const historialActualizado = [...mensajes, nuevoMensajeUsuario];
    setMensajes(historialActualizado);
    setCargando(true);

    try {
      // Obtener token de sesión
      const token = session?.access_token;
      if (!token) throw new Error('Sesión expirada. Recarga la página.');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ??
        (supabase as any)?.supabaseUrl ?? '';

      const res = await fetch(`${supabaseUrl}/functions/v1/chat-financiero`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
        },
        body: JSON.stringify({
          // Mandamos solo el historial sin el mensaje de bienvenida (role assistant inicial)
          messages: historialActualizado
            .filter((m) => !(m.role === 'assistant' && m.ts === mensajes[0]?.ts))
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Error ${res.status}`);
      }

      setMensajes((prev) => [
        ...prev,
        { role: 'assistant', content: data.respuesta ?? '…', ts: Date.now() },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setError(msg);
      setMensajes((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `⚠️ ${msg}`,
          ts: Date.now(),
        },
      ]);
    } finally {
      setCargando(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviarMensaje();
    }
  };

  // ──────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────

  return (
    <div
      className="fixed z-50 flex flex-col items-end gap-2 pointer-events-none"
      style={{ right: dock.right, bottom: dock.bottom, left: 'auto', top: 'auto' }}
    >
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        {/* ── Panel del chat ── */}
        <div
          className={`
            w-[380px] max-w-[calc(100vw-1.5rem)]
            bg-white rounded-2xl shadow-2xl shadow-indigo-500/20
            border border-indigo-100
            flex flex-col h-[540px]
            transition-opacity duration-200
            ${abierto ? '' : 'hidden'}
          `}
        >
          {/* ── Cabecera (arrastrable) ── */}
          <div
            className={`flex items-center gap-2 px-3 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 rounded-t-2xl touch-none cursor-grab active:cursor-grabbing select-none ${arrastrando ? 'cursor-grabbing' : ''}`}
            onPointerDown={iniciarArrastre}
            onPointerMove={moverArrastre}
            onPointerUp={finalizarArrastre}
            onPointerCancel={finalizarArrastre}
            title="Mantén presionado y arrastra para mover FioBot"
          >
            <GripVertical className="h-5 w-5 text-white/50 shrink-0" aria-hidden />
            <div className="flex-shrink-0 h-8 w-8 rounded-full bg-white/20 flex items-center justify-center">
              <ShieldCheck className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm leading-none">FioBot</p>
              <p className="text-indigo-200 text-xs mt-0.5">Auditor Financiero · UFRASAC</p>
            </div>
            <div
              className="flex items-center gap-1 shrink-0 cursor-default"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={limpiarChat}
                className="p-1.5 rounded-lg hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                title="Limpiar conversación"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="p-1.5 rounded-lg hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                title="Cerrar"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </div>

        {/* ── Área de mensajes ── */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50/60">
          {mensajes.map((msg, i) => (
            <div
              key={i}
              className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {/* Avatar del bot */}
              {msg.role === 'assistant' && (
                <div className="flex-shrink-0 h-7 w-7 rounded-full bg-indigo-100 flex items-center justify-center mb-0.5">
                  <Bot className="h-3.5 w-3.5 text-indigo-600" />
                </div>
              )}

              {/* Burbuja */}
              <div
                className={`
                  max-w-[82%] px-3 py-2 rounded-2xl text-sm leading-relaxed
                  ${msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-white text-gray-800 border border-gray-100 rounded-bl-sm shadow-sm'
                  }
                `}
              >
                <MessageContent content={msg.content} />
              </div>
            </div>
          ))}

          {/* Indicador de carga */}
          {cargando && (
            <div className="flex items-end gap-2 justify-start">
              <div className="flex-shrink-0 h-7 w-7 rounded-full bg-indigo-100 flex items-center justify-center">
                <Bot className="h-3.5 w-3.5 text-indigo-600" />
              </div>
              <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm shadow-sm px-4 py-3">
                <div className="flex items-center gap-2 text-indigo-600">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="text-xs font-medium">Analizando base de datos…</span>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Sugerencias rápidas (solo al inicio) ── */}
        {mensajes.length <= 1 && !cargando && (
          <div className="px-3 py-2 border-t border-gray-100 bg-white">
            <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-1.5 flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Sugerencias
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGERENCIAS.map((s) => (
                <button
                  key={s}
                  onClick={() => enviarMensaje(s)}
                  disabled={cargando}
                  className="text-[11px] bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-full px-2.5 py-1 transition-colors disabled:opacity-50 leading-tight"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Input ── */}
        <div className="px-3 py-3 border-t border-gray-100 bg-white rounded-b-2xl">
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Escribe tu pregunta financiera…"
              rows={1}
              disabled={cargando}
              className="flex-1 resize-none text-sm min-h-[38px] max-h-[100px] rounded-xl border-gray-200 focus:border-indigo-400 focus:ring-indigo-400/20 py-2 pr-2 disabled:opacity-60"
              style={{ scrollbarWidth: 'none' }}
            />
            <Button
              onClick={() => enviarMensaje()}
              disabled={cargando || !input.trim()}
              size="sm"
              className="h-9 w-9 p-0 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 flex-shrink-0"
            >
              {cargando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5 text-center">
            Solo responde preguntas sobre cobranzas y auditoría · GPT-4o-mini
          </p>
        </div>
        </div>

        {/* ── Botón flotante (arrastrable; clic sin mover = abrir) ── */}
        <button
          type="button"
          onPointerDown={iniciarArrastre}
          onPointerMove={moverArrastre}
          onPointerUp={finalizarArrastre}
          onPointerCancel={finalizarArrastre}
          onClick={clickEnFab}
          className={`
            flex items-center gap-2 touch-none cursor-grab active:cursor-grabbing select-none
            bg-indigo-600 hover:bg-indigo-700
            text-white font-semibold text-sm
            rounded-full shadow-xl shadow-indigo-500/40
            px-3 py-3 pl-2.5
            transition-shadow duration-200
            ${arrastrando ? 'cursor-grabbing shadow-2xl ring-2 ring-white/30' : ''}
            ${abierto ? 'hidden' : ''}
          `}
          title="Mantén presionado y arrastra para mover · Clic para abrir FioBot"
        >
          <GripVertical className="h-4 w-4 text-white/60 shrink-0" aria-hidden />
          <Bot className="h-5 w-5 shrink-0" />
          <span>FioBot</span>
          <span className="relative ml-0.5 flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
          </span>
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Sub-componente: renderiza Markdown básico en burbujas
// ──────────────────────────────────────────────────────────

function MessageContent({ content }: { content: string }) {
  // Convierte **bold**, *italic*, listas con - y saltos de línea
  const partes = content.split('\n').map((linea, i) => {
    // Negrita
    const renderLinea = linea
      .split(/(\*\*[^*]+\*\*)/g)
      .map((parte, j) => {
        if (parte.startsWith('**') && parte.endsWith('**')) {
          return <strong key={j}>{parte.slice(2, -2)}</strong>;
        }
        return parte;
      });

    // Línea de lista
    if (linea.startsWith('- ') || linea.startsWith('• ')) {
      return (
        <div key={i} className="flex items-start gap-1.5 mt-0.5">
          <span className="mt-1 flex-shrink-0 h-1.5 w-1.5 rounded-full bg-current opacity-50" />
          <span>{renderLinea.map((p, j) => <span key={j}>{p}</span>)}</span>
        </div>
      );
    }

    return (
      <span key={i}>
        {i > 0 && <br />}
        {renderLinea}
      </span>
    );
  });

  return <div className="whitespace-pre-wrap break-words">{partes}</div>;
}
