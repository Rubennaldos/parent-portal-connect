/**
 * bootstrap.ts — Registro centralizado de todos los reportes del sistema.
 *
 * IMPORTANTE: Este archivo debe importarse una sola vez como efecto secundario.
 * Úsalo en ReportsCenter.tsx (o la entrada del módulo) con:
 *   import '@/modules/reports/bootstrap';
 *
 * Para agregar un nuevo reporte: añade una llamada a registerReport() aquí.
 * No abras BaseReportView ni ReportsCenter para "insertar un if más".
 */

import { createElement } from 'react';
import { registerReport } from '@/modules/reports/registry';

import { SalesReport } from '@/modules/reports/features/ventas/SalesReport';
import {
  SALES_REPORT_ID,
  SALES_REPORT_TITLE,
  SALES_REPORT_DESCRIPTION,
} from '@/modules/reports/features/ventas/description';

import { PaymentsReport } from '@/modules/reports/features/movimientos/PaymentsReport';
import {
  PAYMENTS_REPORT_ID,
  PAYMENTS_REPORT_TITLE,
  PAYMENTS_REPORT_DESCRIPTION,
} from '@/modules/reports/features/movimientos/description';

import type { ReportFilters } from '@/modules/reports/types';

registerReport({
  id: SALES_REPORT_ID,
  title: SALES_REPORT_TITLE,
  description: SALES_REPORT_DESCRIPTION,
  requiredRoles: ['admin_general'],
  component: (props: { filters: ReportFilters }) =>
    createElement(SalesReport, { filters: props.filters }),
});

registerReport({
  id: PAYMENTS_REPORT_ID,
  title: PAYMENTS_REPORT_TITLE,
  description: PAYMENTS_REPORT_DESCRIPTION,
  requiredRoles: ['admin_general'],
  component: (props: { filters: ReportFilters }) =>
    createElement(PaymentsReport, { filters: props.filters }),
});
