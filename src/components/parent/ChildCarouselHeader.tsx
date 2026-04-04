/**
 * ChildCarouselHeader — Tarjeta superior del carrusel estilo v0/Yape
 *
 * Muestra el hijo activo con avatar, nombre, colegio y dots de navegación.
 * El botón ">" abre un sheet con los datos completos del menor.
 * Los dots llaman onDotClick para scrollear el carrusel real (que sigue existiendo).
 */
import { useState } from 'react';
import { ChevronRight, GraduationCap, School, Hash, CircleCheck } from 'lucide-react';
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
}

export function ChildCarouselHeader({
  students,
  activeStudentId,
  onDotClick,
}: ChildCarouselHeaderProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const active = students.find(s => s.id === activeStudentId) ?? students[0];
  if (!active) return null;

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
          {/* Avatar con anillo de gradiente */}
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
            {/* Indicador activo */}
            <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full border-[3px] border-white flex items-center justify-center shadow-md">
              <CircleCheck className="w-3.5 h-3.5 text-white" strokeWidth={3} />
            </div>
          </div>

          {/* Nombre y colegio */}
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-800 truncate">{active.full_name}</h2>
            <p className="text-xs text-slate-400 font-medium truncate">
              {active.school?.name ?? 'Colegio'}
            </p>
          </div>

          {/* Botón ver detalles */}
          <button
            onClick={() => setDetailsOpen(true)}
            className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 transition-all flex items-center justify-center shrink-0"
            aria-label="Ver datos del estudiante"
          >
            <ChevronRight className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Dots de navegación — solo cuando hay más de 1 hijo */}
        {students.length > 1 && (
          <div className="flex justify-center items-center gap-2 mt-4">
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
          </div>
        )}
      </div>

      {/* Sheet de detalles del menor */}
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="bottom" className="rounded-t-[2rem] pb-8 max-h-[85vh] overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-left text-lg font-bold">Datos del estudiante</SheetTitle>
          </SheetHeader>

          {/* Avatar grande */}
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
