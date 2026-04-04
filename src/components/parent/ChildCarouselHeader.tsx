/**
 * ChildCarouselHeader — Tarjeta superior del carrusel estilo v0/Yape
 *
 * - Avatar con badge de cámara (cambia foto del menor)
 * - Eye icon junto al nombre (abre sheet de detalles)
 * - Flechas < > funcionales para navegar entre hijos
 * - Dots de navegación rápida
 */
import { useState } from 'react';
import { Eye, Camera, ChevronLeft, ChevronRight, GraduationCap, School, Hash, CircleCheck } from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';

interface StudentLike {
  id: string;
  full_name: string;
  photo_url: string | null;
  grade: string;
  section?: string;
  school?: { id: string; name: string } | null;
  balance?: number;
  is_active?: boolean;
}

interface ChildCarouselHeaderProps {
  students: StudentLike[];
  activeStudentId: string | null;
  onDotClick: (studentId: string) => void;
  onCameraClick?: () => void;
}

export function ChildCarouselHeader({
  students,
  activeStudentId,
  onDotClick,
  onCameraClick,
}: ChildCarouselHeaderProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const active = students.find(s => s.id === activeStudentId) ?? students[0];
  if (!active) return null;

  const activeIdx = students.findIndex(s => s.id === (activeStudentId ?? students[0]?.id));

  const prevStudent = () => {
    const prev = (activeIdx - 1 + students.length) % students.length;
    onDotClick(students[prev].id);
  };

  const nextStudent = () => {
    const next = (activeIdx + 1) % students.length;
    onDotClick(students[next].id);
  };

  const initials = active.full_name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();

  return (
    <>
      <div className="bg-white rounded-[1.75rem] shadow-lg shadow-slate-200/60 border border-white/80 p-5">
        <div className="flex items-center gap-4">

          {/* ── Avatar + badge cámara ── */}
          <div className="relative shrink-0">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-500 p-[3px] shadow-lg shadow-emerald-300/40">
              <div className="w-full h-full rounded-full bg-white overflow-hidden flex items-center justify-center">
                {active.photo_url ? (
                  <img
                    src={active.photo_url}
                    alt={active.full_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xl font-bold bg-gradient-to-br from-emerald-500 to-teal-600 bg-clip-text text-transparent">
                    {initials}
                  </span>
                )}
              </div>
            </div>

            {/* Badge cámara — esquina superior derecha */}
            {onCameraClick && (
              <button
                onClick={(e) => { e.stopPropagation(); onCameraClick(); }}
                className="absolute -top-0.5 -right-0.5 w-6 h-6 bg-white border-2 border-slate-100 rounded-full flex items-center justify-center shadow-sm hover:bg-slate-50 active:scale-95 transition-all"
                aria-label="Cambiar foto"
              >
                <Camera className="w-3 h-3 text-slate-500" />
              </button>
            )}

            {/* Indicador activo — esquina inferior derecha */}
            <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full border-[3px] border-white flex items-center justify-center shadow-md" style={{ right: onCameraClick ? '16px' : '-2px' }}>
              <CircleCheck className="w-3.5 h-3.5 text-white" strokeWidth={3} />
            </div>
          </div>

          {/* ── Nombre + eye + colegio ── */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className="text-base font-bold text-slate-800 truncate">{active.full_name}</h2>
              <button
                onClick={() => setDetailsOpen(true)}
                className="shrink-0 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-600 active:scale-95 transition-all rounded-full hover:bg-slate-100"
                aria-label="Ver datos del estudiante"
              >
                <Eye className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400 font-medium truncate">
              {active.school?.name ?? 'Colegio'}
            </p>
          </div>

        </div>

        {/* ── Flechas + Dots ── */}
        {students.length > 1 && (
          <div className="flex justify-center items-center gap-3 mt-4">

            {/* Flecha anterior */}
            <button
              onClick={prevStudent}
              className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-90 transition-all flex items-center justify-center shrink-0"
              aria-label="Hijo anterior"
            >
              <ChevronLeft className="w-4 h-4 text-slate-400" />
            </button>

            {/* Dots */}
            {students.map(s => (
              <button
                key={s.id}
                onClick={() => onDotClick(s.id)}
                className={`rounded-full transition-all duration-300 ${
                  s.id === activeStudentId
                    ? 'w-6 h-2.5 bg-gradient-to-r from-emerald-400 to-teal-500 shadow-sm shadow-emerald-300'
                    : 'w-2.5 h-2.5 bg-slate-200 hover:bg-slate-300'
                }`}
                aria-label={`Ver ${s.full_name}`}
              />
            ))}

            {/* Flecha siguiente */}
            <button
              onClick={nextStudent}
              className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-90 transition-all flex items-center justify-center shrink-0"
              aria-label="Siguiente hijo"
            >
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>

          </div>
        )}
      </div>

      {/* ── Sheet detalles del menor ── */}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="bottom" className="rounded-t-[2rem] pb-8 max-h-[85vh] overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-left text-lg font-bold">Datos del estudiante</SheetTitle>
          </SheetHeader>

          <div className="flex justify-center mb-6">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-500 p-1 shadow-xl shadow-emerald-300/40">
              <div className="w-full h-full rounded-full bg-white overflow-hidden flex items-center justify-center">
                {active.photo_url ? (
                  <img src={active.photo_url} alt={active.full_name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl font-bold bg-gradient-to-br from-emerald-500 to-teal-600 bg-clip-text text-transparent">
                    {initials}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <DetailRow icon={<CircleCheck className="w-4 h-4 text-emerald-500" />} label="Nombre completo" value={active.full_name} />
            <DetailRow icon={<School className="w-4 h-4 text-teal-500" />} label="Colegio" value={active.school?.name ?? '—'} />
            <DetailRow icon={<GraduationCap className="w-4 h-4 text-violet-500" />} label="Grado" value={active.grade ?? '—'} />
            {active.section && (
              <DetailRow icon={<Hash className="w-4 h-4 text-amber-500" />} label="Sección" value={active.section} />
            )}
          </div>

          <button
            onClick={() => setDetailsOpen(false)}
            className="mt-8 w-full py-3 rounded-2xl bg-slate-100 text-slate-600 font-semibold text-sm hover:bg-slate-200 active:scale-[0.98] transition-all"
          >
            Cerrar
          </button>
        </SheetContent>
      </Sheet>
    </>
  );
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl">
      <div className="w-9 h-9 rounded-xl bg-white shadow-sm flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-slate-400 uppercase tracking-wide leading-none mb-0.5">{label}</p>
        <p className="text-sm font-semibold text-slate-700 truncate">{value}</p>
      </div>
    </div>
  );
}
