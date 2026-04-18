/**
 * Servicio de subida de comprobantes de pago (vouchers).
 *
 * Responsabilidad única: compresión de imagen + upload a Supabase Storage.
 * No importa React. No toca estado UI. Testeable de forma aislada.
 *
 * Flujo correcto para evitar registros huérfanos en Storage:
 *   1. Llamar uploadVoucherImage → obtener { publicUrl, storagePath }
 *   2. Insertar en BD con publicUrl
 *   3. Si el INSERT falla → llamar deleteOrphanedFile(storagePath)
 */

import { supabase } from '@/lib/supabase';

const VOUCHER_MAX_PX = 1000;
const VOUCHER_QUALITY = 0.70;

export interface UploadResult {
  publicUrl: string;
  /** Ruta relativa dentro del bucket "vouchers" — usada para borrar si el INSERT falla. */
  storagePath: string;
}

export interface UploadOptions {
  /** Callback de progreso 0-100 para cada intento exitoso. */
  onProgress?: (pct: number) => void;
  /** Llamado al inicio de cada reintento (attempt >= 2). */
  onRetry?: (attempt: number) => void;
  /** AbortSignal para cancelar la subida cuando el componente se desmonta. */
  signal?: AbortSignal;
}

/**
 * Comprime file a JPEG (máx 1000px, calidad 70%).
 * Soporta HEIC/HEIF vía fallback FileReader.
 * No depende de AbortSignal porque canvas.toBlob no es cancelable;
 * el resultado se descarta si la promesa exterior ya fue abortada.
 */
export async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve) => {
    const convertViaCanvas = (src: string) => {
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(src);
        let { width, height } = img;
        if (width > VOUCHER_MAX_PX || height > VOUCHER_MAX_PX) {
          const ratio = Math.min(VOUCHER_MAX_PX / width, VOUCHER_MAX_PX / height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => resolve(blob ?? new Blob([file], { type: 'image/jpeg' })),
          'image/jpeg',
          VOUCHER_QUALITY,
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(src);
        // Fallback para HEIC/WebP que el browser no decodifica via blob URL.
        const reader = new FileReader();
        reader.onload = (e) => {
          const img2 = new Image();
          img2.onload = () => {
            let { width, height } = img2;
            if (width > VOUCHER_MAX_PX || height > VOUCHER_MAX_PX) {
              const ratio = Math.min(VOUCHER_MAX_PX / width, VOUCHER_MAX_PX / height);
              width  = Math.round(width  * ratio);
              height = Math.round(height * ratio);
            }
            const canvas2 = document.createElement('canvas');
            canvas2.width  = width;
            canvas2.height = height;
            const ctx2 = canvas2.getContext('2d')!;
            ctx2.fillStyle = '#ffffff';
            ctx2.fillRect(0, 0, width, height);
            ctx2.drawImage(img2, 0, 0, width, height);
            canvas2.toBlob(
              (blob) => resolve(blob ?? new Blob([file], { type: 'image/jpeg' })),
              'image/jpeg',
              VOUCHER_QUALITY,
            );
          };
          img2.onerror = () => {
            // Último recurso: subir el binario original sin comprimir.
            resolve(new Blob([file], { type: file.type || 'image/jpeg' }));
          };
          img2.src = e.target?.result as string;
        };
        reader.onerror = () => resolve(new Blob([file], { type: file.type || 'image/jpeg' }));
        reader.readAsDataURL(file);
      };

      img.src = src;
    };

    convertViaCanvas(URL.createObjectURL(file));
  });
}

/**
 * Sube un archivo de voucher a Supabase Storage con hasta 3 reintentos.
 * Devuelve { publicUrl, storagePath } para que el caller pueda limpiar
 * el archivo si el INSERT en BD falla después.
 *
 * Lanza Error con mensaje legible para el usuario si todos los intentos fallan.
 */
export async function uploadVoucherImage(
  file: File,
  userId: string,
  opts: UploadOptions = {},
): Promise<UploadResult> {
  const { onProgress, onRetry, signal } = opts;
  const compressed = await compressImage(file);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (signal?.aborted) {
      throw Object.assign(new Error('Subida cancelada.'), { name: 'AbortError' });
    }

    if (attempt > 1) {
      onRetry?.(attempt);
    }

    try {
      const storagePath = `${userId}/voucher_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const uploadOptions: any = { upsert: false, contentType: 'image/jpeg' };
      if (onProgress) {
        uploadOptions.onUploadProgress = (ev: { loaded: number; total: number }) => {
          if (ev?.total > 0) onProgress(Math.round((ev.loaded / ev.total) * 100));
        };
      }

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('vouchers')
        .upload(storagePath, compressed, uploadOptions);

      if (uploadError) {
        console.error(`[Voucher] Intento ${attempt}/3:`, uploadError.message, (uploadError as any)?.statusCode);
        lastError = Object.assign(new Error(uploadError.message), {
          statusCode: (uploadError as any)?.statusCode,
        });
        if (attempt < 3) {
          // Backoff exponencial con jitter para redes móviles
          await new Promise(r => setTimeout(r, (1500 * attempt) + Math.random() * 500));
        }
        continue;
      }

      const { data: { publicUrl } } = supabase.storage.from('vouchers').getPublicUrl(uploadData.path);
      return { publicUrl, storagePath: uploadData.path };

    } catch (networkErr: unknown) {
      if ((networkErr as Error)?.name === 'AbortError') throw networkErr;
      console.error(`[Voucher] Error de red intento ${attempt}/3:`, networkErr);
      lastError = networkErr instanceof Error ? networkErr : new Error('Error de red');
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, (1500 * attempt) + Math.random() * 500));
      }
    }
  }

  throw new Error(classifyUploadError(lastError));
}

/**
 * Borra un archivo huérfano del bucket "vouchers".
 * Se llama cuando el INSERT en BD falla después de una subida exitosa.
 * Fallo silencioso: si ya fue borrado o no existe, no lanza error.
 */
export async function deleteOrphanedFile(storagePath: string): Promise<void> {
  try {
    await supabase.storage.from('vouchers').remove([storagePath]);
    console.info('[Voucher] Archivo huérfano eliminado:', storagePath);
  } catch (err) {
    console.warn('[Voucher] No se pudo limpiar archivo huérfano:', storagePath, err);
  }
}

// ── Helpers privados ────────────────────────────────────────────────────────

function classifyUploadError(lastError: Error | null): string {
  const msg  = lastError?.message?.toLowerCase() ?? '';
  const code = String((lastError as any)?.statusCode ?? '');

  if (code === '413' || msg.includes('413') || msg.includes('payload too large') || msg.includes('too large')) {
    return 'La imagen es demasiado pesada. Toma una captura de pantalla del comprobante en lugar de adjuntar la foto original (la captura pesa mucho menos).';
  }
  if (code === '403' || msg.includes('403') || msg.includes('not allowed') || msg.includes('permission')) {
    return 'El servidor rechazó la imagen por restricciones de seguridad. Usa una imagen JPG o PNG estándar y vuelve a intentar.';
  }
  if (lastError?.name === 'AbortError' || msg.includes('timeout') || msg.includes('timed out')) {
    return 'La subida está tardando demasiado. Intenta conectarte a WiFi en lugar de datos móviles.';
  }
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('failed to fetch') || msg.includes('load failed')) {
    return 'No se pudo conectar con el servidor. Verifica que tienes internet activo. Si usas datos móviles, prueba cambiando a WiFi.';
  }
  return `No se pudo subir la foto del comprobante. ${lastError?.message || 'Intenta de nuevo en unos minutos.'}`;
}
