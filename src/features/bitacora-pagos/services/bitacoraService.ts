import { supabase } from '@/lib/supabase';
import type {
  BitacoraEvent,
  BitacoraFilters,
  BitacoraTicket,
  BitacoraTicketDetail,
  SelectOption,
} from '../types';

export const BITACORA_PAGE_SIZE = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Lista paginada de eventos
// ─────────────────────────────────────────────────────────────────────────────

export async function listBitacoraEvents(
  filters: BitacoraFilters,
  page: number,
): Promise<{ items: BitacoraEvent[]; total: number }> {
  const offset = (page - 1) * BITACORA_PAGE_SIZE;

  const rpcParams = {
    p_school_id:    filters.schoolId   ?? null,
    p_date_from:    filters.dateFrom   ? `${filters.dateFrom}T00:00:00+00:00` : null,
    p_date_to:      filters.dateTo     ? `${filters.dateTo}T23:59:59+00:00`   : null,
    p_search_term:  filters.searchTerm.trim() || null,
    p_collector_id: filters.collectorId ?? null,
  };

  const [listResult, countResult] = await Promise.all([
    supabase.rpc('list_debt_payment_bitacora', {
      ...rpcParams,
      p_limit:  BITACORA_PAGE_SIZE,
      p_offset: offset,
    }),
    supabase.rpc('count_debt_payment_bitacora', rpcParams),
  ]);

  if (listResult.error)  throw listResult.error;
  if (countResult.error) throw countResult.error;

  return {
    items: (listResult.data ?? []) as BitacoraEvent[],
    total: Number(countResult.data ?? 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Boletas de un evento (carga lazy al abrir acordeón)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchBitacoraTickets(
  eventId:   string,
  eventType: string,
): Promise<BitacoraTicket[]> {
  const { data, error } = await supabase.rpc('get_debt_payment_bitacora_tickets', {
    p_event_id:   eventId,
    p_event_type: eventType,
  });

  if (error) throw error;
  return (data ?? []) as BitacoraTicket[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Detalle completo de una boleta (carga lazy al tocar la boleta)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchBitacoraTicketDetail(
  transactionId: string,
): Promise<BitacoraTicketDetail | null> {
  const { data, error } = await supabase.rpc('get_debt_payment_bitacora_ticket_detail', {
    p_transaction_id: transactionId,
  });

  if (error) throw error;
  const rows = data as BitacoraTicketDetail[] | null;
  return rows?.[0] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Listado de cobradores para el dropdown de filtros (solo admin_general)
// Reutiliza el RPC existente get_billing_collectors.
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchBitacoraCollectors(
  schoolId: string | null,
): Promise<SelectOption[]> {
  const { data, error } = await supabase.rpc('get_billing_collectors', {
    p_school_id: schoolId ?? null,
  });

  if (error) return [];
  return ((data ?? []) as { id: string; full_name: string }[]).map((c) => ({
    id:   c.id,
    name: c.full_name,
  }));
}
