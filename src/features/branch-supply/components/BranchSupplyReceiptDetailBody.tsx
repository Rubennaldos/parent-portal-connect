/**
 * Cuerpo de solo lectura del detalle de un comprobante / ingreso rápido (sede).
 * Sin costos ni cálculos: muestra datos persistidos del RPC.
 */

import { AlertTriangle, Zap } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { BranchSupplyEvidenceViewer } from './BranchSupplyEvidenceViewer';
import {
  receiptDocTypeLabel,
  receiptUsesAuditorCostOnly,
  type ReceiptDetail,
  type ReceiptStatus,
} from '../types';

const STATUS_LABELS: Record<ReceiptStatus, string> = {
  pending:   'Pendiente',
  approved:  'Aprobado',
  rejected:  'Rechazado',
  cancelled: 'Cancelado',
};

function currency(n: number) {
  return `S/ ${n.toFixed(2)}`;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-PE', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'America/Lima',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function uomLabel(item: {
  uom_name: string | null;
  conversion_factor: number | null;
}): string {
  if (!item.uom_name) return 'Unidad base';
  if (item.conversion_factor && item.conversion_factor !== 1) {
    return `${item.uom_name} (×${item.conversion_factor})`;
  }
  return item.uom_name;
}

interface BranchSupplyReceiptDetailBodyProps {
  detail:           ReceiptDetail;
  signedUrl:        string | null;
  loadingSignedUrl: boolean;
}

export function BranchSupplyReceiptDetailBody({
  detail,
  signedUrl,
  loadingSignedUrl,
}: BranchSupplyReceiptDetailBodyProps) {
  const { receipt, items, supplier, school } = detail;
  const itemRows = items ?? [];

  return (
    <div className="space-y-4">
      {receipt.status === 'rejected' && receipt.rejection_reason && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Motivo de rechazo</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">
            {receipt.rejection_reason}
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold text-gray-900">{receipt.receipt_number}</span>
        {receipt.is_quick && (
          <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-800">
            <Zap className="h-3 w-3" />
            Ingreso rápido
          </Badge>
        )}
        <Badge variant="secondary" className="text-xs">
          {STATUS_LABELS[receipt.status] ?? receipt.status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {school?.name && (
          <div>
            <span className="text-gray-500">Sede: </span>
            <span className="font-medium text-gray-900">{school.name}</span>
          </div>
        )}
        <div>
          <span className="text-gray-500">Enviado: </span>
          <span className="font-medium text-gray-900">{formatDate(receipt.submitted_at)}</span>
        </div>
        <div className="sm:col-span-2">
          <span className="text-gray-500">Origen: </span>
          <span className="font-medium text-gray-900">
            {receipt.is_quick
              ? 'Ingreso rápido (sin proveedor)'
              : (
                <>
                  {supplier?.name ?? 'Proveedor'}
                  {supplier?.ruc ? ` · RUC ${supplier.ruc}` : ''}
                </>
              )}
          </span>
        </div>
        {!receipt.is_quick && (
          <>
            <div>
              <span className="text-gray-500">Tipo doc.: </span>
              <span className="font-medium text-gray-900">
                {receiptDocTypeLabel(receipt)}
              </span>
            </div>
            <div>
              <span className="text-gray-500">N.° doc.: </span>
              <span className="font-medium text-gray-900">{receipt.doc_number ?? '—'}</span>
            </div>
            {!receiptUsesAuditorCostOnly(receipt) && (
              <div>
                <span className="text-gray-500">Monto declarado (sede): </span>
                <span className="font-medium text-gray-900 tabular-nums">
                  {currency(receipt.declared_total)}
                </span>
              </div>
            )}
            {receipt.status === 'approved' && receipt.declared_total > 0 && (
              <div>
                <span className="text-gray-500">Total auditado: </span>
                <span className="font-medium text-gray-900 tabular-nums">
                  {currency(receipt.declared_total)}
                </span>
              </div>
            )}
          </>
        )}
        {receipt.notes && (
          <div className="sm:col-span-2">
            <span className="text-gray-500">Notas: </span>
            <span className="text-gray-800">{receipt.notes}</span>
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Productos ingresados ({itemRows.length})
        </h4>
        {itemRows.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center border rounded-lg border-dashed">
            Sin ítems registrados
          </p>
        ) : (
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="text-xs">Producto</TableHead>
                  <TableHead className="text-xs text-right w-24">Cantidad</TableHead>
                  <TableHead className="text-xs w-36">Empaque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemRows.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm">
                      <p className="font-medium text-gray-900">{item.product_name}</p>
                      {item.product_code && (
                        <p className="text-xs text-gray-500">{item.product_code}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-right tabular-nums font-medium">
                      {item.quantity}
                    </TableCell>
                    <TableCell className="text-xs text-gray-600">
                      {uomLabel(item)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {!receipt.is_quick && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Comprobante adjunto
          </h4>
          <BranchSupplyEvidenceViewer
            variant="sede"
            evidencePath={receipt.evidence_path}
            signedUrl={signedUrl}
            loading={loadingSignedUrl}
          />
        </div>
      )}
    </div>
  );
}
