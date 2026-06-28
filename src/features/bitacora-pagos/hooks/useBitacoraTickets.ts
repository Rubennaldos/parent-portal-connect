import { useCallback, useState } from 'react';
import { fetchBitacoraTickets } from '../services/bitacoraService';
import type { BitacoraTicket } from '../types';

/** Maneja la carga lazy de boletas para UN evento del acordeón. */
export function useBitacoraTickets() {
  const [tickets,  setTickets]  = useState<BitacoraTicket[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const load = useCallback(async (eventId: string, eventType: string) => {
    if (loadedId === eventId) return; // ya cargado, no volver a pedir
    setLoading(true);
    setError(null);
    try {
      const result = await fetchBitacoraTickets(eventId, eventType);
      setTickets(result);
      setLoadedId(eventId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando boletas');
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [loadedId]);

  const reset = useCallback(() => {
    setTickets([]);
    setLoading(false);
    setError(null);
    setLoadedId(null);
  }, []);

  return { tickets, loading, error, load, reset };
}
