// api/cron/check-invoice-status.ts
// ============================================================
// CRON JOB — Poller de comprobantes en estado 'processing'
// ============================================================
// Llamado por Vercel Cron (vercel.json) cada 5 minutos.
// Vercel agrega automáticamente: Authorization: Bearer <CRON_SECRET>
//
// Lógica:
//   1. Verificar CRON_SECRET (seguridad)
//   2. Invocar la Edge Function check-invoice-status en Supabase
//   3. Devolver el resultado del poller
//
// Variables de entorno requeridas:
//   CRON_SECRET               — Vercel lo genera automáticamente
//   SUPABASE_URL              — URL del proyecto Supabase
//   SUPABASE_SERVICE_ROLE_KEY — Clave de servicio (nunca exponer al frontend)
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // ── Seguridad: verificar CRON_SECRET ─────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET no configurado.' });
  }
  const authHeader = req.headers['authorization'] ?? '';
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'No autorizado.' });
  }

  // ── Invocar Edge Function via cliente service_role ────────────────────────
  const supabaseUrl    = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.',
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.functions.invoke('check-invoice-status', {
    body: { triggered_by: 'vercel_cron' },
  });

  if (error) {
    console.error('[cron/check-invoice-status] Error al invocar Edge Function:', error);
    return res.status(500).json({ error: error.message, details: error });
  }

  return res.status(200).json({ ok: true, ...data });
}
