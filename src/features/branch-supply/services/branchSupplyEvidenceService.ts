/**
 * Servicio de evidencia documental para comprobantes de suministro de sede.
 *
 * Responsabilidad única: subida + URL firmada + limpieza de archivos huérfanos.
 * Bucket: branch_supply_evidence (privado, políticas RLS scoped por school_id).
 *
 * Convención de path: {school_id}/{receipt_uuid}/{filename_sanitizado}
 * Esta convención es OBLIGATORIA para que la política RLS de Storage permita
 * el INSERT (split_part(name, '/', 1) = school_id del perfil del usuario).
 *
 * Flujo seguro para evitar archivos huérfanos:
 *   1. uploadEvidence(file, schoolId, receiptUuid) → storagePath
 *   2. Pasar storagePath al RPC submit_branch_supply_receipt
 *   3. Si el RPC falla → llamar deleteOrphanedEvidence(storagePath)
 */

import { supabase } from '@/lib/supabase';

// ── Constantes del bucket ──────────────────────────────────────────────────────

const BUCKET = 'branch_supply_evidence';

/** Tamaño máximo: 15 MB (igual al bucket). Validación previa en cliente. */
const MAX_BYTES = 15 * 1024 * 1024;

/** Imágenes: reducir a máx 1400px para mantener legibilidad de facturas. */
const MAX_PX    = 1400;
const JPEG_Q    = 0.82;

/** URL firmada válida 15 minutos para el visor del formulario. */
const SIGNED_URL_SECONDS = 60 * 15;

// ── Compresión de imagen (solo JPEG/PNG/WebP; PDFs pasan directo) ──────────────

function isPdf(file: File): boolean {
  return file.type === 'application/pdf';
}

async function compressImageFile(file: File): Promise<Blob> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    const drawAndExport = (source: HTMLImageElement | HTMLCanvasElement) => {
      let { width, height } = source instanceof HTMLImageElement
        ? source : { width: source.width, height: source.height };
      if (width > MAX_PX || height > MAX_PX) {
        const ratio = Math.min(MAX_PX / width, MAX_PX / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
      canvas.toBlob(
        (blob) => resolve(blob ?? new Blob([file], { type: 'image/jpeg' })),
        'image/jpeg',
        JPEG_Q,
      );
    };

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      drawAndExport(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      // Fallback FileReader para HEIC/HEIF
      const reader = new FileReader();
      reader.onload = (e) => {
        const img2 = new Image();
        img2.onload = () => drawAndExport(img2);
        img2.onerror = () => resolve(new Blob([file], { type: file.type || 'image/jpeg' }));
        img2.src = e.target?.result as string;
      };
      reader.onerror = () => resolve(new Blob([file], { type: file.type || 'image/jpeg' }));
      reader.readAsDataURL(file);
    };

    img.src = objectUrl;
  });
}

// ── API pública ────────────────────────────────────────────────────────────────

export interface EvidenceUploadOptions {
  onProgress?: (pct: number) => void;
  signal?:     AbortSignal;
}

export interface EvidenceUploadResult {
  /** Ruta relativa en el bucket (persistir en BD, no la URL). */
  storagePath: string;
}

/**
 * Sube el comprobante físico al bucket branch_supply_evidence.
 *
 * @param file        Archivo del usuario (imagen o PDF).
 * @param schoolId    ID de la sede; DEBE ser el primer segmento del path (RLS).
 * @param receiptUuid UUID generado en cliente; se incluye en el path para unicidad.
 */
export async function uploadEvidence(
  file:       File,
  schoolId:   string,
  receiptUuid: string,
  opts:       EvidenceUploadOptions = {},
): Promise<EvidenceUploadResult> {
  if (!supabase) throw new Error('Supabase no está configurado.');
  if (file.size > MAX_BYTES) {
    throw new Error(`El archivo supera el límite de 15 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).`);
  }

  const { onProgress, signal } = opts;

  if (signal?.aborted) throw Object.assign(new Error('Subida cancelada.'), { name: 'AbortError' });

  // Sanitizar nombre de archivo: solo alfanumérico, puntos y guiones
  const safeName = file.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);

  const storagePath = `${schoolId}/${receiptUuid}/${Date.now()}_${safeName}`;

  // PDFs → subir directo; imágenes → comprimir primero
  const payload = isPdf(file) ? file : await compressImageFile(file);

  const contentType = isPdf(file) ? 'application/pdf' : 'image/jpeg';

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (signal?.aborted) throw Object.assign(new Error('Subida cancelada.'), { name: 'AbortError' });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const uploadOpts: any = { upsert: false, contentType };
      if (onProgress) {
        uploadOpts.onUploadProgress = (ev: { loaded: number; total: number }) => {
          if (ev?.total > 0) onProgress(Math.round((ev.loaded / ev.total) * 100));
        };
      }

      const { data, error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, payload, uploadOpts);

      if (error) {
        lastError = new Error(error.message);
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1500 * attempt + Math.random() * 400));
        }
        continue;
      }

      return { storagePath: data.path };

    } catch (networkErr: unknown) {
      lastError = networkErr instanceof Error ? networkErr : new Error(String(networkErr));
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1500 * attempt + Math.random() * 400));
      }
    }
  }

  throw lastError ?? new Error('Error al subir el comprobante. Intenta de nuevo.');
}

/**
 * Devuelve una URL firmada (15 min) para previsualizar el comprobante en el formulario.
 * No expone URLs públicas; el bucket es privado.
 */
export async function getEvidenceSignedUrl(storagePath: string): Promise<string> {
  if (!supabase) throw new Error('Supabase no está configurado.');

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error('No se pudo generar el enlace del comprobante.');
  }

  return data.signedUrl;
}

/**
 * Elimina un archivo huérfano cuando el submit del RPC falla después de subir.
 * No lanza excepción: el cleanup es best-effort.
 */
export async function deleteOrphanedEvidence(storagePath: string): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.storage.from(BUCKET).remove([storagePath]);
  } catch {
    // Silencioso: el admin puede limpiar manualmente si hiciera falta
  }
}
