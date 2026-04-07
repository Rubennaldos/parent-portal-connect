import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  BookOpen, Clock, CheckCircle2, AlertCircle, Loader2,
  RefreshCw, Eye, MessageSquareReply, Search, Sparkles,
  Mail, Copy, ExternalLink,
} from 'lucide-react';

// ─── Gemini (misma API que soporte IA) ──────────────────────────
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const GEMINI_KEY = 'AIzaSyDp3GAyFd7RVg_n6KwlsUP_e6V4wycF9Wg';

// ─── Tipos ──────────────────────────────────────────────────────
interface Reclamacion {
  id: string;
  numero: number;
  fecha: string;
  nombre_consumidor: string;
  dni_ce: string;
  domicilio_consumidor: string;
  telefono: string;
  email: string;
  nombre_apoderado: string | null;
  tipo_bien: string | null;
  monto_reclamado: number | null;
  descripcion_bien: string | null;
  tipo_reclamacion: string;
  detalle: string;
  pedido_consumidor: string | null;
  estado: string;
  respuesta_proveedor: string | null;
  fecha_respuesta: string | null;
  created_at: string;
  school_id: string | null;
}

interface School {
  id: string;
  name: string;
}

const ESTADO_BADGE: Record<string, { label: string; color: string }> = {
  pendiente:  { label: 'Pendiente',  color: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  en_proceso: { label: 'En proceso', color: 'bg-blue-100 text-blue-800 border-blue-300' },
  resuelto:   { label: 'Resuelto',   color: 'bg-green-100 text-green-800 border-green-300' },
};

const PROVEEDOR = 'UFRASAC CATERING S.AC';
const RUC = '20603916060';
const DOMICILIO_PROVEEDOR = 'CALLE LOS CIPRESES 165 URB EL REMANSO LA MOLINA';

// ─────────────────────────────────────────────────────────────────
export function ReclamacionesPanel() {
  const { toast } = useToast();

  const [reclamaciones, setReclamaciones] = useState<Reclamacion[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todos');

  // Modal detalle
  const [selected, setSelected] = useState<Reclamacion | null>(null);
  const [respuesta, setRespuesta] = useState('');
  const [nuevoEstado, setNuevoEstado] = useState('');
  const [savingResp, setSavingResp] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);

  // Modal preview email
  const [showEmailPreview, setShowEmailPreview] = useState(false);

  useEffect(() => {
    cargar();
    supabase.from('schools').select('id, name').order('name').then(({ data }) => setSchools(data ?? []));
  }, []);

  const getSchoolName = (id: string | null) => schools.find((s) => s.id === id)?.name ?? '—';

  const cargar = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('reclamaciones')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) toast({ variant: 'destructive', title: 'Error', description: error.message });
    else setReclamaciones(data ?? []);
    setLoading(false);
  };

  // ─── Abrir detalle ──────────────────────────────────────────
  const abrirDetalle = (r: Reclamacion) => {
    setSelected(r);
    setRespuesta(r.respuesta_proveedor ?? '');
    setNuevoEstado(r.estado);
  };

  // ─── Guardar respuesta ──────────────────────────────────────
  const guardarRespuesta = async () => {
    if (!selected) return;
    setSavingResp(true);
    const { error } = await supabase
      .from('reclamaciones')
      .update({
        respuesta_proveedor: respuesta,
        estado: nuevoEstado,
        fecha_respuesta: nuevoEstado === 'resuelto' ? new Date().toISOString().split('T')[0] : selected.fecha_respuesta,
      })
      .eq('id', selected.id);
    if (error) {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    } else {
      toast({ title: '✅ Guardado', description: 'Respuesta registrada.' });
      setSelected(null);
      cargar();
    }
    setSavingResp(false);
  };

  // ─── Generar respuesta con IA ─────────────────────────────
  const generarRespuestaIA = async () => {
    if (!selected) return;
    setGeneratingAI(true);
    try {
      const prompt = `Eres el responsable de atención al cliente de ${PROVEEDOR} (RUC ${RUC}), empresa de catering escolar.

Un consumidor ha presentado una ${selected.tipo_reclamacion === 'reclamo' ? 'RECLAMACIÓN' : 'QUEJA'} con los siguientes datos:

- Nombre: ${selected.nombre_consumidor}
- Tipo: ${selected.tipo_reclamacion === 'reclamo' ? 'Reclamo (disconformidad con producto/servicio)' : 'Queja (disconformidad con la atención)'}
- Bien contratado: ${selected.tipo_bien ?? 'No especificado'} — ${selected.descripcion_bien ?? 'Sin descripción'}
- Monto reclamado: S/ ${selected.monto_reclamado?.toFixed(2) ?? '0.00'}
- Detalle del reclamo: ${selected.detalle}
- Pedido del consumidor: ${selected.pedido_consumidor ?? 'No especificado'}
- Sede: ${getSchoolName(selected.school_id)}

Genera una respuesta PROFESIONAL, empática y legal al consumidor. Debe:
1. Saludar por nombre
2. Agradecer la comunicación
3. Reconocer el reclamo/queja
4. Ofrecer una solución concreta o explicar las acciones tomadas
5. Indicar que la empresa valora la satisfacción del cliente
6. Despedirse profesionalmente firmando como "${PROVEEDOR}"

Responde SOLO con el texto de la respuesta, sin explicaciones adicionales. Máximo 200 palabras. En español.`;

      const body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      });

      const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (!res.ok) throw new Error(`Error IA (${res.status})`);
      const data = await res.json();
      const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      setRespuesta(aiText);
      toast({ title: '✨ Respuesta generada', description: 'Revisa y edita antes de guardar.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error IA', description: err.message });
    } finally {
      setGeneratingAI(false);
    }
  };

  // ─── Email: generar HTML profesional ────────────────────────
  const generarEmailHTML = () => {
    if (!selected) return '';
    const hoja = String(selected.numero).padStart(4, '0');
    const fecha = new Date(selected.fecha).toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const fechaResp = new Date().toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#8B7355,#6B5744);padding:28px 32px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:18px;letter-spacing:2px;">LIBRO DE RECLAMACIONES</h1>
    <p style="color:#d4c5b0;margin:6px 0 0;font-size:12px;">RESPUESTA OFICIAL — HOJA N° ${hoja}</p>
  </td></tr>

  <!-- Datos del proveedor -->
  <tr><td style="padding:24px 32px 0;">
    <table width="100%" style="border:1px solid #e7e5e4;border-radius:8px;overflow:hidden;">
      <tr style="background:#fafaf9;">
        <td style="padding:12px 16px;font-size:11px;color:#78716c;font-weight:bold;width:100px;">PROVEEDOR</td>
        <td style="padding:12px 16px;font-size:13px;color:#292524;font-weight:600;">${PROVEEDOR}</td>
      </tr>
      <tr>
        <td style="padding:8px 16px;font-size:11px;color:#78716c;font-weight:bold;border-top:1px solid #f5f5f4;">RUC</td>
        <td style="padding:8px 16px;font-size:13px;color:#292524;border-top:1px solid #f5f5f4;">${RUC}</td>
      </tr>
      <tr>
        <td style="padding:8px 16px;font-size:11px;color:#78716c;font-weight:bold;border-top:1px solid #f5f5f4;">DOMICILIO</td>
        <td style="padding:8px 16px;font-size:13px;color:#292524;border-top:1px solid #f5f5f4;">${DOMICILIO_PROVEEDOR}</td>
      </tr>
    </table>
  </td></tr>

  <!-- Info del reclamo -->
  <tr><td style="padding:20px 32px 0;">
    <table width="100%" style="border:1px solid #fecaca;border-radius:8px;overflow:hidden;background:#fef2f2;">
      <tr>
        <td style="padding:12px 16px;">
          <p style="margin:0 0 4px;font-size:11px;color:#991b1b;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">
            ${selected.tipo_reclamacion === 'reclamo' ? '¹ RECLAMO' : '² QUEJA'} — Hoja N° ${hoja}
          </p>
          <p style="margin:0;font-size:12px;color:#7f1d1d;">Fecha de registro: ${fecha}</p>
          <p style="margin:4px 0 0;font-size:12px;color:#7f1d1d;">Consumidor: <strong>${selected.nombre_consumidor}</strong> (${selected.dni_ce})</p>
          ${selected.tipo_bien ? `<p style="margin:4px 0 0;font-size:12px;color:#7f1d1d;">Bien: ${selected.tipo_bien} — ${selected.descripcion_bien ?? ''}</p>` : ''}
          ${selected.monto_reclamado ? `<p style="margin:4px 0 0;font-size:12px;color:#7f1d1d;">Monto reclamado: <strong>S/ ${selected.monto_reclamado.toFixed(2)}</strong></p>` : ''}
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Detalle del reclamo original -->
  <tr><td style="padding:20px 32px 0;">
    <p style="margin:0 0 8px;font-size:11px;color:#78716c;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">Detalle del reclamo</p>
    <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:8px;padding:14px 16px;">
      <p style="margin:0;font-size:13px;color:#44403c;line-height:1.6;">${selected.detalle}</p>
    </div>
  </td></tr>

  <!-- RESPUESTA DEL PROVEEDOR -->
  <tr><td style="padding:24px 32px 0;">
    <div style="background:#f0fdf4;border:2px solid #86efac;border-radius:8px;padding:18px 20px;">
      <p style="margin:0 0 8px;font-size:11px;color:#166534;font-weight:bold;text-transform:uppercase;letter-spacing:1px;">✅ Respuesta del Proveedor</p>
      <p style="margin:0 0 4px;font-size:11px;color:#15803d;">Fecha de respuesta: ${fechaResp}</p>
      <hr style="border:none;border-top:1px solid #bbf7d0;margin:10px 0;">
      <p style="margin:0;font-size:13px;color:#14532d;line-height:1.7;white-space:pre-wrap;">${respuesta}</p>
    </div>
  </td></tr>

  <!-- Nota legal -->
  <tr><td style="padding:24px 32px;">
    <p style="margin:0;font-size:10px;color:#a8a29e;line-height:1.5;text-align:center;">
      Conforme al Código de Protección y Defensa del Consumidor (Ley N° 29571) y el D.S. N° 011-2011-PCM, la formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante INDECOPI.
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#292524;padding:20px 32px;text-align:center;">
    <p style="margin:0;color:#a8a29e;font-size:11px;">${PROVEEDOR} · RUC ${RUC}</p>
    <p style="margin:4px 0 0;color:#78716c;font-size:10px;">${DOMICILIO_PROVEEDOR}</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`.trim();
  };

  // ─── Enviar por email (mailto con fallback) ─────────────────
  const enviarEmail = () => {
    if (!selected) return;
    const hoja = String(selected.numero).padStart(4, '0');
    const subject = encodeURIComponent(`Respuesta a ${selected.tipo_reclamacion === 'reclamo' ? 'Reclamo' : 'Queja'} N° ${hoja} — ${PROVEEDOR}`);
    const body = encodeURIComponent(`Estimado/a ${selected.nombre_consumidor},\n\n${respuesta}\n\nAtentamente,\n${PROVEEDOR}\nRUC: ${RUC}\n${DOMICILIO_PROVEEDOR}`);
    window.open(`mailto:${selected.email}?subject=${subject}&body=${body}`, '_blank');
  };

  // ─── Copiar HTML al portapapeles ──────────────────────────
  const copiarHTML = async () => {
    const html = generarEmailHTML();
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([respuesta], { type: 'text/plain' }),
        }),
      ]);
      toast({ title: '📋 Copiado', description: 'Pega directamente en Gmail o tu cliente de correo.' });
    } catch {
      await navigator.clipboard.writeText(respuesta);
      toast({ title: '📋 Texto copiado', description: 'Se copió el texto de la respuesta.' });
    }
  };

  // ─── Filtros ────────────────────────────────────────────────
  const filtradas = reclamaciones.filter((r) => {
    const matchEstado = filtroEstado === 'todos' || r.estado === filtroEstado;
    const texto = searchText.toLowerCase();
    const matchTexto = !texto
      || r.nombre_consumidor.toLowerCase().includes(texto)
      || r.dni_ce.toLowerCase().includes(texto)
      || String(r.numero).includes(texto);
    return matchEstado && matchTexto;
  });

  const pendientes = reclamaciones.filter((r) => r.estado === 'pendiente').length;
  const enProceso  = reclamaciones.filter((r) => r.estado === 'en_proceso').length;
  const resueltos  = reclamaciones.filter((r) => r.estado === 'resuelto').length;

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard icon={<Clock className="h-5 w-5 text-yellow-600" />} label="Pendientes" value={pendientes} color="yellow" />
        <StatCard icon={<AlertCircle className="h-5 w-5 text-blue-600" />} label="En proceso" value={enProceso} color="blue" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5 text-green-600" />} label="Resueltos" value={resueltos} color="green" />
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
          <Input placeholder="Buscar por nombre, DNI o N°…" value={searchText} onChange={(e) => setSearchText(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-2">
          {['todos', 'pendiente', 'en_proceso', 'resuelto'].map((e) => (
            <button key={e} onClick={() => setFiltroEstado(e)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${filtroEstado === e ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'}`}>
              {e === 'todos' ? 'Todos' : ESTADO_BADGE[e]?.label ?? e}
            </button>
          ))}
          <Button variant="outline" size="sm" onClick={cargar} className="ml-2">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-stone-400" /></div>
      ) : filtradas.length === 0 ? (
        <div className="text-center py-16 text-stone-400">
          <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No hay reclamaciones registradas.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase">N°</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase">Fecha</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase">Consumidor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase">Sede</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase">Tipo</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase">Monto</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase">Estado</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-stone-500 uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {filtradas.map((r) => (
                <tr key={r.id} className="hover:bg-stone-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-stone-700">{String(r.numero).padStart(4, '0')}</td>
                  <td className="px-4 py-3 text-stone-600 text-xs whitespace-nowrap">{new Date(r.fecha).toLocaleDateString('es-PE')}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-stone-800">{r.nombre_consumidor}</p>
                    <p className="text-[11px] text-stone-400">{r.dni_ce}</p>
                  </td>
                  <td className="px-4 py-3 text-stone-600 text-xs">{getSchoolName(r.school_id)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${r.tipo_reclamacion === 'reclamo' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-orange-50 text-orange-700 border-orange-200'}`}>
                      {r.tipo_reclamacion === 'reclamo' ? 'Reclamo' : 'Queja'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-stone-700 font-medium">{r.monto_reclamado != null ? `S/ ${r.monto_reclamado.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${ESTADO_BADGE[r.estado]?.color}`}>
                      {ESTADO_BADGE[r.estado]?.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => abrirDetalle(r)}>
                      <Eye className="h-3 w-3 mr-1" /> Ver / Responder
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ═══════════ MODAL DETALLE Y RESPUESTA ═══════════ */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-stone-800">
              <BookOpen className="h-5 w-5 text-red-700" />
              Hoja N° {selected ? String(selected.numero).padStart(4, '0') : ''}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-5 text-sm">

              {/* Info consumidor */}
              <div className="bg-stone-50 rounded-lg p-4 space-y-2 border">
                <p className="font-semibold text-stone-700 uppercase text-xs tracking-wide mb-2">Consumidor</p>
                <Row label="Nombre" value={selected.nombre_consumidor} />
                <Row label="DNI / CE" value={selected.dni_ce} />
                <Row label="Domicilio" value={selected.domicilio_consumidor} />
                <Row label="Teléfono" value={selected.telefono} />
                <Row label="Email" value={selected.email} />
                <Row label="Sede" value={getSchoolName(selected.school_id)} />
                {selected.nombre_apoderado && <Row label="Apoderado" value={selected.nombre_apoderado} />}
              </div>

              {/* Info bien */}
              <div className="bg-stone-50 rounded-lg p-4 space-y-2 border">
                <p className="font-semibold text-stone-700 uppercase text-xs tracking-wide mb-2">Bien contratado</p>
                <Row label="Tipo" value={selected.tipo_bien ?? '—'} />
                <Row label="Descripción" value={selected.descripcion_bien ?? '—'} />
                <Row label="Monto" value={selected.monto_reclamado != null ? `S/ ${selected.monto_reclamado.toFixed(2)}` : '—'} />
              </div>

              {/* Reclamo */}
              <div className="bg-red-50 rounded-lg p-4 space-y-3 border border-red-100">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-red-800 uppercase text-xs tracking-wide">Reclamación</p>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold border ${selected.tipo_reclamacion === 'reclamo' ? 'bg-red-100 text-red-700 border-red-300' : 'bg-orange-100 text-orange-700 border-orange-300'}`}>
                    {selected.tipo_reclamacion === 'reclamo' ? '¹ RECLAMO' : '² QUEJA'}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-stone-600 mb-1">Detalle:</p>
                  <p className="text-stone-800 bg-white rounded p-2 border text-xs leading-relaxed">{selected.detalle}</p>
                </div>
                {selected.pedido_consumidor && (
                  <div>
                    <p className="text-xs font-semibold text-stone-600 mb-1">Pedido del consumidor:</p>
                    <p className="text-stone-800 bg-white rounded p-2 border text-xs leading-relaxed">{selected.pedido_consumidor}</p>
                  </div>
                )}
              </div>

              {/* Respuesta */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-stone-700 uppercase text-xs tracking-wide">Respuesta del Proveedor</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={generarRespuestaIA}
                    disabled={generatingAI}
                    className="gap-1.5 text-purple-700 border-purple-200 hover:bg-purple-50"
                  >
                    {generatingAI ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {generatingAI ? 'Generando…' : 'Responder con IA'}
                  </Button>
                </div>
                <div className="flex gap-2">
                  {['pendiente', 'en_proceso', 'resuelto'].map((e) => (
                    <button key={e} onClick={() => setNuevoEstado(e)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${nuevoEstado === e ? 'bg-stone-800 text-white border-stone-800' : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'}`}>
                      {ESTADO_BADGE[e]?.label}
                    </button>
                  ))}
                </div>
                <Textarea value={respuesta} onChange={(e) => setRespuesta(e.target.value)} rows={5} placeholder="Escribe la respuesta oficial…" className="text-sm" />
                {selected.fecha_respuesta && (
                  <p className="text-xs text-stone-500">Última respuesta: {new Date(selected.fecha_respuesta).toLocaleDateString('es-PE')}</p>
                )}

                {/* Botones de acción */}
                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  <Button variant="outline" onClick={() => setSelected(null)}>Cancelar</Button>
                  <Button onClick={guardarRespuesta} disabled={savingResp} className="bg-green-700 hover:bg-green-800 text-white">
                    {savingResp ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                    Guardar Respuesta
                  </Button>
                  <div className="flex-1" />
                  {respuesta && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setShowEmailPreview(true)} className="gap-1.5 text-blue-700 border-blue-200 hover:bg-blue-50">
                        <Eye className="h-3.5 w-3.5" /> Preview Email
                      </Button>
                      <Button size="sm" variant="outline" onClick={copiarHTML} className="gap-1.5 text-stone-700">
                        <Copy className="h-3.5 w-3.5" /> Copiar para Email
                      </Button>
                      <Button size="sm" onClick={enviarEmail} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
                        <Mail className="h-3.5 w-3.5" /> Enviar al correo
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══════════ MODAL PREVIEW EMAIL ═══════════ */}
      <Dialog open={showEmailPreview} onOpenChange={setShowEmailPreview}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0" aria-describedby={undefined}>
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle className="flex items-center gap-2 text-stone-800">
              <Mail className="h-5 w-5 text-blue-600" />
              Vista previa — Así le llegará al consumidor
            </DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-2 flex gap-2">
            <Button size="sm" variant="outline" onClick={copiarHTML} className="gap-1.5">
              <Copy className="h-3.5 w-3.5" /> Copiar para pegar en Gmail
            </Button>
            <Button size="sm" onClick={enviarEmail} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
              <ExternalLink className="h-3.5 w-3.5" /> Abrir en cliente de correo
            </Button>
          </div>
          {/* Render del email en iframe */}
          <div className="border-t bg-stone-100 p-4">
            <div className="bg-white rounded-lg shadow-md overflow-hidden border">
              <iframe
                title="Email Preview"
                srcDoc={generarEmailHTML()}
                className="w-full border-0"
                style={{ minHeight: '700px' }}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────
function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    yellow: 'bg-yellow-50 border-yellow-200',
    blue:   'bg-blue-50 border-blue-200',
    green:  'bg-green-50 border-green-200',
  };
  return (
    <div className={`rounded-xl border p-4 flex items-center gap-4 ${colors[color]}`}>
      <div className="shrink-0">{icon}</div>
      <div>
        <p className="text-2xl font-bold text-stone-800">{value}</p>
        <p className="text-xs text-stone-500 font-medium">{label}</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="font-semibold text-stone-500 w-28 shrink-0">{label}:</span>
      <span className="text-stone-800">{value}</span>
    </div>
  );
}
