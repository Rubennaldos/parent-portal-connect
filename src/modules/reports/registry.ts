import type { ReportRegistryItem } from '@/modules/reports/types';

/**
 * Registro central de reportes (Registry Pattern — REGLA #12).
 *
 * Agregar un reporte nuevo = una llamada a registerReport().
 * Ningún layout ni página necesita crecer con if/else.
 *
 * El registro es privado: solo se accede a través de las funciones exportadas.
 */
const _registry: Record<string, Readonly<ReportRegistryItem>> = {};

/** IDs heredados: el dueño decidió abandonar estos reportes; se purgan al cargar el módulo. */
const LEGACY_REPORT_IDS = [
  'ventas-periodo',
  'ventas-itemizadas',
  'kardex-inventario',
  'arqueo-caja',
] as const;

for (const id of LEGACY_REPORT_IDS) {
  delete _registry[id];
}

/**
 * Quita un reporte del registro (ej. migración o limpieza).
 */
export const unregisterReport = (reportId: string): void => {
  delete _registry[reportId];
};

/**
 * Registra un nuevo reporte.
 * Lanza un Error explícito si el ID ya está registrado para detectar
 * colisiones de nombres en módulos distintos lo antes posible (en load time).
 */
export const registerReport = (report: ReportRegistryItem): void => {
  if (!Array.isArray(report.requiredRoles) || report.requiredRoles.length === 0) {
    throw new Error(
      `[reports/registry] requiredRoles es obligatorio para "${report.id}". ` +
        `Define al menos un rol permitido (ej: ['admin_general']).`,
    );
  }

  if (_registry[report.id]) {
    throw new Error(
      `[reports/registry] Colisión de ID: "${report.id}" ya está registrado. ` +
        `Cada reporte debe usar un ID único. Revisa los archivos que llaman a registerReport().`,
    );
  }
  _registry[report.id] = Object.freeze({ ...report });
};

export const getReportById = (reportId: string): Readonly<ReportRegistryItem> | undefined =>
  _registry[reportId];

export const getRegisteredReports = (): ReadonlyArray<Readonly<ReportRegistryItem>> =>
  Object.values(_registry);
