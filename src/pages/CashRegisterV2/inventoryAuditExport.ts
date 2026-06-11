/**
 * Exportaciones del reporte de auditoría de inventario.
 * Solo formatea datos ya calculados en PostgreSQL (sin sumar en cliente).
 */
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

export interface Movimiento {
  hora_exacta: string;
  ticket_id: string;
  ticket_code: string;
  categoria: string;
  producto: string;
  vendedor: string;
  precio_unitario: number;
  cantidad: number;
  monto_linea: number;
}

export interface ConsolidadoLinea {
  producto: string;
  cantidad_total: number;
  total_recaudado: number;
}

export interface Resumen {
  total_unidades: number;
  valor_total: number;
  total_tickets: number;
  participacion_total_pct?: number;
}

export interface ReportData {
  fecha: string;
  generado_en: string;
  movimientos: Movimiento[];
  consolidado: ConsolidadoLinea[];
  resumen: Resumen;
}

function formatMoney(n: number): string {
  return `S/ ${Number(n).toFixed(2)}`;
}

export function formatDateLabel(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "EEEE d 'de' MMMM yyyy", { locale: es });
  } catch {
    return dateStr;
  }
}

export function exportDetailPDF(
  report: ReportData,
  date: string,
  schoolName?: string,
  schoolId?: string,
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('AUDITORÍA DE CONSUMO DIARIO — DETALLE', 14, 16);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Sede: ${schoolName ?? schoolId ?? ''}`, 14, 24);
  doc.text(`Fecha: ${formatDateLabel(report.fecha)}`, 14, 30);
  doc.text(`Generado: ${report.generado_en} (hora Lima)`, 14, 36);

  const rows = report.movimientos.map((m, i) => [
    String(i + 1),
    m.hora_exacta,
    m.ticket_code,
    m.categoria,
    m.producto,
    m.vendedor,
    formatMoney(m.precio_unitario),
    String(m.cantidad),
    formatMoney(m.monto_linea),
  ]);

  autoTable(doc, {
    startY: 42,
    head: [['#', 'Hora', 'Ticket', 'Tipo', 'Producto', 'Vendedor', 'P.Unit.', 'Cant.', 'Total Línea']],
    body: rows,
    styles: { fontSize: 7.5, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    foot: [[
      '', '', '', '', '', 'TOTALES', '',
      String(report.resumen.total_unidades),
      formatMoney(report.resumen.valor_total),
    ]],
    footStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
  });

  doc.save(`auditoria_inventario_detalle_${date}.pdf`);
}

export function exportDetailExcel(
  report: ReportData,
  date: string,
  schoolName?: string,
  schoolId?: string,
) {
  const rows = report.movimientos.map((m, i) => ({
    '#': i + 1,
    'Hora Exacta': m.hora_exacta,
    Ticket: m.ticket_code,
    Tipo: m.categoria,
    Producto: m.producto,
    Vendedor: m.vendedor,
    'Precio Unitario': m.precio_unitario,
    Cantidad: m.cantidad,
    'Total Línea': m.monto_linea,
  }));

  rows.push({
    '#': '' as unknown as number,
    'Hora Exacta': '',
    Ticket: '',
    Tipo: '',
    Producto: '',
    Vendedor: 'TOTALES',
    'Precio Unitario': '' as unknown as number,
    Cantidad: report.resumen.total_unidades,
    'Total Línea': report.resumen.valor_total,
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 16 }, { wch: 14 },
    { wch: 40 }, { wch: 28 }, { wch: 15 }, { wch: 10 }, { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Detalle Tickets');
  appendMetaSheet(wb, report, schoolName, schoolId);
  XLSX.writeFile(wb, `auditoria_inventario_detalle_${date}.xlsx`);
}

export function exportConsolidatedExcel(
  report: ReportData,
  date: string,
  schoolName?: string,
  schoolId?: string,
) {
  const wb = XLSX.utils.book_new();
  const ws: XLSX.WorkSheet = {};
  const set = (cell: string, v: unknown) => { ws[cell] = { v }; };

  const sede = schoolName ?? schoolId ?? '';
  const dataStart = 8;
  const lastDataRow = dataStart + report.consolidado.length - 1;
  const totalsRow = lastDataRow + 2;

  set('A1', 'CONSOLIDADO DE VENTAS — AUDITORÍA DE INVENTARIO');
  set('A2', `Sede: ${sede}`);
  set('A3', `Fecha: ${formatDateLabel(report.fecha)}   |   Generado (Lima): ${report.generado_en}`);
  set('A5', 'Tickets / Boletas'); set('B5', report.resumen.total_tickets);

  const headers = ['Producto', 'Cantidad Total Vendida', 'Total Recaudado (S/)'];
  headers.forEach((h, i) => set(`${String.fromCharCode(65 + i)}7`, h));

  report.consolidado.forEach((line, idx) => {
    const row = dataStart + idx;
    set(`A${row}`, line.producto);
    ws[`B${row}`] = { v: line.cantidad_total, t: 'n' };
    ws[`C${row}`] = { v: line.total_recaudado, t: 'n' };
  });

  if (report.consolidado.length > 0) {
    set(`A${totalsRow}`, 'TOTALES GENERALES');
    ws[`B${totalsRow}`] = { f: `SUM(B${dataStart}:B${lastDataRow})`, t: 'n' };
    ws[`C${totalsRow}`] = { f: `SUM(C${dataStart}:C${lastDataRow})`, t: 'n' };
  } else {
    set(`A${totalsRow}`, 'TOTALES GENERALES');
    ws[`B${totalsRow}`] = { v: 0, t: 'n' };
    ws[`C${totalsRow}`] = { v: 0, t: 'n' };
  }

  ws['!ref'] = `A1:C${totalsRow}`;
  ws['!cols'] = [{ wch: 48 }, { wch: 24 }, { wch: 24 }];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 2 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Consolidado de Ventas');

  const winchaRows: (string | number)[][] = [
    ['AUDITORÍA — WINCHA 80mm'],
    [sede],
    [formatDateLabel(report.fecha)],
    [`Generado: ${report.generado_en}`],
    [''],
    ['PRODUCTO', 'CANT', 'TOTAL'],
    ...report.consolidado.map((l) => [
      l.producto,
      l.cantidad_total,
      formatMoney(l.total_recaudado),
    ]),
    [''],
    ['TOTAL UNIDADES', report.resumen.total_unidades, ''],
    ['VALOR MERCANCÍA', '', formatMoney(report.resumen.valor_total)],
    ['TICKETS', report.resumen.total_tickets, ''],
  ];
  const wsWincha = XLSX.utils.aoa_to_sheet(winchaRows);
  wsWincha['!cols'] = [{ wch: 36 }, { wch: 8 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsWincha, 'Vista Wincha 80mm');

  appendMetaSheet(wb, report, schoolName, schoolId);
  XLSX.writeFile(wb, `reporte_consolidado_productos_${date}.xlsx`);
}

function appendMetaSheet(
  wb: XLSX.WorkBook,
  report: ReportData,
  schoolName?: string,
  schoolId?: string,
) {
  const meta = XLSX.utils.aoa_to_sheet([
    ['Campo', 'Valor'],
    ['Sede', schoolName ?? schoolId ?? ''],
    ['Fecha', report.fecha],
    ['Generado (Lima)', report.generado_en],
    ['Total Tickets', report.resumen.total_tickets],
    ['Total Unidades', report.resumen.total_unidades],
    ['Valor Total (S/)', report.resumen.valor_total],
    ['Líneas consolidadas', report.consolidado.length],
    ['Líneas detalle', report.movimientos.length],
  ]);
  XLSX.utils.book_append_sheet(wb, meta, 'Resumen');
}

export function printConsolidatedWincha(
  report: ReportData,
  schoolName?: string,
  schoolId?: string,
) {
  const sede = (schoolName ?? schoolId ?? 'SEDE').toUpperCase();
  const lines = report.consolidado
    .map((l) => {
      const name = l.producto.length > 22 ? `${l.producto.slice(0, 21)}…` : l.producto;
      const qty = String(l.cantidad_total).padStart(3, ' ');
      const total = formatMoney(l.total_recaudado).padStart(10, ' ');
      return `<div class="line"><span class="name">${escapeHtml(name)}</span><span class="qty">${qty}</span><span class="amt">${escapeHtml(total.trim())}</span></div>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Wincha Totales</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 80mm; margin: 0; padding: 2mm;
    font-family: 'Courier New', Courier, monospace;
    font-size: 10pt; line-height: 1.25; color: #000; background: #fff;
  }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .sep { border-top: 1px dashed #000; margin: 2mm 0; }
  .line {
    display: grid;
    grid-template-columns: 1fr 8mm 14mm;
    gap: 1mm;
    font-size: 9pt;
    margin: 0.5mm 0;
  }
  .name { text-align: left; overflow: hidden; }
  .qty { text-align: center; }
  .amt { text-align: right; }
  .total-row {
    display: flex; justify-content: space-between;
    font-weight: bold; font-size: 10pt; margin: 1mm 0;
  }
  @media print {
    html, body { width: 80mm; margin: 0; padding: 2mm; }
    .no-print { display: none !important; }
  }
</style></head><body>
  <div class="center bold" style="font-size:11pt">AUDITORÍA DE SALIDA</div>
  <div class="center bold">${escapeHtml(sede)}</div>
  <div class="center">${escapeHtml(formatDateLabel(report.fecha))}</div>
  <div class="center" style="font-size:8pt">Gen: ${escapeHtml(report.generado_en)} Lima</div>
  <div class="sep"></div>
  <div class="line bold" style="font-size:8pt">
    <span class="name">PRODUCTO</span><span class="qty">CANT</span><span class="amt">TOTAL</span>
  </div>
  <div class="sep"></div>
  ${lines || '<div class="center">Sin ventas registradas</div>'}
  <div class="sep"></div>
  <div class="total-row"><span>UNIDADES</span><span>${report.resumen.total_unidades}</span></div>
  <div class="total-row"><span>VALOR MERCANCÍA</span><span>${escapeHtml(formatMoney(report.resumen.valor_total))}</span></div>
  <div class="total-row"><span>TICKETS</span><span>${report.resumen.total_tickets}</span></div>
  <div class="sep"></div>
  <div class="center" style="font-size:8pt">— Fin del reporte —</div>
</body></html>`;

  const win = window.open('', '_blank', 'width=320,height=640');
  if (!win) {
    alert('Habilite ventanas emergentes para imprimir la wincha.');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.close();
  }, 300);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
