import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useDebounce } from '@/hooks/useDebounce';

export interface ParentChildLite {
  id: string;
  full_name: string;
  grade: string;
  section: string;
}

export interface ParentSearchItem {
  id: string;
  user_id: string;
  full_name: string;
  nickname?: string;
  dni: string;
  phone_1: string;
  phone_2?: string;
  email?: string;
  address: string;
  school_id: string;
  school_name?: string;
  children: ParentChildLite[];
  children_count: number;
  created_at: string;
}

interface SearchParentsRpcRow {
  id: string;
  user_id: string;
  full_name: string;
  nickname: string | null;
  dni: string | null;
  phone_1: string | null;
  phone_2: string | null;
  email: string | null;
  address: string | null;
  school_id: string;
  school_name: string | null;
  children: ParentChildLite[] | null;
  created_at: string;
  total_count: number;
}

interface UseParentsSearchOptions {
  searchTerm: string;
  schoolId: string | null;
  page: number;
  pageSize?: number;
}

interface UseParentsSearchResult {
  parents: ParentSearchItem[];
  loading: boolean;
  error: string | null;
  minLengthError: string | null;
  totalCount: number;
  totalPages: number;
  debouncedSearchTerm: string;
  refresh: () => Promise<void>;
}

const QUERY_TIMEOUT_MS = 5000;
const DEFAULT_PAGE_SIZE = 30;
const MIN_SEARCH_CHARS = 3;
const SEARCH_DEBOUNCE_MS = 700;

function isMeaningfulQuery(term: string): boolean {
  return term.trim().length >= MIN_SEARCH_CHARS;
}

export function useParentsSearch({
  searchTerm,
  schoolId,
  page,
  pageSize = DEFAULT_PAGE_SIZE,
}: UseParentsSearchOptions): UseParentsSearchResult {
  const [parents, setParents] = useState<ParentSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const debouncedSearchTerm = useDebounce(searchTerm, SEARCH_DEBOUNCE_MS);
  const trimmedSearch = debouncedSearchTerm.trim();
  const minLengthError = useMemo(() => {
    if (trimmedSearch.length === 0 || isMeaningfulQuery(trimmedSearch)) return null;
    return 'Escribe al menos 3 caracteres para buscar.';
  }, [trimmedSearch]);

  const fetchParents = useCallback(async () => {
    if (!supabase) {
      setError('Supabase no está configurado.');
      setParents([]);
      setTotalCount(0);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const offset = Math.max((page - 1) * pageSize, 0);
      const queryToSend = isMeaningfulQuery(trimmedSearch) ? trimmedSearch : '';

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const rpcPromise = supabase
        .rpc('search_parents_v3', {
          p_query: queryToSend,
          p_school_id: schoolId,
          p_limit: pageSize,
          p_offset: offset,
        })
        .abortSignal(controller.signal);

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('TIMEOUT_DB_QUERY')), QUERY_TIMEOUT_MS);
      });

      const response = await Promise.race([rpcPromise, timeoutPromise]) as {
        data: SearchParentsRpcRow[] | null;
        error: Error | null;
      };

      if (requestId !== requestIdRef.current) return;

      if (response.error) throw response.error;

      const rows = response.data ?? [];
      const mapped: ParentSearchItem[] = rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        full_name: row.full_name ?? '',
        nickname: row.nickname ?? undefined,
        dni: row.dni ?? '',
        phone_1: row.phone_1 ?? '',
        phone_2: row.phone_2 ?? undefined,
        email: row.email ?? undefined,
        address: row.address ?? '',
        school_id: row.school_id,
        school_name: row.school_name ?? undefined,
        children: row.children ?? [],
        children_count: row.children?.length ?? 0,
        created_at: row.created_at,
      }));

      setParents(mapped);
      setTotalCount(rows[0]?.total_count ?? 0);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (requestId !== requestIdRef.current) return;
      const message = err?.message === 'TIMEOUT_DB_QUERY'
        ? 'La búsqueda demoró más de 5 segundos. Intenta nuevamente o acota el filtro.'
        : 'No se pudo consultar la base de datos de padres.';
      setError(message);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [page, pageSize, schoolId, trimmedSearch]);

  useEffect(() => {
    if (minLengthError) {
      setLoading(false);
      setError(null);
      return;
    }

    fetchParents();
  }, [fetchParents, minLengthError]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return {
    parents,
    loading,
    error,
    minLengthError,
    totalCount,
    totalPages,
    debouncedSearchTerm,
    refresh: fetchParents,
  };
}
