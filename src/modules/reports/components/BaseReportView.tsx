import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarRange, Building2, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type {
  BaseReportViewProps,
  ISODateString,
  ReportFilters,
  ReportSchoolOption,
  SchoolId,
} from '@/modules/reports/types';

// ── Lima timezone helpers (REGLA #11.C) ───────────────────────────────────────
//
// Perú no tiene horario de verano: America/Lima = UTC-5 permanente.
//
// NO usar new Date().toISOString().split('T')[0].
// Motivo: toISOString() devuelve UTC. A las 7:00 pm en Lima (UTC-5) ya marca
// el día siguiente. Un reporte "de hoy" devolvería 0 registros.
//
// en-CA produce naturalmente YYYY-MM-DD sin necesidad de parsear.
const toLimaDateString = (date: Date): ISODateString =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date) as ISODateString;

const defaultDateFrom = (): ISODateString => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return toLimaDateString(d);
};

const defaultDateTo = (): ISODateString => toLimaDateString(new Date());

// ── Component ─────────────────────────────────────────────────────────────────

export function BaseReportView({
  title,
  description = 'Selecciona filtros globales y luego renderiza tu reporte.',
  className,
  children,
  renderContent,
  onFiltersChange,
}: BaseReportViewProps) {
  const { user } = useAuth();
  const { role, canViewAllSchools, loading: roleLoading } = useRole();
  const hasReportsAccess = role === 'admin_general';

  // ── Date state ──────────────────────────────────────────────────────────────
  const [dateFrom, setDateFrom] = useState<ISODateString>(defaultDateFrom);
  const [dateTo, setDateTo] = useState<ISODateString>(defaultDateTo);

  // ── School state ────────────────────────────────────────────────────────────
  const [schools, setSchools] = useState<ReportSchoolOption[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<SchoolId | 'all'>('all');
  const [loadingScope, setLoadingScope] = useState(true);

  // Write-once ref: se escribe UNA sola vez desde la BD y nunca más.
  //
  // Problema que resuelve: el estado de React es mutable desde DevTools del
  // navegador. Un usuario técnico podría ejecutar setState() en la consola y
  // cambiar userSchoolId a la UUID de otra sede. Ese cambio de estado
  // desencadenaría el useMemo y produciría filtros con esa otra sede.
  //
  // La solución: una vez que el servidor responde, escribimos el school_id en
  // este ref (imperativo, fuera del ciclo de estado) y derivamos
  // effectiveSchoolId desde el ref, no desde el estado mutable.
  // Los DevTools de React no pueden mutar refs directamente.
  const serverSchoolIdRef = useRef<SchoolId | null>(null);
  const serverSchoolIdLoaded = useRef(false);

  // Ref estable para onFiltersChange.
  //
  // Si el padre pasa una función inline (sin useCallback), añadirla como
  // dependencia del efecto que llama onFiltersChange crea un loop:
  //   filters cambia → efecto corre → padre re-renderiza → función nueva
  //   → efecto se re-suscribe → loop.
  //
  // La solución es guardar la función en un ref y excluirla de las deps.
  const onFiltersChangeRef = useRef(onFiltersChange);
  useEffect(() => {
    onFiltersChangeRef.current = onFiltersChange;
  });

  // ── Load school scope from DB ────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const loadSchoolScope = async () => {
      if (!hasReportsAccess) {
        if (mounted) {
          setSchools([]);
          setLoadingScope(false);
        }
        return;
      }

      if (!user?.id) {
        if (mounted) {
          setSchools([]);
          setLoadingScope(false);
        }
        return;
      }

      setLoadingScope(true);
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('school_id')
          .eq('id', user.id)
          .single();

        const profileSchoolId = (profile?.school_id ?? null) as SchoolId | null;

        // Write-once guard: solo asignamos la primera vez que el servidor responde.
        // Reinicios de sesión (token refresh) pueden re-disparar este efecto pero
        // NO deben sobreescribir el valor ya confirmado.
        if (!serverSchoolIdLoaded.current) {
          serverSchoolIdRef.current = profileSchoolId;
          serverSchoolIdLoaded.current = true;
        }

        // Para no-admins, la query de escuelas filtra por su propia sede.
        // Aunque la respuesta de red llegara manipulada, el selector quedará
        // deshabilitado y effectiveSchoolId no depende de él.
        let schoolsQuery = supabase
          .from('schools')
          .select('id, name')
          .eq('is_active', true)
          .order('name', { ascending: true });

        if (!canViewAllSchools && profileSchoolId) {
          schoolsQuery = schoolsQuery.eq('id', profileSchoolId);
        }

        const { data: schoolsData } = await schoolsQuery;
        if (mounted) {
          setSchools((schoolsData ?? []) as unknown as ReportSchoolOption[]);
        }
      } finally {
        if (mounted) setLoadingScope(false);
      }
    };

    loadSchoolScope();

    return () => {
      mounted = false;
    };
  }, [user?.id, canViewAllSchools, hasReportsAccess]);

  // Sincronizar el selector visual con el scope del usuario una vez cargado.
  useEffect(() => {
    if (loadingScope) return;
    if (canViewAllSchools) {
      setSelectedSchoolId('all');
    } else if (serverSchoolIdRef.current) {
      setSelectedSchoolId(serverSchoolIdRef.current);
    }
  }, [canViewAllSchools, loadingScope]);

  // ── Handlers (referencias estables) ─────────────────────────────────────────
  const handleDateFromChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setDateFrom(event.target.value as ISODateString),
    [],
  );

  const handleDateToChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setDateTo(event.target.value as ISODateString),
    [],
  );

  // Guarda defensiva: aunque el Select quedara habilitado por error en el JSX,
  // este handler bloquea cualquier cambio de sede para no-admins.
  const handleSchoolChange = useCallback(
    (value: string) => {
      if (!canViewAllSchools) return;
      setSelectedSchoolId(value as SchoolId | 'all');
    },
    [canViewAllSchools],
  );

  // ── Filters (memoized) ───────────────────────────────────────────────────────
  //
  // Para no-admins: effectiveSchoolId siempre usa el ref inmutable del servidor.
  // El valor de selectedSchoolId (mutable) se ignora completamente.
  // Incluso si alguien alterara el estado de React en DevTools, el ref no cambia.
  const filters = useMemo<ReportFilters>(() => {
    const effectiveSchoolId: SchoolId | null = canViewAllSchools
      ? selectedSchoolId === 'all'
        ? null
        : (selectedSchoolId as SchoolId)
      : serverSchoolIdRef.current;

    return {
      dateRange: { from: dateFrom, to: dateTo },
      selectedSchoolId,
      effectiveSchoolId,
      canViewAllSchools,
    };
  }, [canViewAllSchools, dateFrom, dateTo, selectedSchoolId]);

  // Notificar al padre cuando cambian los filtros, sin depender de la referencia
  // del callback para no crear loops.
  useEffect(() => {
    onFiltersChangeRef.current?.(filters);
  }, [filters]);

  // ── Content projection ───────────────────────────────────────────────────────
  const content = useMemo(() => {
    if (renderContent) return renderContent(filters);
    if (typeof children === 'function') return children(filters);
    return children;
  }, [children, filters, renderContent]);

  // ── Render ───────────────────────────────────────────────────────────────────
  if (roleLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-8 text-center text-sm text-slate-500">
          Validando permisos de acceso...
        </CardContent>
      </Card>
    );
  }

  if (!hasReportsAccess) {
    return (
      <Card className={className}>
        <CardContent className="p-8">
          <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 p-6 text-center">
            <AlertCircle className="mx-auto mb-3 h-10 w-10 text-red-600" />
            <h3 className="text-lg font-semibold text-red-800">Acceso Denegado (403)</h3>
            <p className="mt-2 text-sm text-red-700">
              El Centro de Reportes está habilitado solo para el rol <strong>admin_general</strong>.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="space-y-2">
        <CardTitle className="text-xl font-semibold text-slate-900">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Filtros globales */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
            <CalendarRange className="h-4 w-4" />
            Filtros globales
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="reports-date-from">Desde</Label>
              <Input
                id="reports-date-from"
                type="date"
                value={dateFrom}
                onChange={handleDateFromChange}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reports-date-to">Hasta</Label>
              <Input
                id="reports-date-to"
                type="date"
                value={dateTo}
                onChange={handleDateToChange}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reports-school-select" className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                Sede
              </Label>
              {/* Deshabilitado para no-admins: su sede ya está fija desde la BD */}
              <Select
                value={selectedSchoolId}
                onValueChange={handleSchoolChange}
                disabled={loadingScope || !canViewAllSchools}
              >
                <SelectTrigger id="reports-school-select">
                  <SelectValue placeholder="Selecciona sede" />
                </SelectTrigger>
                <SelectContent>
                  {canViewAllSchools && (
                    <SelectItem value="all">Todas las sedes</SelectItem>
                  )}
                  {schools.map((school) => (
                    <SelectItem key={school.id} value={school.id}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Zona de contenido inyectado por cada reporte */}
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          {content}
        </section>
      </CardContent>
    </Card>
  );
}
