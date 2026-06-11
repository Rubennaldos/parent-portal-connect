/**
 * Modal de detalle de comprobante para historial de sede (solo lectura).
 */

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useBranchSupplyReceiptDetail } from '../hooks/useBranchSupplyReceiptDetail';
import { BranchSupplyReceiptDetailBody } from './BranchSupplyReceiptDetailBody';

interface BranchSupplyReceiptDetailModalProps {
  receiptId: string | null;
  open:      boolean;
  onOpenChange: (open: boolean) => void;
}

export function BranchSupplyReceiptDetailModal({
  receiptId,
  open,
  onOpenChange,
}: BranchSupplyReceiptDetailModalProps) {
  const {
    detail,
    signedUrl,
    loading,
    loadingSignedUrl,
    error,
    load,
    reset,
  } = useBranchSupplyReceiptDetail();

  useEffect(() => {
    if (open && receiptId) {
      load(receiptId);
    }
    if (!open) {
      reset();
    }
  }, [open, receiptId, load, reset]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle className="text-base">Detalle del ingreso</DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 pb-6">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Cargando detalle...</span>
            </div>
          ) : error ? (
            <p className="text-sm text-red-600 py-8 text-center">{error}</p>
          ) : detail ? (
            <BranchSupplyReceiptDetailBody
              detail={detail}
              signedUrl={signedUrl}
              loadingSignedUrl={loadingSignedUrl}
            />
          ) : null}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
