/**
 * Carga de detalle de comprobante para modal de sede (solo lectura).
 * SSOT: get_branch_supply_receipt_detail + URL firmada de evidencia en servicio.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  getReceiptDetail,
  extractRpcErrorMessage,
} from '../services/branchSupplyService';
import { getEvidenceSignedUrl } from '../services/branchSupplyEvidenceService';
import type { ReceiptDetail } from '../types';

export interface UseBranchSupplyReceiptDetailReturn {
  detail:           ReceiptDetail | null;
  signedUrl:        string | null;
  loading:          boolean;
  loadingSignedUrl: boolean;
  error:            string | null;
  load:             (receiptId: string) => Promise<void>;
  reset:            () => void;
}

export function useBranchSupplyReceiptDetail(): UseBranchSupplyReceiptDetailReturn {
  const { toast } = useToast();
  const mountedRef = useRef(true);

  const [detail,           setDetail]           = useState<ReceiptDetail | null>(null);
  const [signedUrl,        setSignedUrl]        = useState<string | null>(null);
  const [loading,          setLoading]          = useState(false);
  const [loadingSignedUrl, setLoadingSignedUrl] = useState(false);
  const [error,            setError]            = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const reset = useCallback(() => {
    setDetail(null);
    setSignedUrl(null);
    setError(null);
    setLoading(false);
    setLoadingSignedUrl(false);
  }, []);

  const load = useCallback(async (receiptId: string) => {
    setLoading(true);
    setError(null);
    setDetail(null);
    setSignedUrl(null);

    try {
      const d = await getReceiptDetail(receiptId);
      if (!mountedRef.current) return;

      const normalized: ReceiptDetail = {
        ...d,
        receipt: {
          ...d.receipt,
          is_quick: d.receipt.is_quick ?? false,
          supplier_id: d.receipt.supplier_id ?? null,
          match_score: d.receipt.match_score ?? null,
        },
        items: d.items ?? [],
        supplier: d.supplier ?? null,
        school: d.school ?? null,
      };

      setDetail(normalized);

      if (normalized.receipt.evidence_path) {
        setLoadingSignedUrl(true);
        try {
          const url = await getEvidenceSignedUrl(normalized.receipt.evidence_path);
          if (mountedRef.current) setSignedUrl(url);
        } catch {
          if (mountedRef.current) setSignedUrl(null);
        } finally {
          if (mountedRef.current) setLoadingSignedUrl(false);
        }
      }
    } catch (err: unknown) {
      const msg = extractRpcErrorMessage(err);
      if (mountedRef.current) {
        setError(msg);
        toast({
          title:       'No se pudo cargar el detalle',
          description: msg,
          variant:     'destructive',
        });
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [toast]);

  return {
    detail,
    signedUrl,
    loading,
    loadingSignedUrl,
    error,
    load,
    reset,
  };
}
