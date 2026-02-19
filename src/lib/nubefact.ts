import { supabase } from '@/lib/supabase';

export type TipoComprobante = 1 | 2 | 7; // 1=factura, 2=boleta, 7=nota crédito

export interface ClienteComprobante {
  nombre: string;
  tipo_doc?: number;   // 0=sin doc, 1=DNI, 6=RUC
  numero_doc?: string;
  email?: string;
}

export interface DocReferencia {
  tipo: number;
  serie: string;
  numero: number;
}

export interface GenerarComprobanteParams {
  school_id: string;
  transaction_id?: string;
  tipo: TipoComprobante;
  cliente?: ClienteComprobante;
  monto_total: number;
  doc_ref?: DocReferencia; // solo para nota de crédito
}

export interface ComprobanteResultado {
  success: boolean;
  documento?: {
    id: string;
    serie: string;
    numero: number;
    enlace_pdf: string | null;
    enlace_xml: string | null;
    estado: string;
  };
  nubefact?: {
    enlace_del_pdf?: string;
    enlace_del_xml?: string;
    aceptada_por_sunat?: boolean;
    errors?: string;
  };
  error?: string;
}

/**
 * Genera un comprobante electrónico a través de Nubefact.
 * 
 * Uso:
 *   const result = await generarBoleta({ school_id, transaction_id, monto_total: 50, cliente: { nombre: 'Juan' } });
 *   const result = await generarFactura({ school_id, monto_total: 100, cliente: { nombre: 'Empresa SAC', tipo_doc: 6, numero_doc: '20123456789' } });
 *   const result = await generarNotaCredito({ school_id, monto_total: 50, doc_ref: { tipo: 2, serie: 'B001', numero: 1 } });
 */
export async function generarComprobante(params: GenerarComprobanteParams): Promise<ComprobanteResultado> {
  try {
    const { data, error } = await supabase.functions.invoke('generate-document', {
      body: params,
    });

    if (error) throw error;
    return data as ComprobanteResultado;
  } catch (err: any) {
    console.error('Error generando comprobante:', err);
    return { success: false, error: err?.message || 'Error al generar comprobante' };
  }
}

/** Genera una Boleta de Venta (tipo 2) */
export const generarBoleta = (params: Omit<GenerarComprobanteParams, 'tipo'>) =>
  generarComprobante({ ...params, tipo: 2 });

/** Genera una Factura (tipo 1) */
export const generarFactura = (params: Omit<GenerarComprobanteParams, 'tipo'>) =>
  generarComprobante({ ...params, tipo: 1 });

/** Genera una Nota de Crédito (tipo 7) */
export const generarNotaCredito = (params: Omit<GenerarComprobanteParams, 'tipo'>) =>
  generarComprobante({ ...params, tipo: 7 });

/** Verifica si una sede tiene configuración de facturación activa */
export async function tieneConfigFacturacion(school_id: string): Promise<boolean> {
  const { data } = await supabase
    .from('billing_config')
    .select('id')
    .eq('school_id', school_id)
    .eq('activo', true)
    .single();
  return !!data;
}
