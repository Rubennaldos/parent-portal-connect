import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Loader2, BookOpen, CheckCircle2 } from 'lucide-react';

interface School {
  id: string;
  name: string;
}

interface LibroReclamacionesProps {
  open: boolean;
  onClose: () => void;
}

const PROVEEDOR = 'UFRASAC CATERING S.AC';
const RUC = '20603916060';
const DOMICILIO_PROVEEDOR = 'CALLE LOS CIPRESES 165 URB EL REMANSO LA MOLINA';

export default function LibroReclamaciones({ open, onClose }: LibroReclamacionesProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [numeroReclamo, setNumeroReclamo] = useState<number | null>(null);

  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState('');

  const [form, setForm] = useState({
    nombre_consumidor: '',
    dni_ce: '',
    domicilio_consumidor: '',
    telefono: '',
    email: '',
    nombre_apoderado: '',
    tipo_bien: '' as 'producto' | 'servicio' | '',
    monto_reclamado: '',
    descripcion_bien: '',
    tipo_reclamacion: '' as 'reclamo' | 'queja' | '',
    detalle: '',
    pedido_consumidor: '',
  });

  // Cargar sedes
  useEffect(() => {
    if (open) {
      supabase.from('schools').select('id, name').order('name').then(({ data }) => {
        setSchools(data ?? []);
      });
    }
  }, [open]);

  // Campos que se marcaron como tocados para mostrar error de radio/select
  const [touched, setTouched] = useState({ tipo_bien: false, tipo_reclamacion: false });

  const set = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ tipo_bien: true, tipo_reclamacion: true });

    const missing: string[] = [];
    if (!selectedSchool) missing.push('Sede');
    if (!form.nombre_consumidor) missing.push('Nombre');
    if (!form.dni_ce) missing.push('DNI / CE');
    if (!form.domicilio_consumidor) missing.push('Domicilio');
    if (!form.telefono) missing.push('Teléfono');
    if (!form.email) missing.push('E-mail');
    if (!form.tipo_bien) missing.push('Tipo de bien (Producto/Servicio)');
    if (!form.monto_reclamado) missing.push('Monto reclamado');
    if (!form.descripcion_bien) missing.push('Descripción del bien');
    if (!form.tipo_reclamacion) missing.push('Tipo (Reclamo/Queja)');
    if (!form.detalle) missing.push('Detalle de la reclamación');
    if (!form.pedido_consumidor) missing.push('Pedido del consumidor');

    if (missing.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Campos obligatorios incompletos',
        description: `Completa: ${missing.join(', ')}.`,
      });
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('reclamaciones')
        .insert({
          nombre_consumidor: form.nombre_consumidor,
          dni_ce: form.dni_ce,
          domicilio_consumidor: form.domicilio_consumidor,
          telefono: form.telefono,
          email: form.email,
          nombre_apoderado: form.nombre_apoderado || null,
          tipo_bien: form.tipo_bien,
          monto_reclamado: parseFloat(form.monto_reclamado),
          descripcion_bien: form.descripcion_bien,
          tipo_reclamacion: form.tipo_reclamacion,
          detalle: form.detalle,
          pedido_consumidor: form.pedido_consumidor,
          school_id: selectedSchool || null,
        })
        .select('numero')
        .single();

      if (error) throw error;
      setNumeroReclamo(data?.numero ?? null);
      setSubmitted(true);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Error al enviar',
        description: err.message || 'No se pudo registrar el reclamo. Intenta nuevamente.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setSubmitted(false);
    setNumeroReclamo(null);
    setSelectedSchool('');
    setTouched({ tipo_bien: false, tipo_reclamacion: false });
    setForm({
      nombre_consumidor: '', dni_ce: '', domicilio_consumidor: '',
      telefono: '', email: '', nombre_apoderado: '',
      tipo_bien: '', monto_reclamado: '', descripcion_bien: '',
      tipo_reclamacion: '', detalle: '', pedido_consumidor: '',
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0" aria-describedby={undefined}>

<DialogTitle className="sr-only">Diálogo</DialogTitle>

        {/* ── Encabezado oficial ── */}
        <div className="border-b border-stone-300">
          <div className="grid grid-cols-3 border-b border-stone-300">
            <div className="col-span-2 p-3 border-r border-stone-300">
              <p className="text-center font-bold text-sm tracking-widest uppercase text-stone-800">
                Libro de Reclamaciones
              </p>
            </div>
            <div className="p-3">
              <p className="text-center font-bold text-xs text-stone-700 uppercase">Hoja de Reclamación</p>
            </div>
          </div>
          <div className="grid grid-cols-3 border-b border-stone-300 text-xs">
            <div className="col-span-2 grid grid-cols-2 border-r border-stone-300">
              <div className="p-2 border-r border-stone-300">
                <span className="font-semibold text-stone-600">FECHA:</span>
                <span className="ml-2 text-stone-800">{new Date().toLocaleDateString('es-PE')}</span>
              </div>
              <div className="p-2">
                <span className="font-semibold text-stone-600">N°</span>
                <span className="ml-2 text-stone-400 italic">Auto</span>
              </div>
            </div>
            <div className="p-2" />
          </div>
          <div className="p-2 text-xs space-y-0.5">
            <p><span className="font-semibold text-stone-600">PROVEEDOR:</span> <span className="text-stone-800">{PROVEEDOR}</span></p>
            <p><span className="font-semibold text-stone-600">RUC:</span> <span className="text-stone-800">{RUC}</span></p>
            <p><span className="font-semibold text-stone-600">DOMICILIO:</span> <span className="text-stone-800">{DOMICILIO_PROVEEDOR}</span></p>
          </div>
        </div>

        {submitted ? (
          /* ── Pantalla de éxito ── */
          <div className="flex flex-col items-center justify-center py-12 px-8 space-y-4">
            <CheckCircle2 className="h-16 w-16 text-green-600" />
            <h3 className="text-xl font-bold text-stone-800 text-center">Reclamo Registrado</h3>
            {numeroReclamo && (
              <div className="bg-stone-100 border border-stone-300 rounded-lg px-6 py-3 text-center">
                <p className="text-xs text-stone-500 font-medium uppercase tracking-wider">Número de Hoja</p>
                <p className="text-3xl font-bold text-stone-800">{String(numeroReclamo).padStart(4, '0')}</p>
              </div>
            )}
            <p className="text-sm text-stone-600 text-center max-w-xs">
              Tu reclamo ha sido registrado. Guarda este número. El proveedor tiene
              <strong> 30 días calendario</strong> para responder.
            </p>
            <Button onClick={handleClose} className="mt-4 bg-[#8B7355] hover:bg-[#6B5744] text-white">
              Cerrar
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-0 text-xs">
            {/* Indicador de obligatorios */}
            <div className="px-3 py-1.5 bg-red-50 border-b border-red-100">
              <p className="text-[10px] text-red-600">* Todos los campos son obligatorios, excepto el nombre del apoderado.</p>
            </div>

            {/* ── Selector de Sede ── */}
            <div className="bg-amber-50 px-3 py-2 border-b border-amber-200 flex items-center gap-3">
              <span className="font-semibold text-xs text-amber-800 shrink-0">SEDE *</span>
              <select
                value={selectedSchool}
                onChange={(e) => setSelectedSchool(e.target.value)}
                className={`flex-1 h-7 text-xs rounded border px-2 focus:outline-none focus:ring-1 focus:ring-[#8B7355] ${!selectedSchool ? 'border-red-300 bg-red-50/40' : 'border-amber-300 bg-white'}`}
              >
                <option value="">— Selecciona la sede —</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* ── Sección 1: Consumidor ── */}
            <div className="bg-stone-100 px-3 py-1.5 border-b border-stone-300">
              <p className="font-bold text-[11px] uppercase tracking-wide text-stone-700">
                1. Identificación del Consumidor Reclamante
              </p>
            </div>
            <div className="grid grid-cols-1 gap-0 border-b border-stone-300">
              <FieldRow label="NOMBRE *">
                <Input
                  value={form.nombre_consumidor}
                  onChange={(e) => set('nombre_consumidor', e.target.value)}
                  className={`h-7 text-xs border-0 focus-visible:ring-0 rounded-none ${!form.nombre_consumidor ? 'bg-red-50/40' : ''}`}
                  placeholder="Apellidos y Nombres completos"
                />
              </FieldRow>
              <FieldRow label="DNI / CE *">
                <Input
                  value={form.dni_ce}
                  onChange={(e) => set('dni_ce', e.target.value)}
                  className={`h-7 text-xs border-0 focus-visible:ring-0 rounded-none ${!form.dni_ce ? 'bg-red-50/40' : ''}`}
                  placeholder="Número de documento"
                />
              </FieldRow>
              <FieldRow label="DOMICILIO *">
                <Input
                  value={form.domicilio_consumidor}
                  onChange={(e) => set('domicilio_consumidor', e.target.value)}
                  className={`h-7 text-xs border-0 focus-visible:ring-0 rounded-none ${!form.domicilio_consumidor ? 'bg-red-50/40' : ''}`}
                  placeholder="Dirección completa"
                />
              </FieldRow>
              <div className="grid grid-cols-2 border-t border-stone-200">
                <FieldRow label="TELÉFONO *" noBorder>
                  <Input
                    value={form.telefono}
                    onChange={(e) => set('telefono', e.target.value)}
                    className={`h-7 text-xs border-0 focus-visible:ring-0 rounded-none ${!form.telefono ? 'bg-red-50/40' : ''}`}
                    placeholder="999 999 999"
                  />
                </FieldRow>
                <FieldRow label="E-MAIL *" noBorder>
                  <Input
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    className={`h-7 text-xs border-0 focus-visible:ring-0 rounded-none ${!form.email ? 'bg-red-50/40' : ''}`}
                    placeholder="correo@ejemplo.com"
                    type="email"
                  />
                </FieldRow>
              </div>
              <FieldRow label="SI ES MENOR DE EDAD — Nombre del Padre, Madre o Apoderado (opcional):">
                <Input
                  value={form.nombre_apoderado}
                  onChange={(e) => set('nombre_apoderado', e.target.value)}
                  className="h-7 text-xs border-0 focus-visible:ring-0 rounded-none"
                  placeholder="Solo si el reclamante es menor de edad"
                />
              </FieldRow>
            </div>

            {/* ── Sección 2: Bien contratado ── */}
            <div className="bg-stone-100 px-3 py-1.5 border-b border-stone-300">
              <p className="font-bold text-[11px] uppercase tracking-wide text-stone-700">
                2. Identificación del Bien Contratado
              </p>
            </div>
            <div className="border-b border-stone-300">
              <div className="grid grid-cols-2 border-b border-stone-200">
                <div className={`flex items-center gap-3 px-3 py-2 border-r border-stone-200 ${touched.tipo_bien && !form.tipo_bien ? 'bg-red-50/40' : ''}`}>
                  <span className="font-semibold text-stone-600 shrink-0">PRODUCTO *</span>
                  <input
                    type="radio" name="tipo_bien" value="producto"
                    checked={form.tipo_bien === 'producto'}
                    onChange={() => { set('tipo_bien', 'producto'); setTouched(t => ({ ...t, tipo_bien: true })); }}
                    className="cursor-pointer"
                  />
                  <span className="font-semibold text-stone-600 ml-3 shrink-0">SERVICIO *</span>
                  <input
                    type="radio" name="tipo_bien" value="servicio"
                    checked={form.tipo_bien === 'servicio'}
                    onChange={() => { set('tipo_bien', 'servicio'); setTouched(t => ({ ...t, tipo_bien: true })); }}
                    className="cursor-pointer"
                  />
                </div>
                <FieldRow label="MONTO RECLAMADO (S/) *" noBorder>
                  <Input
                    value={form.monto_reclamado}
                    onChange={(e) => set('monto_reclamado', e.target.value)}
                    className={`h-7 text-xs border-0 focus-visible:ring-0 rounded-none ${!form.monto_reclamado ? 'bg-red-50/40' : ''}`}
                    placeholder="0.00"
                    type="number"
                    min="0"
                    step="0.01"
                  />
                </FieldRow>
              </div>
              <FieldRow label="DESCRIPCIÓN *">
                <Input
                  value={form.descripcion_bien}
                  onChange={(e) => set('descripcion_bien', e.target.value)}
                  className={`h-7 text-xs border-0 focus-visible:ring-0 rounded-none ${!form.descripcion_bien ? 'bg-red-50/40' : ''}`}
                  placeholder="Describe el producto o servicio involucrado"
                />
              </FieldRow>
            </div>

            {/* ── Sección 3: Detalle del reclamo ── */}
            <div className={`bg-stone-100 px-3 py-1.5 border-b border-stone-300 flex items-center justify-between ${touched.tipo_reclamacion && !form.tipo_reclamacion ? 'bg-red-50' : ''}`}>
              <p className="font-bold text-[11px] uppercase tracking-wide text-stone-700">
                3. Detalle de la Reclamación y Pedido del Consumidor *
              </p>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio" name="tipo_reclamacion" value="reclamo"
                    checked={form.tipo_reclamacion === 'reclamo'}
                    onChange={() => { set('tipo_reclamacion', 'reclamo'); setTouched(t => ({ ...t, tipo_reclamacion: true })); }}
                  />
                  <span className="font-semibold text-stone-700">RECLAMO ¹</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio" name="tipo_reclamacion" value="queja"
                    checked={form.tipo_reclamacion === 'queja'}
                    onChange={() => { set('tipo_reclamacion', 'queja'); setTouched(t => ({ ...t, tipo_reclamacion: true })); }}
                  />
                  <span className="font-semibold text-stone-700">QUEJA ²</span>
                </label>
              </div>
            </div>
            <div className="border-b border-stone-300 p-0">
              <div className="px-3 pt-2 pb-1">
                <p className="font-semibold text-stone-600 mb-1">DETALLE: *</p>
                <Textarea
                  value={form.detalle}
                  onChange={(e) => set('detalle', e.target.value)}
                  className={`text-xs border rounded-md resize-none focus-visible:ring-1 focus-visible:ring-[#8B7355] ${!form.detalle ? 'border-red-200 bg-red-50/40' : 'border-stone-200'}`}
                  rows={4}
                  placeholder="Describe detalladamente lo sucedido..."
                />
              </div>
              <div className="px-3 pt-1 pb-3">
                <p className="font-semibold text-stone-600 mb-1">PEDIDO DEL CONSUMIDOR: *</p>
                <Textarea
                  value={form.pedido_consumidor}
                  onChange={(e) => set('pedido_consumidor', e.target.value)}
                  className={`text-xs border rounded-md resize-none focus-visible:ring-1 focus-visible:ring-[#8B7355] ${!form.pedido_consumidor ? 'border-red-200 bg-red-50/40' : 'border-stone-200'}`}
                  rows={2}
                  placeholder="¿Qué solución esperas?"
                />
              </div>
            </div>

            {/* ── Notas legales ── */}
            <div className="px-3 py-2 space-y-1 border-b border-stone-300 bg-stone-50">
              <p className="text-[10px] text-stone-500">
                ¹ <strong>Reclamo:</strong> Disconformidad relacionada a los productos o servicios.
              </p>
              <p className="text-[10px] text-stone-500">
                ² <strong>Queja:</strong> Disconformidad relacionada a la atención al consumidor.
              </p>
              <p className="text-[10px] text-stone-500 pt-1">
                La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI. El proveedor deberá dar respuesta al reclamo en un plazo no mayor a <strong>30 días calendario</strong>.
              </p>
            </div>

            {/* ── Botones ── */}
            <div className="flex justify-end gap-3 p-4">
              <Button type="button" variant="outline" onClick={handleClose} disabled={isLoading}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isLoading} className="bg-red-700 hover:bg-red-800 text-white">
                {isLoading ? (
                  <><Loader2 className="animate-spin h-4 w-4 mr-2" /> Enviando...</>
                ) : (
                  <><BookOpen className="h-4 w-4 mr-2" /> Registrar Reclamo</>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Componente auxiliar de fila ── */
function FieldRow({
  label,
  children,
  noBorder,
}: {
  label: string;
  children: React.ReactNode;
  noBorder?: boolean;
}) {
  return (
    <div className={`flex items-center ${!noBorder ? 'border-t border-stone-200' : ''}`}>
      <span className="font-semibold text-stone-600 px-3 py-1 w-auto shrink-0 whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 border-l border-stone-200">{children}</div>
    </div>
  );
}
