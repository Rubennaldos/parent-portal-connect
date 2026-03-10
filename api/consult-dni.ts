// api/consult-dni.ts
// Función serverless de Vercel — proxy para apis.net.pe (evita CORS)
// Llamada desde el frontend: POST /api/consult-dni
// Body: { tipo: 'dni' | 'ruc', numero: string }

import type { VercelRequest, VercelResponse } from '@vercel/node';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type')
      .end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

  const { tipo, numero } = req.body ?? {};

  if (!tipo || !numero) {
    return res.status(400).json({ success: false, error: 'Faltan parámetros: tipo y numero' });
  }

  const tipoLimpio   = String(tipo).toLowerCase().trim() as 'dni' | 'ruc';
  const numeroLimpio = String(numero).replace(/\D/g, '').trim();

  if (tipoLimpio === 'dni' && numeroLimpio.length !== 8) {
    return res.status(400).json({ success: false, error: 'El DNI debe tener 8 dígitos.' });
  }
  if (tipoLimpio === 'ruc' && numeroLimpio.length !== 11) {
    return res.status(400).json({ success: false, error: 'El RUC debe tener 11 dígitos.' });
  }

  // Intentar v2 primero, luego v1 como fallback
  const urls = tipoLimpio === 'ruc'
    ? [
        `https://api.apis.net.pe/v2/sunat/ruc?numero=${numeroLimpio}`,
        `https://api.apis.net.pe/v1/ruc?numero=${numeroLimpio}`,
      ]
    : [
        `https://api.apis.net.pe/v2/reniec/dni?numero=${numeroLimpio}`,
        `https://api.apis.net.pe/v1/dni?numero=${numeroLimpio}`,
      ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) continue;

      const data = await response.json() as Record<string, unknown>;
      if (!data || (data as any).error) continue;

      const result = normalizar(tipoLimpio, numeroLimpio, data);
      if (result.success) {
        return res.status(200).setHeader('Access-Control-Allow-Origin', '*').json(result);
      }
    } catch {
      // Intenta siguiente URL
    }
  }

  return res.status(200).setHeader('Access-Control-Allow-Origin', '*').json({
    success: false,
    error: `${tipoLimpio.toUpperCase()} no encontrado en los registros oficiales.`,
  });
}

// ─────────────────────────────────────────────────────────────
// Normalizar respuesta de apis.net.pe a nuestro formato
// ─────────────────────────────────────────────────────────────
function normalizar(
  tipo: 'dni' | 'ruc',
  numero: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (tipo === 'ruc') {
    const rsocial = (data.razonSocial ?? data.razon_social ?? data.nombre ?? '') as string;
    if (!rsocial) return { success: false, error: 'RUC no encontrado en SUNAT.' };

    const partes: string[] = [];
    if (data.tipoVia)    partes.push(data.tipoVia as string);
    if (data.nombreVia)  partes.push(data.nombreVia as string);
    if (data.numero)     partes.push(`Nro. ${data.numero}`);
    if (data.interior)   partes.push(`Int. ${data.interior}`);
    if (data.distrito)   partes.push(data.distrito as string);
    if (data.provincia)  partes.push(data.provincia as string);
    if (data.departamento) partes.push(data.departamento as string);

    const direccion = (
      data.direccion ?? data.domicilioFiscal ?? data.domicilio_fiscal ?? partes.join(' ').trim() ?? ''
    ) as string;

    return {
      success:      true,
      tipo:         'ruc',
      numero:       (data.ruc as string) || numero,
      razon_social: rsocial,
      nombre_comercial: (data.nombreComercial ?? '') as string,
      direccion,
      estado:       (data.estado     ?? '') as string,
      condicion:    (data.condicion  ?? '') as string,
      activo:       ((data.estado as string) ?? '').toUpperCase() === 'ACTIVO',
    };
  } else {
    const nombre = [data.apellidoPaterno, data.apellidoMaterno, data.nombres]
      .filter(Boolean).join(' ')
      || (data.nombre as string)
      || (data.nombreCompleto as string)
      || (data.nombre_completo as string)
      || '';
    if (!nombre) return { success: false, error: 'DNI no encontrado en RENIEC.' };

    return {
      success:          true,
      tipo:             'dni',
      numero:           (data.dni as string) || numero,
      razon_social:     nombre,
      nombre,
      apellido_paterno: (data.apellidoPaterno ?? '') as string,
      apellido_materno: (data.apellidoMaterno ?? '') as string,
      nombres:          (data.nombres         ?? '') as string,
      direccion:        '',
      codigo_verificacion: (data.codigoVerificacion ?? '') as string,
    };
  }
}
