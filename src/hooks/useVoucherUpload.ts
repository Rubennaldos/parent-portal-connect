/**
 * Hook React que envuelve voucherUploadService.
 *
 * Responsabilidad: gestionar el estado de UI de la subida (progreso, etiqueta)
 * y proporcionar un AbortController que cancela la operación si el componente
 * se desmonta antes de completarla (cierra el memory leak de los callbacks).
 *
 * No contiene lógica de negocio ni queries a la BD.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  uploadVoucherImage,
  deleteOrphanedFile,
  type UploadResult,
} from '@/services/voucherUploadService';

export interface VoucherUploadSlice {
  /** Índice de esta imagen dentro del lote (0-based). */
  imageIndex?: number;
  /** Total de imágenes del lote (para calcular el rango de progreso). */
  totalImages?: number;
  /** Etiqueta para la barra de progreso durante esta subida. */
  phaseLabel?: string;
}

export interface UseVoucherUploadReturn {
  /** Inicia la subida de un archivo. Devuelve { publicUrl, storagePath }. */
  upload: (file: File, userId: string, slice?: VoucherUploadSlice) => Promise<UploadResult>;
  /** Borra un archivo huérfano si el INSERT en BD falla. */
  deleteOrphanedFile: typeof deleteOrphanedFile;
  /** Progreso global de la subida (0-100) o null si no hay subida activa. */
  uploadProgress: number | null;
  /** Texto descriptivo para la barra de progreso. */
  uploadPhaseLabel: string;
  /** Fija el progreso manualmente (útil para la etapa de "Guardando registro..."). */
  setUploadProgress: (v: number | null) => void;
  /** Fija la etiqueta manualmente. */
  setUploadPhaseLabel: (v: string) => void;
  /** Resetea progreso y etiqueta al estado inicial. */
  reset: () => void;
}

export function useVoucherUpload(): UseVoucherUploadReturn {
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadPhaseLabel, setUploadPhaseLabel] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  // Cancelar subida en curso cuando el componente se desmonta
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const upload = useCallback(
    async (
      file: File,
      userId: string,
      slice: VoucherUploadSlice = {},
    ): Promise<UploadResult> => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const totalImages = slice.totalImages ?? 1;
      const imageIndex  = slice.imageIndex  ?? 0;
      const imageSlice  = Math.floor(94 / totalImages);
      const baseOffset  = imageSlice * imageIndex;

      if (slice.phaseLabel) setUploadPhaseLabel(slice.phaseLabel);

      return uploadVoucherImage(file, userId, {
        signal: controller.signal,
        onProgress: (pct) => {
          setUploadProgress(baseOffset + Math.round((pct * imageSlice) / 100));
        },
        onRetry: (attempt) => {
          setUploadPhaseLabel(`Reintentando subida (${attempt}/3)...`);
          toast({
            title: '♻️ Reintentando subida automática...',
            description: `Intento ${attempt} de 3. Mantén tu conexión activa un momento.`,
            duration: 5000,
          });
        },
      });
    },
    [toast],
  );

  const reset = useCallback(() => {
    setUploadProgress(null);
    setUploadPhaseLabel('');
  }, []);

  return {
    upload,
    deleteOrphanedFile,
    uploadProgress,
    uploadPhaseLabel,
    setUploadProgress,
    setUploadPhaseLabel,
    reset,
  };
}
