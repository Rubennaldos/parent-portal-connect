/**
 * usePersonSearch — hook para búsqueda inteligente de personas.
 *
 * Usa la RPC search_persons_v2 que corre pg_trgm con índices GIN:
 *  - Tolerante a typos ("Chavez" → "Chávez")
 *  - Insensible a tildes
 *  - Búsqueda por nombre parcial (primera, segunda palabra)
 *  - Resultados ordenados por relevancia
 *  - Debounce configurable (default 300ms)
 *  - Caché en memoria para evitar requests repetidos
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface PersonResult {
  id:          string;
  full_name:   string;
  entity_type: 'student' | 'teacher' | 'admin';
  subtitle:    string;   // salón, área, rol
  school_name: string | null;
  photo_url:   string | null;
  score:       number;   // 0..1, mayor = mejor match
}

export interface UsePersonSearchOptions {
  /** Filtrar por sede (null = todas) */
  schoolId?:   string | null;
  /** Tipos a incluir */
  types?:      Array<'student' | 'teacher' | 'admin'>;
  /** Resultados máximos por tipo */
  limit?:      number;
  /** Debounce en ms (default 300) */
  debounce?:   number;
  /** Mínimo de caracteres para buscar (default 2) */
  minChars?:   number;
}

interface CacheEntry {
  results:  PersonResult[];
  timestamp: number;
}

// Caché LRU simple — 60 segundos TTL, 50 entradas máx
const CACHE_TTL = 60_000;
const CACHE_MAX = 50;
const cache = new Map<string, CacheEntry>();

function getCacheKey(query: string, opts: UsePersonSearchOptions) {
  return JSON.stringify({ query, ...opts });
}

function getFromCache(key: string): PersonResult[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) { cache.delete(key); return null; }
  return entry.results;
}

function setCache(key: string, results: PersonResult[]) {
  if (cache.size >= CACHE_MAX) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { results, timestamp: Date.now() });
}

export function usePersonSearch(options: UsePersonSearchOptions = {}) {
  const {
    schoolId  = null,
    types     = ['student', 'teacher'],
    limit     = 10,
    debounce  = 300,
    minChars  = 2,
  } = options;

  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<PersonResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef    = useRef<AbortController | null>(null);
  const latestQuery = useRef('');

  const search = useCallback(async (rawQuery: string) => {
    const q = rawQuery.trim();
    latestQuery.current = q;

    if (q.length < minChars) {
      setResults([]);
      setLoading(false);
      return;
    }

    const cacheKey = getCacheKey(q, { schoolId, types, limit });
    const cached = getFromCache(cacheKey);
    if (cached) {
      if (latestQuery.current === q) setResults(cached);
      setLoading(false);
      return;
    }

    // Cancelar request anterior si sigue en vuelo
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcErr } = await supabase.rpc('search_persons_v2', {
        p_query:     q,
        p_school_id: schoolId ?? null,
        p_types:     types,
        p_limit:     limit,
      });

      if (latestQuery.current !== q) return; // llegó una query más nueva, ignorar

      if (rpcErr) throw rpcErr;

      const sorted = (data as PersonResult[] ?? [])
        .sort((a, b) => b.score - a.score);

      setCache(cacheKey, sorted);
      setResults(sorted);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('[usePersonSearch] Error:', err);
      setError('Error al buscar. Intenta de nuevo.');
      setResults([]);
    } finally {
      if (latestQuery.current === q) setLoading(false);
    }
  }, [schoolId, types, limit, minChars]);

  // Disparar búsqueda con debounce
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!query.trim()) { setResults([]); setLoading(false); return; }

    setLoading(query.trim().length >= minChars);
    timerRef.current = setTimeout(() => search(query), debounce);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, search, debounce, minChars]);

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    setLoading(false);
    setError(null);
  }, []);

  return { query, setQuery, results, loading, error, clear };
}
