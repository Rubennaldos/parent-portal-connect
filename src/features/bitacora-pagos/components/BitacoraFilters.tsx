import { useEffect, useState } from 'react';
import { Search, Building2, UserCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { fetchBitacoraCollectors } from '../services/bitacoraService';
import type { BitacoraFilters, SelectOption } from '../types';

interface Props {
  filters:          BitacoraFilters;
  schools:          SelectOption[];
  canViewAllSchools: boolean;
  onApply:          (next: Partial<BitacoraFilters>) => void;
}

function isoDate(d: Date) { return d.toISOString().split('T')[0]; }

function mondayOf(base: Date) {
  const d = new Date(base);
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + diff);
  return d;
}

export function BitacoraFilters({ filters, schools, canViewAllSchools, onApply }: Props) {
  const [search,     setSearch]     = useState(filters.searchTerm);
  const [collectors, setCollectors] = useState<SelectOption[]>([]);

  useEffect(() => {
    if (!canViewAllSchools) return;
    fetchBitacoraCollectors(filters.schoolId).then(setCollectors).catch(() => {});
  }, [canViewAllSchools, filters.schoolId]);

  const handleSearch = () => onApply({ searchTerm: search });

  const setWeek = (offset: number) => {
    const base = filters.dateFrom ? new Date(filters.dateFrom + 'T12:00:00') : new Date();
    const mon  = mondayOf(base);
    mon.setDate(mon.getDate() + offset * 7);
    const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
    onApply({ dateFrom: isoDate(mon), dateTo: isoDate(sun) });
  };

  const setMonth = (offset: number) => {
    const base = filters.dateFrom ? new Date(filters.dateFrom + 'T12:00:00') : new Date();
    const first = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    const last  = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    onApply({ dateFrom: isoDate(first), dateTo: isoDate(last) });
  };

  const labelWeek = () => {
    const base = filters.dateFrom ? new Date(filters.dateFrom + 'T12:00:00') : new Date();
    const mon  = mondayOf(base);
    const sun  = new Date(mon); sun.setDate(mon.getDate() + 6);
    const fmt  = (d: Date) => d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' });
    return `${fmt(mon)} – ${fmt(sun)}`;
  };

  const labelMonth = () => {
    const base = filters.dateFrom ? new Date(filters.dateFrom + 'T12:00:00') : new Date();
    return base.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
  };

  const today = isoDate(new Date());

  return (
    <div className="space-y-3 pb-4 border-b border-gray-200 mb-4">

      {/* Fila 1: Semana + Mes */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Semana</Label>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-9 w-8 shrink-0"
              onClick={() => setWeek(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <button
              onClick={() => setWeek(0)}
              className="flex-1 h-9 text-xs font-medium border border-input rounded-md px-1 text-center bg-background hover:bg-accent">
              {labelWeek()}
            </button>
            <Button variant="outline" size="icon" className="h-9 w-8 shrink-0"
              onClick={() => setWeek(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Mes</Label>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-9 w-8 shrink-0"
              onClick={() => setMonth(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <button
              onClick={() => setMonth(0)}
              className="flex-1 h-9 text-xs font-medium border border-input rounded-md px-1 text-center capitalize bg-background hover:bg-accent">
              {labelMonth()}
            </button>
            <Button variant="outline" size="icon" className="h-9 w-8 shrink-0"
              onClick={() => setMonth(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Fila 2: Desde / Hasta + atajos */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Desde</Label>
          <Input type="date" value={filters.dateFrom} className="text-sm h-9"
            onChange={(e) => onApply({ dateFrom: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-500">Hasta</Label>
          <Input type="date" value={filters.dateTo} className="text-sm h-9"
            onChange={(e) => onApply({ dateTo: e.target.value })} />
        </div>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {[
          { label: 'Hoy',    fn: () => onApply({ dateFrom: today, dateTo: today }) },
          { label: 'Ayer',   fn: () => { const y = isoDate(new Date(Date.now() - 86400000)); onApply({ dateFrom: y, dateTo: y }); } },
          { label: 'Mes anterior', fn: () => setMonth(-1) },
        ].map(({ label, fn }) => (
          <button key={label} onClick={fn}
            className="px-2.5 py-1 text-xs rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors font-medium">
            {label}
          </button>
        ))}
      </div>

      {/* Fila 3: Sede + Cobrado por (solo admin general) */}
      {canViewAllSchools && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-gray-500 flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" /> Sede
            </Label>
            <select value={filters.schoolId ?? 'all'}
              onChange={(e) => onApply({ schoolId: e.target.value === 'all' ? null : e.target.value })}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="all">Todas las sedes</option>
              {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-500 flex items-center gap-1">
              <UserCheck className="h-3.5 w-3.5" /> Cobrado por
            </Label>
            <select value={filters.collectorId ?? 'all'}
              onChange={(e) => onApply({ collectorId: e.target.value === 'all' ? null : e.target.value })}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="all">Todos</option>
              {collectors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Fila 4: Buscador */}
      <div className="space-y-1">
        <Label className="text-xs text-gray-500">Buscar</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Nombre del alumno, padre, correo o N° de operación..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-9 text-sm h-9"
            />
          </div>
          <Button onClick={handleSearch} size="sm" className="h-9 shrink-0">
            Buscar
          </Button>
        </div>
      </div>
    </div>
  );
}
