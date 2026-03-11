import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  Search, Users, SlidersHorizontal, GraduationCap,
  CreditCard, Wallet, ShieldOff, ShieldCheck,
  TrendingDown, Banknote, RefreshCw, AlertCircle,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Student {
  id: string;
  full_name: string;
  grade: string | null;
  section: string | null;
  photo_url: string | null;
  balance: number;
  free_account: boolean | null;
  kiosk_disabled: boolean | null;
  limit_type: 'none' | 'daily' | 'weekly' | 'monthly' | null;
  daily_limit: number | null;
  weekly_limit: number | null;
  monthly_limit: number | null;
  school_id: string;
  parent: { full_name: string | null; email: string | null } | null;
}

interface Props {
  schoolId: string | null; // null = admin general (ver todos)
  canViewAllSchools: boolean;
}

const LIMIT_LABELS: Record<string, string> = {
  daily: 'Tope diario',
  weekly: 'Tope semanal',
  monthly: 'Tope mensual',
  none: 'Sin tope',
};

export default function StudentsDirectory({ schoolId, canViewAllSchools }: Props) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterGrade, setFilterGrade] = useState<string>('all');
  const [filterSection, setFilterSection] = useState<string>('all');
  const [filterAccount, setFilterAccount] = useState<'all' | 'free' | 'prepaid'>('all');
  const [filterKiosk, setFilterKiosk] = useState<'all' | 'active' | 'disabled'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'grade' | 'balance'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [showFilters, setShowFilters] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('students')
        .select(`
          id, full_name, grade, section, photo_url,
          balance, free_account, kiosk_disabled,
          limit_type, daily_limit, weekly_limit, monthly_limit,
          school_id,
          parent:profiles!students_parent_id_fkey(full_name, email)
        `)
        .order('full_name', { ascending: true });

      if (!canViewAllSchools && schoolId) {
        q = q.eq('school_id', schoolId);
      }

      const { data, error } = await q;
      if (error) throw error;
      setStudents((data || []) as Student[]);
    } catch (err) {
      console.error('Error cargando alumnos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [schoolId]);

  // ── Opciones únicas de grado y sección ──
  const grades   = useMemo(() => ['all', ...Array.from(new Set(students.map(s => s.grade).filter(Boolean))).sort()], [students]);
  const sections = useMemo(() => ['all', ...Array.from(new Set(students.map(s => s.section).filter(Boolean))).sort()], [students]);

  // ── Filtrado + ordenamiento ──
  const filtered = useMemo(() => {
    let list = [...students];

    if (search.trim()) {
      const t = search.toLowerCase();
      list = list.filter(s =>
        s.full_name.toLowerCase().includes(t) ||
        (s.grade || '').toLowerCase().includes(t) ||
        (s.section || '').toLowerCase().includes(t) ||
        (s.parent?.full_name || '').toLowerCase().includes(t) ||
        (s.parent?.email || '').toLowerCase().includes(t)
      );
    }
    if (filterGrade !== 'all')   list = list.filter(s => s.grade === filterGrade);
    if (filterSection !== 'all') list = list.filter(s => s.section === filterSection);
    if (filterAccount === 'free')    list = list.filter(s => s.free_account !== false);
    if (filterAccount === 'prepaid') list = list.filter(s => s.free_account === false);
    if (filterKiosk === 'active')   list = list.filter(s => !s.kiosk_disabled);
    if (filterKiosk === 'disabled') list = list.filter(s => !!s.kiosk_disabled);

    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name')    cmp = a.full_name.localeCompare(b.full_name);
      if (sortBy === 'grade')   cmp = ((a.grade || '') + (a.section || '')).localeCompare((b.grade || '') + (b.section || ''));
      if (sortBy === 'balance') cmp = (a.balance || 0) - (b.balance || 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [students, search, filterGrade, filterSection, filterAccount, filterKiosk, sortBy, sortDir]);

  // ── Agrupar por grado+sección ──
  const grouped = useMemo(() => {
    const map = new Map<string, Student[]>();
    filtered.forEach(s => {
      const key = s.grade && s.section ? `${s.grade} - ${s.section}` : s.grade || 'Sin grado';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const hasDebt = (s: Student) => (s.balance || 0) < 0;

  const activeLimit = (s: Student): { label: string; amount: number } | null => {
    if (!s.limit_type || s.limit_type === 'none') return null;
    const map: Record<string, number | null> = {
      daily: s.daily_limit,
      weekly: s.weekly_limit,
      monthly: s.monthly_limit,
    };
    const amount = map[s.limit_type];
    if (!amount) return null;
    return { label: LIMIT_LABELS[s.limit_type], amount };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-emerald-600" />
        <span className="text-gray-500 text-sm">Cargando alumnos...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Encabezado + stats ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-600" />
            Directorio de Alumnos
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {filtered.length} de {students.length} alumnos · {grouped.length} salones
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} className="h-8 gap-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Actualizar
          </Button>
          <Button
            variant={showFilters ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(v => !v)}
            className="h-8 gap-1.5 text-xs"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filtros
          </Button>
        </div>
      </div>

      {/* ── Barra de búsqueda siempre visible ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Buscar por nombre, grado, sección o padre..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-10 bg-white border-gray-200"
        />
      </div>

      {/* ── Panel de filtros expandible ── */}
      {showFilters && (
        <Card className="bg-gray-50 border-gray-200">
          <CardContent className="pt-4 pb-3 px-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Grado */}
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase mb-1 block">Grado</label>
                <select
                  value={filterGrade}
                  onChange={e => setFilterGrade(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                >
                  {grades.map(g => (
                    <option key={g} value={g}>{g === 'all' ? 'Todos' : g}</option>
                  ))}
                </select>
              </div>
              {/* Sección */}
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase mb-1 block">Sección</label>
                <select
                  value={filterSection}
                  onChange={e => setFilterSection(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                >
                  {sections.map(s => (
                    <option key={s} value={s}>{s === 'all' ? 'Todas' : s}</option>
                  ))}
                </select>
              </div>
              {/* Tipo cuenta */}
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase mb-1 block">Tipo cuenta</label>
                <select
                  value={filterAccount}
                  onChange={e => setFilterAccount(e.target.value as any)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                >
                  <option value="all">Todos</option>
                  <option value="free">Cuenta Libre</option>
                  <option value="prepaid">Con Recargas</option>
                </select>
              </div>
              {/* Kiosco */}
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase mb-1 block">Kiosco</label>
                <select
                  value={filterKiosk}
                  onChange={e => setFilterKiosk(e.target.value as any)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                >
                  <option value="all">Todos</option>
                  <option value="active">Activo</option>
                  <option value="disabled">Desactivado</option>
                </select>
              </div>
            </div>
            {/* Ordenamiento */}
            <div className="flex gap-2 mt-3 flex-wrap">
              <span className="text-[11px] font-semibold text-gray-500 uppercase self-center">Ordenar:</span>
              {(['name', 'grade', 'balance'] as const).map(col => (
                <button
                  key={col}
                  onClick={() => toggleSort(col)}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all',
                    sortBy === col
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-300'
                  )}
                >
                  {col === 'name' && 'Nombre'}
                  {col === 'grade' && 'Grado'}
                  {col === 'balance' && 'Saldo'}
                  {sortBy === col && (sortDir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                </button>
              ))}
              {/* Limpiar filtros */}
              {(filterGrade !== 'all' || filterSection !== 'all' || filterAccount !== 'all' || filterKiosk !== 'all' || search) && (
                <button
                  onClick={() => { setSearch(''); setFilterGrade('all'); setFilterSection('all'); setFilterAccount('all'); setFilterKiosk('all'); }}
                  className="ml-auto text-xs text-red-500 hover:text-red-700 font-semibold"
                >
                  Limpiar filtros ✕
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Stats rápidas ── */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Total', val: students.length, color: 'bg-gray-100 text-gray-700' },
          { label: 'Con Recargas', val: students.filter(s => s.free_account === false).length, color: 'bg-blue-100 text-blue-700' },
          { label: 'Con Deuda', val: students.filter(s => hasDebt(s)).length, color: 'bg-red-100 text-red-700' },
          { label: 'Kiosco OFF', val: students.filter(s => s.kiosk_disabled).length, color: 'bg-amber-100 text-amber-700' },
        ].map(({ label, val, color }) => (
          <div key={label} className={cn('rounded-xl px-3 py-2 text-center', color)}>
            <p className="text-lg font-black">{val}</p>
            <p className="text-[10px] font-semibold">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Grupos por salón ── */}
      {grouped.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="font-semibold">No se encontraron alumnos</p>
          <p className="text-xs mt-1">Intenta con otros filtros</p>
        </div>
      ) : (
        grouped.map(([groupLabel, groupStudents]) => (
          <div key={groupLabel} className="space-y-2">
            {/* Header del salón */}
            <div className="flex items-center gap-2 sticky top-14 z-10 bg-white/95 backdrop-blur-sm py-1.5 -mx-1 px-1">
              <div className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1 rounded-full">
                <GraduationCap className="h-3.5 w-3.5" />
                <span className="text-xs font-bold">{groupLabel}</span>
              </div>
              <span className="text-xs text-gray-400">{groupStudents.length} alumnos</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* Tarjetas de alumnos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {groupStudents.map(student => {
                const lim = activeLimit(student);
                const debt = hasDebt(student);
                const isPrepaid = student.free_account === false;
                const isDisabled = !!student.kiosk_disabled;

                return (
                  <Card
                    key={student.id}
                    className={cn(
                      'border transition-all hover:shadow-md',
                      debt ? 'border-red-200 bg-red-50/30' :
                      isDisabled ? 'border-amber-200 bg-amber-50/20' :
                      'border-gray-200 bg-white'
                    )}
                  >
                    <CardContent className="p-3 space-y-3">
                      {/* ── Fila 1: Foto + nombre + badges ── */}
                      <div className="flex items-start gap-3">
                        <Avatar className="h-11 w-11 shrink-0 ring-2 ring-offset-1 ring-gray-200">
                          <AvatarImage src={student.photo_url || undefined} />
                          <AvatarFallback className="bg-gradient-to-br from-emerald-400 to-teal-500 text-white text-sm font-bold">
                            {student.full_name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-gray-900 truncate">{student.full_name}</p>
                          <p className="text-[11px] text-gray-500">
                            {student.grade}{student.section ? ` — ${student.section}` : ''}
                          </p>
                          {student.parent?.full_name && (
                            <p className="text-[10px] text-gray-400 truncate mt-0.5">
                              👨‍👩‍👧 {student.parent.full_name}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* ── Fila 2: Indicadores visuales ── */}
                      <div className="grid grid-cols-2 gap-2">
                        {/* Saldo / Deuda */}
                        <div className={cn(
                          'rounded-lg px-2.5 py-2 flex items-center justify-between',
                          debt ? 'bg-red-100' : isPrepaid ? 'bg-blue-50' : 'bg-gray-100'
                        )}>
                          <div>
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                              {debt ? 'Deuda' : isPrepaid ? 'Saldo' : 'Estado'}
                            </p>
                            <p className={cn(
                              'text-base font-black',
                              debt ? 'text-red-600' : isPrepaid ? 'text-blue-700' : 'text-green-600'
                            )}>
                              {debt
                                ? `S/ ${Math.abs(student.balance).toFixed(2)}`
                                : isPrepaid
                                  ? `S/ ${(student.balance || 0).toFixed(2)}`
                                  : 'Al día'}
                            </p>
                          </div>
                          {debt
                            ? <TrendingDown className="h-4 w-4 text-red-400" />
                            : isPrepaid
                              ? <Banknote className="h-4 w-4 text-blue-400" />
                              : <Wallet className="h-4 w-4 text-gray-400" />
                          }
                        </div>

                        {/* Tipo de cuenta */}
                        <div className={cn(
                          'rounded-lg px-2.5 py-2 flex items-center justify-between',
                          isPrepaid ? 'bg-blue-50' : 'bg-emerald-50'
                        )}>
                          <div>
                            <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">Cuenta</p>
                            <p className={cn('text-xs font-bold mt-0.5', isPrepaid ? 'text-blue-700' : 'text-emerald-700')}>
                              {isPrepaid ? 'Con Recargas' : 'Cuenta Libre'}
                            </p>
                          </div>
                          {isPrepaid
                            ? <CreditCard className="h-4 w-4 text-blue-400" />
                            : <Wallet className="h-4 w-4 text-emerald-400" />
                          }
                        </div>
                      </div>

                      {/* ── Fila 3: Badges de configuración ── */}
                      <div className="flex flex-wrap gap-1.5">
                        {/* Tope */}
                        {lim ? (
                          <div className="flex items-center gap-1 bg-purple-50 border border-purple-200 rounded-lg px-2 py-1">
                            <span className="text-[10px] font-semibold text-purple-700">{lim.label}:</span>
                            <span className="text-[10px] font-black text-purple-900">S/ {lim.amount.toFixed(0)}</span>
                            {/* Barra de consumo si es prepaid */}
                            {isPrepaid && lim.amount > 0 && (
                              <div className="w-12 h-1.5 bg-purple-200 rounded-full overflow-hidden ml-1">
                                <div
                                  className="h-full bg-purple-500 rounded-full"
                                  style={{ width: `${Math.min(100, ((student.balance || 0) / lim.amount) * 100)}%` }}
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-500 text-[10px] font-semibold border-0">Sin tope</Badge>
                        )}

                        {/* Kiosco desactivado */}
                        {isDisabled && (
                          <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                            <ShieldOff className="h-3 w-3 text-amber-600" />
                            <span className="text-[10px] font-semibold text-amber-700">Kiosco OFF</span>
                          </div>
                        )}
                        {!isDisabled && (
                          <div className="flex items-center gap-1 bg-green-50 border border-green-200 rounded-lg px-2 py-1">
                            <ShieldCheck className="h-3 w-3 text-green-600" />
                            <span className="text-[10px] font-semibold text-green-700">Kiosco ON</span>
                          </div>
                        )}
                      </div>

                      {/* ── Fila 4: Cuánto le queda para el tope (solo si tiene tope + prepaid) ── */}
                      {lim && isPrepaid && !debt && (
                        <div className="bg-purple-50 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
                          <span className="text-[10px] text-purple-600">
                            Puede gastar aún:
                          </span>
                          <span className="text-xs font-black text-purple-800">
                            S/ {Math.max(0, (student.balance || 0)).toFixed(2)}
                            <span className="text-[9px] font-normal text-purple-500 ml-1">
                              de S/ {lim.amount.toFixed(0)}
                            </span>
                          </span>
                        </div>
                      )}

                      {/* Alerta deuda */}
                      {debt && (
                        <div className="bg-red-100 rounded-lg px-2.5 py-1.5 flex items-center gap-2">
                          <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                          <span className="text-[10px] text-red-700 font-semibold">
                            Debe S/ {Math.abs(student.balance).toFixed(2)} al kiosco
                          </span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
