import { useCallback, useRef, useState } from 'react';
import { listBitacoraEvents, BITACORA_PAGE_SIZE } from '../services/bitacoraService';
import type { BitacoraEvent, BitacoraFilters } from '../types';

const today = () => new Date().toISOString().split('T')[0];
const mondayOfWeek = () => {
  const d = new Date();
  const day = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + day);
  return d.toISOString().split('T')[0];
};

export const INITIAL_FILTERS: BitacoraFilters = {
  schoolId:    null,
  dateFrom:    mondayOfWeek(),
  dateTo:      today(),
  searchTerm:  '',
  collectorId: null,
};

export function useBitacoraList() {
  const [filters, setFilters] = useState<BitacoraFilters>(INITIAL_FILTERS);
  const [events,  setEvents]  = useState<BitacoraEvent[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Anti-race: solo procesar la respuesta del request más reciente
  const requestSeq = useRef(0);

  const totalPages = Math.ceil(total / BITACORA_PAGE_SIZE);

  const load = useCallback(async (f: BitacoraFilters, p: number) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listBitacoraEvents(f, p);
      if (seq !== requestSeq.current) return;
      setEvents(result.items);
      setTotal(result.total);
    } catch (e: unknown) {
      if (seq !== requestSeq.current) return;
      setError(e instanceof Error ? e.message : 'Error cargando la bitácora');
      setEvents([]);
      setTotal(0);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  const applyFilters = useCallback(
    (next: Partial<BitacoraFilters>) => {
      const merged = { ...filters, ...next };
      setFilters(merged);
      setPage(1);
      load(merged, 1);
    },
    [filters, load],
  );

  const goToPage = useCallback(
    (p: number) => {
      setPage(p);
      load(filters, p);
    },
    [filters, load],
  );

  const refresh = useCallback(() => load(filters, page), [filters, page, load]);

  // Carga inicial con los filtros por defecto (esta semana)
  const initialLoad = useCallback(() => load(INITIAL_FILTERS, 1), [load]);

  return {
    filters,
    events,
    total,
    page,
    totalPages,
    loading,
    error,
    applyFilters,
    goToPage,
    refresh,
    initialLoad,
  };
}
