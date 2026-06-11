/**
 * Visor de comprobante físico (bucket privado branch_supply_evidence).
 * Compartido entre panel de auditoría y modal de detalle de sede.
 */

import { FileSearch, Loader2, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export type EvidenceViewerVariant = 'audit' | 'sede';

interface BranchSupplyEvidenceViewerProps {
  evidencePath: string | null;
  signedUrl:    string | null;
  loading:      boolean;
  /** audit: alerta de riesgo si falta archivo; sede: mensaje informativo */
  variant?:     EvidenceViewerVariant;
  className?:   string;
}

export function BranchSupplyEvidenceViewer({
  evidencePath,
  signedUrl,
  loading,
  variant = 'audit',
  className = 'min-h-[200px]',
}: BranchSupplyEvidenceViewerProps) {
  if (!evidencePath) {
    if (variant === 'audit') {
      return (
        <Alert variant="destructive" className="m-4">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>OPERACIÓN DE RIESGO</AlertTitle>
          <AlertDescription>
            Sin comprobante físico adjunto. El administrador de sede envió este registro
            sin documento de soporte. Rechaza e instruye a la sede a reenviar con evidencia.
          </AlertDescription>
        </Alert>
      );
    }
    return (
      <div className={`flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-gray-500 text-sm p-6 ${className}`}>
        Sin comprobante adjunto
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`flex items-center justify-center text-gray-400 ${className}`}>
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        <span className="text-sm">Cargando documento...</span>
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div className={`flex flex-col items-center justify-center text-gray-400 gap-2 p-8 text-center ${className}`}>
        <FileSearch className="h-10 w-10 opacity-50" />
        <p className="text-sm">No se pudo generar el enlace seguro para el comprobante.</p>
        <p className="text-xs">Intenta cerrar y volver a abrir el detalle.</p>
      </div>
    );
  }

  const isPdf = evidencePath.toLowerCase().includes('.pdf');

  return (
    <div className={`overflow-hidden rounded-lg border border-gray-200 bg-gray-50 ${className}`}>
      {isPdf ? (
        <iframe
          src={signedUrl}
          title="Comprobante físico"
          className="w-full min-h-[240px] h-[320px] border-0"
        />
      ) : (
        <div className="flex items-start justify-center overflow-auto max-h-[320px] p-3">
          <img
            src={signedUrl}
            alt="Comprobante físico"
            className="max-w-full h-auto object-contain rounded shadow-sm"
          />
        </div>
      )}
    </div>
  );
}
