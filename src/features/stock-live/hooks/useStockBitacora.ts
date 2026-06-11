import { useCallback, useState } from 'react';
import { fetchProductStockBitacora, STOCK_BITACORA_PAGE_SIZE } from '../services/stockBitacoraService';
import type { StockBitacoraItem, StockBitacoraTarget } from '../types';

export function useStockBitacora() {
  const [target, setTarget] = useState<StockBitacoraTarget | null>(null);
  const [items, setItems] = useState<StockBitacoraItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setTarget(null);
    setItems([]);
    setHasMore(false);
    setOffset(0);
    setError(null);
    setLoading(false);
    setLoadingMore(false);
  }, []);

  const loadPage = useCallback(
    async (t: StockBitacoraTarget, nextOffset: number, append: boolean) => {
      const res = await fetchProductStockBitacora(t.productId, t.schoolId, nextOffset);

      if (res.product_id !== t.productId || res.school_id !== t.schoolId) {
        throw new Error('BITACORA_MISMATCH: la respuesta no coincide con producto/sede solicitados.');
      }

      setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      setHasMore(res.has_more);
      setOffset(nextOffset + res.items.length);
    },
    [],
  );

  const open = useCallback(
    async (t: StockBitacoraTarget) => {
      setTarget(t);
      setItems([]);
      setHasMore(false);
      setOffset(0);
      setError(null);
      setLoading(true);
      try {
        await loadPage(t, 0, false);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setItems([]);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [loadPage],
  );

  const loadMore = useCallback(async () => {
    if (!target || !hasMore || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      await loadPage(target, offset, true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoadingMore(false);
    }
  }, [target, hasMore, loadingMore, offset, loadPage]);

  const refresh = useCallback(async () => {
    if (!target) return;
    setLoading(true);
    setError(null);
    try {
      await loadPage(target, 0, false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [target, loadPage]);

  return {
    target,
    items,
    hasMore,
    loading,
    loadingMore,
    error,
    pageSize: STOCK_BITACORA_PAGE_SIZE,
    open,
    loadMore,
    refresh,
    reset,
  };
}
